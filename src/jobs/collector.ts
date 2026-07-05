import { prisma } from "@/src/lib/prisma";
import { KTradeClient } from "@/src/services/ktrade/client";
import {
  closeSeriesBulk,
  normalizeTradingDate,
  portfolioSymbols,
  recordPortfolioDailyCloses,
  saveIndicatorsBulk,
  savePortfolio,
  savePortfolioPositions,
  savePortfolioSummary,
  saveQuotes,
  saveSignals,
  saveWatchlists,
  watchlistSymbols
} from "@/src/services/market-repository";
import { calculateIndicators } from "@/src/services/indicators";
import { buildPortfolioSignals, buildPositionIndicatorSignals } from "@/src/services/signals";
import { syncDailyQuotesToSheets } from "@/src/services/sheets";
import { evaluateAlerts } from "@/src/services/alerts";
import { decideCollection, markScheduledCollectionRun, type CollectionTrigger } from "@/src/services/collection-policy";
import { getMySignalPreference } from "@/src/services/my-signal-preferences";
import { runTradeEngine } from "@/src/services/trade-engine";
import { clearPendingSync } from "@/src/services/sync-queue";
import {
  beginSyncRun,
  completeSync,
  failSync,
  finishSyncStep,
  isSyncActive,
  startSyncStep
} from "@/src/services/sync-progress";
import type { SignalInput } from "@/src/types/market";

export async function collectMarketData(
  trigger: CollectionTrigger = "manual",
  options: { skipPolicyCheck?: boolean } = {}
): Promise<void> {
  if (!options.skipPolicyCheck) {
    const decision = await decideCollection(trigger);
    if (!decision.allowed) {
      await prisma.collectionRun.create({
        data: {
          status: "blocked",
          finishedAt: new Date(),
          error: decision.reason ?? "Collection blocked by policy."
        }
      });
      throw new Error(decision.reason ?? "Collection blocked by policy.");
    }
  }

  if (await isSyncActive()) {
    throw new Error("A sync is already running.");
  }

  await beginSyncRun();
  await clearPendingSync();
  const client = new KTradeClient();

  try {
    await startSyncStep("connect", "Launching browser & connecting to KTrade");
    await client.connect();
    await finishSyncStep("connect");

    await startSyncStep("login", "Logging in to KTrade");
    await client.login();
    await finishSyncStep("login");

    await startSyncStep("portfolio", "Fetching portfolio positions");
    const portfolioPositions = await client.fetchPortfolioPositions();
    await savePortfolioPositions(portfolioPositions);
    await recordPortfolioDailyCloses(portfolioPositions);
    await finishSyncStep("portfolio", `${portfolioPositions.length} positions`);

    await startSyncStep("summary", "Fetching portfolio summary");
    const portfolioSummary = await client.fetchPortfolioSummary();
    await savePortfolioSummary(portfolioSummary);
    await finishSyncStep("summary");

    await startSyncStep("watchlists", "Saving watchlists");
    const watchlists =
      portfolioPositions.length > 0
        ? [
            {
              name: "KTrade Portfolio",
              symbols: portfolioPositions.map((position) => ({ symbol: position.symbol, name: position.name }))
            }
          ]
        : await client.fetchWatchlists();
    await saveWatchlists(watchlists);

    const portfolio = portfolioPositions.map((position) => ({
      symbol: position.symbol,
      quantity: position.position,
      averageBuy: position.purchasePrice,
      currentPrice: position.lastPrice
    }));
    await savePortfolio(portfolio);
    await finishSyncStep("watchlists");

    const symbols = Array.from(
      new Set([
        ...watchlists.flatMap((watchlist) => watchlist.symbols.map((item) => item.symbol)),
        ...portfolio.map((item) => item.symbol),
        ...(await watchlistSymbols()),
        ...(await portfolioSymbols())
      ])
    );

    await startSyncStep("quotes", "Fetching market quotes");
    const quotes = await client.fetchQuotes(symbols);
    await saveQuotes(quotes);
    await finishSyncStep("quotes", `${quotes.length} symbols`);

    await startSyncStep("signals", "Calculating signals & indicators");
    const mySignalPreference = await getMySignalPreference();
    const allSignals: SignalInput[] = [...buildPortfolioSignals(portfolioPositions, mySignalPreference)];

    // Technical indicators run off each holding's own recorded price history
    // (recordPortfolioDailyCloses above) rather than a separate quotes feed —
    // KTrade doesn't expose one that's reachable from this collector.
    const uniquePositions = [...new Map(portfolioPositions.map((position) => [position.symbol, position])).values()];
    const now = new Date();
    const seriesBySymbol = await closeSeriesBulk(uniquePositions.map((position) => position.symbol));

    const indicatorEntries: Array<{ symbol: string; date: Date; indicators: ReturnType<typeof calculateIndicators> }> = [];
    for (const position of uniquePositions) {
      const series = seriesBySymbol.get(position.symbol) ?? [];
      const closes = series.map((row) => row.close);
      const indicators = calculateIndicators(closes);
      indicatorEntries.push({ symbol: position.symbol, date: now, indicators });

      const tradingDate = normalizeTradingDate(now);
      const previous = [...series].reverse().find((row) => row.date < tradingDate)?.close;
      allSignals.push(...buildPositionIndicatorSignals(position.symbol, position.lastPrice, previous, indicators));
    }
    await saveIndicatorsBulk(indicatorEntries);
    await saveSignals(allSignals);
    await finishSyncStep("signals", `${allSignals.length} signals`);

    await startSyncStep("orders", "Evaluating auto-trade orders");
    const tradeResult = await runTradeEngine(portfolioPositions, client);
    await finishSyncStep(
      "orders",
      tradeResult.proposed > 0
        ? `${tradeResult.proposed} proposed, ${tradeResult.executed} placed`
        : "no orders triggered"
    );

    await startSyncStep("alerts", "Evaluating alerts");
    await evaluateAlerts(quotes, allSignals);
    await finishSyncStep("alerts");

    await syncDailyQuotesToSheets(quotes).catch((error) => {
      console.warn("Google Sheets sync skipped:", error instanceof Error ? error.message : String(error));
    });

    await startSyncStep("done", "Finishing up");
    await finishSyncStep("done");
    await completeSync(quotes.length);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failSync(message);
    throw error;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  const trigger: CollectionTrigger = process.env.COLLECT_TRIGGER === "scheduled" ? "scheduled" : "manual";

  collectMarketData(trigger)
    .then(async () => {
      if (trigger === "scheduled") {
        await markScheduledCollectionRun();
      }
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
