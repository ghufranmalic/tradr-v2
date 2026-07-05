export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const normalized = value.replace(/,/g, "").replace(/[^\d.-]/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function percentChange(current: number, previous: number): number {
  if (!previous) return 0;
  return ((current - previous) / previous) * 100;
}
