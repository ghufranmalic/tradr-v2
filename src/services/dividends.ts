import { prisma } from "@/src/lib/prisma";
import { upsertTicker } from "@/src/services/market-repository";

/**
 * Dividend history from stockanalysis.com's public PSX endpoint — free, no
 * login. Used for total-return-aware backtesting (price return alone
 * understates real returns for dividend payers) and a yield-aware signal fed
 * to the AI advisor.
 */

export type DividendRow = { exDate: Date; amount: number; payDate?: Date };

export async function fetchDividendHistory(symbol: string): Promise<DividendRow[]> {
  const response = await fetch(`https://stockanalysis.com/api/symbol/q/PSX-${encodeURIComponent(symbol)}/dividend`, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error(`stockanalysis.com responded ${response.status}`);

  const payload = await response.json();
  const rows: unknown[] = Array.isArray(payload?.data?.history) ? payload.data.history : [];

  return rows
    .map((row): DividendRow | null => {
      if (!row || typeof row !== "object") return null;
      const entry = row as Record<string, unknown>;
      const exDate = parseDate(entry.dt);
      const amount = parseAmount(entry.amt);
      if (!exDate || amount === null || amount <= 0) return null;
      const payDate = parseDate(entry.pay);
      return { exDate, amount, payDate: payDate ?? undefined };
    })
    .filter((row): row is DividendRow => row !== null);
}

export async function saveDividends(symbol: string, rows: DividendRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const ticker = await upsertTicker(symbol);
  const result = await prisma.dividend.createMany({
    data: rows.map((row) => ({
      tickerId: ticker.id,
      exDate: row.exDate,
      amount: row.amount,
      payDate: row.payDate
    })),
    skipDuplicates: true
  });
  return result.count;
}

/** Total dividends per share paid while a position was held, from entryDate (exclusive) to exitDate (inclusive). */
export async function dividendsReceivedBetween(symbol: string, entryDate: Date, exitDate: Date): Promise<number> {
  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) return 0;
  const rows = await prisma.dividend.findMany({
    where: { tickerId: ticker.id, exDate: { gt: entryDate, lte: exitDate } }
  });
  return rows.reduce((sum, row) => sum + Number(row.amount), 0);
}

/** Trailing 12-month dividend total and the nearest upcoming/most-recent ex-date, for signals + AI context. */
export async function trailingYieldInfo(
  symbol: string,
  asOf: Date
): Promise<{ trailingTwelveMonthDividend: number; lastExDate?: Date } | null> {
  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) return null;

  const start = new Date(asOf);
  start.setUTCFullYear(start.getUTCFullYear() - 1);

  const rows = await prisma.dividend.findMany({
    where: { tickerId: ticker.id, exDate: { gte: start, lte: asOf } },
    orderBy: { exDate: "desc" }
  });
  if (rows.length === 0) return { trailingTwelveMonthDividend: 0 };

  return {
    trailingTwelveMonthDividend: rows.reduce((sum, row) => sum + Number(row.amount), 0),
    lastExDate: rows[0].exDate
  };
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseAmount(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
