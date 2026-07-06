import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().toUpperCase() ?? "";
  if (query.length < 1) return NextResponse.json([]);

  const tickers = await prisma.ticker.findMany({
    where: {
      OR: [{ symbol: { startsWith: query } }, { name: { contains: query, mode: "insensitive" } }]
    },
    include: {
      prices: {
        where: { interval: "1d" },
        orderBy: { date: "desc" },
        take: 1
      }
    },
    orderBy: { symbol: "asc" },
    take: 15
  });

  return NextResponse.json(
    tickers.map((ticker) => ({
      symbol: ticker.symbol,
      name: ticker.name ?? "",
      sector: ticker.sector ?? "",
      lastClose: ticker.prices[0] ? Number(ticker.prices[0].close) : null,
      lastDate: ticker.prices[0]?.date.toISOString().slice(0, 10) ?? null
    }))
  );
}
