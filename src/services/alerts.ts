import { prisma } from "@/src/lib/prisma";
import { percentChange } from "@/src/lib/number";
import { sendTelegramAlert } from "@/src/services/telegram";
import type { Quote, SignalInput } from "@/src/types/market";

export async function evaluateAlerts(quotes: Quote[], signals: SignalInput[]): Promise<void> {
  await sendSignalAlerts(signals);
  await sendRuleAlerts(quotes);
}

async function sendSignalAlerts(signals: SignalInput[]): Promise<void> {
  const important = signals.filter((signal) => signal.score >= 70);
  for (const signal of important) {
    await sendTelegramAlert(`<b>${signal.side.toUpperCase()}</b> ${signal.message}`);
  }
}

async function sendRuleAlerts(quotes: Quote[]): Promise<void> {
  const rules = await prisma.alertRule.findMany({
    where: { enabled: true },
    include: { ticker: true }
  });

  for (const quote of quotes) {
    const matchingRules = rules.filter((rule) => !rule.ticker || rule.ticker.symbol === quote.symbol);
    for (const rule of matchingRules) {
      const value = resolveRuleValue(rule.type, quote);
      if (value === undefined || !compare(value, rule.operator, Number(rule.threshold))) continue;

      const message = `${rule.name}: ${quote.symbol} is ${value.toFixed(2)} (${rule.operator} ${rule.threshold})`;
      await sendTelegramAlert(message);
      await prisma.alertEvent.create({
        data: {
          alertRuleId: rule.id,
          symbol: quote.symbol,
          message,
          value
        }
      });
      await prisma.alertRule.update({ where: { id: rule.id }, data: { lastSentAt: new Date() } });
    }
  }
}

function resolveRuleValue(type: string, quote: Quote): number | undefined {
  if (type === "price") return quote.close;
  if (type === "day_change_percent") return percentChange(quote.close, quote.open);
  if (type === "volume") return quote.volume;
  return undefined;
}

function compare(value: number, operator: string, threshold: number): boolean {
  if (operator === ">") return value > threshold;
  if (operator === ">=") return value >= threshold;
  if (operator === "<") return value < threshold;
  if (operator === "<=") return value <= threshold;
  if (operator === "=" || operator === "==") return value === threshold;
  return false;
}
