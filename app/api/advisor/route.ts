import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { calculateIndicators } from "@/src/services/indicators";
import { closeSeriesBulk } from "@/src/services/market-repository";
import { generateRecommendations } from "@/src/services/ai-advisor";
import { getTradeSettings } from "@/src/services/trade-settings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const requestSchema = z.object({ symbol: z.string().min(1).max(20) });

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { symbol }." }, { status: 400 });
  }

  const symbol = parsed.data.symbol.trim().toUpperCase();
  const [series, position, settings] = await Promise.all([
    closeSeriesBulk([symbol]),
    prisma.portfolioPosition.findFirst({ where: { ticker: { symbol } } }),
    getTradeSettings()
  ]);

  const bars = series.get(symbol) ?? [];
  if (bars.length === 0) {
    return NextResponse.json(
      { error: `No price history for ${symbol} yet — sync first, or check the symbol is in your portfolio or KTrade watch list.` },
      { status: 404 }
    );
  }

  const indicators = calculateIndicators(bars.map((bar) => bar.close), bars.map((bar) => bar.volume));
  const close = bars.at(-1)!.close;
  const purchasePrice = position ? Number(position.purchasePrice) : undefined;
  const gainPercent = purchasePrice ? ((close - purchasePrice) / purchasePrice) * 100 : undefined;

  const recommendations = await generateRecommendations(
    [{ symbol, close, purchasePrice, gainPercent, indicators, signals: [] }],
    settings.horizon
  );

  const recommendation = recommendations[0];
  if (!recommendation) {
    return NextResponse.json({ error: "The AI advisor didn't return an answer — try again in a moment." }, { status: 502 });
  }

  return NextResponse.json(recommendation);
}
