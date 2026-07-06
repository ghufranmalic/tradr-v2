import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { cancelOrder, decideOrder, proposeManualOrder } from "@/src/services/trade-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const orders = await prisma.order.findMany({
    include: { ticker: { select: { symbol: true, name: true } } },
    orderBy: { proposedAt: "desc" },
    take: 50
  });

  return NextResponse.json(
    orders.map((order) => ({
      id: order.id,
      symbol: order.ticker.symbol,
      name: order.ticker.name ?? "",
      side: order.side,
      quantity: Number(order.quantity),
      limitPrice: order.limitPrice ? Number(order.limitPrice) : null,
      estimatedValue: Number(order.estimatedValue),
      reason: order.reason,
      status: order.status,
      mode: order.mode,
      detail: order.detail ?? "",
      proposedAt: order.proposedAt.toISOString(),
      executedAt: order.executedAt?.toISOString() ?? null
    }))
  );
}

const manualOrderSchema = z.object({
  symbol: z.string().min(1).max(20),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  limitPrice: z.number().positive().optional()
});

export async function POST(request: Request) {
  const parsed = manualOrderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { symbol, side, quantity, limitPrice? }." }, { status: 400 });
  }

  const result = await proposeManualOrder(parsed.data);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, orderId: result.orderId });
}

const decisionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["approve", "reject", "cancel"])
});

export async function PATCH(request: Request) {
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { id, action: approve|reject|cancel }." }, { status: 400 });
  }

  if (parsed.data.action === "cancel") {
    const result = await cancelOrder(parsed.data.id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  const order = await prisma.order.findUnique({ where: { id: parsed.data.id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.status !== "proposed") {
    return NextResponse.json({ error: `Order is already ${order.status}.` }, { status: 409 });
  }

  await decideOrder(parsed.data.id, parsed.data.action);
  return NextResponse.json({ ok: true });
}
