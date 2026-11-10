import type { AuditLog } from "../execution/audit";
import { ExecutionError } from "../execution/errors";
import { newId } from "../execution/quote-service";
import type { ExecutionRecords, ExecutionRow } from "../execution/records";
import type { DepositRecords } from "../deposits/records";
import { RpcUnavailable, type ChainRpc } from "../deposits/rpc";
import { getAsset } from "../spak-in/registries/assets";
import { getNetwork } from "../spak-in/registries/networks";
import { verifyDelivery } from "../tracking/verifiers";
import type { DeliveryResult } from "../tracking/types";
import type { FailureRecords, RefundRow, RefundState } from "./records";

export const REFUND_TIMING = { delayedAfterMs: 6 * 3600_000, reviewAfterMs: 72 * 3600_000 };
const FINAL = new Set(["CONFIRMED", "FAILED", "NO_TRANSFER"]);
export const TX_FORMAT: Record<string, RegExp> = {
  evm: /^0x[0-9a-fA-F]{64}$/, solana: /^[1-9A-HJ-NP-Za-km-z]{64,90}$/, near: /^[1-9A-HJ-NP-Za-km-z]{43,44}$/,
};

/**
 * Refund verification. NEAR Intents refunds automatically (refundType ORIGIN_CHAIN, to the execution's refund
 * address) and exposes no refund endpoint and no dedicated refund transaction field. SPak therefore:
 *  - opens a refund record when a swap fails after a confirmed deposit, or the provider reports REFUNDED;
 *  - takes candidate refund transactions from the provider's origin-chain hashes (excluding the deposit itself)
 *    and from hashes the user or a reviewer submits;
 *  - verifies each on the source chain (recipient = refund address, exact source asset, amount, finality);
 *  - marks the execution REFUNDED only when the provider reports REFUNDED *and* the chain shows at least the
 *    provider's refunded amount reaching the refund address. Partial refunds are recorded as such.
 */
export class RefundVerifier {
  constructor(private readonly d: { executions: ExecutionRecords; failures: FailureRecords; depositRecords: DepositRecords; rpc: ChainRpc; audit?: AuditLog; clock?: () => Date }) {}
  private now() { return (this.d.clock ?? (() => new Date()))(); }

  /** Make sure an execution that needs a refund has a refund record. Returns null when no refund is expected. */
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

  /** Register a refund transaction reference. Rejects deposit transactions and references owned by another execution. */
  async register(row: ExecutionRow, txHash: string, source: "PROVIDER" | "USER" | "ADMIN") {
    const net = getNetwork(row.sourceNetwork), asset = getAsset(row.sourceAssetId);
    if (!net || !asset) throw new ExecutionError("UNSUPPORTED_ASSET", "Unknown source asset.");
    const hash = txHash.trim();
    if (!TX_FORMAT[net.family]?.test(hash)) throw new ExecutionError("INVALID_TX_REFERENCE", `That is not a valid ${net.name} transaction reference.`);
    if (await this.d.depositRecords.byTx(row.sourceNetwork, hash)) throw new ExecutionError("INVALID_TX_REFERENCE", "That is a deposit transaction, not a refund.");
    const t = await this.d.failures.registerRefundTx({ id: newId("rtx"), executionId: row.id, network: row.sourceNetwork, txHash: hash, source, recipient: row.refundAddress, assetId: asset.id, tokenContract: asset.contract });
    if (t.executionId !== row.id) throw new ExecutionError("DUPLICATE_TX", "That transaction is already linked to another transfer.");
    return t;
  }

  /** One verification pass. Idempotent; only moves forward. ok=false means a chain could not be read. */
  async verify(row: ExecutionRow): Promise<{ row: ExecutionRow; refund: RefundRow | null; ok: boolean; error?: string; needsReview?: string }> {
    let refund = await this.ensure(row);
    if (!refund || refund.state === "COMPLETED") return { row, refund, ok: true };
    const now = this.now();
    const providerSays = row.providerStatus === "REFUNDED";
    // Provider facts (informational).
    const facts = { providerRefundedAmount: row.refundedAmount ?? refund.providerRefundedAmount, providerRefundReason: row.refundReason ?? refund.providerRefundReason };
    if (providerSays && refund.state === "PENDING_PROVIDER") {
      refund = (await this.d.failures.setRefund(row.id, refund.state, { state: "INITIATED", ...facts }, { code: "REFUND_INITIATED" })) ?? refund;
    } else if (facts.providerRefundedAmount !== refund.providerRefundedAmount || facts.providerRefundReason !== refund.providerRefundReason) {
      refund = (await this.d.failures.setRefund(row.id, refund.state, facts)) ?? refund;
    }

    // Candidate refund transactions: provider origin-chain hashes that are not deposits, plus registered ones.
    const deposits = new Set((await this.d.depositRecords.forExecution(row.id)).map((x) => (x.txHash ?? "").toLowerCase()));
    for (const h of row.originTxHashes as string[]) {
      if (deposits.has(h.toLowerCase())) continue;
      try { await this.register(row, h, "PROVIDER"); } catch (e) {
        if ((e as ExecutionError).code === "DUPLICATE_TX") return { row, refund, ok: true, needsReview: `Refund reference ${h} belongs to another transfer.` };
      }
    }
    const txs = await this.d.failures.refundTxsFor(row.id);
    const net = getNetwork(row.sourceNetwork)!;
    let total = 0n, allFinal = true, rpcError: string | undefined;
    for (const t of txs) {
      if (t.outcome === "CONFIRMED") { total += BigInt(t.receivedAmount ?? "0"); continue; }
      let r: DeliveryResult;
      try {
        r = await verifyDelivery(this.d.rpc, net.family, { network: t.network, txHash: t.txHash, recipient: row.refundAddress, kind: t.tokenContract ? "TOKEN" : "NATIVE", tokenContract: t.tokenContract });
      } catch (e) {
        rpcError = e instanceof RpcUnavailable ? e.message : `Chain check failed: ${(e as Error).message}`;
        allFinal = false;
        continue;
      }
      await this.d.failures.updateRefundTx(t.id, { outcome: r.outcome, receivedAmount: r.received, confirmations: r.confirmations, problems: r.problems, observed: r.observed, verifiedAt: r.outcome === "CONFIRMED" ? now : null });
      if (r.outcome === "CONFIRMED") total += BigInt(r.received);
      if (!FINAL.has(r.outcome)) allFinal = false;
    }

    const age = now.getTime() - refund.openedAt.getTime();
    const move = async (to: RefundState, code: string, extra: Record<string, unknown> = {}) => {
      if (refund!.state === to) return refund!;
      return (await this.d.failures.setRefund(row.id, refund!.state, { state: to, ...extra }, { code })) ?? refund!;
    };
    if (rpcError) return { row, refund, ok: false, error: rpcError };
    if (!txs.length) {
      if (age > REFUND_TIMING.delayedAfterMs) refund = await move("DELAYED", "REFUND_DELAYED");
      return { row, refund, ok: true, needsReview: age > REFUND_TIMING.reviewAfterMs ? "No refund transaction found 72 hours after the refund was expected." : undefined };
    }
    if (!allFinal) {
      refund = await move(txs.some((t) => t.outcome !== "PENDING" && t.outcome !== "NOT_FOUND") || refund.state === "TX_DETECTED" ? "VERIFICATION_PENDING" : "TX_DETECTED", "REFUND_TX_DETECTED");
      return { row, refund, ok: true };
    }
    const claimed = refund.providerRefundedAmount && /^\d+$/.test(refund.providerRefundedAmount) ? BigInt(refund.providerRefundedAmount) : null;
    if (total > 0n && providerSays && claimed !== null && total >= claimed && row.state === "REFUNDING") {
      refund = await move("COMPLETED", "REFUND_COMPLETED", { verifiedAmount: total.toString(), completedAt: now });
      const r = await this.d.executions.transition(row.id, "REFUNDING", "REFUNDED", `Refund verified on ${net.name}: ${total} returned to ${row.refundAddress}.`,
        { refundVerifiedAmount: total.toString(), refundVerifiedAt: now }, { refundVerifiedAmount: total.toString(), providerRefundedAmount: claimed.toString() });
      await this.d.audit?.record({ at: now.toISOString(), actor: "spak", event: "REFUND_VERIFIED", ref: row.id, data: { amount: total.toString(), txs: txs.map((t) => t.txHash) } });
      return { row: r ?? (await this.d.executions.get(row.id))!, refund, ok: true };
    }
    if (total === 0n) {
      refund = await move("FAILED", "REFUND_FAILED");
      return { row, refund, ok: true, needsReview: "Refund transactions show no return of the deposited asset to the refund address." };
    }
    // Some funds verified back, but not (yet) what the provider says, or the provider has not confirmed: wait, then review.
    refund = await move("VERIFICATION_PENDING", "REFUND_PARTIAL_OR_UNCONFIRMED", { verifiedAmount: total.toString() });
    return { row, refund, ok: true, needsReview: age > REFUND_TIMING.reviewAfterMs ? `Verified ${total} returned; provider reports ${claimed ?? "no amount"}${providerSays ? "" : " and has not reported REFUNDED"}.` : undefined };
  }
}
