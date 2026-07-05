import { NextResponse } from "next/server";
import { isLocalCollectorAvailable } from "@/src/lib/runtime";
import { decideCollection } from "@/src/services/collection-policy";
import { triggerCollectWorkflow } from "@/src/services/github-dispatch";
import { getSyncProgress, isSyncActive } from "@/src/services/sync-progress";
import { getSyncQueueStatus, requestRemoteSync } from "@/src/services/sync-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const status = await getSyncQueueStatus();
  return NextResponse.json(status);
}

export async function POST() {
  const decision = await decideCollection("manual");
  if (!decision.allowed) {
    return NextResponse.json({ ok: false, error: decision.reason }, { status: 409 });
  }

  if (await isSyncActive()) {
    return NextResponse.json(
      { ok: false, error: "A sync is already running.", progress: await getSyncProgress() },
      { status: 409 }
    );
  }

  // Local dev convenience: run the collector in-process when not on Vercel.
  if (isLocalCollectorAvailable()) {
    void import("@/src/jobs/collector")
      .then(({ collectMarketData }) => collectMarketData("manual", { skipPolicyCheck: true }))
      .catch((error) => {
        console.error("[collect] background sync failed", error);
      });

    const status = await getSyncQueueStatus();
    return NextResponse.json({ ok: true, mode: "direct", started: true, ...status });
  }

  // Cloud mode: queue the sync and kick the GitHub Actions collector.
  const status = await requestRemoteSync();
  const dispatch = await triggerCollectWorkflow().catch((error) => ({
    triggered: false,
    detail: error instanceof Error ? error.message : String(error)
  }));

  return NextResponse.json({
    ok: true,
    mode: "remote",
    ...status,
    dispatched: dispatch.triggered,
    message: dispatch.triggered
      ? "Sync started on GitHub Actions — data will refresh shortly."
      : `Sync queued. ${dispatch.detail}`
  });
}
