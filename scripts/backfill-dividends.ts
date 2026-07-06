import { prisma } from "@/src/lib/prisma";
import { fetchDividendHistory, saveDividends } from "@/src/services/dividends";

/**
 * Backfills real dividend payout history from stockanalysis.com's public PSX
 * endpoint — free, no login, ~5 years of history per symbol.
 *
 * Usage: npx tsx scripts/backfill-dividends.ts [SYMBOL ...]
 * With no arguments, backfills every symbol currently tracked (Ticker table).
 */

async function main() {
  const requested = process.argv.slice(2).map((symbol) => symbol.toUpperCase());
  const symbols =
    requested.length > 0 ? requested : (await prisma.ticker.findMany({ select: { symbol: true } })).map((t) => t.symbol);

  console.log(`Backfilling dividends for ${symbols.length} symbol(s) from stockanalysis.com...`);

  let totalInserted = 0;
  for (const symbol of symbols) {
    try {
      const history = await withRetry(() => fetchDividendHistory(symbol));
      if (history.length === 0) {
        console.log(`  ${symbol}: no dividend history found, skipping`);
        continue;
      }
      const inserted = await saveDividends(symbol, history);
      totalInserted += inserted;
      console.log(`  ${symbol}: ${history.length} payouts fetched, ${inserted} new rows inserted`);
    } catch (error) {
      console.error(`  ${symbol}: failed —`, error instanceof Error ? error.message : String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  console.log(`Done. ${totalInserted} new dividend rows inserted across ${symbols.length} symbol(s).`);
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
