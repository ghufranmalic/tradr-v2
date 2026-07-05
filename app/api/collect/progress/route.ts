import { NextResponse } from "next/server";
import { getSyncProgress } from "@/src/services/sync-progress";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getSyncProgress());
}
