import { isLocalCollectorAvailable } from "@/src/lib/runtime";
import { loadDashboardData } from "@/src/services/dashboard-data";
import { getSyncQueueStatus } from "@/src/services/sync-queue";
import DashboardClient from "@/src/ui/DashboardClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [data, syncStatus] = await Promise.all([loadDashboardData(), getSyncQueueStatus()]);

  return (
    <DashboardClient
      data={data}
      syncMode={isLocalCollectorAvailable() ? "direct" : "remote"}
      workerOnline={syncStatus.workerOnline}
    />
  );
}
