import { prisma } from "@/src/lib/prisma";
import { getCollectionPolicy } from "@/src/services/collection-policy";
import { getMySignalPreference } from "@/src/services/my-signal-preferences";
import { getTradeSettings } from "@/src/services/trade-settings";
import type { DashboardData } from "@/src/ui/DashboardClient";

export async function loadDashboardData(): Promise<DashboardData> {
  const [holdings, portfolioPositions, summaryMetrics, signals, watchlists, prices, runs, settings, mySignalPreference, tradeSettings, orders, recommendations] =
    await Promise.all([
      prisma.holding.findMany({
        include: {
          ticker: {
            include: {
              prices: {
                orderBy: { date: "desc" },
                take: 1
              }
            }
          }
        },
        orderBy: { updatedAt: "desc" }
      }),
      prisma.portfolioPosition.findMany({
        include: { ticker: true },
        orderBy: { updatedAt: "desc" }
      }),
      prisma.portfolioSummaryMetric.findMany({
        orderBy: { label: "asc" }
      }),
      prisma.signal.findMany({
        include: { ticker: true },
        orderBy: { createdAt: "desc" },
        take: 12
      }),
      prisma.watchlist.findMany({
        include: { items: { include: { ticker: true } } },
        orderBy: { name: "asc" }
      }),
      prisma.priceBar.findMany({
        include: { ticker: true },
        orderBy: { date: "desc" },
        take: 160
      }),
      prisma.collectionRun.findMany({
        orderBy: { startedAt: "desc" },
        take: 6
      }),
      getCollectionPolicy(),
      getMySignalPreference(),
      getTradeSettings(),
      prisma.order.findMany({
        include: { ticker: { select: { symbol: true, name: true } }, recommendation: true },
        orderBy: { proposedAt: "desc" },
        take: 50
      }),
      prisma.recommendation.findMany({
        include: { ticker: { select: { symbol: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 50
      })
    ]);

  const priceHistoryStart = new Date();
  priceHistoryStart.setUTCDate(priceHistoryStart.getUTCDate() - 400);
  const tickerIds = [...new Set(portfolioPositions.map((position) => position.tickerId))];
  const dailyPriceBars =
    tickerIds.length > 0
      ? await prisma.priceBar.findMany({
          where: {
            tickerId: { in: tickerIds },
            interval: "1d",
            date: { gte: priceHistoryStart }
          },
          include: { ticker: true },
          orderBy: { date: "asc" }
        })
      : [];

  const dailyBySymbol = new Map<string, Array<{ date: string; close: number }>>();
  for (const bar of dailyPriceBars) {
    const rows = dailyBySymbol.get(bar.ticker.symbol) ?? [];
    rows.push({
      date: bar.date.toISOString().slice(0, 10),
      close: Number(bar.close)
    });
    dailyBySymbol.set(bar.ticker.symbol, rows);
  }

  return {
    holdings: holdings.map((holding) => {
      const latest = holding.ticker.prices[0];
      const currentPrice = latest ? Number(latest.close) : 0;
      const quantity = Number(holding.quantity);
      const averageBuy = Number(holding.averageBuy);
      return {
        symbol: holding.ticker.symbol,
        name: holding.ticker.name ?? "",
        quantity,
        averageBuy,
        currentPrice,
        marketValue: quantity * currentPrice,
        profitLoss: quantity * (currentPrice - averageBuy)
      };
    }),
    portfolioPositions: portfolioPositions.map((position) => ({
      symbol: position.ticker.symbol,
      name: position.ticker.name ?? "",
      market: position.market ?? "",
      position: Number(position.position),
      purchasePrice: Number(position.purchasePrice),
      lastPrice: Number(position.lastPrice),
      todayGainLoss: Number(position.todayGainLoss),
      totalGainLoss: Number(position.totalGainLoss),
      bidSize: Number(position.bidSize),
      bidPrice: Number(position.bidPrice),
      askPrice: Number(position.askPrice),
      askSize: Number(position.askSize),
      change: Number(position.change),
      custodyValue: position.custodyValue === null ? undefined : Number(position.custodyValue),
      profitLoss: position.profitLoss === null ? undefined : Number(position.profitLoss)
    })),
    summaryMetrics: summaryMetrics.map((metric) => ({
      label: metric.label,
      value: Number(metric.value)
    })),
    signals: signals.map((signal) => ({
      symbol: signal.ticker.symbol,
      side: signal.side,
      type: signal.type,
      score: signal.score,
      message: signal.message,
      createdAt: signal.createdAt.toISOString()
    })),
    watchlists: watchlists.map((watchlist) => ({
      name: watchlist.name,
      symbols: watchlist.items.map((item) => item.ticker.symbol)
    })),
    prices: prices
      .map((price) => ({
        symbol: price.ticker.symbol,
        date: price.date.toISOString().slice(0, 10),
        close: Number(price.close),
        volume: Number(price.volume)
      }))
      .reverse(),
    runs: runs.map((run) => ({
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      quoteCount: run.quoteCount,
      error: run.error ?? ""
    })),
    settings,
    mySignalPreference,
    tradeSettings,
    orders: orders.map((order) => ({
      id: order.id,
      symbol: order.ticker.symbol,
      name: order.ticker.name ?? "",
      side: order.side,
      quantity: Number(order.quantity),
      limitPrice: order.limitPrice ? Number(order.limitPrice) : null,
      estimatedValue: Number(order.estimatedValue),
      reason: order.reason,
      status: order.status,
      mode: order.mode,
      detail: order.detail ?? "",
      proposedAt: order.proposedAt.toISOString(),
      executedAt: order.executedAt?.toISOString() ?? null,
      aiRationale: order.recommendation?.rationale ?? null,
      aiConfidence: order.recommendation?.confidence ?? null,
      aiSide: order.recommendation?.side ?? null
    })),
    recommendations: recommendations.map((rec) => ({
      symbol: rec.ticker.symbol,
      name: rec.ticker.name ?? "",
      side: rec.side,
      confidence: rec.confidence,
      horizon: rec.horizon,
      rationale: rec.rationale,
      createdAt: rec.createdAt.toISOString()
    })),
    priceLog: portfolioPositions.map((position) => ({
      symbol: position.ticker.symbol,
      name: position.ticker.name ?? "",
      purchasePrice: Number(position.purchasePrice),
      dailyPrices: dailyBySymbol.get(position.ticker.symbol) ?? []
    }))
  };
}
