import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { decideOrder } from "@/src/services/trade-engine";

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

const decisionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["approve", "reject"])
});

export async function PATCH(request: Request) {
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { id, action: approve|reject }." }, { status: 400 });
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
