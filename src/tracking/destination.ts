import type { AuditLog } from "../execution/audit";
import { newId } from "../execution/quote-service";
import type { ExecutionRecords, ExecutionRow } from "../execution/records";
import { RpcUnavailable, type ChainRpc } from "../deposits/rpc";
import { getAsset } from "../spak-in/registries/assets";
import { getNetwork } from "../spak-in/registries/networks";
import { txChainFacts } from "../failures/chain-facts";
import type { TrackingRecords } from "./records";
import type { DeliveryResult } from "./types";
import { verifyDelivery } from "./verifiers";
import { canonicalSender, trustedSendersFromEnv, type TrustedSenders } from "./route-trust";

/** Evidence version. Records verified before execution binding existed (version 1) are re-checked, never trusted. */
export const DESTINATION_EVIDENCE_VERSION = 2;

/**
 * Terminal outcomes a record can reach. CONFIRMED is the only one that counts toward delivery.
 * - UNTRUSTED_SENDER: the transfer is real, but not from a sender SPak can bind to the route.
 * - BEFORE_DEPOSIT: the transfer happened before the source deposit, so it cannot be this execution's payout.
 * - NOT_DESTINATION_CHAIN: a provider reference that cannot be a transaction on the destination chain (A-3).
 */
export const FINAL_OUTCOMES = new Set(["CONFIRMED", "FAILED", "NO_TRANSFER", "UNTRUSTED_SENDER", "BEFORE_DEPOSIT", "NOT_DESTINATION_CHAIN"]);
export const NOT_DESTINATION_CHAIN = "NOT_DESTINATION_CHAIN";

/** References that can be a transaction on a network of this family. Only EVM hashes are unambiguous. */
export function isDestinationReference(family: string | undefined, ref: string): boolean {
  return family !== "evm" || /^0x[0-9a-fA-F]{64}$/.test(ref);
}

type Anchor = { ok: true; time: number; txHash: string; depositId: string } | { ok: false; final: boolean; reason: string };

/**
 * Destination verification. COMPLETED is assigned here only. A destination transfer counts for an execution only when
 * SPak itself reads it on the destination chain and finds all of:
 * - a successful transaction on the expected chain, final by SPak's confirmation rules;
 * - transfers of the exact approved asset to the approved recipient;
 * - sent by a sender that trusted route evidence lists for that network (see route-trust.ts);
 * - in a block no earlier than the block of this execution's own confirmed source deposit;
 * - not already linked to another execution (unique per network and hash).
 * The counted total must reach the approved minimum. The provider's SUCCESS only says where to look. When the facts
 * cannot be established the execution stays pending or goes to manual reconciliation (UNKNOWN), never COMPLETED.
 */
export class DestinationVerifier {
  private readonly trusted: TrustedSenders;
  constructor(private readonly d: { executions: ExecutionRecords; tracking: TrackingRecords; rpc: ChainRpc; audit?: AuditLog; clock?: () => Date; trustedSenders?: TrustedSenders }) {
    this.trusted = d.trustedSenders ?? trustedSendersFromEnv();
  }
  private now() { return (this.d.clock ?? (() => new Date()))(); }

  /**
   * A-3: references a provider listed that cannot be destination-chain transactions. Existing records for them
   * (created before this rule) are moved, through the normal update path, to NOT_DESTINATION_CHAIN with the reason.
   * Idempotent, never deletes, never touches the execution's state or amounts. Safe in any execution state.
   */
  async classifyReferences(row: ExecutionRow): Promise<string[]> {
    const net = getNetwork(row.destinationNetwork);
    const ignored = ((row.destinationTxHashes as string[]) ?? []).filter((h) => !isDestinationReference(net?.family, h));
    if (!ignored.length) return ignored;
    for (const rec of await this.d.tracking.destinationsFor(row.id)) {
      if (!ignored.includes(rec.txHash) || rec.outcome === NOT_DESTINATION_CHAIN) continue;
      await this.d.tracking.updateDestination(rec.id, {
        outcome: NOT_DESTINATION_CHAIN, receivedAmount: null,
        problems: [`Provider reference, not a transaction on ${net?.name ?? row.destinationNetwork}: it is not a 32-byte 0x hash. Kept for audit; never counted as delivery.`],
        observed: { ...(rec.observed as object), reclassifiedAt: this.now().toISOString(), previousOutcome: rec.outcome },
      });
    }
    return ignored;
  }

  /** The time of this execution's own confirmed source deposit, read from the source chain. */
  private async anchor(row: ExecutionRow): Promise<Anchor> {
    const dep = await this.d.executions.confirmedDeposit(row.id);
    if (!dep?.txHash) return { ok: false, final: true, reason: "No confirmed source deposit is recorded for this execution, so a destination transfer cannot be bound to it." };
    const fam = getNetwork(row.sourceNetwork)?.family;
    if (!fam) return { ok: false, final: true, reason: `Unknown source network ${row.sourceNetwork}.` };
    try {
      const f = await txChainFacts(this.d.rpc, fam, row.sourceNetwork, dep.txHash, [dep.sender]);
      if (!f.timestamp) return { ok: false, final: false, reason: "The source deposit's block time could not be read yet." };
      return { ok: true, time: Math.floor(f.timestamp.getTime() / 1000), txHash: dep.txHash, depositId: dep.id };
    } catch (e) {
      return { ok: false, final: false, reason: e instanceof RpcUnavailable ? e.message : `Source chain check failed: ${(e as Error).message}` };
    }
  }

  async verify(row: ExecutionRow): Promise<{ row: ExecutionRow; ok: boolean; error?: string }> {
    if (row.state !== "VERIFYING_DESTINATION") return { row, ok: true };
    const net = getNetwork(row.destinationNetwork), asset = getAsset(row.destinationAssetId);
    const ignored = await this.classifyReferences(row);
    const hashes = [...new Set(((row.destinationTxHashes as string[]) ?? []).filter((h) => !ignored.includes(h)))];
    const firm = row.firmQuoteId ? await this.d.executions.getQuote(row.firmQuoteId) : null;
    const min = firm?.minAmountOut && /^\d+$/.test(firm.minAmountOut) ? BigInt(firm.minAmountOut) : null;
    if (!net || !asset || !hashes.length || min === null) {
      // Fail closed: without the approved minimum, a known asset or a usable reference, delivery cannot be proven.
      return { row: await this.toUnknown(row, !hashes.length
        ? (ignored.length ? `No ${net?.name ?? "destination"} transaction among the provider's references (${ignored.join(", ")}).` : "No destination transaction reference to verify.")
        : "Approved minimum output or destination asset is unknown; delivery cannot be verified."), ok: true };
    }
    const anchor = await this.anchor(row);
    if (!anchor.ok) {
      if (anchor.final) return { row: await this.toUnknown(row, `${anchor.reason} Needs manual reconciliation.`), ok: true };
      await this.d.executions.touch(row.id, { lastStatusError: anchor.reason.slice(0, 500) });
      return { row: (await this.d.executions.get(row.id))!, ok: false, error: anchor.reason };
    }
    const trusted = new Set(this.trusted(row.destinationNetwork).map((a) => canonicalSender(row.destinationNetwork, a)));

    let total = 0n, allFinal = true, rpcError: string | undefined;
    const conflicts: string[] = [], notes: string[] = [];
    for (const hash of hashes) {
      const v = await this.d.tracking.registerDestinationTx({
        id: newId("dvf"), executionId: row.id, network: row.destinationNetwork, txHash: hash, recipient: row.recipient, assetId: asset.id, tokenContract: asset.contract,
      });
      if (v.executionId !== row.id) { conflicts.push(hash); continue; } // reused evidence: belongs to another execution
      const prev = v.observed as { evidenceVersion?: number } | null;
      if (FINAL_OUTCOMES.has(v.outcome) && prev?.evidenceVersion === DESTINATION_EVIDENCE_VERSION) {
        if (v.outcome === "CONFIRMED") total += BigInt(v.receivedAmount ?? "0"); // bound and final; no RPC again
        continue;
      }
      let r: DeliveryResult;
      try {
        r = await verifyDelivery(this.d.rpc, net.family, { network: row.destinationNetwork, txHash: hash, recipient: row.recipient, kind: asset.contract ? "TOKEN" : "NATIVE", tokenContract: asset.contract, chainId: net.chainId ? Number(net.chainId) : null });
      } catch (e) {
        rpcError = e instanceof RpcUnavailable ? e.message : `Chain check failed: ${(e as Error).message}`;
        await this.d.tracking.updateDestination(v.id, { outcome: v.outcome === "PENDING" ? "PENDING" : v.outcome, observed: { ...(v.observed as object), lastError: rpcError.slice(0, 300) } });
        allFinal = false;
        continue;
      }
      const bound = bind(r, anchor.time, trusted, row.destinationNetwork, net.name);
      const now = this.now();
      await this.d.tracking.updateDestination(v.id, {
        outcome: bound.outcome, receivedAmount: bound.outcome === "CONFIRMED" ? bound.counted.toString() : (r.received === "0" ? null : r.received),
        confirmations: r.confirmations, problems: bound.problems,
        observed: { ...r.observed, evidenceVersion: DESTINATION_EVIDENCE_VERSION, transfers: r.transfers ?? [], blockTime: r.blockTime ?? null,
          source: { depositId: anchor.depositId, txHash: anchor.txHash, blockTime: anchor.time }, quoteId: row.firmQuoteId, trustedSenders: [...trusted] },
        verifiedAt: bound.outcome === "CONFIRMED" ? now : null,
      });
      if (bound.outcome === "CONFIRMED") total += bound.counted;
      if (!FINAL_OUTCOMES.has(bound.outcome)) allFinal = false;
      if (bound.problems.length) notes.push(`${hash.slice(0, 12)}: ${bound.problems.join("; ")}`);
    }

    if (conflicts.length) return { row: await this.toUnknown(row, `Destination transaction already linked to another execution: ${conflicts.join(", ")}. Needs manual reconciliation.`), ok: true };
    if (rpcError) return { row: (await this.d.executions.get(row.id))!, ok: false, error: rpcError };
    if (!allFinal) return { row: (await this.d.executions.get(row.id))!, ok: true }; // pending: confirmations, finality, or block time

    if (total >= min && total > 0n) {
      const now = this.now();
      const r = await this.d.executions.transition(row.id, "VERIFYING_DESTINATION", "COMPLETED",
        `Delivery verified on ${net.name}: recipient received ${total} (minimum ${min}).`,
        { amountOutVerified: total.toString(), destinationVerifiedAt: now },
        { amountOutVerified: total.toString(), minAmountOut: min.toString(), txs: hashes, sourceDeposit: anchor.txHash, evidenceVersion: DESTINATION_EVIDENCE_VERSION, ...(ignored.length ? { ignoredNonChainReferences: ignored } : {}) });
      await this.d.audit?.record({ at: now.toISOString(), actor: "spak", event: "DESTINATION_VERIFIED", ref: row.id, data: { network: row.destinationNetwork, received: total.toString(), min: min.toString(), txs: hashes, ignored, sourceDeposit: anchor.txHash } });
      return { row: r ?? (await this.d.executions.get(row.id))!, ok: true };
    }
    const why = total > 0n
      ? `Recipient received ${total} in verified route transfers, below the approved minimum ${min}.`
      : `Destination transactions show no verified delivery of the approved asset to the recipient.${notes.length ? ` ${notes.join(" | ")}` : ""}`;
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

/**
 * Pure: bind one chain result to this execution. Only a chain-CONFIRMED result can count, and only its transfers from
 * trusted senders, in a block at or after the source deposit's block. Missing facts keep it pending, never counted.
 */
export function bind(r: DeliveryResult, sourceTime: number, trusted: Set<string>, network: string, networkName: string): { outcome: string; counted: bigint; problems: string[] } {
  if (r.outcome !== "CONFIRMED") return { outcome: r.outcome, counted: 0n, problems: r.problems };
  if (r.blockTime == null || !Number.isFinite(r.blockTime)) return { outcome: "PENDING", counted: 0n, problems: ["the destination block time could not be read, so the transfer cannot be ordered after the deposit"] };
  if (r.blockTime < sourceTime) {
    return { outcome: "BEFORE_DEPOSIT", counted: 0n, problems: [`the transfer is from ${new Date(r.blockTime * 1000).toISOString()}, before this execution's source deposit (${new Date(sourceTime * 1000).toISOString()})`] };
  }
  if (!trusted.size) {
    return { outcome: "UNTRUSTED_SENDER", counted: 0n, problems: [`no trusted route sender is configured for ${networkName}, so SPak cannot bind this payout to the route; manual review`] };
  }
  const transfers = r.transfers ?? [];
  const good = transfers.filter((t) => trusted.has(canonicalSender(network, t.from)));
  const bad = transfers.filter((t) => !trusted.has(canonicalSender(network, t.from)));
  const counted = good.reduce((s, t) => s + BigInt(t.amount), 0n);
  const problems = bad.length ? [`ignored ${bad.length} transfer(s) from untrusted sender(s) ${[...new Set(bad.map((t) => t.from))].join(", ")}`] : [];
  if (counted === 0n) return { outcome: "UNTRUSTED_SENDER", counted: 0n, problems: problems.length ? problems : ["no transfer from a trusted route sender"] };
  return { outcome: "CONFIRMED", counted, problems };
}
