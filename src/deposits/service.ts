import type { GuardService } from "../guard/service";
import { sourceProblem } from "../execution/v1-scope";
import type { OneClickClient } from "../integrations/near-intents/client";
import { getAsset } from "../spak-in/registries/assets";
import { getNetwork } from "../spak-in/registries/networks";
import type { AuditLog } from "../execution/audit";
import { ExecutionError } from "../execution/errors";
import type { VerifiedWallet } from "../execution/plan-validator";
import { newId } from "../execution/quote-service";
import type { ExecutionRecords, ExecutionRow } from "../execution/records";
import type { ExecutionService } from "../execution/service";
import { buildDepositTransaction, depositKind, senderBalance, type DepositInput, type DepositTransaction } from "./builder";
import { DepositRecords, DuplicateTxError, type DepositRow } from "./records";
import { RpcUnavailable, type ChainRpc } from "./rpc";
import { DEPOSIT_LIVE, type DepositExpectation, type DepositState } from "./types";
import { verifyDeposit } from "./verifiers";

/** Minimum time between chain checks for one deposit. */
export const MIN_VERIFY_INTERVAL_MS = 4_000;

const TX_FORMAT: Record<string, RegExp> = {
  evm: /^0x[0-9a-fA-F]{64}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{64,90}$/,
  near: /^[1-9A-HJ-NP-Za-km-z]{43,44}$/,
};

export interface DepositDeps {
  records: DepositRecords;
  executions: ExecutionRecords;
  executionService: ExecutionService;
  rpc: ChainRpc;
  client: OneClickClient;
  audit?: AuditLog;
  clock?: () => Date;
  /** SPak Guard. Required: deposit instructions are never prepared without a Guard check. */
  guard: GuardService;
}

/**
 * Deposit flow for an approved execution: prepare the exact transaction, record the wallet's transaction reference,
 * and verify it on the source chain. Deposit states are separate from execution states: a confirmed deposit does not
 * mean the cross-chain transfer finished. SPak never signs; the user's wallet does.
 */
export class DepositService {
  private readonly clock: () => Date;
  constructor(private readonly d: DepositDeps) { this.clock = d.clock ?? (() => new Date()); }

  private async approvedExecution(userId: string, executionId: string, wallets: VerifiedWallet[], checkGuard = true) {
    const ex = await this.d.executions.getForUser(executionId, userId);
    if (!ex) throw new ExecutionError("EXECUTION_NOT_FOUND", "No such execution.");
    if (ex.state !== "AWAITING_DEPOSIT") throw new ExecutionError("DEPOSIT_NOT_ALLOWED", `This execution is ${ex.state.toLowerCase().replaceAll("_", " ")}; it does not accept a deposit.`);
    const approval = await this.d.executions.activeApproval(ex.id);
    if (!approval || approval.quoteId !== ex.firmQuoteId || approval.planHash !== ex.planHash || approval.planRevision !== ex.planRevision) {
      throw new ExecutionError("APPROVAL_REQUIRED", "This execution has no valid approval for its current quote.");
    }
    const quote = ex.firmQuoteId ? await this.d.executions.getQuote(ex.firmQuoteId) : null;
    if (!quote || quote.kind !== "FIRM" || quote.status !== "VALID" || quote.depositAddress !== ex.depositAddress || quote.amountIn !== ex.amountIn) {
      throw new ExecutionError("APPROVAL_MISMATCH", "The approved quote no longer matches this execution.");
    }
    if (!ex.depositDeadline || ex.depositDeadline.getTime() <= this.clock().getTime()) throw new ExecutionError("DEPOSIT_EXPIRED", "The deposit deadline has passed. Start a new transaction.");
    // The sender is the refund wallet, which the user proved they own and which must still be verified and enabled.
    const fam = getNetwork(ex.sourceNetwork)?.family;
    const ok = wallets.some((w) => w.family === fam && w.networks.some((n) => n.id === ex.sourceNetwork && n.enabled)
      && (fam === "solana" ? w.address === ex.refundAddress : w.address.toLowerCase() === ex.refundAddress.toLowerCase()));
    if (!ok) throw new ExecutionError("WALLET_NOT_VERIFIED", "The wallet that must send this deposit is no longer verified on the source network.");
    // Guard: emergency controls, disabled networks and a live spending reservation.
    if (checkGuard) await this.d.guard.enforceDeposit(ex, quote);
    return { ex, approval, quote };
  }

  private input(ex: ExecutionRow): DepositInput {
    const a = getAsset(ex.sourceAssetId);
    if (!a) throw new ExecutionError("UNSUPPORTED_ASSET", `Unknown asset ${ex.sourceAssetId}.`);
    return { network: ex.sourceNetwork, assetId: a.id, symbol: a.symbol, decimals: a.decimals, contract: a.contract, depositAddress: ex.depositAddress!, depositMemo: ex.depositMemo, amount: ex.amountIn, sender: ex.refundAddress };
  }

  /**
   * Prepare the deposit transaction for the user's wallet. Reuses the open attempt for the execution; refuses when
   * a deposit was already submitted (no double funding). Checks the sender's balance first.
   */
  async prepare(args: { userId: string; executionId: string; wallets: VerifiedWallet[] }): Promise<{ deposit: DepositRow; transaction: DepositTransaction; balance: { balance: string | null; sufficient: boolean | null } }> {
    const { ex, approval, quote } = await this.approvedExecution(args.userId, args.executionId, args.wallets);
    // V1 scope: no new deposit instructions from a source SPak has not validated (NEAR is manual and unvalidated).
    const scope = sourceProblem(ex.sourceNetwork);
    if (scope) throw new ExecutionError(scope.code, scope.message);
    const live = await this.d.records.inStates(ex.id, [...DEPOSIT_LIVE]);
    if (live.length) throw new ExecutionError("DEPOSIT_IN_PROGRESS", "A deposit for this execution was already submitted.", { depositId: live[0].id });
    // Resolve the asset again against the live provider listing: the token contract must still match.
    await this.d.executionService.resolver.resolve(ex.sourceAssetId, ex.sourceNetwork);
    const input = this.input(ex);
    let transaction: DepositTransaction;
    try { transaction = await buildDepositTransaction(this.d.rpc, input); }
    catch (e) { if (e instanceof RpcUnavailable) throw new ExecutionError("CHAIN_UNAVAILABLE", e.message); throw e; }
    const balance = await senderBalance(this.d.rpc, input);
    if (balance.sufficient === false) {
      throw new ExecutionError("INSUFFICIENT_BALANCE", `Your wallet holds ${balance.balance} base units of ${input.symbol}; this deposit needs ${input.amount}.`, { balance: balance.balance, required: input.amount });
    }
    const now = this.clock();
    const family = getNetwork(ex.sourceNetwork)!.family as "evm" | "solana" | "near";
    const [open] = await this.d.records.inStates(ex.id, ["WALLET_CONFIRMATION_REQUESTED"]);
    const deposit = open ?? await this.d.records.insert({
      id: newId("dep"), executionId: ex.id, userId: args.userId, quoteId: quote.id, approvalId: approval.id, family, network: ex.sourceNetwork,
      kind: depositKind(family, input.contract), assetId: input.assetId, tokenContract: input.contract, depositAddress: input.depositAddress,
      depositMemo: input.depositMemo, amount: input.amount, sender: input.sender, method: family === "near" ? "MANUAL" : "WALLET",
      state: "WALLET_CONFIRMATION_REQUESTED", createdAt: now, updatedAt: now,
    });
    await this.d.audit?.record({ at: now.toISOString(), actor: `user:${args.userId}`, event: "DEPOSIT_PREPARED", ref: deposit.id, data: { executionId: ex.id, kind: deposit.kind, network: deposit.network, amount: deposit.amount, depositAddress: deposit.depositAddress } });
    return { deposit, transaction, balance };
  }

  /** The user's wallet returned a transaction reference. Record it (once, globally) and verify on chain. */
  async submit(args: { userId: string; depositId: string; txHash: string }) {
    const dep = await this.d.records.getForUser(args.depositId, args.userId);
    if (!dep) throw new ExecutionError("DEPOSIT_NOT_FOUND", "No such deposit.");
    const txHash = args.txHash.trim();
    if (!TX_FORMAT[dep.family]?.test(txHash)) throw new ExecutionError("INVALID_TX_REFERENCE", `That is not a valid ${dep.family} transaction reference.`);
    if (dep.txHash) {
      if (dep.txHash === txHash) return this.verify({ userId: args.userId, depositId: dep.id });
      throw new ExecutionError("DUPLICATE_TX", "This deposit already has a different transaction.");
    }
    if (dep.state !== "WALLET_CONFIRMATION_REQUESTED") throw new ExecutionError("DEPOSIT_NOT_ALLOWED", `This deposit is ${dep.state.toLowerCase().replaceAll("_", " ")}.`);
    const used = await this.d.records.byTx(dep.network, txHash);
    if (used) throw new ExecutionError("DUPLICATE_TX", "That transaction is already linked to a deposit.");
    let r: DepositRow | null;
    try {
      r = await this.d.records.transition(dep.id, "WALLET_CONFIRMATION_REQUESTED", "SUBMITTED", "Transaction reference received from the wallet. Not yet verified.", { txHash, submittedAt: this.clock() });
    } catch (e) {
      if (e instanceof DuplicateTxError) throw new ExecutionError("DUPLICATE_TX", "That transaction is already linked to a deposit.");
      throw e;
    }
    if (!r) throw new ExecutionError("DEPOSIT_IN_PROGRESS", "This deposit changed. Reload it.");
    await this.d.audit?.record({ at: this.clock().toISOString(), actor: `user:${args.userId}`, event: "DEPOSIT_SUBMITTED", ref: dep.id, data: { txHash, network: dep.network } });
    // Tell 1Click about the transaction so it is picked up faster. Best effort; it is not proof of anything.
    try {
      await this.d.client.submitDeposit({ txHash, depositAddress: dep.depositAddress, ...(dep.depositMemo ? { memo: dep.depositMemo } : {}), ...(dep.family === "near" ? { nearSenderAccount: dep.sender } : {}) });
      await this.d.records.touch(dep.id, { providerNotifiedAt: this.clock() });
    } catch { /* provider will still find the deposit on chain */ }
    return this.verify({ userId: args.userId, depositId: dep.id, force: true });
  }

  /** Manual deposits (NEAR, or a transfer sent outside SPak): create the record and submit in one step. */
  async submitManual(args: { userId: string; executionId: string; txHash: string; wallets: VerifiedWallet[] }) {
    const { deposit } = await this.prepare({ userId: args.userId, executionId: args.executionId, wallets: args.wallets }).catch(async (e) => {
      // Insufficient balance after sending is expected for manual deposits: the funds already left the wallet.
      if (e instanceof ExecutionError && e.code === "INSUFFICIENT_BALANCE") return this.prepareWithoutBalance(args);
      // The user says the deposit was already broadcast. Guard stops SPak giving new deposit instructions, never the
      // recording of funds that already left the wallet: those must be tracked, verified and, if needed, refunded.
      if (e instanceof ExecutionError && (e.code === "GUARD_BLOCKED" || e.code === "GUARD_NEEDS_CONFIGURATION" || e.code === "V1_SOURCE_NOT_SUPPORTED")) return this.prepareWithoutBalance(args, false);
      throw e;
    });
    await this.d.records.touch(deposit.id, { method: "MANUAL" });
    return this.submit({ userId: args.userId, depositId: deposit.id, txHash: args.txHash });
  }

  private async prepareWithoutBalance(args: { userId: string; executionId: string; wallets: VerifiedWallet[] }, checkGuard = true) {
    const { ex, approval, quote } = await this.approvedExecution(args.userId, args.executionId, args.wallets, checkGuard);
    const [open] = await this.d.records.inStates(ex.id, ["WALLET_CONFIRMATION_REQUESTED"]);
    if (open) return { deposit: open };
    const input = this.input(ex);
    const now = this.clock();
    const family = getNetwork(ex.sourceNetwork)!.family as "evm" | "solana" | "near";
    return { deposit: await this.d.records.insert({
      id: newId("dep"), executionId: ex.id, userId: args.userId, quoteId: quote.id, approvalId: approval.id, family, network: ex.sourceNetwork,
      kind: depositKind(family, input.contract), assetId: input.assetId, tokenContract: input.contract, depositAddress: input.depositAddress,
      depositMemo: input.depositMemo, amount: input.amount, sender: input.sender, method: "MANUAL", state: "WALLET_CONFIRMATION_REQUESTED", createdAt: now, updatedAt: now,
    }) };
  }

  /** The user rejected the request in the wallet, or the wallet failed before broadcasting. */
  async walletRejected(args: { userId: string; depositId: string; reason: string }) {
    const dep = await this.d.records.getForUser(args.depositId, args.userId);
    if (!dep) throw new ExecutionError("DEPOSIT_NOT_FOUND", "No such deposit.");
    if (dep.state !== "WALLET_CONFIRMATION_REQUESTED") return dep;
    return (await this.d.records.transition(dep.id, "WALLET_CONFIRMATION_REQUESTED", "REJECTED", `Wallet: ${args.reason.slice(0, 200)}`, { reason: args.reason.slice(0, 200) })) ?? dep;
  }

  /**
   * Check the source chain. CONFIRMED only when the chain shows the exact transfer with enough confirmations.
   * Unreadable chains or unconfirmed transactions stay pending; nothing is assumed.
   */
  async verify(args: { userId: string; depositId: string; force?: boolean }) {
    const dep = await this.d.records.getForUser(args.depositId, args.userId);
    if (!dep) throw new ExecutionError("DEPOSIT_NOT_FOUND", "No such deposit.");
    const now = this.clock();
    if (!dep.txHash || !["SUBMITTED", "VERIFICATION_PENDING"].includes(dep.state)) return dep;
    if (!args.force && dep.lastCheckedAt && now.getTime() - dep.lastCheckedAt.getTime() < MIN_VERIFY_INTERVAL_MS) return dep;
    const ex = (await this.d.executions.get(dep.executionId))!;
    const net = getNetwork(dep.network)!;
    const expect: DepositExpectation = {
      network: dep.network, kind: dep.kind as DepositExpectation["kind"], txHash: dep.txHash, sender: dep.sender, depositAddress: dep.depositAddress,
      amount: dep.amount, tokenContract: dep.tokenContract, chainId: net.chainId ? Number(net.chainId) : null, decimals: getAsset(dep.assetId)?.decimals ?? 0,
    };
    let result;
    try {
      result = await verifyDeposit(this.d.rpc, dep.family as "evm" | "solana" | "near", expect);
    } catch (e) {
      const msg = e instanceof RpcUnavailable ? e.message : `Chain check failed: ${(e as Error).message}`;
      const from = dep.state as DepositState;
      return (await this.d.records.transition(dep.id, from, "VERIFICATION_PENDING", "Could not read the chain; will retry.", { lastCheckedAt: now, reason: msg.slice(0, 300) })) ?? dep;
    }
    const from = dep.state as DepositState;
    const base = { lastCheckedAt: now, confirmations: result.confirmations, verification: { ...result, checkedAt: now.toISOString() } };
    const deadlinePassed = !!ex.depositDeadline && ex.depositDeadline.getTime() < now.getTime();
    let next: DepositRow | null;
    switch (result.outcome) {
      case "CONFIRMED":
        next = await this.d.records.transition(dep.id, from, "CONFIRMED", "Source-chain deposit verified.", { ...base, verifiedAt: now, reason: null });
        await this.d.audit?.record({ at: now.toISOString(), actor: "spak", event: "DEPOSIT_CONFIRMED", ref: dep.id, data: { txHash: dep.txHash, confirmations: result.confirmations } });
        // Ask NEAR Intents now; the execution moves only on the provider's own status.
        await this.d.executionService.refresh({ userId: dep.userId, executionId: dep.executionId }).catch(() => undefined);
        await this.noteProviderRecognition(dep.id, dep.executionId);
        break;
      case "MISMATCH":
        next = await this.d.records.transition(dep.id, from, "REJECTED", `Transaction does not match the deposit: ${result.problems.join("; ")}.`, { ...base, reason: result.problems.join("; ").slice(0, 500) });
        await this.d.audit?.record({ at: now.toISOString(), actor: "spak", event: "DEPOSIT_REJECTED", ref: dep.id, data: { txHash: dep.txHash, problems: result.problems } });
        break;
      case "FAILED":
        next = await this.d.records.transition(dep.id, from, "FAILED", "Transaction failed on chain.", { ...base, reason: result.problems.join("; ") });
        break;
      case "NOT_FOUND":
        next = deadlinePassed
          ? await this.d.records.transition(dep.id, from, "EXPIRED", "Transaction never appeared before the deposit deadline.", base)
          : await this.d.records.transition(dep.id, from, "VERIFICATION_PENDING", "Transaction not found on chain yet.", base);
        break;
      default:
        next = await this.d.records.transition(dep.id, from, "VERIFICATION_PENDING", `Waiting for confirmations${result.confirmations !== null ? ` (${result.confirmations})` : ""}.`, base);
    }
    return next ?? (await this.d.records.get(dep.id))!;
  }

  private async noteProviderRecognition(depositId: string, executionId: string) {
    const ex = await this.d.executions.get(executionId);
    const dep = await this.d.records.get(depositId);
    if (ex && dep?.txHash && (ex.originTxHashes as string[]).some((h) => h.toLowerCase() === dep.txHash!.toLowerCase())) {
      await this.d.records.touch(depositId, { providerRecognizedAt: this.clock() });
    }
  }

  async get(userId: string, id: string) {
    const r = await this.d.records.getForUser(id, userId);
    if (!r) throw new ExecutionError("DEPOSIT_NOT_FOUND", "No such deposit.");
    if (r.state !== "CONFIRMED" && r.txHash) await this.noteProviderRecognition(r.id, r.executionId);
    return toDepositView((await this.d.records.get(id))!, await this.d.records.events(id));
  }
  async list(userId: string, opts: { limit: number; executionId?: string }) {
    if (opts.executionId && !(await this.d.executions.getForUser(opts.executionId, userId))) throw new ExecutionError("EXECUTION_NOT_FOUND", "No such execution.");
    return (await this.d.records.list(userId, opts)).map((r) => toDepositView(r, []));
  }
}

export function toDepositView(r: DepositRow, events: { at: Date; fromState: string | null; toState: string; reason: string }[]) {
  return {
    id: r.id, executionId: r.executionId, quoteId: r.quoteId, approvalId: r.approvalId, state: r.state, method: r.method,
    family: r.family, network: r.network, kind: r.kind, assetId: r.assetId, tokenContract: r.tokenContract,
    depositAddress: r.depositAddress, depositMemo: r.depositMemo, amount: r.amount, sender: r.sender,
    txHash: r.txHash, confirmations: r.confirmations, reason: r.reason,
    providerNotifiedAt: r.providerNotifiedAt?.toISOString() ?? null, providerRecognizedAt: r.providerRecognizedAt?.toISOString() ?? null,
    submittedAt: r.submittedAt?.toISOString() ?? null, verifiedAt: r.verifiedAt?.toISOString() ?? null, lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
    events: events.map((e) => ({ at: e.at.toISOString(), from: e.fromState, to: e.toState, reason: e.reason })),
    createdAt: r.createdAt.toISOString(),
  };
}
export type DepositView = ReturnType<typeof toDepositView>;
