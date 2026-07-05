import { prisma } from "@/src/lib/prisma";

export type CollectionTrigger = "manual" | "scheduled";

export type CollectionPolicyView = {
  manualRefreshEnabled: boolean;
  scheduledEnabled: boolean;
  intervalMinutes: number;
  weekdays: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  lastScheduledRunAt?: string;
};

export type CollectionDecision = {
  allowed: boolean;
  reason?: string;
  policy: CollectionPolicyView;
};

const DEFAULT_POLICY_ID = "default";

export async function getCollectionPolicy(): Promise<CollectionPolicyView> {
  const policy = await prisma.collectionPolicy.upsert({
    where: { id: DEFAULT_POLICY_ID },
    update: {},
    create: {
      id: DEFAULT_POLICY_ID,
      manualRefreshEnabled: true,
      scheduledEnabled: false,
      intervalMinutes: 5,
      weekdays: "1,2,3,4,5",
      startTime: "09:00",
      endTime: "15:59",
      timezone: "Asia/Karachi"
    }
  });

  return toPolicyView(policy);
}

export async function updateCollectionPolicy(input: Partial<CollectionPolicyView>): Promise<CollectionPolicyView> {
  const intervalMinutes = clampInteger(input.intervalMinutes, 1, 240, 5);
  const weekdays = normalizeWeekdays(input.weekdays);
  const startTime = normalizeTime(input.startTime, "09:00");
  const endTime = normalizeTime(input.endTime, "15:59");

  const policy = await prisma.collectionPolicy.upsert({
    where: { id: DEFAULT_POLICY_ID },
    update: {
      manualRefreshEnabled: Boolean(input.manualRefreshEnabled),
      scheduledEnabled: Boolean(input.scheduledEnabled),
      intervalMinutes,
      weekdays: weekdays.join(","),
      startTime,
      endTime,
      timezone: input.timezone?.trim() || "Asia/Karachi"
    },
    create: {
      id: DEFAULT_POLICY_ID,
      manualRefreshEnabled: Boolean(input.manualRefreshEnabled),
      scheduledEnabled: Boolean(input.scheduledEnabled),
      intervalMinutes,
      weekdays: weekdays.join(","),
      startTime,
      endTime,
      timezone: input.timezone?.trim() || "Asia/Karachi"
    }
  });

  return toPolicyView(policy);
}

export async function decideCollection(trigger: CollectionTrigger, now = new Date()): Promise<CollectionDecision> {
  const policy = await getCollectionPolicy();

  if (trigger === "manual" && !policy.manualRefreshEnabled) {
    return { allowed: false, reason: "Manual refresh is disabled in collection settings.", policy };
  }

  if (trigger === "manual") {
    return { allowed: true, policy };
  }

  if (trigger === "scheduled" && !policy.scheduledEnabled) {
    return { allowed: false, reason: "Automatic scheduled collection is disabled.", policy };
  }

  const local = localParts(now, policy.timezone);
  if (!policy.weekdays.includes(local.weekday)) {
    return { allowed: false, reason: `Collection is not allowed today in ${policy.timezone}.`, policy };
  }

  const currentMinutes = timeToMinutes(local.time);
  if (currentMinutes < timeToMinutes(policy.startTime) || currentMinutes > timeToMinutes(policy.endTime)) {
    return {
      allowed: false,
      reason: `Collection is only allowed from ${policy.startTime} to ${policy.endTime} ${policy.timezone}. Current local time is ${local.time}.`,
      policy
    };
  }

  if (trigger === "scheduled" && policy.lastScheduledRunAt) {
    const elapsedMs = now.getTime() - new Date(policy.lastScheduledRunAt).getTime();
    if (elapsedMs < policy.intervalMinutes * 60_000) {
      return { allowed: false, reason: `Next scheduled collection is not due yet.`, policy };
    }
  }

  return { allowed: true, policy };
}

export async function markScheduledCollectionRun(date = new Date()): Promise<void> {
  await prisma.collectionPolicy.update({
    where: { id: DEFAULT_POLICY_ID },
    data: { lastScheduledRunAt: date }
  });
}

function toPolicyView(policy: {
  manualRefreshEnabled: boolean;
  scheduledEnabled: boolean;
  intervalMinutes: number;
  weekdays: string;
  startTime: string;
  endTime: string;
  timezone: string;
  lastScheduledRunAt: Date | null;
}): CollectionPolicyView {
  return {
    manualRefreshEnabled: policy.manualRefreshEnabled,
    scheduledEnabled: policy.scheduledEnabled,
    intervalMinutes: policy.intervalMinutes,
    weekdays: normalizeWeekdays(policy.weekdays.split(",").map(Number)),
    startTime: policy.startTime,
    endTime: policy.endTime,
    timezone: policy.timezone,
    lastScheduledRunAt: policy.lastScheduledRunAt?.toISOString()
  };
}

function localParts(date: Date, timezone: string): { weekday: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return { weekday: weekdayNumber(weekdayName), time: `${hour}:${minute}` };
}

function weekdayNumber(name: string): number {
  const normalized = name.slice(0, 3).toLowerCase();
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(normalized);
}

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function normalizeTime(value: string | undefined, fallback: string): string {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return fallback;
  const [hour, minute] = value.split(":").map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return value;
}

function normalizeWeekdays(value: unknown): number[] {
  const raw = Array.isArray(value) ? value.map(Number) : [1, 2, 3, 4, 5];
  const days = Array.from(new Set(raw.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort();
  return days.length > 0 ? days : [1, 2, 3, 4, 5];
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value as number));
}
