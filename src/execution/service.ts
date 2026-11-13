import { z } from "zod";
import { OneClickError, type OneClickClient } from "../integrations/near-intents/client";
import { hashObject } from "../spak-in/lib/hash";
import type { AuditLog } from "./audit";
import { AssetResolver, type ResolvedAsset } from "./asset-resolver";
import { ExecutionError } from "./errors";
import { validateExecutionPlan, type PlanStore, type ValidatedPlan, type VerifiedWallet } from "./plan-validator";
import { compareDecimal } from "../spak-in/lib/decimal";
import { QuoteService, newId, providerError } from "./quote-service";
import type { ExecutionRecords, ExecutionRow, QuoteRow } from "./records";
import type { Db } from "../database/repositories";
import { GuardDecisionError, guardError, type GuardService } from "../guard/service";
import { cleanUsd } from "../guard/engine";
import { DELAYED_AFTER_MS, TERMINAL, stateFromProvider, type ExecutionState } from "./state";

export const PROVIDER_ID = "near-intents";
export const APPROVAL_TTL_MS = 10 * 60_000;
export const DUPLICATE_WINDOW_MS = 2 * 60_000;
export const MIN_STATUS_INTERVAL_MS = 3_000;

/** A firm quote must be approved within this window after SPak received it; otherwise request a new one. */
export const FIRM_APPROVAL_TTL_MS = 10 * 60_000;
/** Per-execution ceiling in USD (from the provider's amountInUsd). Fails closed when the value is unknown. No Guard setting can raise it. */
export { platformCeilingUsd as maxExecutionUsd } from "../guard/ceiling";
import { platformCeilingUsd as maxExecutionUsd } from "../guard/ceiling";

export const approvalSchema = z.object({
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** The plan version the user reviewed. */
  planRevision: z.number().int().nonnegative(),
  approvedAt: z.string().datetime(),
  /** The user confirmed they want a second identical transfer within the duplicate window. */
  allowDuplicate: z.boolean().default(false),
});
export type ApprovalInput = z.input<typeof approvalSchema>;

export interface ExecutionDeps {
  client: OneClickClient;
  records: ExecutionRecords;
  plans: PlanStore;
  audit?: AuditLog;
  clock?: () => Date;
  /** SPak Guard. Required: there is no way to build an execution service that skips policy enforcement. */
  guard: GuardService;
  /** Stage 9: checks that an Agent may act for its owner. Without it, any Agent execution is refused (fail closed). */
  agents?: AgentGate;
  /** Stage 10: Agent permissions. Without it, an Agent can never approve; the user approves every transfer. */
  grants?: GrantAuthority;
}

/** Stage 10: the Agent's permission, checked before and inside an Agent approval. Implemented by AgentGrantService. */
export interface GrantAuthority {
  precheck(userId: string, row: ExecutionRow, firm: QuoteRow): Promise<{ grantId: string; grantVersion: number }>;
  authorizeInTx(tx: Db, userId: string, row: ExecutionRow, firm: QuoteRow, expect: { grantId: string; grantVersion: number }): Promise<void>;
}

/** Can this user's Agent act right now? Throws ExecutionError AGENT_NOT_AUTHORIZED when not. Read from the server's own records. */
export interface AgentGate { assertCanAct(userId: string, agentId: string): Promise<void> }

export async function assertAgent(gate: AgentGate | undefined, userId: string, agentId: string | null | undefined) {
  if (!agentId) return;
  if (!gate) throw new ExecutionError("AGENT_NOT_AUTHORIZED", "Agent actions are not available on this server.");
  await gate.assertCanAct(userId, agentId);
}

/**
 * SPak Execution. Coordinates a validated SPak-in plan through NEAR Intents:
 * create (indicative quote) → firm quote (reviewed by the user) → approve that exact firm quote → deposit → tracking.
 * It never signs or sends funds. The user's wallet sends the deposit (phase 3 UI).
 */
export class ExecutionService {
  readonly resolver: AssetResolver;
  readonly quotes: QuoteService;
  private readonly clock: () => Date;

  constructor(private readonly d: ExecutionDeps) {
    this.clock = d.clock ?? (() => new Date());
    this.resolver = new AssetResolver(d.client, this.clock);
    this.quotes = new QuoteService(d.client, d.records, this.clock);
  }

  private async prepare(userId: string, planHash: string, wallets: VerifiedWallet[]) {
    const v = await validateExecutionPlan({ planHash, userId, wallets, store: this.d.plans });
    let src: ResolvedAsset, dst: ResolvedAsset;
    try {
      src = await this.resolver.resolve(v.leg.sourceAssetId, v.leg.sourceNetwork);
      dst = await this.resolver.resolve(v.leg.destinationAssetId, v.leg.destinationNetwork);
    } catch (e) { throw e instanceof ExecutionError ? e : providerError(e); }
    if (src.id === dst.id) throw new ExecutionError("PLAN_NOT_EXECUTABLE", "Same asset on the same network is a wallet transfer, not an intent.");
    return { v, src, dst };
  }

  /** Create (or return) the execution for a plan and attach a fresh indicative quote. Idempotent per key and per plan. */
  async create(args: { userId: string; planHash: string; idempotencyKey: string; wallets: VerifiedWallet[]; agentId?: string | null }) {
    const agentId = args.agentId ?? null;
    // Stage 9: an execution started through the Agent is attributed to it only if the server finds the Agent owned, verified and current.
    await assertAgent(this.d.agents, args.userId, agentId);
    const { v, src, dst } = await this.prepare(args.userId, args.planHash, args.wallets);
    // Guard, before anything is quoted: the stored policy against the plan itself.
    await this.d.guard.enforcePlan(args.userId, v);
    const now = this.clock();
    const { row, created } = await this.d.records.createOrGet({
      id: newId("exe"), userId: args.userId, intentId: v.intentId, planRevision: v.revision, planId: v.plan.planId, planHash: v.plan.hash,
      plan: v.plan, idempotencyKey: args.idempotencyKey, fingerprint: fingerprint(args.userId, v), state: "DRAFT", provider: PROVIDER_ID,
      sourceNetwork: src.network, destinationNetwork: dst.network, sourceAssetId: src.id, destinationAssetId: dst.id,
      amountIn: this.quotes.buildRequest(v, src, dst, true).amount, recipient: v.leg.recipient, recipientKind: v.recipientKind,
      refundAddress: v.leg.refundAddress, agentId, createdAt: now, updatedAt: now,
    });
    if (!created && (row.agentId ?? null) !== agentId) {
      throw new ExecutionError("AGENT_MISMATCH", row.agentId ? "This plan already has a transfer started through your Agent." : "This plan already has a transfer you started yourself.", { existing: row.id });
    }
    // Same key or same plan: return the one execution. Retry the quote only if the first attempt never got one.
    if (!created && !(row.state === "DRAFT" && !row.currentQuoteId)) return { execution: row, quote: row.currentQuoteId ? await this.d.records.getQuote(row.currentQuoteId) : null, created };
    const quote = await this.attachIndicative(row, v, src, dst);
    return { execution: (await this.d.records.get(row.id))!, quote, created: true };
  }

  private async attachIndicative(row: ExecutionRow, v: ValidatedPlan, src: ResolvedAsset, dst: ResolvedAsset): Promise<QuoteRow> {
    let q: QuoteRow;
    try {
      q = await this.quotes.quote({ executionId: row.id, userId: row.userId, v, src, dst, dry: true });
    } catch (e) {
      await this.d.records.touch(row.id, { error: (e as ExecutionError).toJSON?.() ?? { message: String(e) } });
      throw e;
    }
    await this.guardQuote("QUOTE", row, q);
    await this.d.records.supersedeQuotes(row.id, q.id);
    // Approval is always required in this phase (autonomy is off), so a quoted execution waits for approval.
    const r = await this.d.records.transition(row.id, row.state as ExecutionState, "AWAITING_APPROVAL", "Indicative quote received.", { currentQuoteId: q.id, error: null }, { quoteId: q.id });
    if (!r) throw new ExecutionError("INVALID_STATE", "The execution changed while quoting. Reload it.");
    return q;
  }

  /** Guard on a quote the provider returned. A blocked quote is rejected so it can never be approved. */
  private async guardQuote(stage: "QUOTE" | "FIRM_QUOTE", row: ExecutionRow, q: QuoteRow) {
    try {
      await this.d.guard.enforceQuote(stage, row, q);
    } catch (e) {
      await this.d.records.setQuoteStatus(q.id, "REJECTED", "VALID");
      await this.d.records.touch(row.id, { error: (e as ExecutionError).toJSON?.() ?? { message: "Guard stopped this quote." } });
      throw e;
    }
  }

  /** New indicative quote (e.g. after the previous one expired). Only before approval; replaces any firm quote. */
  async requote(args: { userId: string; executionId: string; wallets: VerifiedWallet[] }) {
    const row = await this.mustGet(args.executionId, args.userId);
    if (!["DRAFT", "QUOTED", "AWAITING_APPROVAL"].includes(row.state) || row.approvedAt) {
      throw new ExecutionError("INVALID_STATE", `Cannot re-quote an execution that is ${row.state.toLowerCase().replaceAll("_", " ")}.`);
    }
    const { v, src, dst } = await this.prepare(args.userId, row.planHash, args.wallets);
    const quote = await this.attachIndicative(row, v, src, dst);
    if (row.firmQuoteId) await this.d.records.touch(row.id, { firmQuoteId: null });
    await this.d.records.invalidateApprovals(row.id, "Quote replaced.");
    return { execution: (await this.d.records.get(row.id))!, quote };
  }

  /**
   * Turn the current indicative quote into a firm quote for the user to review. Nothing is approved here:
   * the firm quote (with its deposit address) is shown first, and only that exact quote can be approved.
   */
  async firmQuote(args: { userId: string; executionId: string; quoteId: string; wallets: VerifiedWallet[] }) {
    const now = this.clock();
    const row = await this.mustGet(args.executionId, args.userId);
    if (row.state !== "AWAITING_APPROVAL" || row.approvedAt) throw new ExecutionError("INVALID_STATE", `This execution is ${row.state.toLowerCase().replaceAll("_", " ")}.`);
    if (row.currentQuoteId !== args.quoteId) throw new ExecutionError("QUOTE_NOT_CURRENT", "That quote was replaced. Review the latest quote.");
    const current = await this.d.records.getQuote(args.quoteId);
    if (!current || current.status !== "VALID") throw new ExecutionError("QUOTE_NOT_CURRENT", "That quote can no longer be used.");
    if (current.kind === "FIRM" && now.getTime() - current.createdAt.getTime() < FIRM_APPROVAL_TTL_MS) {
      // The policy may have changed since: check the reused firm quote again before showing it.
      await this.guardQuote("FIRM_QUOTE", row, current);
      return { execution: row, quote: current, reused: true };
    }
    if (current.kind === "INDICATIVE" && current.expiresAt.getTime() <= now.getTime()) {
      await this.d.records.setQuoteStatus(current.id, "EXPIRED", "VALID");
      throw new ExecutionError("QUOTE_EXPIRED", "The quote expired. Get a new quote.");
    }
    // Guard before asking for a firm quote (no deposit address is issued under a policy that would block it)...
    await this.guardQuote("QUOTE", row, current);
    const { v, src, dst } = await this.prepare(args.userId, row.planHash, args.wallets);
    const firm = await this.quotes.quote({ executionId: row.id, userId: args.userId, v, src, dst, dry: false });
    // ...and on the firm quote itself, before it is shown for review.
    await this.guardQuote("FIRM_QUOTE", row, firm);
    await this.d.records.supersedeQuotes(row.id, firm.id);
    await this.d.records.invalidateApprovals(row.id, "Quote replaced.");
    const r = await this.d.records.transition(row.id, "AWAITING_APPROVAL", "AWAITING_APPROVAL", "Firm quote received for review.", { currentQuoteId: firm.id, firmQuoteId: firm.id }, { firmQuoteId: firm.id, fromQuoteId: current.id });
    if (!r) throw new ExecutionError("INVALID_STATE", "The execution changed while quoting. Reload it.");
    return { execution: r, quote: firm, reused: false };
  }

  /**
   * The user approves the exact firm quote they reviewed. Tied to execution, quote and plan revision.
   * The server re-checks everything; a browser-side "approved" flag means nothing.
   */
  async approve(args: { userId: string; executionId: string; quoteId: string; approval: ApprovalInput; wallets: VerifiedWallet[] }) {
    const a = approvalSchema.parse(args.approval);
    const now = this.clock();
    const row = await this.mustGet(args.executionId, args.userId);
    const done = await this.alreadyApproved(row, args.quoteId);
    if (done) return done;
    if (a.planHash !== row.planHash || a.planRevision !== row.planRevision) throw new ExecutionError("APPROVAL_MISMATCH", "The approval is for a different plan or plan version.");
    const age = now.getTime() - Date.parse(a.approvedAt);
    if (age > APPROVAL_TTL_MS || age < -60_000) throw new ExecutionError("APPROVAL_EXPIRED", "The approval expired. Review the quote and approve again.");
    const firm = await this.approvableFirm(row, args.userId, args.quoteId, args.wallets, a.allowDuplicate, now);
    return this.commitApproval({ row, firm, userId: args.userId, approvedAt: new Date(a.approvedAt), allowDuplicate: a.allowDuplicate, now, actor: `user:${args.userId}`, reason: "Firm quote approved by the user." });
  }

  /**
   * Stage 10: the Agent approves the firm quote under the user's signed permission, without the user reviewing it.
   * Only for transfers started through the Agent, only within the grant AND Guard (both checked again inside the
   * approval transaction with the Agent, grant and Guard rows locked), never for a suspected duplicate. Anything
   * outside the grant is AGENT_APPROVAL_REQUIRED: the user approves it themselves with approve(). The deposit still
   * needs the user's wallet signature.
   */
  async approveByAgent(args: { userId: string; executionId: string; quoteId: string; wallets: VerifiedWallet[] }) {
    const now = this.clock();
    const row = await this.mustGet(args.executionId, args.userId);
    const done = await this.alreadyApproved(row, args.quoteId);
    if (done) return done;
    if (!row.agentId) throw new ExecutionError("AGENT_APPROVAL_REQUIRED", "This transfer was not started through your Agent. Approve it yourself.");
    if (!this.d.grants) throw new ExecutionError("AGENT_APPROVAL_REQUIRED", "Agent approvals are not available on this server. Approve it yourself.");
    const firm = await this.approvableFirm(row, args.userId, args.quoteId, args.wallets, false, now);
    let grant: { grantId: string; grantVersion: number };
    try { grant = await this.d.grants.precheck(args.userId, row, firm); } catch (e) { throw asApprovalRequired(e); }
    return this.commitApproval({ row, firm, userId: args.userId, approvedAt: now, allowDuplicate: false, now, actor: `agent:${row.agentId}`, reason: `Firm quote approved by the Agent under permission version ${grant.grantVersion}.`, grant });
  }

  /** A repeat approval of an execution already past approval returns it as a duplicate, or is refused. */
  private async alreadyApproved(row: ExecutionRow, quoteId: string) {
    if (row.state === "AWAITING_DEPOSIT" || TERMINAL.has(row.state as ExecutionState) || ["PROCESSING", "FAILED", "REFUNDING", "VERIFYING_DESTINATION", "UNKNOWN"].includes(row.state)) {
      const active = await this.d.records.activeApproval(row.id);
      if (row.firmQuoteId && active?.quoteId === quoteId) return { execution: row, quote: await this.d.records.getQuote(row.firmQuoteId), duplicate: true as const };
      throw new ExecutionError("INVALID_STATE", `This execution is ${row.state.toLowerCase().replaceAll("_", " ")}.`);
    }
    if (row.state !== "AWAITING_APPROVAL") throw new ExecutionError("INVALID_STATE", "This execution has no quote to approve yet.");
    return null;
  }

  /** Every check on the firm quote shared by user and Agent approvals. Returns the firm quote. */
  private async approvableFirm(row: ExecutionRow, userId: string, quoteId: string, wallets: VerifiedWallet[], allowDuplicate: boolean, now: Date): Promise<QuoteRow> {
    if (row.currentQuoteId !== quoteId || row.firmQuoteId !== quoteId) {
      const q = await this.d.records.getQuote(quoteId);
      if (q?.executionId === row.id && q.kind === "INDICATIVE" && row.currentQuoteId === quoteId) throw new ExecutionError("FIRM_QUOTE_REQUIRED", "Review the firm quote before approving.");
      throw new ExecutionError("QUOTE_NOT_CURRENT", "That quote was replaced. Review the latest quote.");
    }
    const firm = await this.d.records.getQuote(quoteId);
    if (!firm || firm.kind !== "FIRM" || firm.status !== "VALID") throw new ExecutionError("QUOTE_NOT_CURRENT", "That quote can no longer be approved.");
    if (now.getTime() - firm.createdAt.getTime() > FIRM_APPROVAL_TTL_MS || (firm.providerDeadline && firm.providerDeadline.getTime() <= now.getTime())) {
      await this.d.records.setQuoteStatus(firm.id, "EXPIRED", "VALID");
      throw new ExecutionError("QUOTE_EXPIRED", "The firm quote is too old to approve. Get a new quote.");
    }
    // The quote must still say what the execution says: same plan, recipient, refund address and amount.
    const req = firm.request as { recipient?: string; refundTo?: string; amount?: string };
    if (firm.planHash !== row.planHash || firm.planRevision !== row.planRevision || req.recipient !== row.recipient || req.refundTo !== row.refundAddress || firm.amountIn !== row.amountIn || !firm.depositAddress) {
      throw new ExecutionError("APPROVAL_MISMATCH", "The quote no longer matches this execution. Get a new quote.");
    }
    const limit = maxExecutionUsd();
    const usdIn = cleanUsd(firm.amountInUsd);
    if (!usdIn || compareDecimal(usdIn, limit) > 0) {
      throw new ExecutionError("AMOUNT_LIMIT_EXCEEDED", firm.amountInUsd ? `This is about $${Number(firm.amountInUsd).toFixed(2)}, above the $${limit} limit per execution.` : "The USD value of this execution is unknown, so it cannot be checked against the limit.");
    }
    await this.prepare(userId, row.planHash, wallets);
    // An Agent transfer is approved only while the Agent can still act: a suspended or revoked Agent stops it here.
    await assertAgent(this.d.agents, userId, row.agentId);
    if (!allowDuplicate) {
      const recent = await this.d.records.recentSameTransfer(userId, row.fingerprint, new Date(now.getTime() - DUPLICATE_WINDOW_MS), row.id);
      if (recent.length) throw new ExecutionError("DUPLICATE_SUSPECTED", "You started the same transfer less than 2 minutes ago. Confirm to do it again.", { existing: recent[0].id });
    }
    return firm;
  }

  private async commitApproval(c: { row: ExecutionRow; firm: QuoteRow; userId: string; approvedAt: Date; allowDuplicate: boolean; now: Date; actor: string; reason: string; grant?: { grantId: string; grantVersion: number } }) {
    const { row, firm, now } = c;
    const approval = await this.d.records.insertApproval({
      id: newId("apv"), executionId: row.id, userId: c.userId, quoteId: firm.id, planHash: row.planHash, planRevision: row.planRevision,
      approvedAt: c.approvedAt, createdAt: now,
      ...(c.grant ? { approvedBy: "AGENT_GRANT", grantId: c.grant.grantId, grantVersion: c.grant.grantVersion } : { approvedBy: "USER" }),
    });
    if (!approval) throw new ExecutionError("APPROVAL_IN_PROGRESS", "This execution is already approved.");
    const claimed = await this.d.records.claimApproval(row.id);
    if (!claimed) { await this.d.records.invalidateApprovals(row.id, "Lost approval race."); throw new ExecutionError("APPROVAL_IN_PROGRESS", "This execution is already being approved."); }
    // The Agent's permission (when used) and Guard are both checked in the same database transaction as the state
    // change, and Guard reserves spending there. If either refuses, nothing is approved.
    let r: ExecutionRow | null;
    try {
      r = await this.d.records.transition(row.id, "AWAITING_APPROVAL", "AWAITING_DEPOSIT", c.reason, {
        depositAddress: firm.depositAddress, depositMemo: firm.depositMemo, depositDeadline: firm.providerDeadline,
      }, { approvalId: approval.id, firmQuoteId: firm.id, allowDuplicate: c.allowDuplicate, approvedBy: approval.approvedBy, ...(c.grant ?? {}) }, async (tx, updated) => {
        if (c.grant) await this.d.grants!.authorizeInTx(tx, c.userId, updated, firm, c.grant);
        await this.d.guard.reserveInTx(tx, updated, firm);
      });
    } catch (e) {
      await this.d.records.invalidateApprovals(row.id, e instanceof GuardDecisionError ? "Blocked by Guard." : (e as Error).name === "GrantDecisionError" ? "Outside the Agent's permission." : "Approval failed.");
      await this.d.records.releaseApproval(row.id);
      if (e instanceof GuardDecisionError) {
        await this.d.guard.record(c.userId, e.decision).catch(() => {});
        throw guardError(e.decision);
      }
      if ((e as Error).name === "GrantDecisionError") throw asApprovalRequired(e);
      if (e instanceof ExecutionError) throw e;
      console.error("[spak-execution] approval failed", e);
      throw new ExecutionError("GUARD_UNAVAILABLE", "Guard could not check this transfer, so it was not approved. Try again shortly.");
    }
    if (!r) throw new ExecutionError("INVALID_STATE", "The execution changed during approval. Reload it.");
    await this.d.audit?.record({ at: now.toISOString(), actor: c.actor, event: "EXECUTION_APPROVED", ref: row.id, data: { approvalId: approval.id, approvedBy: approval.approvedBy, grantId: approval.grantId, grantVersion: approval.grantVersion, planHash: row.planHash, planRevision: row.planRevision, firmQuoteId: firm.id, depositAddress: firm.depositAddress, amountInUsd: firm.amountInUsd } });
    return { execution: r, quote: firm, duplicate: false, approval };
  }

  /** Ask NEAR Intents for the current status and move the state machine (user-triggered; rate limited per execution). */
  async refresh(args: { userId: string; executionId: string }) {
    const row = await this.mustGet(args.executionId, args.userId);
    return (await this.checkProvider(row)).row;
  }

  /**
   * One provider status check for an execution row. Used by user refreshes and the background monitor (force).
   * ok=false means the provider could not be read (timeout, rate limit, outage): nothing about the state changed
   * except, after a long silence, PROCESSING to UNKNOWN (delayed). A missing status field is not a failure.
   */
  async checkProvider(row: ExecutionRow, opts: { force?: boolean } = {}): Promise<{ row: ExecutionRow; ok: boolean; error?: string }> {
    const now = this.clock();
    if (TERMINAL.has(row.state as ExecutionState) || !row.depositAddress) return { row, ok: true };
    if (!opts.force && row.lastCheckedAt && now.getTime() - row.lastCheckedAt.getTime() < MIN_STATUS_INTERVAL_MS) return { row, ok: true };
    let status: string | null, dest: string[] = [], origin: string[] = [], amountOut: string | null = null, refunded: string | null = null, refundReason: string | null = null, updatedAt: Date | null = null;
    try {
      const s = await this.d.client.status(row.depositAddress, row.depositMemo);
      const firm = row.firmQuoteId ? await this.d.records.getQuote(row.firmQuoteId) : null;
      const sig = s.quoteResponse?.signature;
      if (firm?.providerSignature && sig && sig !== firm.providerSignature) {
        await this.d.records.touch(row.id, { lastCheckedAt: now, lastStatusError: "Status response belongs to a different quote; ignored." });
        return { row: (await this.d.records.get(row.id))!, ok: false, error: "status signature mismatch" };
      }
      status = s.status ?? null;
      dest = s.swapDetails?.destinationChainTxHashes.map((t) => t.hash) ?? [];
      origin = s.swapDetails?.originChainTxHashes.map((t) => t.hash) ?? [];
      amountOut = s.swapDetails?.amountOut ?? null;
      refunded = s.swapDetails?.refundedAmount ?? null;
      refundReason = s.swapDetails?.refundReason ?? null;
      updatedAt = s.updatedAt ? new Date(s.updatedAt) : null;
    } catch (e) {
      if (e instanceof OneClickError && e.kind === "NOT_FOUND") status = "NOT_FOUND";
      else {
        const lastOk = row.lastSuccessfulCheckAt ?? row.approvedAt ?? row.createdAt;
        const msg = e instanceof OneClickError ? `${e.kind}: ${e.message}` : (e as Error).message;
        await this.d.records.touch(row.id, { lastCheckedAt: now, lastStatusError: msg.slice(0, 500) });
        if (row.state === "PROCESSING" && now.getTime() - lastOk.getTime() > DELAYED_AFTER_MS) {
          const r = await this.d.records.transition(row.id, "PROCESSING", "UNKNOWN", "No status from NEAR Intents for 30 minutes.");
          return { row: r ?? (await this.d.records.get(row.id))!, ok: false, error: msg };
        }
        return { row: (await this.d.records.get(row.id))!, ok: false, error: msg };
      }
    }
    const depositConfirmed = await this.d.records.hasConfirmedDeposit(row.id);
    let next = stateFromProvider(row.state as ExecutionState, { status, destinationTxHashes: dest, amountOut, depositConfirmed }, row.depositDeadline, now);
    // Delivery already found wrong for these exact destination transactions: stay UNKNOWN until the provider reports new ones.
    const rec = row.error as { code?: string; destinationTxHashes?: string[] } | null;
    if (row.state === "UNKNOWN" && next.state === "VERIFYING_DESTINATION" && rec?.code === "NEEDS_RECONCILIATION"
      && JSON.stringify([...(rec.destinationTxHashes ?? [])].sort()) === JSON.stringify([...dest].sort())) {
      next = { state: "UNKNOWN", reason: "Needs manual reconciliation." };
    }
    const patch = {
      providerStatus: status ?? row.providerStatus, providerUpdatedAt: updatedAt ?? row.providerUpdatedAt,
      // Keep references already seen: an incomplete response never erases them.
      originTxHashes: origin.length ? origin : row.originTxHashes, destinationTxHashes: dest.length ? dest : row.destinationTxHashes,
      // Provider-reported output is informational. The verified amount lives in amountOutVerified.
      amountOutSettled: amountOut ?? row.amountOutSettled, refundedAmount: refunded ?? row.refundedAmount, refundReason: refundReason ?? row.refundReason,
      lastCheckedAt: now, lastSuccessfulCheckAt: now, lastStatusError: null,
    };
    const r = await this.d.records.transition(row.id, row.state as ExecutionState, next.state, next.reason, patch, next.state !== row.state ? { providerStatus: status } : {});
    if (r && next.state === "EXPIRED" && row.firmQuoteId) await this.d.records.setQuoteStatus(row.firmQuoteId, "EXPIRED");
    if (r && ["VERIFYING_DESTINATION", "REFUNDING", "FAILED"].includes(next.state) && row.firmQuoteId) await this.d.records.setQuoteStatus(row.firmQuoteId, "USED");
    return { row: r ?? (await this.d.records.get(row.id))!, ok: true };
  }

  /**
   * Read-only provider observation, used after a refund completed: no state change, no bookkeeping beyond the
   * caller's. ok=false when the provider could not be read or the response belongs to another quote.
   */
  async observeProvider(row: ExecutionRow): Promise<{ ok: boolean; status: string | null; refundedAmount: string | null; originTxHashes: string[]; error?: string }> {
    if (!row.depositAddress) return { ok: false, status: null, refundedAmount: null, originTxHashes: [], error: "no deposit address" };
    try {
      const s = await this.d.client.status(row.depositAddress, row.depositMemo);
      const firm = row.firmQuoteId ? await this.d.records.getQuote(row.firmQuoteId) : null;
      const sig = s.quoteResponse?.signature;
      if (firm?.providerSignature && sig && sig !== firm.providerSignature) return { ok: false, status: null, refundedAmount: null, originTxHashes: [], error: "status signature mismatch" };
      return { ok: true, status: s.status ?? null, refundedAmount: s.swapDetails?.refundedAmount ?? null, originTxHashes: s.swapDetails?.originChainTxHashes.map((t) => t.hash) ?? [] };
    } catch (e) {
      return { ok: false, status: null, refundedAmount: null, originTxHashes: [], error: (e as Error).message };
    }
  }

  /** Cancel before any deposit. A deposit already sent is settled or refunded by the provider. */
  async cancel(args: { userId: string; executionId: string }) {
    let row = await this.mustGet(args.executionId, args.userId);
    if (row.state === "AWAITING_DEPOSIT") row = await this.refresh(args);
    if (!["DRAFT", "QUOTED", "AWAITING_APPROVAL", "AWAITING_DEPOSIT"].includes(row.state)) {
      throw new ExecutionError("INVALID_STATE", `This execution is ${row.state.toLowerCase().replaceAll("_", " ")} and cannot be cancelled.`);
    }
    // A deposit already on its way is never written off by a cancel; it is tracked to delivery or refund.
    if (row.state === "AWAITING_DEPOSIT" && await this.d.records.hasLiveDeposit(row.id)) {
      throw new ExecutionError("INVALID_STATE", "A deposit was already sent for this execution. SPak keeps tracking it; it cannot be cancelled.");
    }
    const note = row.state === "AWAITING_DEPOSIT" ? "Do not send the deposit. Funds sent after cancelling are refunded by NEAR Intents after the deadline." : "Cancelled before approval.";
    const r = await this.d.records.transition(row.id, row.state as ExecutionState, "CANCELLED", note);
    if (!r) throw new ExecutionError("INVALID_STATE", "The execution changed. Reload it.");
    await this.d.records.invalidateApprovals(row.id, "Execution cancelled.");
    await this.d.audit?.record({ at: this.clock().toISOString(), actor: `user:${args.userId}`, event: "EXECUTION_CANCELLED", ref: row.id, data: {} });
    return r;
  }

  async mustGet(id: string, userId: string) {
    const r = await this.d.records.getForUser(id, userId);
    if (!r) throw new ExecutionError("EXECUTION_NOT_FOUND", "No such execution.");
    return r;
  }

  async details(id: string, userId: string) {
    const row = await this.mustGet(id, userId);
    const [allQuotes, events] = await Promise.all([this.d.records.quotesFor(row.id), this.d.records.events(row.id)]);
    return toExecutionView(row, allQuotes, events, this.clock());
  }

  async quote(id: string, userId: string) {
    const q = await this.d.records.getQuoteForUser(id, userId);
    if (!q) throw new ExecutionError("QUOTE_NOT_FOUND", "No such quote.");
    return toQuoteView(q, this.clock());
  }

  async history(userId: string, opts: { limit: number; before?: Date }) {
    return (await this.d.records.list(userId, opts)).map((r) => toExecutionView(r, [], [], this.clock()));
  }
}

/** A grant refusal becomes "approve it yourself", with the reasons. Anything else passes through unchanged. */
function asApprovalRequired(e: unknown): unknown {
  const g = e as { name?: string; message?: string; reasons?: string[]; rules?: unknown[] };
  if (g?.name !== "GrantDecisionError") return e;
  return new ExecutionError("AGENT_APPROVAL_REQUIRED", `${g.message} Approve this transfer yourself.`, { reasons: g.reasons ?? [], rules: g.rules ?? [] });
}

function fingerprint(userId: string, v: ValidatedPlan): string {
  const l = v.leg;
  return hashObject({ userId, src: l.sourceAssetId, dst: l.destinationAssetId, amount: l.amount, recipient: l.recipient });
}

// ------------------------------------------------------------------ views (API shapes; no raw provider payloads)

export function toQuoteView(q: QuoteRow, now: Date = new Date()) {
  const expired = q.status === "VALID" && q.expiresAt.getTime() <= now.getTime();
  return {
    id: q.id, kind: q.kind, status: expired ? "EXPIRED" : q.status, executionId: q.executionId,
    plan: { planId: q.planId, planHash: q.planHash, revision: q.planRevision },
    source: { network: q.sourceNetwork, assetId: q.sourceAssetId, providerAssetId: q.providerOriginAsset, amountIn: q.amountIn, amountInUsd: q.amountInUsd },
    destination: { network: q.destinationNetwork, assetId: q.destinationAssetId, providerAssetId: q.providerDestinationAsset, amountOut: q.amountOut, minAmountOut: q.minAmountOut, amountOutUsd: q.amountOutUsd },
    slippageBps: q.slippageBps, fees: q.fees, timeEstimateSec: q.timeEstimateSec,
    deposit: q.depositAddress ? { address: q.depositAddress, memo: q.depositMemo, deadline: q.providerDeadline?.toISOString() ?? null } : null,
    expiresAt: q.expiresAt.toISOString(), rejectionReason: q.rejectionReason,
    providerReference: { provider: PROVIDER_ID, correlationId: q.providerCorrelationId, signature: q.providerSignature, timestamp: q.providerTimestamp },
    createdAt: q.createdAt.toISOString(),
  };
}

export function toExecutionView(r: ExecutionRow, allQuotes: QuoteRow[], events: { at: Date; fromState: string | null; toState: string; reason: string }[], now: Date = new Date()) {
  return {
    id: r.id, state: r.state, provider: r.provider, agentId: r.agentId ?? null,
    plan: { planId: r.planId, planHash: r.planHash, intentId: r.intentId, revision: r.planRevision },
    source: { network: r.sourceNetwork, assetId: r.sourceAssetId, amountIn: r.amountIn },
    destination: { network: r.destinationNetwork, assetId: r.destinationAssetId, amountOutSettled: r.amountOutSettled, amountOutVerified: r.amountOutVerified, verifiedAt: r.destinationVerifiedAt?.toISOString() ?? null },
    recipient: { address: r.recipient, kind: r.recipientKind }, refundAddress: r.refundAddress,
    currentQuoteId: r.currentQuoteId, firmQuoteId: r.firmQuoteId, approvedAt: r.approvedAt?.toISOString() ?? null,
    deposit: r.depositAddress && r.state === "AWAITING_DEPOSIT"
      ? { network: r.sourceNetwork, assetId: r.sourceAssetId, amount: r.amountIn, address: r.depositAddress, memo: r.depositMemo, deadline: r.depositDeadline?.toISOString() ?? null }
      : null,
    providerStatus: r.providerStatus, originTxHashes: r.originTxHashes, destinationTxHashes: r.destinationTxHashes, refundedAmount: r.refundedAmount,
    lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null, lastStatusError: r.lastStatusError, error: r.error,
    quotes: allQuotes.map((q) => toQuoteView(q, now)),
    events: events.map((e) => ({ at: e.at.toISOString(), from: e.fromState, to: e.toState, reason: e.reason })),
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}
