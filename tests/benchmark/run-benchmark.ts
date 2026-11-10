import { SpakIn, type IntentResult } from "../../src/spak-in";
import { SYMBOL_EQUIVALENTS } from "../../src/spak-in/registries/assets";
import { BENCH_WALLETS, DATASET, type BenchCase } from "./dataset";

export const BENCH_NOW = "2026-11-10T10:00:00.000Z";

export interface CaseResult {
  case: BenchCase;
  result: IntentResult;
  typeOk: boolean;
  statusOk: boolean;
  fields: { field: string; expected: string; actual: string; ok: boolean }[];
  missOk: boolean;
  codeOk: boolean;
  /** Expected anything but VALIDATED, got VALIDATED. The dangerous failure. */
  unsafeValidation: boolean;
  ms: number;
}

const amountText = (r: IntentResult) => {
  const a = r.source.amount;
  if (!a) return "";
  return a.kind === "EXACT" ? a.value : a.kind === "PERCENT_OF_BALANCE" ? `${a.percent}%` : `$${a.value}`;
};

function actual(field: string, r: IntentResult): string {
  switch (field) {
    case "amt": return amountText(r);
    case "sa": return r.source.asset?.symbol.toUpperCase() ?? "";
    case "sn": return r.source.network ?? "";
    case "da": return r.destination.asset?.symbol.toUpperCase() ?? "";
    case "dn": return r.destination.network ?? "";
    case "r": return r.recipient ? (r.recipient.kind === "SELF" ? "SELF" : r.recipient.address) : "";
    default: return "";
  }
}

export async function runBenchmark(dataset: readonly BenchCase[] = DATASET) {
  const engine = new SpakIn({ clock: () => new Date(BENCH_NOW) });
  // Warm up the JIT so the first case does not distort latency.
  for (let i = 0; i < 20; i++) await engine.interpret({ text: "swap 1 eth on base to usdc on base", wallets: BENCH_WALLETS });

  const out: CaseResult[] = [];
  for (const c of dataset) {
    const req = { text: c.text, wallets: BENCH_WALLETS, now: BENCH_NOW, sessionId: `bench-${c.id}`, ...(c.ctx ?? {}) };
    const t0 = performance.now();
    const r = await engine.interpret(req as Parameters<SpakIn["interpret"]>[0]);
    const ms = performance.now() - t0;
    const e = c.expect;
    const fields = (["amt", "sa", "sn", "da", "dn", "r"] as const)
      .filter((f) => e[f] !== undefined)
      .map((f) => {
        const a = actual(f, r), x = String(e[f]);
        const ok = a === x || ((f === "sa" || f === "da") && SYMBOL_EQUIVALENTS[x.toUpperCase()] === a);
        return { field: f, expected: x, actual: a, ok };
      });
    out.push({
      case: c, result: r, ms,
      typeOk: r.intentType === e.type && (!e.inner || r.innerIntentType === e.inner),
      statusOk: r.status === e.status,
      fields,
      missOk: (e.miss ?? []).every((m) => r.missingFields.includes(m)),
      codeOk: !e.code || r.errors.some((x) => x.code === e.code) || !!r.policy?.violations.some((x) => x.code === e.code),
      unsafeValidation: e.status !== "VALIDATED" && r.status === "VALIDATED",
    });
  }
  return summarize(out);
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 100);
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const round = (n: number) => Math.round(n * 1000) / 1000;

export function summarize(rs: CaseResult[]) {
  const allFields = rs.flatMap((r) => r.fields);
  const clarifyExpected = rs.filter((r) => r.case.expect.status === "NEEDS_CLARIFICATION");
  const notValid = rs.filter((r) => r.case.expect.status !== "VALIDATED");
  const ms = rs.map((r) => r.ms);
  return {
    cases: rs.length,
    classificationAccuracy: pct(rs.filter((r) => r.typeOk).length, rs.length),
    entityExtractionAccuracy: pct(allFields.filter((f) => f.ok).length, allFields.length),
    entityFieldsChecked: allFields.length,
    validationAccuracy: pct(rs.filter((r) => r.statusOk).length, rs.length),
    missingFieldRecall: pct(rs.filter((r) => r.missOk).length, rs.length),
    errorCodeAccuracy: pct(rs.filter((r) => r.codeOk).length, rs.length),
    ambiguityDetection: pct(clarifyExpected.filter((r) => r.result.status === "NEEDS_CLARIFICATION").length, clarifyExpected.length),
    ambiguityCases: clarifyExpected.length,
    unsafeValidations: notValid.filter((r) => r.unsafeValidation).length,
    nonValidCases: notValid.length,
    latencyMs: { p50: round(quantile(ms, 0.5)), p95: round(quantile(ms, 0.95)), max: round(Math.max(...ms)) },
    failures: rs.filter((r) => !r.typeOk || !r.statusOk || r.fields.some((f) => !f.ok) || !r.missOk || !r.codeOk).map((r) => ({
      id: r.case.id, text: r.case.text.slice(0, 90),
      type: r.typeOk ? undefined : `${r.result.intentType}${r.result.innerIntentType ? "/" + r.result.innerIntentType : ""} (want ${r.case.expect.type}${r.case.expect.inner ? "/" + r.case.expect.inner : ""})`,
      status: r.statusOk ? undefined : `${r.result.status} (want ${r.case.expect.status})`,
      fields: r.fields.filter((f) => !f.ok).map((f) => `${f.field}=${f.actual || "∅"} (want ${f.expected})`),
      missing: r.missOk ? undefined : `${r.result.missingFields.join(",")} (want ${r.case.expect.miss?.join(",")})`,
      code: r.codeOk ? undefined : `${r.result.errors.map((e) => e.code).join(",") || "none"} (want ${r.case.expect.code})`,
    })),
  };
}
