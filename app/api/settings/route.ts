import { NextResponse } from "next/server";
import { getCollectionPolicy, updateCollectionPolicy } from "@/src/services/collection-policy";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getCollectionPolicy());
}

export async function PUT(request: Request) {
  const body = await request.json();
  return NextResponse.json(await updateCollectionPolicy(body));
}
