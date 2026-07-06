export type Quote = {
  symbol: string;
  name?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date;
};

export type HoldingInput = {
  symbol: string;
  name?: string;
  quantity: number;
  averageBuy: number;
  targetPrice?: number;
  stopLossPrice?: number;
};

export type PortfolioRow = HoldingInput & {
  currentPrice?: number;
};

export type PortfolioPositionInput = {
  symbol: string;
  name?: string;
  market?: string;
  position: number;
  purchasePrice: number;
  lastPrice: number;
  todayGainLoss: number;
  totalGainLoss: number;
  bidSize: number;
  bidPrice: number;
  askPrice: number;
  askSize: number;
  change: number;
  holding?: number;
  holdingAvailable?: number;
  marketRate?: number;
  custodyValue?: number;
  profitLoss?: number;
};

export type PortfolioSummaryInput = {
  label: string;
  value: number;
};

export type MySignalPreferenceInput = {
  id: string;
  positivePercent: number;
  negativePercent: number;
  enabled: boolean;
};

export type WatchlistInput = {
  name: string;
  symbols: Array<{ symbol: string; name?: string }>;
};

export type IndicatorSet = {
  sma20?: number;
  sma50?: number;
  ema12?: number;
  ema26?: number;
  rsi14?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  bollingerUpper?: number;
  bollingerLower?: number;
  momentum10?: number;
  volumeRatio?: number;
  recentHigh?: number;
  recentLow?: number;
};

export type SignalInput = {
  symbol: string;
  type: string;
  side: "buy" | "sell" | "watch";
  score: number;
  message: string;
  metadata?: Record<string, unknown>;
};

export type OrderRequest = {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  limitPrice?: number;
};

export type OrderResult = {
  placed: boolean;
  detail: string;
};
