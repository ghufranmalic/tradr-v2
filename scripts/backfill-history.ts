import { prisma } from "@/src/lib/prisma";
import { normalizeTradingDate, upsertTicker } from "@/src/services/market-repository";

/**
 * Backfills real historical daily closes from PSX's own public data portal
 * (dps.psx.com.pk/timeseries/eod/{symbol}) — free, no login required, ~5
 * years of history per symbol as of when this was written. This is what
 * makes indicators (SMA50, RSI, Bollinger, backtesting) meaningful right away
 * instead of waiting weeks for organic daily collection to build up.
 *
 * Note: this endpoint only provides open/close/volume per day, not a real
 * intraday high/low — high/low are approximated as max/min(open, close),
 * which is fine for every indicator this project computes (they're all
 * close-and-volume based, never actual day-range based).
 *
 * Usage: npx tsx scripts/backfill-history.ts [SYMBOL ...]
 * With no arguments, backfills every symbol currently tracked (Ticker table).
 */

type HistoryRow = { date: Date; open: number; close: number; volume: number };

async function fetchPsxHistory(symbol: string): Promise<HistoryRow[]> {
  const response = await fetch(`https://dps.psx.com.pk/timeseries/eod/${encodeURIComponent(symbol)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://dps.psx.com.pk/historical"
    }
  });
  if (!response.ok) throw new Error(`PSX responded ${response.status}`);

  const payload = await response.json();
  const rows: unknown[] = Array.isArray(payload?.data) ? payload.data : [];

  return rows
    .map((row): HistoryRow | null => {
      if (!Array.isArray(row) || row.length < 4) return null;
      const close = Number(row[1]);
      if (!Number.isFinite(close) || close <= 0) return null;
      return {
        date: new Date(Number(row[0]) * 1000),
        close,
        volume: Number(row[2]) || 0,
        open: Number(row[3]) || close
      };
    })
    .filter((row): row is HistoryRow => row !== null);
}

async function main() {
  const requested = process.argv.slice(2).map((symbol) => symbol.toUpperCase());
  const symbols =
    requested.length > 0 ? requested : (await prisma.ticker.findMany({ select: { symbol: true } })).map((t) => t.symbol);

  console.log(`Backfilling ${symbols.length} symbol(s) from PSX's public historical data...`);

  let totalInserted = 0;
  for (const symbol of symbols) {
    try {
      const history = await withRetry(() => fetchPsxHistory(symbol));
      if (history.length === 0) {
        console.log(`  ${symbol}: no data returned, skipping`);
        continue;
      }

      const ticker = await upsertTicker(symbol);
      const result = await prisma.priceBar.createMany({
        data: history.map((row) => ({
          tickerId: ticker.id,
          date: normalizeTradingDate(row.date),
          interval: "1d",
          open: row.open,
          high: Math.max(row.open, row.close),
          low: Math.min(row.open, row.close),
          close: row.close,
          volume: BigInt(Math.trunc(row.volume)),
          source: "psx-historical"
        })),
        skipDuplicates: true
      });

      totalInserted += result.count;
      console.log(`  ${symbol}: ${history.length} days fetched, ${result.count} new bars inserted`);
    } catch (error) {
      console.error(`  ${symbol}: failed —`, error instanceof Error ? error.message : String(error));
    }
    // Be polite to PSX's public endpoint — small delay between symbols.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  console.log(`Done. ${totalInserted} new price bars inserted across ${symbols.length} symbol(s).`);
  await prisma.$disconnect();
}

/** One retry after a short delay — third-party endpoints occasionally blip in a loop over many symbols. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return fn();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
