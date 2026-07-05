import { prisma } from "@/src/lib/prisma";

const DEFAULT_POLICY_ID = "default";
const WORKER_ONLINE_MS = 90_000;

export type SyncQueueStatus = {
  pendingSyncAt: string | null;
  workerOnline: boolean;
  lastRun: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    quoteCount: number;
    error: string | null;
  } | null;
};

/** Called by the local sync-watcher on every poll tick to report it's alive. */
export async function touchWorkerSeen(date = new Date()): Promise<void> {
  await prisma.collectionPolicy.upsert({
    where: { id: DEFAULT_POLICY_ID },
    update: { workerSeenAt: date },
    create: {
      id: DEFAULT_POLICY_ID,
      workerSeenAt: date
    }
  });
}

/** Marks a sync as queued; the local sync-watcher clears this once it starts. */
export async function requestRemoteSync(date = new Date()): Promise<SyncQueueStatus> {
  await prisma.collectionPolicy.upsert({
    where: { id: DEFAULT_POLICY_ID },
    update: { pendingSyncAt: date },
    create: {
      id: DEFAULT_POLICY_ID,
      pendingSyncAt: date
    }
  });

  return getSyncQueueStatus();
}

export async function clearPendingSync(): Promise<void> {
  await prisma.collectionPolicy.updateMany({
    where: { id: DEFAULT_POLICY_ID, pendingSyncAt: { not: null } },
    data: { pendingSyncAt: null }
  });
}

export async function getSyncQueueStatus(now = new Date()): Promise<SyncQueueStatus> {
  const [policy, lastRun] = await Promise.all([
    prisma.collectionPolicy.findUnique({ where: { id: DEFAULT_POLICY_ID } }),
    prisma.collectionRun.findFirst({ orderBy: { startedAt: "desc" } })
  ]);

  const workerOnline = Boolean(
    policy?.workerSeenAt && now.getTime() - policy.workerSeenAt.getTime() <= WORKER_ONLINE_MS
  );

  return {
    pendingSyncAt: policy?.pendingSyncAt?.toISOString() ?? null,
    workerOnline,
    lastRun: lastRun
      ? {
          status: lastRun.status,
          startedAt: lastRun.startedAt.toISOString(),
          finishedAt: lastRun.finishedAt?.toISOString() ?? null,
          quoteCount: lastRun.quoteCount,
          error: lastRun.error ?? null
        }
      : null
  };
}
