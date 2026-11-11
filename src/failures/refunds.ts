import type { AuditLog } from "../execution/audit";
import { ExecutionError } from "../execution/errors";
import { newId } from "../execution/quote-service";
import type { ExecutionRecords, ExecutionRow } from "../execution/records";
import type { DepositRecords } from "../deposits/records";
import { RpcUnavailable, type ChainRpc } from "../deposits/rpc";
import { getAsset } from "../spak-in/registries/assets";
import { getNetwork } from "../spak-in/registries/networks";
import type { TrackingRecords } from "../tracking/records";
import { verifyDelivery } from "../tracking/verifiers";
import type { DeliveryResult } from "../tracking/types";
import { txChainFacts } from "./chain-facts";
import type { FailureRecords, RefundRow, RefundState, RefundTxRow } from "./records";

/**
 * Timing is SPak policy, not provider-documented: NEAR Intents documents no refund timing.
 * - Before the deposit transaction (same chain clock): EARLY_TRANSACTION, never a refund.
 * - Up to the deposit deadline (or deposit time) + 7 days: EXPECTED_WINDOW.
 * - Later: LATE_TRANSACTION. Still verified and still counted when associated, but flagged for review.
 * - No reliable timestamp: TIMING_UNKNOWN. Not counted until the time is known.
 * Timing never associates a transaction with an execution.
 */
export const REFUND_TIMING = { delayedAfterMs: 6 * 3600_000, reviewAfterMs: 72 * 3600_000, windowAfterDeadlineMs: 7 * 24 * 3600_000, watchAfterCompletionMs: 30 * 24 * 3600_000 };
export type RefundTiming = "EXPECTED_WINDOW" | "LATE_TRANSACTION" | "EARLY_TRANSACTION" | "TIMING_UNKNOWN";

/**
 * What NEAR Intents exposes as evidence that an origin-chain transaction is this execution's refund.
 * See docs/NEAR-INTENTS-REFUND-EVIDENCE.md. As of 1Click API 0.1.x and SDK 0.1.26 the status response has no refund
 * transaction field; originChainTxHashes is documented only as "all transactions on the origin chain". That is
 * UNCONFIRMED: provider-listed hashes are recorded and verified on chain, but never counted toward REFUNDED.
 * Set SPAK_REFUND_EVIDENCE_CAPABILITY=CONFIRMED only after a documented or observed real refund establishes the meaning.
 */
export type EvidenceCapability = "CONFIRMED" | "UNCONFIRMED" | "UNSUPPORTED";
export function refundEvidenceCapability(v = process.env.SPAK_REFUND_EVIDENCE_CAPABILITY): EvidenceCapability {
  return v === "CONFIRMED" || v === "UNSUPPORTED" ? v : "UNCONFIRMED";
}
export const TX_FORMAT: Record<string, RegExp> = {
  evm: /^0x[0-9a-fA-F]{64}$/, solana: /^[1-9A-HJ-NP-Za-km-z]{64,90}$/, near: /^[1-9A-HJ-NP-Za-km-z]{43,44}$/,
};
/** EVM hashes are case-insensitive: store one form so the unique (network, tx_hash) index really is unique. */
export const normalizeTx = (family: string, h: string) => (family === "evm" ? h.trim().toLowerCase() : h.trim());

type Check = "PASS" | "FAIL" | "PENDING" | "UNKNOWN";
export interface RefundChecks {
  exists: Check; success: Check; network: Check; recipient: Check; asset: Check; amount: Check; finality: Check;
  time: Check; association: Check; provider: Check; notes: string[];
}
const FINAL = new Set(["CONFIRMED", "FAILED", "NO_TRANSFER"]);

function chainChecks(r: DeliveryResult): Omit<RefundChecks, "time" | "association" | "provider" | "notes"> {
  switch (r.outcome) {
    case "NOT_FOUND": return { exists: "PENDING", success: "PENDING", network: "UNKNOWN", recipient: "PENDING", asset: "PENDING", amount: "PENDING", finality: "PENDING" };
    case "PENDING": return { exists: "PASS", success: "PENDING", network: "PASS", recipient: BigInt(r.received) > 0n ? "PASS" : "PENDING", asset: BigInt(r.received) > 0n ? "PASS" : "PENDING", amount: "PENDING", finality: "PENDING" };
    case "FAILED": return { exists: "PASS", success: "FAIL", network: "PASS", recipient: "UNKNOWN", asset: "UNKNOWN", amount: "FAIL", finality: "PASS" };
    case "NO_TRANSFER": {
      const wrongAsset = r.problems.some((p) => /different (token|mint)/i.test(p));
      return { exists: "PASS", success: "PASS", network: "PASS", recipient: wrongAsset ? "PASS" : "FAIL", asset: wrongAsset ? "FAIL" : "UNKNOWN", amount: "FAIL", finality: "PASS" };
    }
    case "UNVERIFIABLE": return { exists: "PASS", success: "UNKNOWN", network: "PASS", recipient: "UNKNOWN", asset: "UNKNOWN", amount: "UNKNOWN", finality: "UNKNOWN" };
    default: return { exists: "PASS", success: "PASS", network: "PASS", recipient: "PASS", asset: "PASS", amount: "PASS", finality: "PASS" };
  }
}

/**
 * Refund verification with strict association.
 *
 * Chain verification (did a transfer of the exact source asset reach the refund address, final, at the right time)
 * is kept separate from association (does this transfer belong to THIS execution's refund).
 *
 * The only association SPak accepts is PROVIDER_LISTED: NEAR Intents returned the hash in originChainTxHashes of the
 * status response for this execution's unique deposit address, signed for this execution's firm quote. NEAR Intents
 * does not label which origin hash is the refund, and exposes no refund reference; SPak claims no more than that.
 * A hash a user or reviewer submits is a candidate: it is checked on chain but stays PENDING_ASSOCIATION (and goes
 * to manual review) unless the provider later lists it. Matching recipient, asset, amount or time never associates.
 *
 * REFUNDED requires: provider status REFUNDED, a provider refunded amount, and provider-listed, chain-verified,
 * in-window transfers to the refund address totalling at least that amount.
 */
export class RefundVerifier {
  constructor(private readonly d: { executions: ExecutionRecords; failures: FailureRecords; depositRecords: DepositRecords; tracking?: TrackingRecords; rpc: ChainRpc; audit?: AuditLog; clock?: () => Date; capability?: () => EvidenceCapability }) {}
  private capability(): EvidenceCapability { return (this.d.capability ?? refundEvidenceCapability)(); }
  private now() { return (this.d.clock ?? (() => new Date()))(); }

  async ensure(row: ExecutionRow): Promise<RefundRow | null> {
    const existing = await this.d.failures.refund(row.id);
    if (existing) return existing;
    const deps = await this.d.depositRecords.forExecution(row.id);
    const confirmed = deps.find((x) => x.state === "CONFIRMED");
    const needs = row.state === "REFUNDING" || (row.state === "FAILED" && (!!confirmed || (row.originTxHashes as string[]).length > 0));
    if (!needs) return null;
    const r = await this.d.failures.openRefund({
      executionId: row.id, userId: row.userId, state: row.state === "REFUNDING" ? "INITIATED" : "PENDING_PROVIDER",
      network: row.sourceNetwork, assetId: row.sourceAssetId, refundTo: row.refundAddress, refundType: "ORIGIN_CHAIN", depositedAmount: confirmed?.amount ?? null,
    });
    const firm = row.firmQuoteId ? await this.d.executions.getQuote(row.firmQuoteId) : null;
    const fee = (firm?.fees as { kind: string; amount?: string }[] | undefined)?.find((f) => f.kind === "REFUND")?.amount ?? null;
    if (fee) await this.d.failures.setRefund(row.id, r.state, { quotedRefundFee: fee });
    await this.d.audit?.record({ at: this.now().toISOString(), actor: "spak", event: "REFUND_OPENED", ref: row.id, data: { state: r.state } });
    return r;
  }

  /**
   * Register a refund candidate. Refuses: malformed hashes, any deposit transaction, the execution's destination
   * transactions, and hashes already linked to another execution (unique network + tx_hash, enforced by the database).
   */
  async register(row: ExecutionRow, txHash: string, source: "PROVIDER" | "USER" | "ADMIN") {
    const net = getNetwork(row.sourceNetwork), asset = getAsset(row.sourceAssetId);
    if (!net || !asset) throw new ExecutionError("UNSUPPORTED_ASSET", "Unknown source asset.");
    if (!TX_FORMAT[net.family]?.test(txHash.trim())) throw new ExecutionError("INVALID_TX_REFERENCE", `That is not a valid ${net.name} transaction reference.`);
    const hash = normalizeTx(net.family, txHash);
    const deps = await this.d.depositRecords.forExecution(row.id);
    if (deps.some((x) => x.txHash && normalizeTx(net.family, x.txHash) === hash) || await this.d.depositRecords.byTx(row.sourceNetwork, txHash.trim()) || await this.d.depositRecords.byTx(row.sourceNetwork, hash)) {
      throw new ExecutionError("INVALID_TX_REFERENCE", "That is a deposit transaction, not a refund.");
    }
    if ((row.destinationTxHashes as string[]).some((h) => normalizeTx(net.family, h) === hash)) throw new ExecutionError("INVALID_TX_REFERENCE", "That is the delivery transaction, not a refund.");
    const t = await this.d.failures.registerRefundTx({ id: newId("rtx"), executionId: row.id, refundId: row.id, network: row.sourceNetwork, txHash: hash, source, recipient: row.refundAddress, assetId: asset.id, tokenContract: asset.contract });
    if (t.executionId !== row.id) throw new ExecutionError("DUPLICATE_TX", "That transaction is already linked to another transfer.");
    return t;
  }

  private async depositTime(row: ExecutionRow, refund: RefundRow, family: string): Promise<Date | null> {
    if (refund.depositTxTimestamp) return refund.depositTxTimestamp;
    const dep = (await this.d.depositRecords.forExecution(row.id)).find((x) => x.state === "CONFIRMED" && x.txHash);
    if (!dep) return null;
    const f = await txChainFacts(this.d.rpc, family, row.sourceNetwork, dep.txHash!);
    if (f.timestamp) await this.d.failures.setRefund(row.id, refund.state, { depositTxTimestamp: f.timestamp });
    return f.timestamp;
  }

  async verify(row: ExecutionRow): Promise<{ row: ExecutionRow; refund: RefundRow | null; ok: boolean; error?: string; needsReview?: string }> {
    let refund = await this.ensure(row);
    if (!refund || refund.state === "COMPLETED") return { row, refund, ok: true };
    const now = this.now();
    const net = getNetwork(row.sourceNetwork)!;
    const providerSays = row.providerStatus === "REFUNDED";
    const facts = { providerRefundedAmount: row.refundedAmount ?? refund.providerRefundedAmount, providerRefundReason: row.refundReason ?? refund.providerRefundReason };
    if (providerSays && refund.state === "PENDING_PROVIDER") refund = (await this.d.failures.setRefund(row.id, refund.state, { state: "INITIATED", ...facts }, { code: "REFUND_INITIATED" })) ?? refund;
    else if (facts.providerRefundedAmount !== refund.providerRefundedAmount || facts.providerRefundReason !== refund.providerRefundReason) refund = (await this.d.failures.setRefund(row.id, refund.state, facts)) ?? refund;

    // Provider-listed origin-chain hashes for this execution (other than the deposit) are registered as PROVIDER.
    const providerListed = new Set((row.originTxHashes as string[]).map((h) => normalizeTx(net.family, h)));
    const reviews: string[] = [];
    for (const h of row.originTxHashes as string[]) {
      try { await this.register(row, h, "PROVIDER"); } catch (e) {
        const c = (e as ExecutionError).code;
        if (c === "DUPLICATE_TX") reviews.push(`Provider-listed transaction ${h} is already linked to another transfer.`);
        // INVALID_TX_REFERENCE here is the deposit itself or a malformed hash: not a refund candidate.
      }
    }

    let depositAt: Date | null = null, rpcError: string | undefined;
    try { depositAt = await this.depositTime(row, refund, net.family); } catch (e) { rpcError = (e as Error).message; }
    const windowEnd = new Date((row.depositDeadline ?? depositAt ?? refund.openedAt).getTime() + REFUND_TIMING.windowAfterDeadlineMs);

    const capability = this.capability();
    const txs = await this.d.failures.refundTxsFor(row.id);
    for (const t of txs) {
      let r: DeliveryResult;
      let when: { timestamp: Date | null; sender: string | null } = { timestamp: t.txTimestamp, sender: t.sender };
      if (t.outcome === "CONFIRMED" && t.txTimestamp) {
        // Chain facts are final; reuse them. Association and timing are re-assessed every pass.
        r = { outcome: "CONFIRMED", received: t.receivedAmount ?? "0", confirmations: t.confirmations, problems: (t.problems as string[]) ?? [], observed: (t.observed as Record<string, unknown>) ?? {} };
      } else {
        try {
          r = await verifyDelivery(this.d.rpc, net.family, { network: t.network, txHash: t.txHash, recipient: row.refundAddress, kind: t.tokenContract ? "TOKEN" : "NATIVE", tokenContract: t.tokenContract });
          if (r.outcome !== "NOT_FOUND" && !when.timestamp) when = await txChainFacts(this.d.rpc, net.family, t.network, t.txHash);
        } catch (e) {
          rpcError = e instanceof RpcUnavailable ? e.message : `Chain check failed: ${(e as Error).message}`;
          continue;
        }
      }
      const checks: RefundChecks = { ...chainChecks(r), time: "PENDING", association: "PENDING", provider: providerSays ? "PASS" : "PENDING", notes: [...r.problems] };
      let timing: RefundTiming = "TIMING_UNKNOWN";
      if (when.timestamp && depositAt) {
        if (when.timestamp.getTime() < depositAt.getTime()) { timing = "EARLY_TRANSACTION"; checks.time = "FAIL"; checks.notes.push(`transaction time ${when.timestamp.toISOString()} is before the deposit ${depositAt.toISOString()}`); }
        else if (when.timestamp.getTime() > windowEnd.getTime()) { timing = "LATE_TRANSACTION"; checks.time = "PASS"; checks.notes.push(`transaction time ${when.timestamp.toISOString()} is after the expected refund window ${windowEnd.toISOString()} (late, still eligible)`); }
        else { timing = "EXPECTED_WINDOW"; checks.time = "PASS"; }
      }
      const sameAsset = t.network === refund.network && t.assetId === refund.assetId;
      if (!sameAsset) { checks.asset = "FAIL"; checks.notes.push("different network or asset than the refund record"); }
      let association = "PENDING_ASSOCIATION", evidence: Record<string, unknown> = { source: t.source, capability };
      if (timing === "EARLY_TRANSACTION" || !sameAsset) { association = "REJECTED"; checks.association = "FAIL"; }
      else if (providerListed.has(t.txHash) && capability !== "UNSUPPORTED") {
        association = capability === "CONFIRMED" ? "PROVIDER_LISTED" : "PROVIDER_LISTED_UNCONFIRMED";
        checks.association = capability === "CONFIRMED" ? "PASS" : "PENDING";
        evidence = { source: t.source, capability, type: "PROVIDER_STATUS_ORIGIN_TX", depositAddress: row.depositAddress, depositMemo: row.depositMemo, firmQuoteId: row.firmQuoteId,
          note: "Listed by NEAR Intents in originChainTxHashes for this execution's deposit address. The provider documents this field as all origin-chain transactions and does not label refunds." };
        if (capability !== "CONFIRMED") checks.notes.push("NEAR Intents lists this hash for the deposit address, but does not document it as the refund; association unconfirmed");
      } else {
        checks.association = r.outcome === "CONFIRMED" ? "FAIL" : "PENDING";
        checks.notes.push("not linked to this execution by NEAR Intents; recipient, asset, amount and time alone do not prove it is this refund");
      }
      await this.d.failures.updateRefundTx(t.id, {
        outcome: r.outcome, receivedAmount: r.received, confirmations: r.confirmations, problems: r.problems, observed: r.observed, verifiedAt: r.outcome === "CONFIRMED" ? (t.verifiedAt ?? now) : null,
        association, associationEvidence: evidence, checks, sender: when.sender, txTimestamp: when.timestamp, timing,
        rejectedReason: association === "REJECTED" ? checks.notes.join("; ").slice(0, 500) : null,
      });
    }
    if (rpcError) return { row, refund, ok: false, error: rpcError };

    // Aggregation: exact bigint sums over distinct rows (unique network + tx_hash), this execution only, same asset only.
    const all = (await this.d.failures.refundTxsFor(row.id)).filter((t) => t.executionId === row.id);
    const usable = (t: RefundTxRow) => t.outcome === "CONFIRMED" && t.association !== "REJECTED" && (t.timing === "EXPECTED_WINDOW" || t.timing === "LATE_TRANSACTION");
    const counted = (t: RefundTxRow) => usable(t) && t.association === "PROVIDER_LISTED";
    const listedOk = (t: RefundTxRow) => usable(t) && (t.association === "PROVIDER_LISTED" || t.association === "PROVIDER_LISTED_UNCONFIRMED");
    const sum = (f: (t: RefundTxRow) => boolean) => all.filter(f).reduce((s, t) => s + BigInt(t.receivedAmount ?? "0"), 0n);
    const associated = sum(counted), listedTotal = sum(listedOk), verified = sum(usable);
    const chainOnly = all.filter((t) => t.outcome === "CONFIRMED" && !counted(t));
    const pendingProvider = all.some((t) => providerListed.has(t.txHash) && !FINAL.has(t.outcome));
    // Observed live: refundedAmount is "0" before any refund. A refunded amount only means something once the provider
    // reports REFUNDED and it is a positive integer; otherwise it is unknown.
    const claimed = providerSays && refund.providerRefundedAmount && /^\d+$/.test(refund.providerRefundedAmount) && BigInt(refund.providerRefundedAmount) > 0n ? BigInt(refund.providerRefundedAmount) : null;
    const amounts = {
      verifiedAmount: verified.toString(), associatedAmount: associated.toString(), providerListedAmount: listedTotal.toString(), evidenceCapability: capability,
      outstandingAmount: claimed !== null ? (claimed > associated ? claimed - associated : 0n).toString() : null,
    };
    for (const t of all.filter((x) => x.timing === "LATE_TRANSACTION" && x.outcome === "CONFIRMED")) reviews.push(`Refund transaction ${t.txHash} arrived after the expected window (late, still counted if associated).`);
    for (const t of chainOnly) {
      if (t.association === "REJECTED") reviews.push(`Refund candidate ${t.txHash} rejected: ${t.rejectedReason ?? "not eligible"}.`);
      else if (t.association === "PROVIDER_LISTED_UNCONFIRMED") reviews.push(`NEAR Intents lists ${t.txHash} for this deposit address, but its refund evidence capability is ${capability}; SPak cannot confirm it is the refund.`);
      else if (usable(t) || t.timing === "TIMING_UNKNOWN") reviews.push(`Refund candidate ${t.txHash} is a real transfer to the refund address but NEAR Intents has not linked it to this execution.`);
    }
    const age = now.getTime() - refund.openedAt.getTime();
    const move = async (to: RefundState, code: string, extra: Record<string, unknown> = {}) =>
      (await this.d.failures.setRefund(row.id, refund!.state, { state: to, ...amounts, ...extra }, refund!.state !== to ? { code } : undefined)) ?? refund!;
    const review = (extra?: string) => [...reviews, ...(extra ? [extra] : [])].join(" ") || undefined;

    if (claimed !== null && associated > claimed) {
      // Never treat more than the reported refund as completed: keep every row as evidence and ask a person.
      return { row, refund: await move("VERIFICATION_PENDING", "REFUND_EXCESS"), ok: true, needsReview: review(`Associated refund transfers total ${associated}, more than the ${claimed} NEAR Intents reports.`) };
    }
    // Completion: provider confirmation + provider-listed + chain-verified + in window, covering the provider's amount.
    if (providerSays && claimed !== null && associated > 0n && associated === claimed && !pendingProvider && row.state === "REFUNDING") {
      const snapshot = {
        at: now.toISOString(), capability, providerStatus: row.providerStatus, providerRefundedAmount: claimed.toString(), associatedAmount: associated.toString(),
        transactions: all.filter(counted).map((t) => ({ txHash: t.txHash, amount: t.receivedAmount, timing: t.timing })), providerOriginTxHashes: [...providerListed],
      };
      refund = await move("COMPLETED", "REFUND_COMPLETED", { completedAt: now, completionSnapshot: snapshot, watchUntil: new Date(now.getTime() + REFUND_TIMING.watchAfterCompletionMs), reconciliation: "CONSISTENT", reconciliationCheckedAt: now });
      const r = await this.d.executions.transition(row.id, "REFUNDING", "REFUNDED", `Refund verified on ${net.name}: ${associated} returned to ${row.refundAddress} in provider-listed transaction(s).`,
        { refundVerifiedAmount: associated.toString(), refundVerifiedAt: now }, { refundVerifiedAmount: associated.toString(), providerRefundedAmount: claimed.toString() });
      await this.d.audit?.record({ at: now.toISOString(), actor: "spak", event: "REFUND_VERIFIED", ref: row.id, data: { amount: associated.toString(), txs: all.filter(counted).map((t) => t.txHash) } });
      return { row: r ?? (await this.d.executions.get(row.id))!, refund, ok: true, needsReview: review() };
    }
    if (pendingProvider) return { row, refund: await move(refund.state === "TX_DETECTED" || refund.state === "VERIFICATION_PENDING" ? "VERIFICATION_PENDING" : "TX_DETECTED", "REFUND_TX_DETECTED"), ok: true, needsReview: review() };
    if (associated > 0n) {
      if (!providerSays) return { row, refund: await move("VERIFICATION_PENDING", "REFUND_AWAITING_PROVIDER"), ok: true, needsReview: review(age > REFUND_TIMING.reviewAfterMs ? "Associated transfer verified but NEAR Intents has not reported REFUNDED." : undefined) };
      if (claimed === null) return { row, refund: await move("VERIFICATION_PENDING", "REFUND_AMOUNT_UNKNOWN"), ok: true, needsReview: review("NEAR Intents reported REFUNDED without a refunded amount.") };
      return { row, refund: await move("PARTIAL", "REFUND_PARTIAL"), ok: true, needsReview: review(age > REFUND_TIMING.reviewAfterMs ? `Only ${associated} of the reported ${claimed} is verified and associated.` : undefined) };
    }
    if (chainOnly.length) return { row, refund: await move("ASSOCIATION_PENDING", capability === "CONFIRMED" ? "REFUND_ASSOCIATION_PENDING" : "REFUND_EVIDENCE_UNCONFIRMED"), ok: true, needsReview: review() };
    const listedFinal = all.filter((t) => providerListed.has(t.txHash));
    if (listedFinal.length && listedFinal.every((t) => FINAL.has(t.outcome))) return { row, refund: await move("FAILED", "REFUND_FAILED"), ok: true, needsReview: review("Provider-listed refund transactions show no return of the deposited asset to the refund address.") };
    if (all.some((t) => !FINAL.has(t.outcome))) return { row, refund: await move(refund.state === "PENDING_PROVIDER" ? "PENDING_PROVIDER" : "TX_DETECTED", "REFUND_TX_DETECTED"), ok: true, needsReview: review() };
    if (all.length && all.every((t) => FINAL.has(t.outcome))) return { row, refund: await move("FAILED", "REFUND_FAILED"), ok: true, needsReview: review("Submitted refund transactions show no return of the deposited asset to the refund address.") };
    if (age > REFUND_TIMING.delayedAfterMs && refund.state !== "DELAYED") refund = await move("DELAYED", "REFUND_DELAYED");
    return { row, refund, ok: true, needsReview: review(age > REFUND_TIMING.reviewAfterMs ? "No refund transaction found 72 hours after the refund was expected." : undefined) };
  }

  /** True while a completed refund is still compared against the provider after completion. */
  async watchActive(row: ExecutionRow): Promise<boolean> {
    const r = await this.d.failures.refund(row.id);
    return !!(r && r.state === "COMPLETED" && r.watchUntil && r.watchUntil.getTime() > this.now().getTime());
  }

  /**
   * Post-completion reconciliation. Compares a fresh, read-only provider observation with the completion snapshot.
   * Discrepancies (status no longer REFUNDED, a different refunded amount, new origin-chain transactions) are logged
   * and sent to review. The completion record, the counted transactions and the execution state are never changed.
   */
  async reconcileCompleted(row: ExecutionRow, obs: { ok: boolean; status: string | null; refundedAmount: string | null; originTxHashes: string[]; error?: string }): Promise<{ ok: boolean; error?: string; needsReview?: string }> {
    const refund = await this.d.failures.refund(row.id);
    if (!refund || refund.state !== "COMPLETED") return { ok: true };
    if (!obs.ok) return { ok: false, error: obs.error };
    const snap = (refund.completionSnapshot ?? {}) as { providerRefundedAmount?: string; providerOriginTxHashes?: string[] };
    const net = getNetwork(row.sourceNetwork)!;
    const known = new Set([...(snap.providerOriginTxHashes ?? []), ...(row.originTxHashes as string[]).map((h) => normalizeTx(net.family, h))]);
    const deposits = new Set((await this.d.depositRecords.forExecution(row.id)).map((x) => normalizeTx(net.family, x.txHash ?? "")));
    const problems: string[] = [];
    if (obs.status && obs.status !== "REFUNDED") problems.push(`provider status is now ${obs.status}, not REFUNDED`);
    if (obs.refundedAmount && /^\d+$/.test(obs.refundedAmount) && BigInt(obs.refundedAmount) > 0n && snap.providerRefundedAmount && obs.refundedAmount !== snap.providerRefundedAmount) {
      problems.push(`provider refunded amount is now ${obs.refundedAmount}, was ${snap.providerRefundedAmount} at completion`);
    }
    const fresh = obs.originTxHashes.map((h) => normalizeTx(net.family, h)).filter((h) => !known.has(h) && !deposits.has(h));
    if (fresh.length) problems.push(`provider lists new origin-chain transaction(s) after completion: ${fresh.join(", ")}`);
    const now = this.now();
    const next = problems.length ? "DISCREPANCY" : (refund.reconciliation === "DISCREPANCY" ? "DISCREPANCY" : "CONSISTENT"); // a discrepancy stays until a person reviews it
    const changed = next !== refund.reconciliation || (problems.length > 0 && JSON.stringify(problems) !== JSON.stringify((refund.completionSnapshot as { lastProblems?: string[] } | null)?.lastProblems ?? []));
    await this.d.failures.setRefund(row.id, "COMPLETED", { reconciliation: next, reconciliationCheckedAt: now,
      ...(problems.length ? { completionSnapshot: { ...(refund.completionSnapshot as object), lastProblems: problems } } : {}) });
    if (problems.length && changed) {
      await this.d.failures.recordEvent(row.id, "REFUND", "REFUND_RECONCILIATION_DISCREPANCY", { problems });
      await this.d.audit?.record({ at: now.toISOString(), actor: "spak", event: "REFUND_DISCREPANCY", ref: row.id, data: { problems } });
      return { ok: true, needsReview: `Completed refund no longer matches provider data: ${problems.join("; ")}. The completion record is unchanged.` };
    }
    return { ok: true };
  }
}
