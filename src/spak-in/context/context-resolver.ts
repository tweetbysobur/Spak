import { err, type SpakError } from "../errors/codes";
import type { Frame } from "../parser/frame";
import type { Schedule } from "../schemas/intent";
import type { Classification } from "../classifier/intent-classifier";
import type { Draft, SessionState } from "./draft";

export const CONTEXT_TTL_MS = 15 * 60_000;
const TX = new Set(["SWAP", "BRIDGE", "SEND", "TRANSFER", "PAY"]);
const STANDALONE = new Set(["CANCEL", "STATUS", "HISTORY", "REBALANCE", "SCHEDULE", "NOTIFY"]);

export type ContextApplied = "NONE" | "AMENDMENT" | "CLARIFICATION_ANSWER";

export interface ResolvedContext {
  draft: Draft;
  applied: ContextApplied;
  /** True when the draft continues the session's current intent. */
  continues: boolean;
  issues: SpakError[];
}

export function draftFromFrame(frame: Frame, cls: Classification): Draft {
  return {
    intentType: cls.intentType,
    innerType: cls.innerType,
    verb: frame.verbs.find((v) => TX.has(v.cls))?.cls ?? null,
    amount: frame.amount,
    sourceSymbol: frame.sourceSymbol,
    sourceNetwork: frame.sourceNetwork,
    destSymbol: frame.destSymbol,
    destNetwork: frame.destNetwork,
    recipient: frame.recipient,
    refundAddress: frame.refundAddress,
    schedule: frame.schedule,
    condition: frame.condition,
    constraints: frame.constraints,
    target: frame.target,
    query: frame.query,
    allocations: frame.allocations,
    unknownSymbols: frame.unknownSymbols,
    parseIssues: frame.issues,
    assumptions: frame.assumptions,
  };
}

function hasContent(f: Frame): boolean {
  return !!(f.amount || f.sourceSymbol || f.destSymbol || f.sourceNetwork || f.destNetwork || f.looseNetworks.length
    || f.looseSymbols.length || f.recipient || f.refundAddress || f.schedule || f.condition
    || f.constraints.slippageBps || f.constraints.minOutput || f.issues.length);
}

/** A follow-up has no action of its own and only carries values to apply to the previous intent. */
export function isFollowUp(f: Frame): boolean {
  if (f.verbs.some((v) => TX.has(v.cls) || STANDALONE.has(v.cls))) return false;
  if (f.keywords.has("portfolio") || f.keywords.has("history")) return false;
  if (f.keywords.has("balance") && !f.amount) return false;
  return hasContent(f);
}

function mergeSchedule(base: Schedule | null, next: Schedule): Schedule {
  if (!base) return next;
  const onlyTime = next.time && !next.frequency && next.daysOfWeek.length === 0 && next.dayOfMonth === null && !next.startAt;
  if (onlyTime) return { ...base, time: next.time, raw: `${base.raw} ${next.raw}` };
  return { ...next, timezone: next.timezone ?? base.timezone };
}

/**
 * Context Resolver: apply a follow-up ("make it 100 instead", "on Arbitrum") to the previous intent.
 * Bare values fill missing fields. When a value could fill two fields, it asks instead of guessing.
 */
export function resolveContext(frame: Frame, cls: Classification, session: SessionState | null, now: Date): ResolvedContext {
  const wrapperOnly = (cls.intentType === "CONDITIONAL_TRANSACTION" || cls.intentType === "SCHEDULED_TRANSACTION") && !frame.verbs.some((v) => TX.has(v.cls)) && !!session;
  if (!isFollowUp(frame) || (cls.intentType !== "UNKNOWN" && !wrapperOnly)) return { draft: draftFromFrame(frame, cls), applied: "NONE", continues: false, issues: [] };

  const fresh = session && now.getTime() - Date.parse(session.updatedAt) <= CONTEXT_TTL_MS;
  const usable = fresh && !session.submitted && (session.draft.verb || session.draft.schedule || session.draft.condition);
  if (!usable) {
    const d = draftFromFrame(frame, { ...cls, intentType: "UNKNOWN", innerType: null });
    const issue = session && !fresh
      ? err("CONTEXT_EXPIRED", "That earlier request has expired. Send the full instruction again.")
      : session?.submitted
        ? err("NOTHING_TO_AMEND", "The previous transaction was already submitted. Start a new instruction.")
        : err("UNKNOWN_INTENT", "What should SPak do with that? Try: Swap 50 USDC on Base to SOL on Solana.");
    return { draft: d, applied: "NONE", continues: false, issues: [issue] };
  }

  const amend = frame.keywords.has("amend") || frame.verbs.some((v) => v.cls === "AMEND");
  const d: Draft = structuredClone(session.draft);
  const issues: SpakError[] = [];
  const touched = new Set<string>();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { d[k] = v; touched.add(k as string); };

  if (frame.amount) set("amount", frame.amount);
  if (frame.recipient) set("recipient", frame.recipient);
  if (frame.refundAddress) set("refundAddress", frame.refundAddress);
  if (frame.sourceNetwork) set("sourceNetwork", frame.sourceNetwork);
  if (frame.destNetwork) set("destNetwork", frame.destNetwork);
  if (frame.sourceSymbol) set("sourceSymbol", frame.sourceSymbol);
  if (frame.destSymbol) set("destSymbol", frame.destSymbol);
  if (frame.constraints.slippageBps) set("constraints", { ...d.constraints, slippageBps: frame.constraints.slippageBps });
  if (frame.constraints.minOutput) set("constraints", { ...d.constraints, minOutput: frame.constraints.minOutput });
  if (frame.condition) set("condition", frame.condition);
  if (frame.schedule) set("schedule", mergeSchedule(d.schedule, frame.schedule));

  const place = (values: string[], src: "sourceNetwork" | "sourceSymbol", dst: "destNetwork" | "destSymbol", label: string) => {
    for (const v of values) {
      if (frame.keywords.has("destination_word")) { set(dst, v); continue; }
      if (frame.keywords.has("source_word")) { set(src, v); continue; }
      if (d[src] === v || d[dst] === v) continue;
      const srcMissing = !d[src];
      const dstMissing = !d[dst];
      if (srcMissing && !dstMissing) set(src, v);
      else if (dstMissing && !srcMissing) set(dst, v);
      else issues.push(err("AMBIGUOUS_NETWORK_ROLE", `Should ${v} be the source or the destination ${label}?`, dst, { value: v }));
    }
  };
  place(frame.looseNetworks, "sourceNetwork", "destNetwork", "network");
  place(frame.looseSymbols, "sourceSymbol", "destSymbol", "asset");
  for (const i of issues) if (i.code === "AMBIGUOUS_NETWORK_ROLE" && frame.looseSymbols.includes(String(i.details?.value))) i.code = "AMBIGUOUS_ASSET";

  // Old parse issues about fields the user just supplied no longer apply.
  d.parseIssues = [
    ...d.parseIssues.filter((i) => {
      const f = i.field ?? "";
      if (touched.has("amount") && f === "amount") return false;
      if ((touched.has("sourceNetwork") || touched.has("destNetwork")) && /Network$/.test(f)) return false;
      if ((touched.has("sourceSymbol") || touched.has("destSymbol")) && /Symbol$/.test(f)) return false;
      if (touched.has("recipient") && f === "recipient") return false;
      if (touched.has("schedule") && f.startsWith("schedule")) return false;
      if (touched.has("condition") && f === "condition") return false;
      return true;
    }),
    ...frame.issues,
  ];
  d.unknownSymbols = [...new Set([...d.unknownSymbols.filter((s) => s === d.sourceSymbol || s === d.destSymbol), ...frame.unknownSymbols])];
  d.assumptions = [...frame.assumptions];
  if (frame.schedule && !d.condition) d.intentType = "SCHEDULED_TRANSACTION";
  if (frame.condition) d.intentType = "CONDITIONAL_TRANSACTION";

  const applied: ContextApplied = amend || session.lastStatus !== "NEEDS_CLARIFICATION" ? "AMENDMENT" : "CLARIFICATION_ANSWER";
  return { draft: d, applied, continues: true, issues };
}
