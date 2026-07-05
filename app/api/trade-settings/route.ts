import { NextResponse } from "next/server";
import { z } from "zod";
import { getTradeSettings, updateTradeSettings } from "@/src/services/trade-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getTradeSettings());
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  autoApprove: z.boolean(),
  liveExecution: z.boolean(),
  sellPortionPercent: z.number(),
  buyOrderValue: z.number(),
  maxOrderValue: z.number(),
  maxOrdersPerDay: z.number()
});

export async function PUT(request: Request) {
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid trade settings payload." }, { status: 400 });
  }
  return NextResponse.json(await updateTradeSettings(parsed.data));
}
