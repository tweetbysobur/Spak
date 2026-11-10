import { z } from "zod";
import { OneClickError, type OneClickClient } from "../integrations/near-intents/client";
import { hashObject } from "../spak-in/lib/hash";
import type { AuditLog } from "./audit";
import { AssetResolver, type ResolvedAsset } from "./asset-resolver";
import { ExecutionError } from "./errors";
import { validateExecutionPlan, type PlanStore, type ValidatedPlan, type VerifiedWallet } from "./plan-validator";
import { QuoteService, firmWithinApproved, newId, providerError } from "./quote-service";
import type { ExecutionRecords, ExecutionRow, QuoteRow } from "./records";
import { DELAYED_AFTER_MS, TERMINAL, stateFromProvider, type ExecutionState } from "./state";

export const PROVIDER_ID = "near-intents";
export const APPROVAL_TTL_MS = 10 * 60_000;
export const DUPLICATE_WINDOW_MS = 2 * 60_000;
export const MIN_STATUS_INTERVAL_MS = 3_000;

export const approvalSchema = z.object({
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
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
}

/**
 * SPak Execution. Coordinates a validated SPak-in plan through NEAR Intents:
 * create (indicative quote) → approve (firm quote, deposit instructions) → status tracking.
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
  async create(args: { userId: string; planHash: string; idempotencyKey: string; wallets: VerifiedWallet[] }) {
    const { v, src, dst } = await this.prepare(args.userId, args.planHash, args.wallets);
    const now = this.clock();
    const { row, created } = await this.d.records.createOrGet({
      id: newId("exe"), userId: args.userId, intentId: v.intentId, planRevision: v.revision, planId: v.plan.planId, planHash: v.plan.hash,
      plan: v.plan, idempotencyKey: args.idempotencyKey, fingerprint: fingerprint(args.userId, v), state: "DRAFT", provider: PROVIDER_ID,
      sourceNetwork: src.network, destinationNetwork: dst.network, sourceAssetId: src.id, destinationAssetId: dst.id,
      amountIn: this.quotes.buildRequest(v, src, dst, true).amount, recipient: v.leg.recipient, recipientKind: v.recipientKind,
      refundAddress: v.leg.refundAddress, createdAt: now, updatedAt: now,
    });
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
    await this.d.records.supersedeQuotes(row.id, q.id);
    // Approval is always required in this phase (autonomy is off), so a quoted execution waits for approval.
    const r = await this.d.records.transition(row.id, row.state as ExecutionState, "AWAITING_APPROVAL", "Indicative quote received.", { currentQuoteId: q.id, error: null }, { quoteId: q.id });
    if (!r) throw new ExecutionError("INVALID_STATE", "The execution changed while quoting. Reload it.");
    return q;
  }

  /** New indicative quote (e.g. after the previous one expired). Only before approval. */
  async requote(args: { userId: string; executionId: string; wallets: VerifiedWallet[] }) {
    const row = await this.mustGet(args.executionId, args.userId);
    if (!["DRAFT", "QUOTED", "AWAITING_APPROVAL"].includes(row.state) || row.approvedAt) {
      throw new ExecutionError("INVALID_STATE", `Cannot re-quote an execution that is ${row.state.toLowerCase().replaceAll("_", " ")}.`);
    }
    const { v, src, dst } = await this.prepare(args.userId, row.planHash, args.wallets);
    const quote = await this.attachIndicative(row, v, src, dst);
    return { execution: (await this.d.records.get(row.id))!, quote };
  }

  /**
   * The user approved the current indicative quote. Get a firm quote with deposit instructions.
   * One approval per execution; the firm quote must be at least as good as the approved worst case.
   */
  async approve(args: { userId: string; executionId: string; quoteId: string; approval: ApprovalInput; wallets: VerifiedWallet[] }) {
    const a = approvalSchema.parse(args.approval);
    const now = this.clock();
    const row = await this.mustGet(args.executionId, args.userId);
    if (row.state === "AWAITING_DEPOSIT" || TERMINAL.has(row.state as ExecutionState) || row.state === "PROCESSING") {
      if (row.firmQuoteId) return { execution: row, quote: await this.d.records.getQuote(row.firmQuoteId), duplicate: true };
      throw new ExecutionError("INVALID_STATE", `This execution is ${row.state.toLowerCase()}.`);
    }
    if (a.planHash !== row.planHash) throw new ExecutionError("APPROVAL_MISMATCH", "The approval is for a different plan.");
    const age = now.getTime() - Date.parse(a.approvedAt);
    if (age > APPROVAL_TTL_MS || age < -60_000) throw new ExecutionError("APPROVAL_EXPIRED", "The approval expired. Review the quote and approve again.");
    if (row.currentQuoteId !== args.quoteId) throw new ExecutionError("QUOTE_NOT_CURRENT", "That quote was replaced. Review the latest quote.");
    const indicative = await this.d.records.getQuote(args.quoteId);
    if (!indicative || indicative.status !== "VALID" || indicative.kind !== "INDICATIVE") throw new ExecutionError("QUOTE_NOT_CURRENT", "That quote can no longer be approved.");
    if (indicative.expiresAt.getTime() <= now.getTime()) {
      await this.d.records.setQuoteStatus(indicative.id, "EXPIRED", "VALID");
      throw new ExecutionError("QUOTE_EXPIRED", "The quote expired. Get a new quote and approve again.");
    }
    const { v, src, dst } = await this.prepare(args.userId, row.planHash, args.wallets);
    if (!a.allowDuplicate) {
      const recent = await this.d.records.recentSameTransfer(args.userId, row.fingerprint, new Date(now.getTime() - DUPLICATE_WINDOW_MS), row.id);
      if (recent.length) throw new ExecutionError("DUPLICATE_SUSPECTED", "You started the same transfer less than 2 minutes ago. Confirm to do it again.", { existing: recent[0].id });
    }

    const claimed = await this.d.records.claimApproval(row.id);
    if (!claimed) throw new ExecutionError("APPROVAL_IN_PROGRESS", "This execution is already being approved.");
    let firm: QuoteRow;
    try {
      firm = await this.quotes.quote({ executionId: row.id, userId: args.userId, v, src, dst, dry: false });
      if (!firmWithinApproved(indicative, firm)) {
        await this.d.records.setQuoteStatus(firm.id, "REJECTED");
        throw new ExecutionError("QUOTE_WORSE_THAN_APPROVED", "The price moved below what you approved. Review the new quote.", { firmQuoteId: firm.id });
      }
    } catch (e) {
      await this.d.records.releaseApproval(row.id);
      throw e;
    }
    await this.d.records.setQuoteStatus(indicative.id, "USED", "VALID");
    const r = await this.d.records.transition(row.id, row.state as ExecutionState, "AWAITING_DEPOSIT", "Approved by the user; firm quote received.", {
      firmQuoteId: firm.id, depositAddress: firm.depositAddress, depositMemo: firm.depositMemo, depositDeadline: firm.providerDeadline,
    }, { firmQuoteId: firm.id, approvedQuoteId: indicative.id, allowDuplicate: a.allowDuplicate });
    if (!r) throw new ExecutionError("INVALID_STATE", "The execution changed during approval. Reload it.");
    await this.d.audit?.record({ at: now.toISOString(), actor: `user:${args.userId}`, event: "EXECUTION_APPROVED", ref: row.id, data: { planHash: row.planHash, indicativeQuoteId: indicative.id, firmQuoteId: firm.id, depositAddress: firm.depositAddress } });
    return { execution: r, quote: firm, duplicate: false };
  }

  /** Ask NEAR Intents for the current status and move the state machine. */
  async refresh(args: { userId: string; executionId: string }) {
    const row = await this.mustGet(args.executionId, args.userId);
    const now = this.clock();
    if (TERMINAL.has(row.state as ExecutionState) || !row.depositAddress) return row;
    if (row.lastCheckedAt && now.getTime() - row.lastCheckedAt.getTime() < MIN_STATUS_INTERVAL_MS) return row;
    let status: string, dest: string[] = [], origin: string[] = [], amountOut: string | null = null, refunded: string | null = null, updatedAt: Date | null = null;
    try {
      const s = await this.d.client.status(row.depositAddress, row.depositMemo);
      const firm = row.firmQuoteId ? await this.d.records.getQuote(row.firmQuoteId) : null;
      const sig = s.quoteResponse?.signature;
      if (firm?.providerSignature && sig && sig !== firm.providerSignature) {
        await this.d.records.touch(row.id, { lastCheckedAt: now, lastStatusError: "Status response belongs to a different quote; ignored." });
        return (await this.d.records.get(row.id))!;
      }
      status = s.status;
      dest = s.swapDetails?.destinationChainTxHashes.map((t) => t.hash) ?? [];
      origin = s.swapDetails?.originChainTxHashes.map((t) => t.hash) ?? [];
      amountOut = s.swapDetails?.amountOut ?? null;
      refunded = s.swapDetails?.refundedAmount ?? null;
      updatedAt = s.updatedAt ? new Date(s.updatedAt) : null;
    } catch (e) {
      if (e instanceof OneClickError && e.kind === "NOT_FOUND") status = "NOT_FOUND";
      else {
        const lastOk = row.lastSuccessfulCheckAt ?? row.approvedAt ?? row.createdAt;
        await this.d.records.touch(row.id, { lastCheckedAt: now, lastStatusError: (e as Error).message });
        if (row.state === "PROCESSING" && now.getTime() - lastOk.getTime() > DELAYED_AFTER_MS) {
          return (await this.d.records.transition(row.id, "PROCESSING", "UNKNOWN", "No status from NEAR Intents for 30 minutes.")) ?? (await this.d.records.get(row.id))!;
        }
        return (await this.d.records.get(row.id))!;
      }
    }
    const next = stateFromProvider(row.state as ExecutionState, { status, destinationTxHashes: dest, amountOut }, row.depositDeadline, now);
    const patch = {
      providerStatus: status, providerUpdatedAt: updatedAt, originTxHashes: origin, destinationTxHashes: dest,
      amountOutSettled: next.state === "COMPLETED" ? amountOut : row.amountOutSettled, refundedAmount: refunded ?? row.refundedAmount,
      lastCheckedAt: now, lastSuccessfulCheckAt: now, lastStatusError: null,
    };
    const r = await this.d.records.transition(row.id, row.state as ExecutionState, next.state, next.reason, patch, next.state !== row.state ? { providerStatus: status } : {});
    if (r && next.state === "EXPIRED" && row.firmQuoteId) await this.d.records.setQuoteStatus(row.firmQuoteId, "EXPIRED");
    if (r && ["COMPLETED", "REFUNDED", "FAILED"].includes(next.state) && row.firmQuoteId) await this.d.records.setQuoteStatus(row.firmQuoteId, "USED");
    return r ?? (await this.d.records.get(row.id))!;
  }

  /** Cancel before any deposit. A deposit already sent is settled or refunded by the provider. */
  async cancel(args: { userId: string; executionId: string }) {
    let row = await this.mustGet(args.executionId, args.userId);
    if (row.state === "AWAITING_DEPOSIT") row = await this.refresh(args);
    if (!["DRAFT", "QUOTED", "AWAITING_APPROVAL", "AWAITING_DEPOSIT"].includes(row.state)) {
      throw new ExecutionError("INVALID_STATE", `This execution is ${row.state.toLowerCase().replaceAll("_", " ")} and cannot be cancelled.`);
    }
    const note = row.state === "AWAITING_DEPOSIT" ? "Do not send the deposit. Funds sent after cancelling are refunded by NEAR Intents after the deadline." : "Cancelled before approval.";
    const r = await this.d.records.transition(row.id, row.state as ExecutionState, "CANCELLED", note);
    if (!r) throw new ExecutionError("INVALID_STATE", "The execution changed. Reload it.");
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
    id: r.id, state: r.state, provider: r.provider,
    plan: { planId: r.planId, planHash: r.planHash, intentId: r.intentId, revision: r.planRevision },
    source: { network: r.sourceNetwork, assetId: r.sourceAssetId, amountIn: r.amountIn },
    destination: { network: r.destinationNetwork, assetId: r.destinationAssetId, amountOutSettled: r.amountOutSettled },
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
