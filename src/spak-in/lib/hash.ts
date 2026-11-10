import { createHash, randomUUID } from "node:crypto";

/** Stable JSON: keys sorted, so equal objects always hash the same. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function hashObject(v: unknown): string {
  return sha256(stableStringify(v));
}

export type IdFactory = (prefix: "spak_int" | "spak_plan" | "spak_sub" | "spak_ses") => string;

export const randomIds: IdFactory = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

/** Deterministic ids for tests and replay. */
export function sequentialIds(): IdFactory {
  const counters: Record<string, number> = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}_${String(counters[prefix]).padStart(3, "0")}`;
  };
}
