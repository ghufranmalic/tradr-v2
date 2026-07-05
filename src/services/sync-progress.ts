import { prisma } from "@/src/lib/prisma";
import { createInitialSyncProgress, type SyncProgressState, type SyncStep, type SyncStepStatus } from "@/src/lib/sync-steps";

export type { SyncProgressState, SyncStep, SyncStepStatus };

/**
 * Sync progress lives on CollectionRun.progress (JSON) so the collector — which
 * runs in GitHub Actions — and the Vercel dashboard share state through the
 * database instead of process memory.
 */

const STALE_RUN_MS = 10 * 60 * 1000;

let currentRunId: string | null = null;
let cachedState: SyncProgressState | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

const idleState = (): SyncProgressState => ({
  active: false,
  startedAt: null,
  finishedAt: null,
  steps: [],
  error: null
});

async function persist(): Promise<void> {
  if (!currentRunId || !cachedState) return;
  await prisma.collectionRun.update({
    where: { id: currentRunId },
    data: { progress: JSON.stringify(cachedState) }
  });
}

/** Create the CollectionRun row that anchors this sync and its progress. */
export async function beginSyncRun(): Promise<string> {
  cachedState = createInitialSyncProgress();
  const run = await prisma.collectionRun.create({
    data: { status: "running", progress: JSON.stringify(cachedState) }
  });
  currentRunId = run.id;
  return run.id;
}

export async function startSyncStep(id: string, label?: string, detail?: string): Promise<void> {
  if (!cachedState) return;
  for (const step of cachedState.steps) {
    if (step.status === "running") step.status = "done";
  }

  const step = cachedState.steps.find((item) => item.id === id);
  if (!step) {
    cachedState.steps.push({ id, label: label ?? id, status: "running", at: nowIso(), detail });
  } else {
    if (label) step.label = label;
    step.status = "running";
    step.at = nowIso();
    step.detail = detail;
  }
  await persist();
}

export async function finishSyncStep(id: string, detail?: string): Promise<void> {
  if (!cachedState) return;
  const step = cachedState.steps.find((item) => item.id === id);
  if (!step) return;
  step.status = "done";
  step.at = nowIso();
  if (detail !== undefined) step.detail = detail;
  await persist();
}

export async function completeSync(quoteCount = 0): Promise<void> {
  if (!cachedState || !currentRunId) return;
  for (const step of cachedState.steps) {
    if (step.status === "running" || step.status === "pending") step.status = "done";
  }
  cachedState.active = false;
  cachedState.finishedAt = nowIso();
  cachedState.error = null;

  await prisma.collectionRun.update({
    where: { id: currentRunId },
    data: {
      status: "success",
      finishedAt: new Date(),
      quoteCount,
      progress: JSON.stringify(cachedState)
    }
  });
  currentRunId = null;
  cachedState = null;
}

export async function failSync(error: string): Promise<void> {
  if (!cachedState || !currentRunId) return;
  const running = cachedState.steps.find((step) => step.status === "running");
  if (running) {
    running.status = "error";
  } else {
    const nextPending = cachedState.steps.find((step) => step.status === "pending");
    if (nextPending) nextPending.status = "error";
  }
  cachedState.active = false;
  cachedState.finishedAt = nowIso();
  cachedState.error = error;

  await prisma.collectionRun.update({
    where: { id: currentRunId },
    data: {
      status: "failed",
      finishedAt: new Date(),
      error,
      progress: JSON.stringify(cachedState)
    }
  });
  currentRunId = null;
  cachedState = null;
}

/** Read progress of the most recent run — works from any process (Vercel, Actions, local). */
export async function getSyncProgress(): Promise<SyncProgressState> {
  const run = await prisma.collectionRun.findFirst({ orderBy: { startedAt: "desc" } });
  if (!run) return idleState();

  const parsed = parseProgress(run.progress);
  const stale = run.status === "running" && Date.now() - run.startedAt.getTime() > STALE_RUN_MS;

  if (parsed) {
    return stale ? { ...parsed, active: false, error: parsed.error ?? "Sync timed out." } : parsed;
  }

  return {
    active: run.status === "running" && !stale,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    steps: [],
    error: run.error ?? null
  };
}

export async function isSyncActive(): Promise<boolean> {
  const run = await prisma.collectionRun.findFirst({ orderBy: { startedAt: "desc" } });
  if (!run || run.status !== "running") return false;
  return Date.now() - run.startedAt.getTime() <= STALE_RUN_MS;
}

function parseProgress(progress: string | null): SyncProgressState | null {
  if (!progress) return null;
  try {
    return JSON.parse(progress) as SyncProgressState;
  } catch {
    return null;
  }
}
