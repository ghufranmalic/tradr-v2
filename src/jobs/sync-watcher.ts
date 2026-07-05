import cron from "node-cron";
import { env } from "@/src/config/env";
import { collectMarketData } from "@/src/jobs/collector";
import { decideCollection, markScheduledCollectionRun } from "@/src/services/collection-policy";
import { clearPendingSync, getSyncQueueStatus, touchWorkerSeen } from "@/src/services/sync-queue";

/**
 * Runs on your own PC (not GitHub Actions) so KTrade logins come from your
 * home network — the same network you'd log in from manually — instead of a
 * shared datacenter IP range that KTrade may throttle or flag as suspicious.
 * Polls Neon for Sync-button requests from the Vercel dashboard, and also
 * runs the scheduled collection cron if enabled in the dashboard settings.
 */

const POLL_MS = 15_000;
let running = false;

async function runCollector(trigger: "manual" | "scheduled", label: string): Promise<void> {
  if (running) {
    console.log(`[${new Date().toISOString()}] Skipping ${label}; a collection is already running.`);
    return;
  }

  running = true;
  try {
    console.log(`[${new Date().toISOString()}] Starting ${label}.`);
    await collectMarketData(trigger);
    if (trigger === "scheduled") {
      await markScheduledCollectionRun();
    }
    console.log(`[${new Date().toISOString()}] Finished ${label}.`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ${label} failed`, error);
  } finally {
    running = false;
  }
}

async function pollPendingSync(): Promise<void> {
  await touchWorkerSeen();
  if (running) return;

  const status = await getSyncQueueStatus();
  if (!status.pendingSyncAt) return;

  await clearPendingSync();
  await runCollector("manual", "dashboard-requested sync");
}

async function pollScheduledCollection(): Promise<void> {
  if (running) return;
  const decision = await decideCollection("scheduled");
  if (!decision.allowed) return;
  await runCollector("scheduled", "scheduled collection");
}

async function start(): Promise<void> {
  console.log("Sync watcher active on this PC — logins run from your home network.");
  await pollPendingSync();
  setInterval(() => void pollPendingSync(), POLL_MS);

  cron.schedule("* * * * *", () => void pollScheduledCollection(), { timezone: env.MARKET_TIMEZONE });
}

void start();
