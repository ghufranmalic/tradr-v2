export type SyncStepStatus = "pending" | "running" | "done" | "error";

export type SyncStep = {
  id: string;
  label: string;
  status: SyncStepStatus;
  at: string;
  detail?: string;
};

export type SyncProgressState = {
  active: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  steps: SyncStep[];
  error: string | null;
};

export const SYNC_STEP_PLAN: Array<{ id: string; label: string }> = [
  { id: "connect", label: "Launching browser & connecting to KTrade" },
  { id: "login", label: "Logging in to KTrade" },
  { id: "portfolio", label: "Fetching portfolio positions" },
  { id: "summary", label: "Fetching portfolio summary" },
  { id: "watchlists", label: "Saving watchlists" },
  { id: "quotes", label: "Fetching market quotes" },
  { id: "signals", label: "Calculating signals & indicators" },
  { id: "orders", label: "Evaluating auto-trade orders" },
  { id: "alerts", label: "Evaluating alerts" },
  { id: "done", label: "Finishing up" }
];

export function createInitialSyncProgress(): SyncProgressState {
  const at = new Date().toISOString();
  return {
    active: true,
    startedAt: at,
    finishedAt: null,
    steps: SYNC_STEP_PLAN.map(
      (step): SyncStep => ({
        id: step.id,
        label: step.label,
        status: "pending",
        at
      })
    ),
    error: null
  };
}

export function formatSyncError(error: string): string {
  if (error.includes("Executable doesn't exist") || error.includes("playwright install")) {
    return "Playwright browser is not installed. In your project folder run: npx playwright install chromium";
  }

  if (error.includes("Unique constraint failed") && error.includes("symbol")) {
    return "Indicator save conflict (duplicate symbol for today). Retry sync — this is now handled automatically.";
  }

  return error
    .replace(/Invalid `prisma\.[^`]+` invocation:\s*/g, "")
    .replace(/╔[\s\S]*?╝/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefer live server steps; never wipe the checklist with an empty idle payload mid-sync. */
export function mergeSyncProgress(
  current: SyncProgressState,
  server: SyncProgressState,
  syncing: boolean
): SyncProgressState {
  const serverHasSteps = server.steps.length > 0;
  const serverHasTerminalState = Boolean(server.error || server.finishedAt);

  if (serverHasSteps) {
    return server;
  }

  if (syncing && current.steps.length > 0) {
    return {
      ...current,
      active: server.active || current.active,
      error: server.error ?? current.error
    };
  }

  if (serverHasTerminalState) {
    return {
      ...server,
      steps: current.steps.length > 0 ? current.steps : server.steps
    };
  }

  return server.active ? server : current;
}
