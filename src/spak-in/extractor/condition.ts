import { err, type SpakError } from "../errors/codes";
import { normalizeDecimal } from "../lib/decimal";
import type { Condition } from "../schemas/intent";
import type { Token } from "../tokenizer/tokenize";
import type { Lex } from "./lexicon";

export interface ConditionExtraction {
  condition: Condition | null;
  consumed: Set<number>;
  issues: SpakError[];
  assumptions: string[];
}

const MARKERS = new Set(["when", "whenever", "if", "once"]);
const UP = new Set(["above", "over", "exceeds", "exceed", "rises", "climbs", "pumps", "greater", "higher", "more", ">", ">="]);
const DOWN = new Set(["below", "under", "drops", "falls", "dips", "dumps", "less", "lower", "<", "<="]);
const CROSS = new Set(["reaches", "reach", "hits", "hit", "touches", "equals"]);
const FEE_WORDS = new Set(["gas", "fee", "fees"]);
export const TX_VERBS = new Set(["swap", "convert", "exchange", "trade", "buy", "sell", "bridge", "move", "send", "pay", "transfer"]);

function findMarker(w: string[]): number {
  for (let i = 0; i < w.length; i++) {
    if (MARKERS.has(w[i])) return i;
    if (w[i] === "as" && w[i + 1] === "soon" && w[i + 2] === "as") return i;
  }
  return -1;
}

/** Find a trigger clause ("when ETH hits 4000") and turn it into a structured condition. */
export function extractCondition(tokens: Token[], lex: Map<number, Lex>, notifyOnly: boolean): ConditionExtraction {
  const w = tokens.map((t) => t.lower);
  const consumed = new Set<number>();
  const issues: SpakError[] = [];
  const assumptions: string[] = [];
  const m = findMarker(w);
  if (m < 0) return { condition: null, consumed, issues, assumptions };

  const start = m;
  let end = w.length;
  for (let i = m + 1; i < w.length; i++) {
    if (w[i] === ",") { end = i; break; }
    if (TX_VERBS.has(w[i]) && i > m + 1) { end = i; break; }
  }
  for (let i = start; i < end; i++) consumed.add(i);
  if (w[end] === ",") consumed.add(end);
  if (w[m] === "as") { consumed.add(m + 1); consumed.add(m + 2); }
  const clause = tokens.slice(start, end);
  const cw = clause.map((t) => t.lower);
  const raw = clause.map((t) => t.raw).join(" ");
  const onTrigger = notifyOnly ? "NOTIFY" : "EXECUTE";

  if (cw.includes("route")) return { condition: { kind: "ROUTE_AVAILABLE", onTrigger, raw }, consumed, issues, assumptions };

  let comparator: "GTE" | "LTE" | "CROSSES" | null = null;
  for (const x of cw) {
    if (UP.has(x)) { comparator = "GTE"; break; }
    if (DOWN.has(x)) { comparator = "LTE"; break; }
    if (CROSS.has(x)) { comparator = "CROSSES"; break; }
  }
  const valTok = clause.find((t) => t.kind === "number" || t.kind === "money");
  const value = valTok?.value ? normalizeDecimal(valTok.value) : null;

  if (cw.some((x) => FEE_WORDS.has(x))) {
    let network: string | null = null;
    for (let i = start; i < end; i++) {
      const l = lex.get(i);
      if (l?.network && (w[i - 1] === "on" || l.network.strong)) network = l.network.id;
    }
    let unit: "GWEI" | "USD" | null = cw.includes("gwei") ? "GWEI" : valTok?.kind === "money" || cw.some((x) => x === "usd" || x === "dollars" || x === "cents") ? "USD" : null;
    if (!unit && cw.includes("gas")) { unit = "GWEI"; assumptions.push("Gas threshold read as gwei."); }
    if (!value || !comparator || !unit) {
      issues.push(err("INVALID_CONDITION", "Say the fee threshold with a unit, for example: when gas on Ethereum is below 10 gwei.", "condition"));
      return { condition: null, consumed, issues, assumptions };
    }
    return { condition: { kind: "NETWORK_FEE", network, comparator: comparator === "CROSSES" ? "LTE" : comparator, value, unit, onTrigger, raw }, consumed, issues, assumptions };
  }

  let symbol: string | null = null;
  for (let i = start; i < end; i++) { const l = lex.get(i); if (l?.asset) { symbol = l.asset.symbol; break; } }
  if (!symbol) symbol = clause.find((t) => t.kind === "word" && /^[A-Z][A-Z0-9]{1,9}$/.test(t.raw) && !MARKERS.has(t.lower))?.raw ?? null;
  if (!symbol || !value || !comparator) {
    const missing = [!symbol && "which asset", !comparator && "above or below", !value && "what price"].filter(Boolean).join(", ");
    issues.push(err("INVALID_CONDITION", `The trigger is incomplete (${missing}). Example: when ETH is above $4000.`, "condition"));
    return { condition: null, consumed, issues, assumptions };
  }
  if (valTok?.kind !== "money") assumptions.push(`Price trigger read as ${value} USD.`);
  return { condition: { kind: "PRICE", symbol, comparator, value, currency: "USD", onTrigger, raw }, consumed, issues, assumptions };
}
