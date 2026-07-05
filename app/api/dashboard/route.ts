import { NextResponse } from "next/server";
import { loadDashboardData } from "@/src/services/dashboard-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await loadDashboardData();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
