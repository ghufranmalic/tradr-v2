import { isLocalCollectorAvailable } from "@/src/lib/runtime";
import { loadDashboardData } from "@/src/services/dashboard-data";
import DashboardClient from "@/src/ui/DashboardClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const data = await loadDashboardData();

  return <DashboardClient data={data} syncMode={isLocalCollectorAvailable() ? "direct" : "remote"} />;
}
