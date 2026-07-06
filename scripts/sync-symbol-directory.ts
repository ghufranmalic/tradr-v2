import { prisma } from "@/src/lib/prisma";

/**
 * Syncs the full PSX equity symbol directory (name + sector) from
 * dps.psx.com.pk/symbols — free, no login. This does NOT add these symbols
 * to the active watch/signals/AI-advisor loop (that stays scoped to your
 * portfolio + KTrade watch list to keep collection runs fast); it just makes
 * every PSX-listed company's name/sector available for lookups, the ask-AI
 * box, and future backfill-history/backfill-dividends runs on any symbol.
 *
 * Usage: npx tsx scripts/sync-symbol-directory.ts
 */

type PsxSymbol = { symbol: string; name: string; sectorName: string; isETF: boolean; isDebt: boolean };

async function main() {
  const response = await fetch("https://dps.psx.com.pk/symbols", {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://dps.psx.com.pk/" }
  });
  if (!response.ok) throw new Error(`PSX responded ${response.status}`);

  const all: PsxSymbol[] = await response.json();
  const equities = all.filter((entry) => !entry.isDebt && !entry.isETF);
  console.log(`Fetched ${all.length} listed instruments, ${equities.length} are tracked-eligible equities.`);

  let created = 0;
  let updated = 0;
  for (const entry of equities) {
    const existing = await prisma.ticker.findUnique({ where: { symbol: entry.symbol } });
    if (!existing) {
      await prisma.ticker.create({
        data: { symbol: entry.symbol, name: entry.name, sector: entry.sectorName }
      });
      created += 1;
    } else if (existing.name !== entry.name || existing.sector !== entry.sectorName) {
      await prisma.ticker.update({
        where: { id: existing.id },
        data: { name: entry.name, sector: entry.sectorName }
      });
      updated += 1;
    }
  }

  console.log(`Done. ${created} new tickers created, ${updated} existing tickers updated.`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
