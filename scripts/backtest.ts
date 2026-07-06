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
 * Run `npm run backfill-history` first if a symbol has too little history —
 * it pulls ~5 years of real daily closes from PSX's public data portal.
 *
 * Caveat: results here reflect the technical indicator signals only, not the
 * %-gain/loss-from-purchase-price thresholds (those need a real entry price,
 * which a synthetic backtest can't assume).
 *
 * Returns include dividends paid while a position was simulated as held (run
 * `npm run backfill-dividends` first) — price return alone understates real
 * returns for dividend payers, sometimes significantly over a multi-year hold.
 */

const MIN_HISTORY_DAYS = 30;
const MAX_HOLD_DAYS = 30;

type Trade = {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  dividendPerShare: number;
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
      },
      dividends: {
        orderBy: { exDate: "asc" }
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
    let entryDateObj: Date | null = null;
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
          entryDateObj = bars[i].date;
          entryPrice = close;
          holdDays = 0;
        }
        continue;
      }

      holdDays += 1;
      const isLastBar = i === bars.length - 1;
      const shouldExit = signals.some((signal) => signal.side === "sell") || holdDays >= MAX_HOLD_DAYS || isLastBar;
      if (shouldExit) {
        const exitDateObj = bars[i].date;
        const dividendPerShare = ticker.dividends
          .filter((dividend) => dividend.exDate > entryDateObj! && dividend.exDate <= exitDateObj)
          .reduce((sum, dividend) => sum + Number(dividend.amount), 0);

        trades.push({
          symbol: ticker.symbol,
          entryDate,
          entryPrice,
          exitDate: exitDateObj.toISOString().slice(0, 10),
          exitPrice: close,
          dividendPerShare,
          returnPercent: round(((close - entryPrice + dividendPerShare) / entryPrice) * 100)
        });
        inPosition = false;
      }
    }
  }

  const wins = trades.filter((trade) => trade.returnPercent > 0);
  const avgReturn = trades.length > 0 ? trades.reduce((sum, trade) => sum + trade.returnPercent, 0) / trades.length : 0;
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  // Compounding ALL trades together (across every symbol) into one product would imply they
  // happened sequentially in a single account, which is wrong — trades in different symbols
  // overlap in time. Compounding is only valid *within* one symbol, where this simulation never
  // holds two positions at once. So: compound per-symbol, then average those per-symbol results —
  // an honest (if still simplified — it assumes equal capital re-allocated to each symbol) figure.
  const bySymbol = new Map<string, Trade[]>();
  for (const trade of trades) {
    const list = bySymbol.get(trade.symbol) ?? [];
    list.push(trade);
    bySymbol.set(trade.symbol, list);
  }
  const perSymbolReturns = [...bySymbol.values()].map(
    (symbolTrades) => (symbolTrades.reduce((acc, trade) => acc * (1 + trade.returnPercent / 100), 1) - 1) * 100
  );
  const avgPerSymbolCompoundReturn =
    perSymbolReturns.length > 0 ? perSymbolReturns.reduce((sum, value) => sum + value, 0) / perSymbolReturns.length : 0;

  console.log(
    JSON.stringify(
      {
        symbolsTested: tested,
        symbolsSkippedThinHistory: skippedThin,
        totalTrades: trades.length,
        winRatePercent: round(winRate),
        avgReturnPerTradePercent: round(avgReturn),
        avgPerSymbolCompoundReturnPercent: round(avgPerSymbolCompoundReturn),
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
