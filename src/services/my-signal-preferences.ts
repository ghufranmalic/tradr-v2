import { prisma } from "@/src/lib/prisma";

const DEFAULT_ID = "default";

export type MySignalPreferenceView = {
  positivePercent: number;
  negativePercent: number;
  enabled: boolean;
};

export async function getMySignalPreference(): Promise<MySignalPreferenceView> {
  const preference = await prisma.mySignalPreference.upsert({
    where: { id: DEFAULT_ID },
    update: {},
    create: {
      id: DEFAULT_ID,
      positivePercent: 5,
      negativePercent: -5,
      enabled: true
    }
  });

  return {
    positivePercent: Number(preference.positivePercent),
    negativePercent: Number(preference.negativePercent),
    enabled: preference.enabled
  };
}

export async function updateMySignalPreference(input: Partial<MySignalPreferenceView>): Promise<MySignalPreferenceView> {
  const positivePercent = normalizePercent(input.positivePercent, 5, true);
  const negativePercent = normalizePercent(input.negativePercent, -5, false);
  const preference = await prisma.mySignalPreference.upsert({
    where: { id: DEFAULT_ID },
    update: {
      positivePercent,
      negativePercent,
      enabled: Boolean(input.enabled)
    },
    create: {
      id: DEFAULT_ID,
      positivePercent,
      negativePercent,
      enabled: Boolean(input.enabled)
    }
  });

  return {
    positivePercent: Number(preference.positivePercent),
    negativePercent: Number(preference.negativePercent),
    enabled: preference.enabled
  };
}

function normalizePercent(value: number | undefined, fallback: number, positive: boolean): number {
  if (!Number.isFinite(value)) return fallback;
  const absolute = Math.min(100, Math.max(0.1, Math.abs(value as number)));
  return positive ? absolute : -absolute;
}
