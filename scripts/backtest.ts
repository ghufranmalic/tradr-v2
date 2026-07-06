import { prisma } from "@/src/lib/prisma";
import { calculateIndicators } from "@/src/services/indicators";
import { buildPositionIndicatorSignals } from "@/src/services/signals";

/**
 * Walk-forward backtest of the quant signal engine (not the AI advisor — that's
 * non-deterministic and API-metered, so this validates the deterministic rule
 * layer that actually drives trade triggers). At each day it only looks at data
 * up to that point (no lookahead). Enters on any "buy" signal, exits on any
 * "sell" signal or after MAX_HOLD_DAYS, whichever comes first.
 *
 * Usage: npx tsx scripts/backtest.ts [SYMBOL]
 * With no argument, backtests every symbol with enough recorded history.
 *
 * Caveat: this repo has only been collecting price history for a short time,
 * so early runs will have thin/no results — this becomes more meaningful as
 * daily closes accumulate. Also note results here reflect the technical
 * indicator signals only, not the %-gain/loss-from-purchase-price thresholds
 * (those need a real entry price, which a synthetic backtest can't assume).
 */

const MIN_HISTORY_DAYS = 30;
const MAX_HOLD_DAYS = 30;

type Trade = {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  returnPercent: number;
};

async function main() {
  const symbolArg = process.argv[2]?.toUpperCase();

  const tickers = await prisma.ticker.findMany({
    where: symbolArg ? { symbol: symbolArg } : undefined,
    include: {
      prices: {
        where: { interval: "1d" },
        orderBy: { date: "asc" }
      }
    }
  });

  const trades: Trade[] = [];
  let skippedThin = 0;
  let tested = 0;

  for (const ticker of tickers) {
    const bars = ticker.prices;
    if (bars.length < MIN_HISTORY_DAYS) {
      skippedThin += 1;
      continue;
    }
    tested += 1;

    let inPosition = false;
    let entryDate = "";
    let entryPrice = 0;
    let holdDays = 0;

    for (let i = MIN_HISTORY_DAYS; i < bars.length; i += 1) {
      const closesSoFar = bars.slice(0, i + 1).map((bar) => Number(bar.close));
      const volumesSoFar = bars.slice(0, i + 1).map((bar) => Number(bar.volume));
      const indicators = calculateIndicators(closesSoFar, volumesSoFar);
      const close = closesSoFar.at(-1)!;
      const previousClose = closesSoFar.at(-2);
      const signals = buildPositionIndicatorSignals(ticker.symbol, close, previousClose, indicators);

      if (!inPosition) {
        if (signals.some((signal) => signal.side === "buy")) {
          inPosition = true;
          entryDate = bars[i].date.toISOString().slice(0, 10);
          entryPrice = close;
          holdDays = 0;
        }
        continue;
      }

      holdDays += 1;
      const isLastBar = i === bars.length - 1;
      const shouldExit = signals.some((signal) => signal.side === "sell") || holdDays >= MAX_HOLD_DAYS || isLastBar;
      if (shouldExit) {
        trades.push({
          symbol: ticker.symbol,
          entryDate,
          entryPrice,
          exitDate: bars[i].date.toISOString().slice(0, 10),
          exitPrice: close,
          returnPercent: round(((close - entryPrice) / entryPrice) * 100)
        });
        inPosition = false;
      }
    }
  }

  const wins = trades.filter((trade) => trade.returnPercent > 0);
  const avgReturn = trades.length > 0 ? trades.reduce((sum, trade) => sum + trade.returnPercent, 0) / trades.length : 0;
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const cumulativeGrowth = trades.reduce((acc, trade) => acc * (1 + trade.returnPercent / 100), 1);

  console.log(
    JSON.stringify(
      {
        symbolsTested: tested,
        symbolsSkippedThinHistory: skippedThin,
        totalTrades: trades.length,
        winRatePercent: round(winRate),
        avgReturnPerTradePercent: round(avgReturn),
        cumulativeReturnPercent: round((cumulativeGrowth - 1) * 100),
        recentTrades: trades.slice(-20)
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
