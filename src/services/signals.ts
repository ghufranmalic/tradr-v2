import { percentChange } from "@/src/lib/number";
import type { IndicatorSet, PortfolioPositionInput, Quote, SignalInput } from "@/src/types/market";

export function buildSignals(quote: Quote, previousClose: number | undefined, indicators: IndicatorSet): SignalInput[] {
  const signals: SignalInput[] = [];

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
