/**
 * Defensive shaping helpers for Google Health payloads. The API returns
 * union-typed data points; these keep extraction tolerant (numbers sometimes
 * arrive as strings, e.g. steps counts) without ever inventing values.
 */

export type Rec = Record<string, unknown>;

export function asRec(value: unknown): Rec {
  return value && typeof value === "object" ? (value as Rec) : {};
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** First present numeric among candidate keys on an object. */
export function pickNum(obj: unknown, keys: string[]): number | undefined {
  const record = asRec(obj);
  for (const key of keys) {
    const value = num(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function bound<T>(items: T[], max: number): { items: T[]; truncated?: string } {
  if (items.length <= max) return { items };
  return {
    items: items.slice(0, max),
    truncated: `${items.length - max} additional item(s) omitted for payload size`,
  };
}
