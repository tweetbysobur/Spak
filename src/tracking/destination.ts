import type { AuditLog } from "../execution/audit";
import { newId } from "../execution/quote-service";
import type { ExecutionRecords, ExecutionRow } from "../execution/records";
import { RpcUnavailable, type ChainRpc } from "../deposits/rpc";
import { getAsset } from "../spak-in/registries/assets";
import { getNetwork } from "../spak-in/registries/networks";
import type { TrackingRecords } from "./records";
import type { DeliveryResult } from "./types";
import { verifyDelivery } from "./verifiers";

const FINAL_OUTCOMES = new Set(["CONFIRMED", "FAILED", "NO_TRANSFER"]);

/**
 * Destination verification. COMPLETED is assigned here only, and only when SPak itself reads the destination
 * chain and sees the approved recipient receive at least the approved minimum of the exact approved asset,
 * at final commitment, in transactions the provider linked to this execution and to no other.
 */
export class DestinationVerifier {
  constructor(private readonly d: { executions: ExecutionRecords; tracking: TrackingRecords; rpc: ChainRpc; audit?: AuditLog; clock?: () => Date }) {}
  private now() { return (this.d.clock ?? (() => new Date()))(); }

  async verify(row: ExecutionRow): Promise<{ row: ExecutionRow; ok: boolean; error?: string }> {
    if (row.state !== "VERIFYING_DESTINATION") return { row, ok: true };
    const net = getNetwork(row.destinationNetwork), asset = getAsset(row.destinationAssetId);
    const reported = (row.destinationTxHashes as string[]) ?? [];
    // Providers can list their own settlement transactions (e.g. a NEAR intents hash) among "destination" hashes.
    // On an EVM destination only a 32-byte 0x hash can be a transaction there; anything else is recorded as ignored and
    // never counted. Delivery must still be proven on chain from the remaining references.
    const ignored = net?.family === "evm" ? reported.filter((h) => !/^0x[0-9a-fA-F]{64}$/.test(h)) : [];
    const hashes = reported.filter((h) => !ignored.includes(h));
    const firm = row.firmQuoteId ? await this.d.executions.getQuote(row.firmQuoteId) : null;
    const min = firm?.minAmountOut && /^\d+$/.test(firm.minAmountOut) ? BigInt(firm.minAmountOut) : null;
    if (!net || !asset || !hashes.length || min === null) {
      // Fail closed: without the approved minimum or a known asset, delivery cannot be proven.
      return { row: await this.toUnknown(row, !hashes.length ? (ignored.length ? `No ${net?.name ?? "destination"} transaction among the provider's references (${ignored.join(", ")}).` : "No destination transaction reference to verify.") : "Approved minimum output or destination asset is unknown; delivery cannot be verified."), ok: true };
    }

    let total = 0n, allFinal = true, rpcError: string | undefined;
    const conflicts: string[] = [], notes: string[] = [];
    for (const hash of hashes) {
      const v = await this.d.tracking.registerDestinationTx({
        id: newId("dvf"), executionId: row.id, network: row.destinationNetwork, txHash: hash, recipient: row.recipient, assetId: asset.id, tokenContract: asset.contract,
      });
      if (v.executionId !== row.id) { conflicts.push(hash); continue; } // tampered or reused reference
      if (v.outcome === "CONFIRMED") { total += BigInt(v.receivedAmount ?? "0"); continue; } // final; no RPC again
      let r: DeliveryResult;
      try {
        r = await verifyDelivery(this.d.rpc, net.family, { network: row.destinationNetwork, txHash: hash, recipient: row.recipient, kind: asset.contract ? "TOKEN" : "NATIVE", tokenContract: asset.contract });
      } catch (e) {
        rpcError = e instanceof RpcUnavailable ? e.message : `Chain check failed: ${(e as Error).message}`;
        await this.d.tracking.updateDestination(v.id, { outcome: v.outcome === "PENDING" ? "PENDING" : v.outcome, observed: { ...(v.observed as object), lastError: rpcError.slice(0, 300) } });
        allFinal = false;
        continue;
      }
      const now = this.now();
      await this.d.tracking.updateDestination(v.id, {
        outcome: r.outcome, receivedAmount: r.received, confirmations: r.confirmations, problems: r.problems, observed: r.observed,
        verifiedAt: r.outcome === "CONFIRMED" ? now : null,
      });
      if (r.outcome === "CONFIRMED") total += BigInt(r.received);
      if (!FINAL_OUTCOMES.has(r.outcome)) allFinal = false;
      if (r.problems.length) notes.push(`${hash.slice(0, 12)}: ${r.problems.join("; ")}`);
    }

    if (conflicts.length) return { row: await this.toUnknown(row, `Destination transaction already linked to another execution: ${conflicts.join(", ")}. Needs manual reconciliation.`), ok: true };
    if (rpcError) return { row: (await this.d.executions.get(row.id))!, ok: false, error: rpcError };
    if (!allFinal) return { row: (await this.d.executions.get(row.id))!, ok: true }; // pending: confirmations, finality, or unverifiable

    if (total >= min && total > 0n) {
      const now = this.now();
      const r = await this.d.executions.transition(row.id, "VERIFYING_DESTINATION", "COMPLETED",
        `Delivery verified on ${net.name}: recipient received ${total} (minimum ${min}).`,
        { amountOutVerified: total.toString(), destinationVerifiedAt: now }, { amountOutVerified: total.toString(), minAmountOut: min.toString(), txs: hashes, ...(ignored.length ? { ignoredNonChainReferences: ignored } : {}) });
      await this.d.audit?.record({ at: now.toISOString(), actor: "spak", event: "DESTINATION_VERIFIED", ref: row.id, data: { network: row.destinationNetwork, received: total.toString(), min: min.toString(), txs: hashes, ignored } });
      return { row: r ?? (await this.d.executions.get(row.id))!, ok: true };
    }
    const why = total > 0n
      ? `Recipient received ${total}, below the approved minimum ${min}.`
      : `Destination transactions show no delivery of the approved asset to the recipient.${notes.length ? ` ${notes.join(" | ")}` : ""}`;
    return { row: await this.toUnknown(row, `${why} Needs manual reconciliation.`), ok: true };
  }

  /** Final answer that is not a verified delivery: UNKNOWN, marked for manual reconciliation, never FAILED. */
  private async toUnknown(row: ExecutionRow, reason: string) {
    const error = { code: "NEEDS_RECONCILIATION", reason: reason.slice(0, 1000), destinationTxHashes: row.destinationTxHashes };
    const r = await this.d.executions.transition(row.id, row.state as "VERIFYING_DESTINATION", "UNKNOWN", reason.slice(0, 1000), { lastStatusError: reason.slice(0, 500), error });
    await this.d.audit?.record({ at: this.now().toISOString(), actor: "spak", event: "DESTINATION_UNVERIFIED", ref: row.id, data: { reason } });
    return r ?? (await this.d.executions.get(row.id))!;
  }
}
