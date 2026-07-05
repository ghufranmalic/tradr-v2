import { NextResponse } from "next/server";
import { isLocalCollectorAvailable } from "@/src/lib/runtime";
import { decideCollection } from "@/src/services/collection-policy";
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

  // On Vercel: queue the sync for the local sync-watcher (running on your PC) to pick up.
  const status = await requestRemoteSync();
  return NextResponse.json({
    ok: true,
    mode: "remote",
    ...status,
    message: status.workerOnline
      ? "Sync queued — your PC will pick it up shortly."
      : "Sync queued — start npm run sync-watcher on your PC to process it."
  });
}
