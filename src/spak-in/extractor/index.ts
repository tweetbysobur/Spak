import type { SpakError } from "../errors/codes";
import type { Condition, Constraints, Schedule } from "../schemas/intent";
import type { Token } from "../tokenizer/tokenize";
import { extractCondition, TX_VERBS } from "./condition";
import { extractConstraints } from "./constraints";
import { lexicon, type Lex } from "./lexicon";
import { extractSchedule } from "./schedule";

export interface Entities {
  lex: Map<number, Lex>;
  schedule: Schedule | null;
  scheduleMissing: string[];
  condition: Condition | null;
  constraints: Constraints;
  /** Token positions already explained by schedule, condition or constraint clauses. */
  consumed: Set<number>;
  issues: SpakError[];
  assumptions: string[];
}

const NOTIFY = new Set(["notify", "alert", "remind", "ping", "tell", "warn"]);

/** Entity Extractor: lexical entities plus clause-level entities (time, triggers, limits). */
export function extractEntities(tokens: Token[], opts: { now: Date; timezone?: string }): Entities {
  const lex = lexicon(tokens);
  const w = tokens.map((t) => t.lower);
  const hasNotify = w.some((x) => NOTIFY.has(x)) || (w.includes("let") && w.includes("know"));
  const hasTx = w.some((x) => TX_VERBS.has(x));

  const cond = extractCondition(tokens, lex, hasNotify && !hasTx);
  const cons = extractConstraints(tokens, lex, cond.consumed);
  const masked = new Set([...cond.consumed, ...cons.consumed]);
  const maskedTokens = tokens.map((t, i) => (masked.has(i) ? { ...t, lower: "\u0000", raw: "", kind: "word" as const } : t));
  const sched = extractSchedule(maskedTokens, opts);

  return {
    lex,
    schedule: sched.schedule,
    scheduleMissing: sched.missing,
    condition: cond.condition,
    constraints: cons.constraints,
    consumed: new Set([...masked, ...sched.consumed]),
    issues: [...cond.issues, ...cons.issues, ...sched.issues],
    assumptions: cond.assumptions,
  };
}

export type { Lex } from "./lexicon";
