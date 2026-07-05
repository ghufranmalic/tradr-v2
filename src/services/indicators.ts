import { round } from "@/src/lib/number";
import type { IndicatorSet } from "@/src/types/market";

export function sma(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined;
  const slice = values.slice(-period);
  return round(slice.reduce((sum, value) => sum + value, 0) / period);
}

export function ema(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined;
  const multiplier = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const result = values.slice(period).reduce((previous, value) => {
    return value * multiplier + previous * (1 - multiplier);
  }, seed);
  return round(result);
}

export function rsi(values: number[], period = 14): number | undefined {
  if (values.length <= period) return undefined;

  const changes = values.slice(1).map((value, index) => value - values[index]);
  const seed = changes.slice(0, period);
  let averageGain = seed.reduce((sum, change) => sum + Math.max(change, 0), 0) / period;
  let averageLoss = seed.reduce((sum, change) => sum + Math.abs(Math.min(change, 0)), 0) / period;

  for (const change of changes.slice(period)) {
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.abs(Math.min(change, 0))) / period;
  }

  if (averageLoss === 0) return 100;
  const relativeStrength = averageGain / averageLoss;
  return round(100 - 100 / (1 + relativeStrength));
}

export function macd(values: number[]): Pick<IndicatorSet, "macd" | "macdSignal" | "macdHist"> {
  if (values.length < 35) return {};
  const macdSeries: number[] = [];
  for (let index = 26; index <= values.length; index += 1) {
    const window = values.slice(0, index);
    const fast = ema(window, 12);
    const slow = ema(window, 26);
    if (fast !== undefined && slow !== undefined) {
      macdSeries.push(fast - slow);
    }
  }

  const currentMacd = macdSeries.at(-1);
  const signal = ema(macdSeries, 9);
  if (currentMacd === undefined || signal === undefined) return {};
  return {
    macd: round(currentMacd),
    macdSignal: signal,
    macdHist: round(currentMacd - signal)
  };
}

export function calculateIndicators(closes: number[]): IndicatorSet {
  return {
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    ema12: ema(closes, 12),
    ema26: ema(closes, 26),
    rsi14: rsi(closes, 14),
    ...macd(closes)
  };
}
