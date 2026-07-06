import { prisma } from "@/src/lib/prisma";

const DEFAULT_ID = "default";
const HORIZONS = ["daily", "weekly", "monthly"] as const;
export type TradeHorizon = (typeof HORIZONS)[number];

export type TradeSettingsView = {
  enabled: boolean;
  autoApprove: boolean;
  liveExecution: boolean;
  aiAdvisorEnabled: boolean;
  horizon: TradeHorizon;
  sellPortionPercent: number;
  buyOrderValue: number;
  maxOrderValue: number;
  maxOrdersPerDay: number;
};

export async function getTradeSettings(): Promise<TradeSettingsView> {
  const settings = await prisma.tradeSettings.upsert({
    where: { id: DEFAULT_ID },
    update: {},
    create: { id: DEFAULT_ID }
  });
  return toView(settings);
}

export async function updateTradeSettings(input: Partial<TradeSettingsView>): Promise<TradeSettingsView> {
  const data = {
    enabled: Boolean(input.enabled),
    autoApprove: Boolean(input.autoApprove),
    liveExecution: Boolean(input.liveExecution),
    aiAdvisorEnabled: input.aiAdvisorEnabled ?? true,
    horizon: HORIZONS.includes(input.horizon as TradeHorizon) ? (input.horizon as TradeHorizon) : "daily",
    sellPortionPercent: clamp(input.sellPortionPercent, 1, 100, 100),
    buyOrderValue: clamp(input.buyOrderValue, 0, 10_000_000, 25_000),
    maxOrderValue: clamp(input.maxOrderValue, 1_000, 10_000_000, 50_000),
    maxOrdersPerDay: Math.round(clamp(input.maxOrdersPerDay, 1, 50, 5))
  };

  const settings = await prisma.tradeSettings.upsert({
    where: { id: DEFAULT_ID },
    update: data,
    create: { id: DEFAULT_ID, ...data }
  });
  return toView(settings);
}

function toView(settings: {
  enabled: boolean;
  autoApprove: boolean;
  liveExecution: boolean;
  aiAdvisorEnabled: boolean;
  horizon: string;
  sellPortionPercent: unknown;
  buyOrderValue: unknown;
  maxOrderValue: unknown;
  maxOrdersPerDay: number;
}): TradeSettingsView {
  return {
    enabled: settings.enabled,
    autoApprove: settings.autoApprove,
    liveExecution: settings.liveExecution,
    aiAdvisorEnabled: settings.aiAdvisorEnabled,
    horizon: HORIZONS.includes(settings.horizon as TradeHorizon) ? (settings.horizon as TradeHorizon) : "daily",
    sellPortionPercent: Number(settings.sellPortionPercent),
    buyOrderValue: Number(settings.buyOrderValue),
    maxOrderValue: Number(settings.maxOrderValue),
    maxOrdersPerDay: settings.maxOrdersPerDay
  };
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value as number));
}
