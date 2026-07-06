import { env, hasGeminiConfig } from "@/src/config/env";
import type { IndicatorSet, SignalInput } from "@/src/types/market";

/**
 * Advisory reasoning layer on top of the quant signal engine — never the sole
 * trade trigger. It only synthesizes numbers already computed elsewhere into a
 * confidence + rationale; it never invents news, fundamentals, or predictions
 * beyond what's in the prompt.
 */

export type AdvisorCandidate = {
  symbol: string;
  close: number;
  purchasePrice?: number;
  gainPercent?: number;
  indicators: IndicatorSet;
  signals: SignalInput[];
};

export type AdvisorRecommendation = {
  symbol: string;
  side: "buy" | "sell" | "hold" | "watch";
  confidence: number;
  rationale: string;
};

const SIDES = ["buy", "sell", "hold", "watch"] as const;

export async function generateRecommendations(
  candidates: AdvisorCandidate[],
  horizon: string
): Promise<AdvisorRecommendation[]> {
  if (candidates.length === 0 || !hasGeminiConfig) return [];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(candidates, horizon) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  symbol: { type: "string" },
                  side: { type: "string", enum: [...SIDES] },
                  confidence: { type: "integer" },
                  rationale: { type: "string" }
                },
                required: ["symbol", "side", "confidence", "rationale"]
              }
            }
          }
        }),
        signal: AbortSignal.timeout(30_000)
      }
    );

    if (!response.ok) {
      console.warn(`[ai-advisor] request failed: ${response.status} ${await safeText(response)}`);
      return [];
    }

    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") return [];

    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isValidRecommendation).map((item) => ({
      symbol: item.symbol,
      side: item.side,
      confidence: Math.max(0, Math.min(100, Math.round(item.confidence))),
      rationale: item.rationale.slice(0, 500)
    }));
  } catch (error) {
    console.warn("[ai-advisor] call failed (continuing without it):", error instanceof Error ? error.message : String(error));
    return [];
  }
}

function isValidRecommendation(item: unknown): item is AdvisorRecommendation {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate.symbol === "string" &&
    typeof candidate.side === "string" &&
    (SIDES as readonly string[]).includes(candidate.side) &&
    typeof candidate.confidence === "number" &&
    typeof candidate.rationale === "string"
  );
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function buildPrompt(candidates: AdvisorCandidate[], horizon: string): string {
  const lines = candidates.map((candidate) => {
    const signalSummary = candidate.signals.map((signal) => `${signal.type}(${signal.side})`).join(", ") || "none";
    const positionLine =
      candidate.purchasePrice && candidate.gainPercent !== undefined
        ? ` Held at avg buy ${candidate.purchasePrice}, currently ${candidate.gainPercent.toFixed(2)}% gain/loss.`
        : " Not currently held.";
    const indicatorSummary = [
      `close=${candidate.close}`,
      `sma20=${candidate.indicators.sma20 ?? "n/a"}`,
      `sma50=${candidate.indicators.sma50 ?? "n/a"}`,
      `rsi14=${candidate.indicators.rsi14 ?? "n/a"}`,
      `macd=${candidate.indicators.macd ?? "n/a"}/${candidate.indicators.macdSignal ?? "n/a"}`,
      `momentum10=${candidate.indicators.momentum10 ?? "n/a"}%`,
      `volumeRatio=${candidate.indicators.volumeRatio ?? "n/a"}`
    ].join(", ");
    return `- ${candidate.symbol}: ${indicatorSummary}. Triggered signals: ${signalSummary}.${positionLine}`;
  });

  return [
    `You are a cautious equity research assistant reviewing Pakistan Stock Exchange (PSX) positions for a ${horizon} trading horizon.`,
    "You are NOT placing any trades — you are producing an advisory opinion that a human will review before anything happens.",
    "For each symbol below, decide a side (buy/sell/hold/watch), a confidence 0-100, and a one-sentence rationale grounded ONLY in the numbers given — never invent news, fundamentals, or data you weren't given.",
    "Be conservative: if signals conflict or data is thin, prefer 'hold' or 'watch' with lower confidence rather than a strong buy/sell call.",
    "",
    ...lines,
    "",
    "Respond with a JSON array, one object per symbol, matching the requested schema exactly."
  ].join("\n");
}
