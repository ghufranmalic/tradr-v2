import { prisma } from "@/src/lib/prisma";
import type { HoldingInput, IndicatorSet, PortfolioPositionInput, PortfolioSummaryInput, Quote, SignalInput, WatchlistInput } from "@/src/types/market";

/**
 * All write paths batch their round-trips: one lookup, one createMany, and a
 * single transaction for the remaining updates. This matters because the
 * database is Neon over the network — per-row upserts made sync minutes long.
 */

export async function upsertTicker(symbol: string, name?: string) {
  return prisma.ticker.upsert({
    where: { symbol },
    update: { name: name || undefined },
    create: { symbol, name }
  });
}

/** Ensure all tickers exist; returns symbol -> id. */
export async function upsertTickers(entries: Array<{ symbol: string; name?: string }>): Promise<Map<string, string>> {
  const wanted = new Map<string, string | undefined>();
  for (const entry of entries) {
    const symbol = entry.symbol.trim();
    if (!isValidSymbol(symbol)) continue;
    if (!wanted.has(symbol) || (entry.name && !wanted.get(symbol))) {
      wanted.set(symbol, entry.name || wanted.get(symbol));
    }
  }
  if (wanted.size === 0) return new Map();

  const symbols = [...wanted.keys()];
  await prisma.ticker.createMany({
    data: symbols.map((symbol) => ({ symbol, name: wanted.get(symbol) })),
    skipDuplicates: true
  });

  const rows = await prisma.ticker.findMany({ where: { symbol: { in: symbols } } });

  const nameUpdates = rows.filter((row) => {
    const name = wanted.get(row.symbol);
    return Boolean(name) && row.name !== name;
  });
  if (nameUpdates.length > 0) {
    await prisma.$transaction(
      nameUpdates.map((row) =>
        prisma.ticker.update({ where: { id: row.id }, data: { name: wanted.get(row.symbol) } })
      )
    );
  }

  return new Map(rows.map((row) => [row.symbol, row.id]));
}

export async function saveQuotes(quotes: Quote[]): Promise<void> {
  const valid = quotes.filter(
    (quote) => isValidSymbol(quote.symbol) && Number.isFinite(quote.close) && quote.close > 0
  );
  if (valid.length === 0) return;

  const bySymbol = new Map<string, Quote>();
  for (const quote of valid) bySymbol.set(quote.symbol, quote);

  const tickerIds = await upsertTickers([...bySymbol.values()].map((quote) => ({ symbol: quote.symbol, name: quote.name })));
  await recordDailyCloses(
    [...bySymbol.values()].map((quote) => ({
      tickerId: tickerIds.get(quote.symbol)!,
      close: quote.close,
      date: quote.timestamp,
      ohlc: { open: quote.open, high: quote.high, low: quote.low, volume: quote.volume }
    }))
  );
}

export async function recordPortfolioDailyCloses(positions: PortfolioPositionInput[]): Promise<void> {
  const when = new Date();
  const valid = positions.filter((position) => isValidSymbol(position.symbol) && position.lastPrice > 0);
  if (valid.length === 0) return;

  const tickerIds = await upsertTickers(valid.map((position) => ({ symbol: position.symbol, name: position.name })));
  await recordDailyCloses(
    valid.map((position) => ({
      tickerId: tickerIds.get(position.symbol)!,
      close: position.lastPrice,
      date: when
    }))
  );
}

/** Store the closing price for a calendar day; later refreshes on the same day overwrite close. */
export async function recordDailyClosePrice(
  symbol: string,
  close: number,
  date = new Date(),
  name?: string,
  ohlc?: { open: number; high: number; low: number; volume: number }
): Promise<void> {
  if (!isValidSymbol(symbol) || !Number.isFinite(close) || close <= 0) return;
  const ticker = await upsertTicker(symbol, name);
  await recordDailyCloses([{ tickerId: ticker.id, close, date, ohlc }]);
}

type DailyCloseEntry = {
  tickerId: string;
  close: number;
  date: Date;
  ohlc?: { open: number; high: number; low: number; volume: number };
};

async function recordDailyCloses(entries: DailyCloseEntry[]): Promise<void> {
  const deduped = new Map<string, DailyCloseEntry>();
  for (const entry of entries) {
    if (!entry.tickerId || !Number.isFinite(entry.close) || entry.close <= 0) continue;
    deduped.set(`${entry.tickerId}:${normalizeTradingDate(entry.date).toISOString()}`, entry);
  }
  if (deduped.size === 0) return;

  const rows = [...deduped.values()];
  const dates = [...new Set(rows.map((row) => normalizeTradingDate(row.date).toISOString()))].map((iso) => new Date(iso));
  const existing = await prisma.priceBar.findMany({
    where: {
      tickerId: { in: rows.map((row) => row.tickerId) },
      date: { in: dates },
      interval: "1d"
    }
  });
  const existingByKey = new Map(existing.map((bar) => [`${bar.tickerId}:${bar.date.toISOString()}`, bar]));

  const creates: DailyCloseEntry[] = [];
  const updates: Array<{ id: string; close: number; high: number; low: number; volume?: number }> = [];

  for (const row of rows) {
    const key = `${row.tickerId}:${normalizeTradingDate(row.date).toISOString()}`;
    const bar = existingByKey.get(key);
    if (!bar) {
      creates.push(row);
      continue;
    }
    const nextHigh = row.ohlc ? Math.max(Number(bar.high), row.ohlc.high, row.close) : Math.max(Number(bar.high), row.close);
    const nextLow = row.ohlc ? Math.min(Number(bar.low), row.ohlc.low, row.close) : Math.min(Number(bar.low), row.close);
    updates.push({
      id: bar.id,
      close: row.close,
      high: nextHigh,
      low: nextLow,
      volume: row.ohlc ? Math.trunc(row.ohlc.volume) : undefined
    });
  }

  if (creates.length > 0) {
    await prisma.priceBar.createMany({
      data: creates.map((row) => ({
        tickerId: row.tickerId,
        date: normalizeTradingDate(row.date),
        interval: "1d",
        open: row.ohlc?.open ?? row.close,
        high: row.ohlc?.high ?? row.close,
        low: row.ohlc?.low ?? row.close,
        close: row.close,
        volume: BigInt(Math.trunc(row.ohlc?.volume ?? 0))
      })),
      skipDuplicates: true
    });
  }

  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map((update) =>
        prisma.priceBar.update({
          where: { id: update.id },
          data: {
            close: update.close,
            high: update.high,
            low: update.low,
            ...(update.volume !== undefined ? { volume: BigInt(update.volume) } : {})
          }
        })
      )
    );
  }
}

export async function saveWatchlists(watchlists: WatchlistInput[]): Promise<void> {
  for (const input of watchlists) {
    const watchlist = await prisma.watchlist.upsert({
      where: { name: input.name },
      update: {},
      create: { name: input.name }
    });

    const validSymbols = input.symbols.filter((item) => isValidSymbol(item.symbol));
    if (validSymbols.length === 0) continue;
    const tickerIds = await upsertTickers(validSymbols);

    await prisma.watchlistItem.createMany({
      data: [...new Set(validSymbols.map((item) => tickerIds.get(item.symbol)!))].map((tickerId) => ({
        watchlistId: watchlist.id,
        tickerId
      })),
      skipDuplicates: true
    });
  }
}

export async function savePortfolio(holdings: HoldingInput[]): Promise<void> {
  const valid = holdings.filter(
    (holding) =>
      isValidSymbol(holding.symbol) &&
      Number.isFinite(holding.quantity) &&
      holding.quantity > 0 &&
      Number.isFinite(holding.averageBuy) &&
      holding.averageBuy >= 0
  );
  if (valid.length === 0) return;

  const tickerIds = await upsertTickers(valid.map((holding) => ({ symbol: holding.symbol, name: holding.name })));
  await prisma.$transaction(
    valid.map((holding) =>
      prisma.holding.upsert({
        where: { tickerId_broker: { tickerId: tickerIds.get(holding.symbol)!, broker: "KTrade" } },
        update: {
          quantity: holding.quantity,
          averageBuy: holding.averageBuy,
          targetPrice: holding.targetPrice,
          stopLossPrice: holding.stopLossPrice
        },
        create: {
          tickerId: tickerIds.get(holding.symbol)!,
          quantity: holding.quantity,
          averageBuy: holding.averageBuy,
          targetPrice: holding.targetPrice,
          stopLossPrice: holding.stopLossPrice
        }
      })
    )
  );
}

export async function savePortfolioPositions(positions: PortfolioPositionInput[]): Promise<void> {
  const valid = positions.filter(
    (position) =>
      isValidSymbol(position.symbol) && position.position > 0 && position.purchasePrice > 0 && position.lastPrice > 0
  );
  if (valid.length === 0) return;

  const tickerIds = await upsertTickers(valid.map((position) => ({ symbol: position.symbol, name: position.name })));

  await prisma.$transaction([
    ...valid.map((position) => {
      const tickerId = tickerIds.get(position.symbol)!;
      const data = {
        market: position.market,
        position: position.position,
        purchasePrice: position.purchasePrice,
        lastPrice: position.lastPrice,
        todayGainLoss: position.todayGainLoss,
        totalGainLoss: position.totalGainLoss,
        bidSize: position.bidSize,
        bidPrice: position.bidPrice,
        askPrice: position.askPrice,
        askSize: position.askSize,
        change: position.change,
        holding: position.holding,
        holdingAvailable: position.holdingAvailable,
        marketRate: position.marketRate,
        custodyValue: position.custodyValue,
        profitLoss: position.profitLoss
      };
      return prisma.portfolioPosition.upsert({
        where: { tickerId_broker: { tickerId, broker: "KTrade" } },
        update: data,
        create: { tickerId, ...data }
      });
    }),
    ...valid.map((position) => {
      const tickerId = tickerIds.get(position.symbol)!;
      return prisma.holding.upsert({
        where: { tickerId_broker: { tickerId, broker: "KTrade" } },
        update: { quantity: position.position, averageBuy: position.purchasePrice },
        create: { tickerId, quantity: position.position, averageBuy: position.purchasePrice }
      });
    })
  ]);
}

export async function savePortfolioSummary(metrics: PortfolioSummaryInput[]): Promise<void> {
  const valid = metrics.filter((metric) => metric.label && Number.isFinite(metric.value));
  if (valid.length === 0) return;
  await prisma.$transaction(
    valid.map((metric) =>
      prisma.portfolioSummaryMetric.upsert({
        where: { broker_label: { broker: "KTrade", label: metric.label } },
        update: { value: metric.value },
        create: { broker: "KTrade", label: metric.label, value: metric.value }
      })
    )
  );
}

/** One query for the daily price history of many symbols: symbol -> ascending bars. */
export async function closeSeriesBulk(
  symbols: string[],
  limitDays = 200
): Promise<Map<string, Array<{ date: Date; close: number; volume: number }>>> {
  const result = new Map<string, Array<{ date: Date; close: number; volume: number }>>();
  if (symbols.length === 0) return result;

  const start = new Date();
  start.setUTCDate(start.getUTCDate() - limitDays);

  const bars = await prisma.priceBar.findMany({
    where: {
      interval: "1d",
      date: { gte: start },
      ticker: { symbol: { in: symbols } }
    },
    include: { ticker: { select: { symbol: true } } },
    orderBy: { date: "asc" }
  });

  for (const bar of bars) {
    const rows = result.get(bar.ticker.symbol) ?? [];
    rows.push({ date: bar.date, close: Number(bar.close), volume: Number(bar.volume) });
    result.set(bar.ticker.symbol, rows);
  }
  return result;
}

export async function closeSeries(symbol: string, limit = 120): Promise<number[]> {
  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) return [];
  const rows = await prisma.priceBar.findMany({
    where: { tickerId: ticker.id, interval: "1d" },
    orderBy: { date: "desc" },
    take: limit
  });
  return rows.reverse().map((row) => Number(row.close));
}

export async function previousClose(symbol: string, currentDate: Date): Promise<number | undefined> {
  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) return undefined;
  const row = await prisma.priceBar.findFirst({
    where: {
      tickerId: ticker.id,
      interval: "1d",
      date: { lt: normalizeTradingDate(currentDate) }
    },
    orderBy: { date: "desc" }
  });
  return row ? Number(row.close) : undefined;
}

export async function saveIndicatorsBulk(entries: Array<{ symbol: string; date: Date; indicators: IndicatorSet }>): Promise<void> {
  if (entries.length === 0) return;
  await prisma.$transaction(
    entries.map((entry) => {
      const normalizedDate = normalizeTradingDate(entry.date);
      const data = decimalIndicators(entry.indicators);
      return prisma.indicatorSnapshot.upsert({
        where: { symbol_date: { symbol: entry.symbol, date: normalizedDate } },
        update: data,
        create: { symbol: entry.symbol, date: normalizedDate, ...data }
      });
    })
  );
}

export async function saveIndicators(symbol: string, date: Date, indicators: IndicatorSet): Promise<void> {
  await saveIndicatorsBulk([{ symbol, date, indicators }]);
}

export async function saveSignals(signals: SignalInput[]): Promise<void> {
  if (signals.length === 0) return;
  const tickerIds = await upsertTickers(signals.map((signal) => ({ symbol: signal.symbol })));
  const today = normalizeTradingDate(new Date());

  const existing = await prisma.signal.findMany({
    where: {
      tickerId: { in: [...tickerIds.values()] },
      date: { gte: today }
    },
    select: { tickerId: true, type: true }
  });
  const seen = new Set(existing.map((signal) => `${signal.tickerId}:${signal.type}`));

  const fresh = signals.filter((signal) => {
    const tickerId = tickerIds.get(signal.symbol);
    if (!tickerId) return false;
    const key = `${tickerId}:${signal.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (fresh.length === 0) return;
  await prisma.signal.createMany({
    data: fresh.map((signal) => ({
      tickerId: tickerIds.get(signal.symbol)!,
      type: signal.type,
      side: signal.side,
      score: signal.score,
      message: signal.message,
      metadata: signal.metadata ? JSON.stringify(signal.metadata) : undefined
    }))
  });
}

/** Persists AI advisory recommendations and returns symbol -> id for the just-created rows (this run only). */
export async function saveRecommendations(
  recommendations: Array<{ symbol: string; side: string; confidence: number; horizon: string; rationale: string; signalsUsed?: unknown }>
): Promise<Map<string, string>> {
  if (recommendations.length === 0) return new Map();

  const tickerIds = await upsertTickers(recommendations.map((rec) => ({ symbol: rec.symbol })));
  const withTicker = recommendations.filter((rec) => tickerIds.has(rec.symbol));
  if (withTicker.length === 0) return new Map();

  const created = await prisma.$transaction(
    withTicker.map((rec) =>
      prisma.recommendation.create({
        data: {
          tickerId: tickerIds.get(rec.symbol)!,
          side: rec.side,
          confidence: rec.confidence,
          horizon: rec.horizon,
          rationale: rec.rationale,
          signalsUsed: rec.signalsUsed ? JSON.stringify(rec.signalsUsed) : undefined
        }
      })
    )
  );

  return new Map(created.map((row, index) => [withTicker[index].symbol, row.id]));
}

export async function portfolioSymbols(): Promise<string[]> {
  const holdings = await prisma.holding.findMany({ include: { ticker: true } });
  return holdings.map((holding) => holding.ticker.symbol);
}

export async function watchlistSymbols(): Promise<string[]> {
  const items = await prisma.watchlistItem.findMany({ include: { ticker: true } });
  return Array.from(new Set(items.map((item) => item.ticker.symbol)));
}

export function normalizeTradingDate(date: Date): Date {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
}

function decimalIndicators(indicators: IndicatorSet) {
  return {
    sma20: indicators.sma20,
    sma50: indicators.sma50,
    ema12: indicators.ema12,
    ema26: indicators.ema26,
    rsi14: indicators.rsi14,
    macd: indicators.macd,
    macdSignal: indicators.macdSignal,
    macdHist: indicators.macdHist,
    bollingerUpper: indicators.bollingerUpper,
    bollingerLower: indicators.bollingerLower,
    momentum10: indicators.momentum10,
    volumeRatio: indicators.volumeRatio,
    recentHigh: indicators.recentHigh,
    recentLow: indicators.recentLow
  };
}

function isValidSymbol(symbol: string): boolean {
  return /^[A-Z0-9.-]{2,12}$/i.test(symbol.trim());
}
