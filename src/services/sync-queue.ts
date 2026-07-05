import { prisma } from "@/src/lib/prisma";

const DEFAULT_POLICY_ID = "default";

export type SyncQueueStatus = {
  pendingSyncAt: string | null;
  lastRun: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    quoteCount: number;
    error: string | null;
  } | null;
};

/** Marks a sync as queued; the GitHub Actions collector clears this once it starts. */
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

export async function getSyncQueueStatus(): Promise<SyncQueueStatus> {
  const [policy, lastRun] = await Promise.all([
    prisma.collectionPolicy.findUnique({ where: { id: DEFAULT_POLICY_ID } }),
    prisma.collectionRun.findFirst({ orderBy: { startedAt: "desc" } })
  ]);

  return {
    pendingSyncAt: policy?.pendingSyncAt?.toISOString() ?? null,
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
