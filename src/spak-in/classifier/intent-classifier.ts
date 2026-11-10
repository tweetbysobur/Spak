import type { Frame } from "../parser/frame";
import type { IntentRegistry } from "../registries/intent-registry";
import { deriveTxType } from "./transaction-type";
import { txShape } from "./builtins";

export interface Classification {
  intentType: string;
  /** Wrapped transaction for SCHEDULED and CONDITIONAL intents. */
  innerType: string | null;
  confidence: number;
  candidates: { type: string; score: number }[];
}

/** Intent Classifier: highest-scoring registered intent wins; ties break on registry priority. */
export function classify(frame: Frame, registry: IntentRegistry): Classification {
  const scored = registry.list()
    .map((d) => ({ type: d.type, score: d.match(frame), priority: d.priority }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.priority - b.priority);
  const top = scored[0];
  if (!top) return { intentType: "UNKNOWN", innerType: null, confidence: 0, candidates: [] };
  const wrapper = registry.get(top.type)?.category === "WRAPPER";
  const inner = wrapper ? deriveTxType(txShape(frame)) : null;
  return {
    intentType: top.type,
    innerType: inner,
    confidence: top.score / 100,
    candidates: scored.map(({ type, score }) => ({ type, score })),
  };
}
