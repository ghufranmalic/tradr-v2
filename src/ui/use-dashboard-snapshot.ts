"use client";

import { useEffect, useState } from "react";
import type { DashboardData } from "@/src/ui/DashboardClient";

const STORAGE_KEY = "tradr-dashboard-snapshot";

export function hasLoadedDashboardData(data: DashboardData): boolean {
  return (
    data.portfolioPositions.length > 0 ||
    data.holdings.length > 0 ||
    data.summaryMetrics.length > 0 ||
    data.runs.some((run) => run.status === "success")
  );
}

function readCachedDashboard(): DashboardData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardData;
    return hasLoadedDashboardData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedDashboard(data: DashboardData): void {
  if (typeof window === "undefined" || !hasLoadedDashboardData(data)) return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** Keep the last good dashboard snapshot until a successful refresh replaces it. */
export function useDashboardSnapshot(serverData: DashboardData): {
  dashboard: DashboardData;
  replaceDashboard: (next: DashboardData) => void;
} {
  const [dashboard, setDashboard] = useState<DashboardData>(() => {
    if (hasLoadedDashboardData(serverData)) return serverData;
    return readCachedDashboard() ?? serverData;
  });

  useEffect(() => {
    if (hasLoadedDashboardData(serverData)) {
      setDashboard(serverData);
      writeCachedDashboard(serverData);
    }
  }, [serverData]);

  function replaceDashboard(next: DashboardData): void {
    setDashboard(next);
    writeCachedDashboard(next);
  }

  return { dashboard, replaceDashboard };
}
