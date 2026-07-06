import { env } from "@/src/config/env";
import type { IndicatorSet, SignalInput } from "@/src/types/market";

/**
 * Advisory reasoning layer on top of the quant signal engine — never the sole
 * trade trigger. It only synthesizes numbers already computed elsewhere into a
 * confidence + rationale; it never invents news, fundamentals, or predictions
 * beyond what's in the prompt.
 *
 * Three interchangeable providers, tried in this order:
 *   1. Groq (if GROQ_API_KEY set) — free tier, fast, no billing card required
 *   2. Gemini (if GEMINI_API_KEY set) — free tier, requires a linked billing
 *      account on Google's side before quota activates
 *   3. Ollama (local, default) — runs on this machine, no key needed at all
 * If a configured provider's call fails (quota, network, etc.) this logs a
 * warning and returns nothing rather than throwing — the trade engine and
 * dashboard both treat "no recommendation" as a no-op, never an error.
 *
 * One call per candidate rather than one batched call for all of them: a 7B
 * local model (the default, free, no-signup path) was observed silently
 * dropping items from multi-symbol batches — a single-symbol prompt is far
 * more reliable, and the extra calls cost nothing extra for a local model.
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
  const results: AdvisorRecommendation[] = [];
  for (const candidate of candidates) {
    const recommendation = await generateOne(candidate, horizon);
    if (recommendation) results.push(recommendation);
  }
  return results;
}

async function generateOne(candidate: AdvisorCandidate, horizon: string): Promise<AdvisorRecommendation | null> {
  const prompt = buildPrompt(candidate, horizon);

  if (env.GROQ_API_KEY) {
    const result = await callGroq(prompt, candidate.symbol);
    if (result) return result;
  }
  if (env.GEMINI_API_KEY) {
    const result = await callGemini(prompt, candidate.symbol);
    if (result) return result;
  }
  return callOllama(prompt, candidate.symbol);
}

async function callGroq(prompt: string, symbol: string): Promise<AdvisorRecommendation | null> {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: env.GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      console.warn(`[ai-advisor:groq] request failed: ${response.status} ${await safeText(response)}`);
      return null;
    }

    const payload = await response.json();
    return parseRecommendation(payload?.choices?.[0]?.message?.content, symbol, "groq");
  } catch (error) {
    console.warn("[ai-advisor:groq] call failed (continuing without it):", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function callGemini(prompt: string, symbol: string): Promise<AdvisorRecommendation | null> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                side: { type: "string", enum: [...SIDES] },
                confidence: { type: "integer" },
                rationale: { type: "string" }
              },
              required: ["side", "confidence", "rationale"]
            }
          }
        }),
        signal: AbortSignal.timeout(30_000)
      }
    );

    if (!response.ok) {
      console.warn(`[ai-advisor:gemini] request failed: ${response.status} ${await safeText(response)}`);
      return null;
    }

    const payload = await response.json();
    return parseRecommendation(payload?.candidates?.[0]?.content?.parts?.[0]?.text, symbol, "gemini");
  } catch (error) {
    console.warn("[ai-advisor:gemini] call failed (continuing without it):", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function callOllama(prompt: string, symbol: string): Promise<AdvisorRecommendation | null> {
  try {
    const response = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        messages: [{ role: "user", content: prompt }],
        format: "json",
        stream: false,
        // Keeps the model resident in memory between calls (default unload is 5 min) —
        // a cold start (model load from disk) alone can otherwise exceed a normal timeout.
        keep_alive: "30m",
        options: { temperature: 0.2 }
      }),
      signal: AbortSignal.timeout(120_000)
    });

    if (!response.ok) {
      console.warn(`[ai-advisor:ollama] request failed: ${response.status} ${await safeText(response)}`);
      return null;
    }

    const payload = await response.json();
    return parseRecommendation(payload?.message?.content, symbol, "ollama");
  } catch (error) {
    console.warn(
      "[ai-advisor:ollama] call failed — is `ollama serve` running? (continuing without it):",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

/** The symbol always comes from the caller, never the model — small models were observed
 * garbling or substituting it (e.g. "PSX_position" instead of the actual ticker). */
function parseRecommendation(text: unknown, symbol: string, provider: string): AdvisorRecommendation | null {
  if (typeof text !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isValidRecommendation(parsed)) return null;
    return {
      symbol,
      side: parsed.side,
      confidence: normalizeConfidence(parsed.confidence),
      rationale: parsed.rationale.slice(0, 500)
    };
  } catch (error) {
    console.warn(`[ai-advisor:${provider}] response wasn't valid JSON:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Local models are inconsistent about scale — sometimes a 0-1 fraction instead of 0-100. */
function normalizeConfidence(value: number): number {
  const scaled = value > 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

function isValidRecommendation(item: unknown): item is { side: AdvisorRecommendation["side"]; confidence: number; rationale: string } {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Record<string, unknown>;
  return (
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

function buildPrompt(candidate: AdvisorCandidate, horizon: string): string {
  const signalSummary = candidate.signals.map((signal) => `${signal.type}(${signal.side})`).join(", ") || "none";
  const positionLine =
    candidate.purchasePrice && candidate.gainPercent !== undefined
      ? `Held at avg buy ${candidate.purchasePrice}, currently ${candidate.gainPercent.toFixed(2)}% gain/loss.`
      : "Not currently held.";
  const indicatorSummary = [
    `close=${candidate.close}`,
    `sma20=${candidate.indicators.sma20 ?? "n/a"}`,
    `sma50=${candidate.indicators.sma50 ?? "n/a"}`,
    `rsi14=${candidate.indicators.rsi14 ?? "n/a"}`,
    `macd=${candidate.indicators.macd ?? "n/a"}/${candidate.indicators.macdSignal ?? "n/a"}`,
    `momentum10=${candidate.indicators.momentum10 ?? "n/a"}%`,
    `volumeRatio=${candidate.indicators.volumeRatio ?? "n/a"}`
  ].join(", ");

  return [
    `You are a cautious equity research assistant reviewing a Pakistan Stock Exchange (PSX) position for a ${horizon} trading horizon.`,
    "You are NOT placing any trade — you are producing an advisory opinion that a human will review before anything happens.",
    "Decide a side (buy/sell/hold/watch), a confidence, and a one-sentence rationale grounded ONLY in the numbers given below — never invent news, fundamentals, or data you weren't given.",
    "Be conservative: if signals conflict or data is thin, prefer 'hold' or 'watch' with lower confidence rather than a strong buy/sell call.",
    "",
    `${candidate.symbol}: ${indicatorSummary}. Triggered signals: ${signalSummary}. ${positionLine}`,
    "",
    'Respond with ONLY a JSON object of the exact shape {"side": "buy"|"sell"|"hold"|"watch", "confidence": integer, "rationale": string} — no other text. "confidence" MUST be an integer from 0 to 100 (e.g. 72), never a 0-1 decimal fraction (e.g. never 0.72).'
  ].join("\n");
}
