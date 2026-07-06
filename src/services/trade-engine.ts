import { prisma } from "@/src/lib/prisma";
import { env } from "@/src/config/env";
import { normalizeTradingDate, saveRecommendations, upsertTickers } from "@/src/services/market-repository";
import { getMySignalPreference } from "@/src/services/my-signal-preferences";
import { getTradeSettings, type TradeSettingsView } from "@/src/services/trade-settings";
import { generateRecommendations, type AdvisorCandidate, type AdvisorRecommendation } from "@/src/services/ai-advisor";
import type { KTradeClient } from "@/src/services/ktrade/client";
import type { PortfolioPositionInput } from "@/src/types/market";

/**
 * Turns the +/- percentage thresholds into broker orders with hard guardrails:
 * per-order value cap, per-day order cap, one order per symbol+side per day,
 * and live execution only when BOTH the dashboard toggle and the AUTO_TRADE_LIVE
 * environment switch are on. Everything is recorded on the Order table.
 *
 * The AI advisor (if enabled) is consulted for a second opinion on each
 * proposal but never originates trades by itself — it can only attach
 * rationale/confidence, or force a proposal back into manual "confirm" mode
 * when it disagrees with the quant trigger, even if auto-approve is on.
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
  client?: KTradeClient,
  candidates: AdvisorCandidate[] = []
): Promise<TradeEngineResult> {
  const result: TradeEngineResult = { proposed: 0, executed: 0, skipped: [] };

  const settings = await getTradeSettings();

  const recommendationsBySymbol = await runAdvisor(candidates, settings);

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

  const created = await prisma.$transaction(
    proposals.map((proposal) => {
      const recommendation = recommendationsBySymbol.get(proposal.symbol);
      const disagrees = recommendationDisagrees(proposal.side, recommendation);
      const autoApprove = settings.autoApprove && !disagrees;
      const reason = recommendation
        ? `${proposal.reason} AI take: ${recommendation.rationale}`
        : proposal.reason;

      return prisma.order.create({
        data: {
          tickerId: tickerIds.get(proposal.symbol)!,
          side: proposal.side,
          quantity: proposal.quantity,
          limitPrice: proposal.limitPrice,
          estimatedValue: proposal.estimatedValue,
          reason,
          signalType: proposal.signalType,
          status: autoApprove ? "approved" : "proposed",
          mode: autoApprove ? "auto" : "confirm",
          decidedAt: autoApprove ? new Date() : undefined,
          recommendationId: recommendation?.id,
          detail: disagrees
            ? `Held for manual review — AI advisor suggested ${recommendation!.side} (${recommendation!.confidence}% confidence), which disagrees with this ${proposal.side} trigger.`
            : undefined
        },
        include: { ticker: { select: { symbol: true } } }
      });
    })
  );
  result.proposed = created.length;

  if (settings.liveExecution && env.AUTO_TRADE_LIVE && client) {
    result.executed = await executeApprovedOrders(client);
  }

  return result;
}

/** Runs the AI advisor over all candidates (portfolio + watched symbols) and persists the opinions, regardless of whether any order proposal ends up needing them — this also feeds the dashboard's broader "opportunities" view. */
async function runAdvisor(
  candidates: AdvisorCandidate[],
  settings: TradeSettingsView
): Promise<Map<string, AdvisorRecommendation & { id: string }>> {
  const result = new Map<string, AdvisorRecommendation & { id: string }>();
  if (!settings.aiAdvisorEnabled || candidates.length === 0) return result;

  const recommendations = await generateRecommendations(candidates, settings.horizon);
  if (recommendations.length === 0) return result;

  const idsBySymbol = await saveRecommendations(
    recommendations.map((rec) => ({
      symbol: rec.symbol,
      side: rec.side,
      confidence: rec.confidence,
      horizon: settings.horizon,
      rationale: rec.rationale
    }))
  );

  for (const rec of recommendations) {
    const id = idsBySymbol.get(rec.symbol);
    if (id) result.set(rec.symbol, { ...rec, id });
  }
  return result;
}

/** True when the AI's opinion meaningfully contradicts the quant-triggered side, at a confidence worth pausing for. */
function recommendationDisagrees(proposedSide: "buy" | "sell", recommendation?: AdvisorRecommendation & { id: string }): boolean {
  if (!recommendation || recommendation.confidence < 50) return false;
  if (proposedSide === "buy" && recommendation.side === "sell") return true;
  if (proposedSide === "sell" && recommendation.side === "buy") return true;
  return false;
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

export type ManualOrderInput = {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  limitPrice?: number;
};

/**
 * User-initiated order on any symbol — not gated by "enabled"/"auto-trade" or
 * tied to an existing threshold trigger, but still subject to the same hard
 * caps (max order value, max orders/day, one order per symbol+side per day).
 * Always created as "proposed" — a manual order still needs your explicit
 * approve click, regardless of the auto-approve setting.
 */
export async function proposeManualOrder(input: ManualOrderInput): Promise<{ orderId: string } | { error: string }> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) return { error: "Symbol is required." };
  if (!Number.isFinite(input.quantity) || input.quantity < 1) return { error: "Quantity must be at least 1." };

  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) return { error: `${symbol} isn't in the tracked symbol directory yet.` };

  const latestPrice = await prisma.priceBar.findFirst({
    where: { tickerId: ticker.id, interval: "1d" },
    orderBy: { date: "desc" }
  });
  const price = input.limitPrice ?? (latestPrice ? Number(latestPrice.close) : undefined);
  if (!price || price <= 0) return { error: `No known price for ${symbol} — set a limit price.` };

  const settings = await getTradeSettings();
  const estimatedValue = input.quantity * price;
  if (estimatedValue > settings.maxOrderValue) {
    return { error: `Order value (${estimatedValue.toFixed(0)}) exceeds the max order value cap (${settings.maxOrderValue}).` };
  }

  const today = normalizeTradingDate(new Date());
  const todaysOrders = await prisma.order.count({ where: { proposedAt: { gte: today } } });
  if (todaysOrders >= settings.maxOrdersPerDay) {
    return { error: `Daily order cap (${settings.maxOrdersPerDay}) already reached.` };
  }

  const duplicate = await prisma.order.findFirst({
    where: { tickerId: ticker.id, side: input.side, proposedAt: { gte: today } }
  });
  if (duplicate) return { error: `A ${input.side} order for ${symbol} already exists today.` };

  const order = await prisma.order.create({
    data: {
      tickerId: ticker.id,
      side: input.side,
      quantity: input.quantity,
      limitPrice: price,
      estimatedValue,
      reason: "Manual order placed from the dashboard.",
      status: "proposed",
      mode: "manual"
    }
  });

  return { orderId: order.id };
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

/**
 * Cancels an order that was already approved but hasn't been placed yet.
 * Only valid from "approved" — a "proposed" order should use reject instead,
 * and a "placed"/"failed" order already ran (or attempted to) and can't be undone here.
 * Small race window against a concurrent executeApprovedOrders() run is accepted
 * as low-risk for a single-user tool rather than adding row-level locking.
 */
export async function cancelOrder(orderId: string): Promise<{ ok: true } | { error: string }> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { error: "Order not found." };
  if (order.status !== "approved") return { error: `Only approved orders can be cancelled (this one is ${order.status}).` };

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "cancelled", decidedAt: new Date() }
  });
  return { ok: true };
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
