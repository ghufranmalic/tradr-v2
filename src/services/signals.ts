import { percentChange } from "@/src/lib/number";
import type { IndicatorSet, PortfolioPositionInput, Quote, SignalInput } from "@/src/types/market";

/** Bollinger/momentum/volume/range checks shared by both the full-quote and portfolio-only signal builders. */
function buildCommonIndicatorSignals(symbol: string, close: number, indicators: IndicatorSet): SignalInput[] {
  const signals: SignalInput[] = [];

  if (indicators.bollingerLower !== undefined && close < indicators.bollingerLower) {
    signals.push({
      symbol,
      type: "bollinger_breakout_low",
      side: "buy",
      score: 65,
      message: `${symbol} broke below its lower Bollinger band`,
      metadata: { close, bollingerLower: indicators.bollingerLower }
    });
  }

  if (indicators.bollingerUpper !== undefined && close > indicators.bollingerUpper) {
    signals.push({
      symbol,
      type: "bollinger_breakout_high",
      side: "sell",
      score: 65,
      message: `${symbol} broke above its upper Bollinger band`,
      metadata: { close, bollingerUpper: indicators.bollingerUpper }
    });
  }

  if (indicators.momentum10 !== undefined && Math.abs(indicators.momentum10) >= 10) {
    signals.push({
      symbol,
      type: "strong_momentum",
      side: indicators.momentum10 > 0 ? "watch" : "sell",
      score: 60,
      message: `${symbol} has ${indicators.momentum10 > 0 ? "gained" : "lost"} ${Math.abs(indicators.momentum10).toFixed(1)}% over the last 10 sessions`,
      metadata: { momentum10: indicators.momentum10 }
    });
  }

  if (indicators.volumeRatio !== undefined && indicators.volumeRatio >= 2) {
    signals.push({
      symbol,
      type: "volume_spike",
      side: "watch",
      score: 55,
      message: `${symbol} volume is ${indicators.volumeRatio.toFixed(1)}x its 20-day average`,
      metadata: { volumeRatio: indicators.volumeRatio }
    });
  }

  if (indicators.recentLow !== undefined && close <= indicators.recentLow * 1.01) {
    signals.push({
      symbol,
      type: "near_support",
      side: "buy",
      score: 50,
      message: `${symbol} is trading near its 20-day low (support)`,
      metadata: { close, recentLow: indicators.recentLow }
    });
  }

  if (indicators.recentHigh !== undefined && close >= indicators.recentHigh * 0.99) {
    signals.push({
      symbol,
      type: "near_resistance",
      side: "watch",
      score: 50,
      message: `${symbol} is trading near its 20-day high (resistance)`,
      metadata: { close, recentHigh: indicators.recentHigh }
    });
  }

  return signals;
}

export function buildSignals(quote: Quote, previousClose: number | undefined, indicators: IndicatorSet): SignalInput[] {
  const signals: SignalInput[] = [...buildCommonIndicatorSignals(quote.symbol, quote.close, indicators)];

  if (indicators.sma20 && quote.close < indicators.sma20) {
    signals.push({
      symbol: quote.symbol,
      type: "below_sma20",
      side: "buy",
      score: 55,
      message: `${quote.symbol} is below its 20-day moving average`,
      metadata: { close: quote.close, sma20: indicators.sma20 }
    });
  }

  if (indicators.rsi14 !== undefined && indicators.rsi14 < 30) {
    signals.push({
      symbol: quote.symbol,
      type: "oversold_rsi",
      side: "buy",
      score: 75,
      message: `${quote.symbol} RSI is oversold at ${indicators.rsi14}`,
      metadata: { rsi14: indicators.rsi14 }
    });
  }

  if (indicators.macd !== undefined && indicators.macdSignal !== undefined && indicators.macd > indicators.macdSignal) {
    signals.push({
      symbol: quote.symbol,
      type: "macd_bullish",
      side: "watch",
      score: 60,
      message: `${quote.symbol} MACD is above signal line`,
      metadata: { macd: indicators.macd, macdSignal: indicators.macdSignal }
    });
  }

  if (previousClose) {
    const change = percentChange(quote.close, previousClose);
    if (change <= -5) {
      signals.push({
        symbol: quote.symbol,
        type: "price_drop",
        side: "watch",
        score: 65,
        message: `${quote.symbol} dropped ${change.toFixed(2)}% from previous close`,
        metadata: { change, close: quote.close, previousClose }
      });
    }
  }

  if (quote.volume > 0 && quote.close >= quote.high * 0.995) {
    signals.push({
      symbol: quote.symbol,
      type: "near_day_high",
      side: "watch",
      score: 45,
      message: `${quote.symbol} is trading near the day high`,
      metadata: { close: quote.close, high: quote.high, volume: quote.volume }
    });
  }

  return signals;
}

/**
 * Same technical checks as buildSignals, but driven off a portfolio position's
 * last price instead of a full OHLCV quote — used when KTrade doesn't expose a
 * separate market-quotes feed. Skips near_day_high since positions don't carry
 * a real intraday high (only lastPrice), so that check would be meaningless.
 */
export function buildPositionIndicatorSignals(
  symbol: string,
  close: number,
  previousClose: number | undefined,
  indicators: IndicatorSet
): SignalInput[] {
  const signals: SignalInput[] = [...buildCommonIndicatorSignals(symbol, close, indicators)];

  if (indicators.sma20 && close < indicators.sma20) {
    signals.push({
      symbol,
      type: "below_sma20",
      side: "buy",
      score: 55,
      message: `${symbol} is below its 20-day moving average`,
      metadata: { close, sma20: indicators.sma20 }
    });
  }

  if (indicators.rsi14 !== undefined && indicators.rsi14 < 30) {
    signals.push({
      symbol,
      type: "oversold_rsi",
      side: "buy",
      score: 75,
      message: `${symbol} RSI is oversold at ${indicators.rsi14}`,
      metadata: { rsi14: indicators.rsi14 }
    });
  }

  if (indicators.macd !== undefined && indicators.macdSignal !== undefined && indicators.macd > indicators.macdSignal) {
    signals.push({
      symbol,
      type: "macd_bullish",
      side: "watch",
      score: 60,
      message: `${symbol} MACD is above signal line`,
      metadata: { macd: indicators.macd, macdSignal: indicators.macdSignal }
    });
  }

  if (previousClose) {
    const change = percentChange(close, previousClose);
    if (change <= -5) {
      signals.push({
        symbol,
        type: "price_drop",
        side: "watch",
        score: 65,
        message: `${symbol} dropped ${change.toFixed(2)}% from previous close`,
        metadata: { change, close, previousClose }
      });
    }
  }

  return signals;
}

export function buildPortfolioSignals(positions: PortfolioPositionInput[], thresholds = { positivePercent: 5, negativePercent: -5, enabled: true }): SignalInput[] {
  if (!thresholds.enabled) return [];
  return positions.flatMap((position): SignalInput[] => {
    if (!position.purchasePrice) return [];
    const gainPercent = ((position.lastPrice - position.purchasePrice) / position.purchasePrice) * 100;
    const absoluteGain = position.totalGainLoss || (position.lastPrice - position.purchasePrice) * position.position;

    const positive = Math.abs(thresholds.positivePercent);
    const negative = -Math.abs(thresholds.negativePercent);

    if (gainPercent >= positive * 2) {
      return [
        {
          symbol: position.symbol,
          type: "my_signal_gain_strong",
          side: "sell",
          score: 90,
          message: `${position.symbol} is up ${gainPercent.toFixed(2)}% from purchase price. Consider taking profit.`,
          metadata: { gainPercent, absoluteGain, purchasePrice: position.purchasePrice, lastPrice: position.lastPrice }
        }
      ];
    }

    if (gainPercent >= positive) {
      return [
        {
          symbol: position.symbol,
          type: "my_signal_gain",
          side: "sell",
          score: 80,
          message: `${position.symbol} is up ${gainPercent.toFixed(2)}% from purchase price.`,
          metadata: { gainPercent, absoluteGain, purchasePrice: position.purchasePrice, lastPrice: position.lastPrice }
        }
      ];
    }

    if (gainPercent <= negative * 2) {
      return [
        {
          symbol: position.symbol,
          type: "my_signal_drop_strong",
          side: "buy",
          score: 90,
          message: `${position.symbol} is down ${gainPercent.toFixed(2)}% from purchase price. Consider averaging/buy criteria.`,
          metadata: { gainPercent, absoluteGain, purchasePrice: position.purchasePrice, lastPrice: position.lastPrice }
        }
      ];
    }

    if (gainPercent <= negative) {
      return [
        {
          symbol: position.symbol,
          type: "my_signal_drop",
          side: "buy",
          score: 80,
          message: `${position.symbol} is down ${gainPercent.toFixed(2)}% from purchase price.`,
          metadata: { gainPercent, absoluteGain, purchasePrice: position.purchasePrice, lastPrice: position.lastPrice }
        }
      ];
    }

    return [];
  });
}
