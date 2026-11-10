import { classify } from "./classifier/intent-classifier";
import { createDefaultRegistry } from "./classifier/builtins";
import { TX_INTENT_TYPES } from "./classifier/transaction-type";
import { resolveContext, type ContextApplied } from "./context/context-resolver";
import { MemorySessionStore, type Draft, type SessionState, type SessionStore } from "./context/draft";
import { err, SpakInError, type ErrorCode, type SpakError } from "./errors/codes";
import { extractEntities } from "./extractor";
import { randomIds, type IdFactory } from "./lib/hash";
import { parse } from "./parser/intent-parser";
import { evaluatePolicy } from "./policy/policy-engine";
import { buildPlan } from "./planner/execution-planner";
import { processInput } from "./processor/input-processor";
import type { IntentRegistry } from "./registries/intent-registry";
import { getAsset } from "./registries/assets";
import type { AccessMode, AmountSpec, IntentStatus } from "./schemas/intent";
import type { PolicyDecision } from "./schemas/policy";
import { interpretRequestSchema, type InterpretRequest, type InterpretRequestInput } from "./schemas/request";
import { intentResultSchema, type IntentResult } from "./schemas/result";
import { validate, type Validation } from "./validator/validator";
import { z } from "zod";

export const ENGINE_VERSION = "spak-in/1.0.0";

const UNSUPPORTED: ReadonlySet<ErrorCode> = new Set(["INTENT_NOT_IMPLEMENTED", "UNSUPPORTED_NETWORK", "UNSUPPORTED_ASSET", "ASSET_NOT_ON_NETWORK", "MULTI_STEP_NOT_SUPPORTED", "UNSUPPORTED_MODE"]);
const CLARIFY: ReadonlySet<ErrorCode> = new Set(["AMBIGUOUS_ACTION", "AMBIGUOUS_AMOUNT", "AMBIGUOUS_ASSET", "AMBIGUOUS_NETWORK_ROLE", "AMBIGUOUS_TARGET", "UNKNOWN_INTENT", "CONTEXT_EXPIRED", "NOTHING_TO_AMEND"]);

export function statusFor(errors: SpakError[], missing: string[], policy: PolicyDecision | null): IntentStatus {
  if (errors.some((e) => UNSUPPORTED.has(e.code))) return "UNSUPPORTED";
  if (errors.some((e) => !CLARIFY.has(e.code))) return "INVALID";
  if (errors.length || missing.length) return "NEEDS_CLARIFICATION";
  if (policy?.outcome === "DENY") return "POLICY_REJECTED";
  return "VALIDATED";
}

export interface SpakInOptions {
  registry?: IntentRegistry;
  sessions?: SessionStore;
  ids?: IdFactory;
  clock?: () => Date;
  /** Check every result against the output schema. On in tests; costs ~0.1 ms per call. */
  validateOutput?: boolean;
  /** Called with every result, for persistence and audit. Errors are swallowed and reported to onError. */
  onResult?: (r: IntentResult, req: InterpretRequest) => Promise<void> | void;
  onError?: (e: unknown) => void;
}

/** Fields the Manual Access form supplies. Goes through the same validation, policy and planning. */
export const manualIntentSchema = z.object({
  type: z.enum(["SWAP", "CROSS_CHAIN_SWAP", "BRIDGE", "CROSS_CHAIN_TRANSFER", "PAYMENT"]),
  amount: z.string(),
  sourceNetwork: z.string(),
  sourceAsset: z.string().describe("Symbol or canonical asset id"),
  destinationNetwork: z.string(),
  destinationAsset: z.string().describe("Symbol or canonical asset id"),
  recipient: z.string().optional(),
  slippageBps: z.number().int().positive().optional(),
});
export type ManualIntent = z.infer<typeof manualIntentSchema>;

/**
 * SPak-in. Deterministic, local, no LLM. Turns an instruction into a validated, policy-checked execution plan.
 * It never signs, never holds keys and never calls an execution provider.
 */
export class SpakIn {
  readonly registry: IntentRegistry;
  readonly sessions: SessionStore;
  private readonly ids: IdFactory;
  private readonly clock: () => Date;

  constructor(private readonly opts: SpakInOptions = {}) {
    this.registry = opts.registry ?? createDefaultRegistry();
    this.sessions = opts.sessions ?? new MemorySessionStore();
    this.ids = opts.ids ?? randomIds;
    this.clock = opts.clock ?? (() => new Date());
  }

  /** Natural-language entry point. */
  async interpret(input: InterpretRequestInput): Promise<IntentResult> {
    const started = performance.now();
    const req = this.parseRequest(input);
    const now = req.now ? new Date(req.now) : this.clock();
    const sessionId = req.sessionId ?? this.ids("spak_ses");

    const processed = processInput(req.text);
    if (!processed.ok) {
      return this.finish(req, sessionId, null, emptyDraft(), [processed.error], "NONE", started, false, true);
    }
    const entities = extractEntities(processed.value.tokens, { now, timezone: req.timezone });
    const frame = parse(processed.value.tokens, entities);
    const cls = classify(frame, this.registry);
    const session = await this.sessions.get(sessionId);
    const ctx = resolveContext(frame, cls, session, now);
    return this.finish(req, sessionId, session, ctx.draft, ctx.issues, ctx.applied, started, ctx.continues);
  }

  /** Manual Access entry point: structured fields, same checks. */
  async interpretManual(input: InterpretRequestInput & { intent: ManualIntent }): Promise<IntentResult> {
    const started = performance.now();
    const req = this.parseRequest({ ...input, text: input.text || `[manual] ${input.intent.type}` });
    const m = manualIntentSchema.parse(input.intent);
    const sessionId = req.sessionId ?? this.ids("spak_ses");
    const isId = (s: string) => s.includes(":");
    const amount: AmountSpec | null = /^\d+(\.\d+)?$/.test(m.amount.trim()) ? { kind: "EXACT", value: m.amount.trim().replace(/^0+(?=\d)/, "") } : null;
    const issues: SpakError[] = amount ? [] : [err("INVALID_AMOUNT", "Amount must be a positive decimal number.", "source.amount")];
    const verb = m.type === "BRIDGE" ? "BRIDGE" : m.type === "CROSS_CHAIN_TRANSFER" ? "TRANSFER" : m.type === "PAYMENT" ? "PAY" : "SWAP";
    const draft: Draft = {
      ...emptyDraft(),
      intentType: m.type, verb, amount,
      sourceNetwork: m.sourceNetwork, destNetwork: m.destinationNetwork,
      sourceSymbol: isId(m.sourceAsset) ? null : m.sourceAsset.toUpperCase(),
      destSymbol: isId(m.destinationAsset) ? null : m.destinationAsset.toUpperCase(),
      sourceAssetId: isId(m.sourceAsset) ? m.sourceAsset : null,
      destAssetId: isId(m.destinationAsset) ? m.destinationAsset : null,
      recipient: m.recipient ? { kind: "EXTERNAL", address: m.recipient.trim() } : null,
      constraints: { slippageBps: m.slippageBps ?? null, minOutput: null },
    };
    if (draft.sourceAssetId) draft.sourceSymbol = getAsset(draft.sourceAssetId)?.symbol.toUpperCase() ?? null;
    if (draft.destAssetId) draft.destSymbol = getAsset(draft.destAssetId)?.symbol.toUpperCase() ?? null;
    return this.finish(req, sessionId, null, draft, issues, "NONE", started, false);
  }

  private parseRequest(input: InterpretRequestInput): InterpretRequest {
    const r = interpretRequestSchema.safeParse(input);
    if (!r.success) {
      throw new SpakInError(err("INPUT_MALFORMED", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    return r.data;
  }

  private async finish(
    req: InterpretRequest, sessionId: string, session: SessionState | null, draft: Draft,
    ctxIssues: SpakError[], applied: ContextApplied, started: number, continues: boolean, inputRejected = false,
  ): Promise<IntentResult> {
    const v: Validation = inputRejected
      ? { ...validate(draft, req), errors: [], missing: [], clarifications: [] }
      : validate(draft, req, this.registry.get(draft.intentType)?.validate);
    const errors = dedupe([...ctxIssues, ...(ctxIssues.length ? v.errors.filter((e) => e.code !== "UNKNOWN_INTENT") : v.errors)]);
    draft.intentType = v.intentType;
    draft.innerType = v.innerType;

    const fundsType = TX_INTENT_TYPES.has(v.intentType) ? v.intentType : v.innerType;
    const movesFunds = !!fundsType && (this.registry.get(v.intentType)?.movesFunds ?? true) && !(draft.condition?.onTrigger === "NOTIFY" && !draft.verb);
    let policy: PolicyDecision | null = null;
    const preStatus = statusFor(errors, v.missing, null);
    if (preStatus === "VALIDATED" && (movesFunds || v.intentType === "PORTFOLIO_REBALANCE")) {
      policy = evaluatePolicy({
        intentType: v.intentType, mode: req.mode as AccessMode,
        sourceNetwork: draft.sourceNetwork, destNetwork: draft.destNetwork,
        sourceAsset: v.sourceAsset, destAsset: v.destAsset, amount: draft.amount,
        recipient: v.recipient, slippageBps: draft.constraints.slippageBps,
        deferred: v.intentType === "SCHEDULED_TRANSACTION" || v.intentType === "CONDITIONAL_TRANSACTION",
      }, req.policy, req.runtime);
    }
    const status = statusFor(errors, v.missing, policy);

    const intentId = continues && session ? session.intentId : this.ids("spak_int");
    const revision = continues && session ? session.revision + 1 : 0;
    const plan = status === "VALIDATED" && !this.registry.get(v.intentType)?.validate
      ? buildPlan({ intentId, draft, validation: v, policy, defaultSlippageBps: req.policy.maxSlippageBps })
      : null;
    const approvalRequired = plan ? plan.approvalRequired : movesFunds || v.intentType === "CANCEL_TRANSACTION" || v.intentType === "PORTFOLIO_REBALANCE";

    const result: IntentResult = {
      intentId, sessionId, revision,
      intentType: v.intentType, innerIntentType: v.innerType, status,
      input: req.text,
      source: { network: draft.sourceNetwork, asset: v.sourceRef, amount: draft.amount },
      destination: { network: draft.destNetwork, asset: v.destRef },
      recipient: v.recipient,
      refundAddress: v.refundAddress,
      constraints: draft.constraints,
      schedule: draft.schedule,
      condition: draft.condition,
      target: v.target,
      query: v.intentType === "PORTFOLIO_QUERY" ? draft.query : null,
      allocations: draft.allocations,
      executionMode: plan?.executionMode ?? "MANUAL",
      approvalRequired,
      missingFields: v.missing,
      errors,
      clarifications: v.clarifications,
      assumptions: [...new Set(v.assumptions)],
      policy,
      plan,
      meta: { engineVersion: ENGINE_VERSION, processingMs: round(performance.now() - started), contextApplied: applied },
    };
    if (this.opts.validateOutput) intentResultSchema.parse(result);

    // Keep the session pointed at the latest real intent. Unknown input does not wipe a pending draft.
    if (!inputRejected && (draft.intentType !== "UNKNOWN" || continues || !session)) {
      await this.sessions.put({
        sessionId, userId: req.userId ?? null, intentId, revision, draft, lastStatus: status,
        submitted: false, updatedAt: (req.now ? new Date(req.now) : this.clock()).toISOString(),
      });
    }
    if (this.opts.onResult) {
      try { await this.opts.onResult(result, req); } catch (e) { this.opts.onError?.(e); }
    }
    return result;
  }
}

function emptyDraft(): Draft {
  return {
    intentType: "UNKNOWN", innerType: null, verb: null, amount: null,
    sourceSymbol: null, sourceNetwork: null, destSymbol: null, destNetwork: null,
    recipient: null, refundAddress: null, schedule: null, condition: null,
    constraints: { slippageBps: null, minOutput: null }, target: null, query: null, allocations: null,
    unknownSymbols: [], parseIssues: [], assumptions: [],
  };
}

function dedupe(errors: SpakError[]): SpakError[] {
  const seen = new Set<string>();
  return errors.filter((e) => { const k = `${e.code}|${e.field ?? ""}|${e.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const round = (n: number) => Math.round(n * 1000) / 1000;
