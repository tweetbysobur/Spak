/**
 * SPak Payments, one-time payments. A payment is a transfer to someone else's address (recipient kind EXTERNAL),
 * run through the same SPak-in, Guard, Execution, deposit and tracking path as every transfer. No payment engine.
 * Real SQL (PGlite or PostgreSQL 16); MOCKED NEAR Intents provider and chains (Fake1Click, FakeChain).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { base64, hex } from "@scure/base";
import type { ExecutionError } from "@/execution";
import { agents } from "@/database/schema";
import { OWNERSHIP_VALID_MS } from "@/agents/service";
import { buildReceipt } from "@/tracking/receipt";
import { approval, harness } from "../execution/harness";
import { statusPayload } from "../execution/fake-1click";
import { nearWallet } from "../auth/keys";

const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const VAULT = "0x2e6ad9e6d59bb4585ea0e6762c3b637dde29dad2";
const PAYEE = "0x1111111111111111111111111111111111111111";
const OTHER = "0x3333333333333333333333333333333333333333";

let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
let n = 0;
beforeEach(async () => { h = await harness(); u = await h.newUser(); h.chain.setBalance("base", u.evm.address, 1_000_000_000n, USDC_BASE); });
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as ExecutionError).code ?? (e as Error).message; } };
const pay = (amount = 50, to = PAYEE) => `Pay ${amount} USDC from Base to ${to} on Arbitrum`;

async function created(text = pay(), key = `k-${++n}-${Math.random()}`, agentId: string | null = null) {
  const r = await u.plan(text);
  expect(r.status, JSON.stringify(r.clarifications ?? r.errors)).toBe("VALIDATED");
  const wallets = await u.wallets();
  return h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: key, wallets, agentId });
}
async function approved(text = pay()) {
  const x = await created(text);
  const wallets = await u.wallets();
  const f = await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets });
  const a = await h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: f.quote.id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets });
  return a;
}
/** Approve, sign and confirm the deposit (the user's wallet), then have NEAR Intents report SUCCESS with a payout tx. */
async function paidAndReported(o: { payoutTo?: string; amount?: bigint } = {}) {
  const a = await approved();
  const ex = a.execution;
  const wallets = await u.wallets();
  const p = await h.deposits.prepare({ userId: u.userId, executionId: ex.id, wallets });
  const tx = `0x${(++n).toString(16).padStart(64, "d")}`;
  h.chain.evmTx(tx, { network: "base", from: u.evm.address, to: USDC_BASE, logs: [{ address: USDC_BASE, from: u.evm.address, to: ex.depositAddress!, amount: BigInt(ex.amountIn) }] });
  expect((await h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: tx })).state).toBe("CONFIRMED");
  const min = BigInt((await h.records.getQuote(ex.firmQuoteId!))!.minAmountOut!);
  const out = `0x${(++n).toString(16).padStart(64, "e")}`;
  h.chain.evmTx(out, { network: "arbitrum", from: "0x55f2c8044d790e1b8369508c31c756c0c2ca0e93", to: VAULT, logs: [{ address: USDC_ARB, from: VAULT, to: o.payoutTo ?? PAYEE, amount: o.amount ?? min }] });
  h.fake.statuses.set(ex.depositAddress!, statusPayload("SUCCESS", { amountOut: String(o.amount ?? min), destinationChainTxHashes: [{ hash: out, explorerUrl: "x" }] }, a.quote!.providerSignature!));
  return { ex, depositTx: tx, payoutTx: out, min };
}
const monitor = async () => { for (let i = 0; i < 3; i++) { h.clock.now += 60_000; await h.monitor.run({ trigger: "test" }); } };
const receiptOf = async (id: string) => buildReceipt(await h.svc.details(id, u.userId), await h.trackingService.view(u.userId, id), await h.svc.approvalFor(id, u.userId));

describe("creating a payment", () => {
  it("plain words: amount, token, source, recipient and destination network become one validated PAYMENT plan", async () => {
    const r = await u.plan(pay());
    expect(r).toMatchObject({ status: "VALIDATED", intentType: "PAYMENT", recipient: { address: PAYEE, network: "arbitrum", kind: "EXTERNAL" } });
    expect(r.source?.asset?.id).toBe(`base:${USDC_BASE}`);
    expect(r.destination?.asset?.id).toBe(`arbitrum:${USDC_ARB}`);
  });
  it("a NEAR or Solana payee with no network named: SPak asks, offering only the network that fits; an EVM payee is paid on the source network, stated as an assumption", async () => {
    const near = await u.plan("Send 20 USDC on Base to alice.near");
    expect(near.status).toBe("NEEDS_CLARIFICATION");
    expect(near.clarifications.find((c) => c.field === "destination.network")?.options).toEqual(["near"]);
    expect((await u.plan("Send 20 USDC on Base to alice.near on NEAR"))).toMatchObject({ status: "VALIDATED", recipient: { address: "alice.near", network: "near" } });
    const evm = await u.plan(`Pay 5 USDC from Base to ${PAYEE}`);
    expect(evm).toMatchObject({ status: "VALIDATED", recipient: { network: "base" } });
    expect(evm.assumptions.join(" ")).toMatch(/Paying on Base/);
    const unsure = await u.plan(`Pay 5 USDC to ${PAYEE}`);
    expect(unsure.status).toBe("NEEDS_CLARIFICATION");
    expect(unsure.clarifications.map((c) => c.field)).toContain("source.network");
  });
  it("unsupported or invalid: an address that does not fit the named network, a missing recipient, an unknown token", async () => {
    expect((await u.plan(`Pay 5 USDC from Base to ${PAYEE} on Solana`)).status).not.toBe("VALIDATED");
    expect((await u.plan("Pay 5 USDC from Base on Arbitrum")).status).not.toBe("VALIDATED");
    expect((await u.plan(`Pay 5 FOOCOIN from Base to ${PAYEE} on Arbitrum`)).status).not.toBe("VALIDATED");
  });
  it("the Manual form makes the same validated payment plan as the sentence", async () => {
    const r = await h.spakIn.interpretManual({ text: "", userId: u.userId, sessionId: `s-${Math.random()}`, wallets: await h.auth.walletContext(u.userId), now: h.now().toISOString(), mode: "MANUAL",
      intent: { type: "PAYMENT", sourceNetwork: "base", sourceAsset: `base:${USDC_BASE}`, amount: "50", destinationNetwork: "arbitrum", destinationAsset: `arbitrum:${USDC_ARB}`, recipient: PAYEE, slippageBps: 100 } } as never);
    expect(r).toMatchObject({ status: "VALIDATED", intentType: "PAYMENT", recipient: { address: PAYEE, network: "arbitrum", kind: "EXTERNAL" } });
    const words = await u.plan(pay());
    expect(r.plan!.legs).toEqual(words.plan!.legs);
  });
  it("same-chain payment (Base USDC to a Base address) is a valid plan", async () => {
    const r = await u.plan(`Pay 5 USDC from Base to ${PAYEE} on Base`);
    expect(r).toMatchObject({ status: "VALIDATED", intentType: "PAYMENT", recipient: { network: "base", kind: "EXTERNAL" } });
  });
});

describe("quote, approval, deposit and delivery", () => {
  it("the execution records the external recipient; the quote is signature-verified and names the recipient", async () => {
    const x = await created();
    expect(x.execution).toMatchObject({ recipient: PAYEE, recipientKind: "EXTERNAL", destinationNetwork: "arbitrum" });
    expect(x.quote!.providerSignature).toBeTruthy();
  });
  it("full payment: verified delivery to the payee completes it, and the receipt names payee, amounts, both transactions and the approval", async () => {
    const { ex, depositTx, payoutTx, min } = await paidAndReported();
    expect(await receiptOf(ex.id)).toBeNull(); // no receipt before SPak's own destination check
    await monitor();
    expect((await h.records.get(ex.id))!.state).toBe("COMPLETED");
    const r = (await receiptOf(ex.id))!;
    expect(r).toMatchObject({
      kind: "PAYMENT", status: "COMPLETED", executionId: ex.id,
      source: { network: "base", amount: ex.amountIn, amountFormatted: "50", transactions: [{ hash: depositTx }] },
      destination: { network: "arbitrum", recipient: PAYEE, recipientKind: "EXTERNAL", amountReceived: String(min), transactions: [{ hash: payoutTx }] },
      approval: { approvedBy: "USER", grantVersion: null }, verification: { method: "SPAK_DESTINATION_CHAIN_CHECK" },
    });
    expect(r.destination.transactions[0].explorerUrl).toMatch(/^https:\/\//);
  });
  it("a payout to a different address is never counted: not completed, no receipt", async () => {
    const { ex } = await paidAndReported({ payoutTo: OTHER });
    await monitor();
    expect((await h.records.get(ex.id))!.state).not.toBe("COMPLETED");
    expect(await receiptOf(ex.id)).toBeNull();
  });
  it("a payout below the approved minimum is not completed", async () => {
    const { ex, min } = await paidAndReported({ amount: 1n });
    expect(min > 1n).toBe(true);
    await monitor();
    expect((await h.records.get(ex.id))!.state).not.toBe("COMPLETED");
    expect(await receiptOf(ex.id)).toBeNull();
  });
});

describe("duplicates, expiry and failure", () => {
  it("the same idempotency key returns the same payment; the same payment again within minutes is held as a suspected duplicate", async () => {
    const r = await u.plan(pay(7));
    const wallets = await u.wallets();
    const a = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: "same-key", wallets });
    const b = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: "same-key", wallets });
    expect(b.execution.id).toBe(a.execution.id);
    const f = await h.svc.firmQuote({ userId: u.userId, executionId: a.execution.id, quoteId: a.quote!.id, wallets });
    await h.svc.approve({ userId: u.userId, executionId: a.execution.id, quoteId: f.quote.id, approval: approval(a.execution.planHash, h.now(), true, a.execution.planRevision), wallets });
    const again = await created(pay(7));
    const f2 = await h.svc.firmQuote({ userId: u.userId, executionId: again.execution.id, quoteId: again.quote!.id, wallets });
    const second = () => h.svc.approve({ userId: u.userId, executionId: again.execution.id, quoteId: f2.quote.id, approval: approval(again.execution.planHash, h.now(), false, again.execution.planRevision), wallets });
    expect(await code(second())).toBe("DUPLICATE_SUSPECTED");
    expect(await h.records.activeApproval(again.execution.id)).toBeNull();
  });
  it("a payment with no deposit before the deadline expires; no receipt", async () => {
    const a = await approved(pay(9));
    h.clock.now = a.execution.depositDeadline!.getTime() + 1000;
    expect((await h.svc.refresh({ userId: u.userId, executionId: a.execution.id })).state).toBe("EXPIRED");
    expect(await receiptOf(a.execution.id)).toBeNull();
  });
  it("a refunded payment has no receipt", async () => {
    const a = await approved(pay(11));
    h.fake.statuses.set(a.execution.depositAddress!, statusPayload("REFUNDED", { refundedAmount: a.execution.amountIn, refundReason: "TEST" }, a.quote!.providerSignature!));
    await h.svc.refresh({ userId: u.userId, executionId: a.execution.id });
    expect(await receiptOf(a.execution.id)).toBeNull();
  });
  it("another user can see neither the payment nor its approval", async () => {
    const a = await approved(pay(12));
    const other = await h.newUser();
    expect(await code(h.svc.details(a.execution.id, other.userId))).toBe("EXECUTION_NOT_FOUND");
    expect(await code(h.svc.approvalFor(a.execution.id, other.userId))).toBe("EXECUTION_NOT_FOUND");
  });
});

describe("Guard and Agent", () => {
  const settings = async () => (await h.guard.view(u.userId)).policy;
  it("Guard approved-recipients mode blocks a payment to an unlisted payee and allows it once the payee is approved", async () => {
    await h.guard.update(u.userId, { version: (await settings()).version, recipientMode: "APPROVED_ONLY" });
    expect(await code(created(pay(13)))).toBe("GUARD_BLOCKED");
    await h.guard.addRecipient(u.userId, { version: (await settings()).version, network: "arbitrum", address: PAYEE });
    expect(await code(created(pay(14)))).toBe("OK");
  });
  it("the Agent may approve a payment only to a payee in its signed permission; the wallet still signs the deposit", async () => {
    const owner = nearWallet(`o${randomBytes(6).toString("hex")}.testnet`);
    const agentId = `agt_${randomBytes(12).toString("hex")}`;
    const now = h.now();
    await h.db.insert(agents).values({ id: agentId, userId: u.userId, displayName: "Agent", status: "VERIFIED", ownerNetwork: "near", ownerAccountId: owner.address, ownerPublicKey: owner.publicKey,
      verificationMethod: "NEAR_NEP413_FULL_ACCESS_KEY", attestationHash: "a".repeat(64), verifiedAt: now, verificationExpiresAt: new Date(now.getTime() + OWNERSHIP_VALID_MS), createdAt: now, updatedAt: now });
    h.nearKeys.set(`${owner.address}|${owner.publicKey}`, "FullAccess");
    const c = await h.grants.prepare(u.userId, agentId, { maxTransactionUsd: "100", dailyLimitUsd: "200", maxTransactions: 5, durationHours: 24, sourceNetworks: ["base"], destinationNetworks: ["arbitrum"],
      assets: [`base:${USDC_BASE}`, `arbitrum:${USDC_ARB}`], recipients: { self: false, addresses: [{ network: "arbitrum", address: PAYEE }] } }, "spak.test");
    const s = await owner.sign(c.message, hex.encode(base64.decode(c.nonce)), c.recipient);
    await h.grants.confirm(u.userId, agentId, { challengeId: c.challengeId, accountId: owner.address, publicKey: s.publicKey, signature: s.signature, domain: "spak.test" });
    const wallets = await u.wallets();
    const ok = await created(pay(15), `k-${++n}`, agentId);
    const f = await h.svc.firmQuote({ userId: u.userId, executionId: ok.execution.id, quoteId: ok.quote!.id, wallets });
    const a = await h.svc.approveByAgent({ userId: u.userId, executionId: ok.execution.id, quoteId: f.quote.id, wallets });
    expect(a.execution.state).toBe("AWAITING_DEPOSIT");
    const dep = await h.deposits.prepare({ userId: u.userId, executionId: ok.execution.id, wallets });
    expect(dep.transaction.family).toBe("evm"); // built for the user's wallet to sign; SPak signs nothing
    const no = await created(pay(16, OTHER), `k-${++n}`, agentId);
    const f2 = await h.svc.firmQuote({ userId: u.userId, executionId: no.execution.id, quoteId: no.quote!.id, wallets });
    expect(await code(h.svc.approveByAgent({ userId: u.userId, executionId: no.execution.id, quoteId: f2.quote.id, wallets }))).toBe("AGENT_APPROVAL_REQUIRED");
  });
});
