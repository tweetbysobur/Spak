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
 * SPak policy, not provider-documented: NEAR Intents documents no refund timing. A refund transaction must be at or
 * after the deposit transaction (same chain clock) and no later than the deposit deadline (or deposit time) + 7 days.
 */
export const REFUND_TIMING = { delayedAfterMs: 6 * 3600_000, reviewAfterMs: 72 * 3600_000, windowAfterDeadlineMs: 7 * 24 * 3600_000 };
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
  constructor(private readonly d: { executions: ExecutionRecords; failures: FailureRecords; depositRecords: DepositRecords; tracking?: TrackingRecords; rpc: ChainRpc; audit?: AuditLog; clock?: () => Date }) {}
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

    const txs = await this.d.failures.refundTxsFor(row.id);
    for (const t of txs) {
      if (t.association === "PROVIDER_LISTED" && t.outcome === "CONFIRMED" && (t.checks as RefundChecks).time === "PASS" && (t.checks as RefundChecks).provider === (providerSays ? "PASS" : "PENDING")) continue; // final, nothing new
      let r: DeliveryResult;
      let when: { timestamp: Date | null; sender: string | null } = { timestamp: t.txTimestamp, sender: t.sender };
      try {
        r = await verifyDelivery(this.d.rpc, net.family, { network: t.network, txHash: t.txHash, recipient: row.refundAddress, kind: t.tokenContract ? "TOKEN" : "NATIVE", tokenContract: t.tokenContract });
        if (r.outcome !== "NOT_FOUND" && !when.timestamp) when = await txChainFacts(this.d.rpc, net.family, t.network, t.txHash);
      } catch (e) {
        rpcError = e instanceof RpcUnavailable ? e.message : `Chain check failed: ${(e as Error).message}`;
        continue;
      }
      const checks: RefundChecks = { ...chainChecks(r), time: "PENDING", association: "PENDING", provider: providerSays ? "PASS" : "PENDING", notes: [...r.problems] };
      if (when.timestamp && depositAt) {
        if (when.timestamp.getTime() < depositAt.getTime()) { checks.time = "FAIL"; checks.notes.push(`transaction time ${when.timestamp.toISOString()} is before the deposit ${depositAt.toISOString()}`); }
        else if (when.timestamp.getTime() > windowEnd.getTime()) { checks.time = "FAIL"; checks.notes.push(`transaction time ${when.timestamp.toISOString()} is after the refund window ${windowEnd.toISOString()}`); }
        else checks.time = "PASS";
      }
      let association = "PENDING_ASSOCIATION", evidence: Record<string, unknown> = { source: t.source };
      if (checks.time === "FAIL") { association = "REJECTED"; checks.association = "FAIL"; }
      else if (providerListed.has(t.txHash)) {
        association = "PROVIDER_LISTED"; checks.association = "PASS";
        evidence = { source: t.source, type: "PROVIDER_STATUS_ORIGIN_TX", depositAddress: row.depositAddress, depositMemo: row.depositMemo, firmQuoteId: row.firmQuoteId,
          note: "Listed by NEAR Intents in originChainTxHashes for this execution's deposit address. The provider does not label which origin transaction is the refund." };
      } else {
        checks.association = r.outcome === "CONFIRMED" ? "FAIL" : "PENDING";
        checks.notes.push("not listed by NEAR Intents for this execution; recipient, asset, amount and time alone do not prove it is this refund");
      }
      await this.d.failures.updateRefundTx(t.id, {
        outcome: r.outcome, receivedAmount: r.received, confirmations: r.confirmations, problems: r.problems, observed: r.observed, verifiedAt: r.outcome === "CONFIRMED" ? now : null,
        association, associationEvidence: evidence, checks, sender: when.sender, txTimestamp: when.timestamp, rejectedReason: association === "REJECTED" ? checks.notes.join("; ").slice(0, 500) : null,
      });
    }
    if (rpcError) return { row, refund, ok: false, error: rpcError };

    const all = await this.d.failures.refundTxsFor(row.id);
    const counted = (t: RefundTxRow) => t.association === "PROVIDER_LISTED" && t.outcome === "CONFIRMED" && (t.checks as RefundChecks).time === "PASS";
    const associated = all.filter(counted).reduce((s, t) => s + BigInt(t.receivedAmount ?? "0"), 0n);
    const chainOnly = all.filter((t) => t.outcome === "CONFIRMED" && !counted(t));
    const verified = all.filter((t) => t.outcome === "CONFIRMED").reduce((s, t) => s + BigInt(t.receivedAmount ?? "0"), 0n);
    const pendingProvider = all.some((t) => t.association === "PROVIDER_LISTED" && !FINAL.has(t.outcome));
    const claimed = refund.providerRefundedAmount && /^\d+$/.test(refund.providerRefundedAmount) ? BigInt(refund.providerRefundedAmount) : null;
    const amounts = { verifiedAmount: verified.toString(), associatedAmount: associated.toString(), outstandingAmount: claimed !== null ? (claimed > associated ? claimed - associated : 0n).toString() : null };
    for (const t of chainOnly) reviews.push(t.association === "REJECTED"
      ? `Refund candidate ${t.txHash} rejected: ${t.rejectedReason ?? "outside the refund window"}.`
      : `Refund candidate ${t.txHash} is a real transfer to the refund address but NEAR Intents has not linked it to this execution.`);
    const age = now.getTime() - refund.openedAt.getTime();
    const move = async (to: RefundState, code: string, extra: Record<string, unknown> = {}) =>
      (await this.d.failures.setRefund(row.id, refund!.state, { state: to, ...amounts, ...extra }, refund!.state !== to ? { code } : undefined)) ?? refund!;
    const review = (extra?: string) => [...reviews, ...(extra ? [extra] : [])].join(" ") || undefined;

    // Completion: provider confirmation + provider-listed + chain-verified + in window, covering the provider's amount.
    if (providerSays && claimed !== null && associated > 0n && associated >= claimed && !pendingProvider && row.state === "REFUNDING") {
      refund = await move("COMPLETED", "REFUND_COMPLETED", { completedAt: now });
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
    if (chainOnly.length) return { row, refund: await move("ASSOCIATION_PENDING", "REFUND_ASSOCIATION_PENDING"), ok: true, needsReview: review() };
    const listedFinal = all.filter((t) => t.association === "PROVIDER_LISTED");
    if (listedFinal.length && listedFinal.every((t) => FINAL.has(t.outcome))) return { row, refund: await move("FAILED", "REFUND_FAILED"), ok: true, needsReview: review("Provider-listed refund transactions show no return of the deposited asset to the refund address.") };
    if (all.some((t) => !FINAL.has(t.outcome))) return { row, refund: await move(refund.state === "PENDING_PROVIDER" ? "PENDING_PROVIDER" : "TX_DETECTED", "REFUND_TX_DETECTED"), ok: true, needsReview: review() };
    if (all.length && all.every((t) => FINAL.has(t.outcome))) return { row, refund: await move("FAILED", "REFUND_FAILED"), ok: true, needsReview: review("Submitted refund transactions show no return of the deposited asset to the refund address.") };
    if (age > REFUND_TIMING.delayedAfterMs && refund.state !== "DELAYED") refund = await move("DELAYED", "REFUND_DELAYED");
    return { row, refund, ok: true, needsReview: review(age > REFUND_TIMING.reviewAfterMs ? "No refund transaction found 72 hours after the refund was expected." : undefined) };
  }
}
