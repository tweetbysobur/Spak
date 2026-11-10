import { err, type SpakError } from "../errors/codes";
import { fractionDigits, mulDecimal, normalizeDecimal } from "../lib/decimal";
import type { Constraints } from "../schemas/intent";
import type { Token } from "../tokenizer/tokenize";
import type { Lex } from "./lexicon";

const FILLER = new Set(["max", "maximum", "at", "most", "of", "with", "a", "slippage", "tolerance", "and", "up", "to", "limit"]);

/** Slippage limits and minimum-output guards. */
export function extractConstraints(tokens: Token[], lex: Map<number, Lex>, masked: Set<number>) {
  const consumed = new Set<number>();
  const issues: SpakError[] = [];
  const constraints: Constraints = { slippageBps: null, minOutput: null };
  const w = tokens.map((t) => t.lower);

  const s = w.findIndex((x, i) => x === "slippage" && !masked.has(i));
  if (s >= 0) {
    let pct = -1;
    for (let d = 1; d <= 4 && pct < 0; d++) {
      for (const j of [s + d, s - d]) if (tokens[j]?.kind === "percent" && !masked.has(j)) { pct = j; break; }
    }
    if (pct < 0) issues.push(err("INVALID_CONSTRAINT", "Give slippage as a percentage, for example: max 0.5% slippage.", "constraints.slippageBps"));
    else {
      const v = normalizeDecimal(tokens[pct].value!);
      if (fractionDigits(v) > 2) issues.push(err("INVALID_CONSTRAINT", "Slippage supports at most two decimals (0.01%).", "constraints.slippageBps"));
      else {
        const bps = Number(mulDecimal(v, "100"));
        if (bps <= 0 || bps > 5000) issues.push(err("INVALID_CONSTRAINT", "Slippage must be above 0% and at most 50%.", "constraints.slippageBps"));
        else constraints.slippageBps = bps;
      }
      const lo = Math.min(s, pct), hi = Math.max(s, pct);
      for (let j = lo; j <= hi; j++) consumed.add(j);
      for (let j = lo - 1; j >= 0 && FILLER.has(w[j]); j--) consumed.add(j);
      for (let j = hi + 1; j < w.length && FILLER.has(w[j]) && w[j] !== "to"; j++) consumed.add(j);
    }
  }

  // "receive at least 0.5 SOL", "minimum 0.5 SOL", "min out 0.5 SOL"
  for (let i = 0; i < w.length; i++) {
    if (masked.has(i)) continue;
    const atLeast = w[i] === "at" && w[i + 1] === "least";
    const minimum = w[i] === "minimum" || w[i] === "min";
    if (!atLeast && !minimum) continue;
    let j = i + (atLeast ? 2 : 1);
    if (w[j] === "of" || w[j] === "out") j++;
    const num = tokens[j];
    const asset = lex.get(j + 1)?.asset;
    if (num?.kind === "number" && asset) {
      constraints.minOutput = { value: normalizeDecimal(num.value!), symbol: asset.symbol };
      for (let k = i; k <= j + 1; k++) consumed.add(k);
      if (["receive", "get"].includes(w[i - 1])) consumed.add(i - 1);
      if (w[i - 2] === "and") consumed.add(i - 2);
    }
  }
  return { constraints, consumed, issues };
}
