import { prisma } from "@/src/lib/prisma";
import { env } from "@/src/config/env";
import { normalizeTradingDate, upsertTickers } from "@/src/services/market-repository";
import { getMySignalPreference } from "@/src/services/my-signal-preferences";
import { getTradeSettings, type TradeSettingsView } from "@/src/services/trade-settings";
import type { KTradeClient } from "@/src/services/ktrade/client";
import type { PortfolioPositionInput } from "@/src/types/market";

/**
 * Turns the +/- percentage thresholds into broker orders with hard guardrails:
 * per-order value cap, per-day order cap, one order per symbol+side per day,
 * and live execution only when BOTH the dashboard toggle and the AUTO_TRADE_LIVE
 * environment switch are on. Everything is recorded on the Order table.
 */

export type TradeEngineResult = {
  proposed: number;
  executed: number;
  skipped: string[];
};

type OrderProposal = {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  limitPrice: number;
  estimatedValue: number;
  reason: string;
  signalType: string;
};

export async function runTradeEngine(
  positions: PortfolioPositionInput[],
  client?: KTradeClient
): Promise<TradeEngineResult> {
  const result: TradeEngineResult = { proposed: 0, executed: 0, skipped: [] };

  const settings = await getTradeSettings();
  if (!settings.enabled) {
    result.skipped.push("Auto-trade is disabled in settings.");
    return result;
  }

  const thresholds = await getMySignalPreference();
  if (!thresholds.enabled) {
    result.skipped.push("Signal thresholds are disabled.");
    return result;
  }

  const today = normalizeTradingDate(new Date());
  const todaysOrders = await prisma.order.findMany({
    where: { proposedAt: { gte: today } },
    include: { ticker: { select: { symbol: true } } }
  });

  const alreadyOrdered = new Set(todaysOrders.map((order) => `${order.ticker.symbol}:${order.side}`));
  const remainingToday = Math.max(0, settings.maxOrdersPerDay - todaysOrders.length);

  const proposals: OrderProposal[] = [];
  for (const position of positions) {
    if (remainingToday - proposals.length <= 0) {
      result.skipped.push(`Daily order cap (${settings.maxOrdersPerDay}) reached.`);
      break;
    }
    const proposal = buildProposal(position, thresholds, settings);
    if (!proposal) continue;
    if (alreadyOrdered.has(`${proposal.symbol}:${proposal.side}`)) {
      result.skipped.push(`${proposal.symbol}: ${proposal.side} order already exists today.`);
      continue;
    }
    proposals.push(proposal);
  }

  if (proposals.length === 0) return result;

  const tickerIds = await upsertTickers(proposals.map((proposal) => ({ symbol: proposal.symbol })));
  const initialStatus = settings.autoApprove ? "approved" : "proposed";

  const created = await prisma.$transaction(
    proposals.map((proposal) =>
      prisma.order.create({
        data: {
          tickerId: tickerIds.get(proposal.symbol)!,
          side: proposal.side,
          quantity: proposal.quantity,
          limitPrice: proposal.limitPrice,
          estimatedValue: proposal.estimatedValue,
          reason: proposal.reason,
          signalType: proposal.signalType,
          status: initialStatus,
          mode: settings.autoApprove ? "auto" : "confirm",
          decidedAt: settings.autoApprove ? new Date() : undefined
        },
        include: { ticker: { select: { symbol: true } } }
      })
    )
  );
  result.proposed = created.length;

  if (settings.liveExecution && env.AUTO_TRADE_LIVE && client) {
    result.executed = await executeApprovedOrders(client);
  }

  return result;
}

/** Place every approved order through the broker session; records placed/failed per order. */
export async function executeApprovedOrders(client: KTradeClient): Promise<number> {
  const approved = await prisma.order.findMany({
    where: { status: "approved" },
    include: { ticker: { select: { symbol: true } } },
    orderBy: { proposedAt: "asc" }
  });

  let executed = 0;
  for (const order of approved) {
    try {
      const outcome = await client.placeOrder({
        symbol: order.ticker.symbol,
        side: order.side as "buy" | "sell",
        quantity: Number(order.quantity),
        limitPrice: order.limitPrice ? Number(order.limitPrice) : undefined
      });

      if (outcome.placed) {
        executed += 1;
        await prisma.order.update({
          where: { id: order.id },
          data: { status: "placed", detail: outcome.detail, executedAt: new Date() }
        });
      } else {
        await prisma.order.update({
          where: { id: order.id },
          data: { detail: outcome.detail }
        });
      }
    } catch (error) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
          executedAt: new Date()
        }
      });
    }
  }
  return executed;
}

export async function decideOrder(orderId: string, action: "approve" | "reject"): Promise<void> {
  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: action === "approve" ? "approved" : "rejected",
      decidedAt: new Date()
    }
  });
}

function buildProposal(
  position: PortfolioPositionInput,
  thresholds: { positivePercent: number; negativePercent: number },
  settings: TradeSettingsView
): OrderProposal | null {
  if (!position.purchasePrice || !position.lastPrice || position.position <= 0) return null;

  const gainPercent = ((position.lastPrice - position.purchasePrice) / position.purchasePrice) * 100;
  const positive = Math.abs(thresholds.positivePercent);
  const negative = -Math.abs(thresholds.negativePercent);

  if (gainPercent >= positive) {
    let quantity = Math.floor((position.position * settings.sellPortionPercent) / 100);
    quantity = capQuantityByValue(quantity, position.lastPrice, settings.maxOrderValue);
    if (quantity < 1) return null;
    return {
      symbol: position.symbol,
      side: "sell",
      quantity,
      limitPrice: position.bidPrice > 0 ? position.bidPrice : position.lastPrice,
      estimatedValue: quantity * position.lastPrice,
      reason: `${position.symbol} is up ${gainPercent.toFixed(2)}% (threshold +${positive}%). Take profit.`,
      signalType: "auto_take_profit"
    };
  }

  if (gainPercent <= negative) {
    const budget = Math.min(settings.buyOrderValue, settings.maxOrderValue);
    const quantity = Math.floor(budget / position.lastPrice);
    if (quantity < 1) return null;
    return {
      symbol: position.symbol,
      side: "buy",
      quantity,
      limitPrice: position.askPrice > 0 ? position.askPrice : position.lastPrice,
      estimatedValue: quantity * position.lastPrice,
      reason: `${position.symbol} is down ${gainPercent.toFixed(2)}% (threshold ${negative}%). Average down.`,
      signalType: "auto_average_down"
    };
  }

  return null;
}

function capQuantityByValue(quantity: number, price: number, maxValue: number): number {
  if (price <= 0) return 0;
  if (quantity * price <= maxValue) return quantity;
  return Math.floor(maxValue / price);
}
