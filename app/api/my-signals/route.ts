import { NextResponse } from "next/server";
import { getMySignalPreference, updateMySignalPreference } from "@/src/services/my-signal-preferences";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getMySignalPreference());
}

export async function PUT(request: Request) {
  const body = await request.json();
  return NextResponse.json(await updateMySignalPreference(body));
}
