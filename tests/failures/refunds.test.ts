/**
 * Refund lifecycle, verification, recovery and manual review. MOCKED: 1Click (Fake1Click) and chain RPC (FakeChain).
 * Real: users, wallets, plans, approvals, deposits, SQL, atomic claims.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { refundTxs, failureEvents, reviews, recoveryAttempts } from "@/database/schema";
import { REFUND_TIMING } from "@/failures";
import type { ExecutionError } from "@/execution";
import { approval, harness } from "../execution/harness";
import { statusPayload } from "../execution/fake-1click";

let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
beforeEach(async () => { h = await harness(); u = await h.newUser(); });
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BRIDGE = "0x7777777777777777777777777777777777777777";
const OTHER = "0x9999999999999999999999999999999999999999";
let n = 0;
const H = () => `0x${(++n).toString(16).padStart(64, "b")}`;
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as ExecutionError).code ?? (e as Error).message; } };

async function deposited(who = u) {
  const r = await who.plan("Swap 50 USDC on Base to SOL on Solana");
  const wallets = await who.wallets();
  const x = await h.svc.create({ userId: who.userId, planHash: r.plan!.hash, idempotencyKey: `k-${++n}-${Math.random()}`, wallets });
  const f = await h.svc.firmQuote({ userId: who.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets });
  const a = await h.svc.approve({ userId: who.userId, executionId: x.execution.id, quoteId: f.quote.id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets });
  const ex = a.execution;
  h.chain.setBalance("base", who.evm.address, 50_000_000n, USDC);
  const p = await h.deposits.prepare({ userId: who.userId, executionId: ex.id, wallets });
  const depTx = H();
  h.chain.evmTx(depTx, { from: who.evm.address, to: USDC, logs: [{ address: USDC, from: who.evm.address, to: ex.depositAddress!, amount: 50_000_000n }] });
  expect((await h.deposits.submit({ userId: who.userId, depositId: p.deposit.id, txHash: depTx })).state).toBe("CONFIRMED");
  return { ex, sig: a.quote!.providerSignature!, depTx, refundTo: ex.refundAddress };
}
const provider = (dep: string, sig: string, status: string, extra: Record<string, unknown> = {}) => h.fake.statuses.set(dep, statusPayload(status, extra, sig));
const refundTx = (to: string, amount: bigint, o: { token?: string; status?: "0x1" | "0x0"; block?: number } = {}) => {
  const hash = H();
  h.chain.evmTx(hash, { from: BRIDGE, to: o.token ?? USDC, status: o.status, block: o.block, logs: [{ address: o.token ?? USDC, from: BRIDGE, to, amount }] });
  return hash;
};
const tick = async (ms = 5 * 60_000) => { h.clock.now += ms; return h.monitor.run({ trigger: "test" }); };
const get = async (id: string) => (await h.records.get(id))!;
const refund = async (id: string) => (await h.failureRecords.refund(id));

describe("refund lifecycle (mocked provider and chain)", () => {
  it("failed swap after confirmed deposit → refund expected → provider REFUNDED → tx verified on chain → REFUNDED", async () => {
    const { ex, sig, depTx, refundTo } = await deposited();
    provider(ex.depositAddress!, sig, "FAILED", { originChainTxHashes: [{ hash: depTx, explorerUrl: "x" }] });
    await tick();
    expect((await get(ex.id)).state).toBe("FAILED");
    expect((await refund(ex.id))!.state).toBe("PENDING_PROVIDER"); // the confirmed deposit is not written off
    expect((await get(ex.id)).failure).toMatchObject({ code: "REFUND_EXPECTED" });

    provider(ex.depositAddress!, sig, "REFUNDED", { refundedAmount: "49990000", refundReason: "SWAP_FAILED", originChainTxHashes: [{ hash: depTx, explorerUrl: "x" }] });
    await tick();
    expect((await get(ex.id)).state).toBe("REFUNDING"); // provider said so; not proof
    expect((await refund(ex.id))!.state).toBe("INITIATED");

    const rtx = refundTx(refundTo, 49_990_000n);
    provider(ex.depositAddress!, sig, "REFUNDED", { refundedAmount: "49990000", originChainTxHashes: [{ hash: depTx, explorerUrl: "x" }, { hash: rtx, explorerUrl: "x" }] });
    await tick();
    expect(await get(ex.id)).toMatchObject({ state: "REFUNDED", refundVerifiedAmount: "49990000" });
    const r = (await refund(ex.id))!;
    expect(r).toMatchObject({ state: "COMPLETED", verifiedAmount: "49990000", depositedAmount: "50000000" });
    const txs = await h.db.select().from(refundTxs).where(eq(refundTxs.executionId, ex.id));
    expect(txs.map((t) => t.txHash)).toEqual([rtx]); // the deposit tx is never counted as a refund
    const view = await h.failures.refund(u.userId, ex.id);
    expect(view.refund).toMatchObject({ partial: true, expectedAmount: "49990000", verifiedAmount: "49990000" });
    // Idempotent: more runs change nothing.
    const evs = (await h.db.select().from(failureEvents).where(eq(failureEvents.executionId, ex.id))).length;
    await tick(); await tick();
    expect((await h.db.select().from(failureEvents).where(eq(failureEvents.executionId, ex.id))).length).toBe(evs);
  });

  it("wrong recipient, wrong asset, failed tx and short amount never complete the refund", async () => {
    const cases: [string, (to: string) => string][] = [
      ["wrong recipient", () => refundTx(OTHER, 50_000_000n)],
      ["wrong asset", (to) => refundTx(to, 50_000_000n, { token: "0x4444444444444444444444444444444444444444" })],
      ["failed tx", (to) => refundTx(to, 50_000_000n, { status: "0x0" })],
    ];
    for (const [, make] of cases) {
      const { ex, sig, refundTo } = await deposited();
      const t = make(refundTo);
      provider(ex.depositAddress!, sig, "REFUNDED", { refundedAmount: "50000000", originChainTxHashes: [{ hash: t, explorerUrl: "x" }] });
      await tick();
      expect((await get(ex.id)).state).toBe("REFUNDING");
      expect((await refund(ex.id))!.state).toBe("FAILED");
      expect(await h.failureRecords.openReviewFor(ex.id)).not.toBeNull();
    }
    const { ex, sig, refundTo } = await deposited();
    const short = refundTx(refundTo, 10_000_000n);
    provider(ex.depositAddress!, sig, "REFUNDED", { refundedAmount: "50000000", originChainTxHashes: [{ hash: short, explorerUrl: "x" }] });
    await tick();
    expect((await get(ex.id)).state).toBe("REFUNDING");
    expect(await refund(ex.id)).toMatchObject({ state: "PARTIAL", associatedAmount: "10000000", outstandingAmount: "40000000" });
  });

  it("insufficient confirmations stay pending; partial refund completes as partial", async () => {
    const { ex, sig, refundTo } = await deposited();
    const t = refundTx(refundTo, 20_000_000n, { block: h.chain.evmHead });
    provider(ex.depositAddress!, sig, "REFUNDED", { refundedAmount: "20000000", refundReason: "PARTIAL_DEPOSIT", originChainTxHashes: [{ hash: t, explorerUrl: "x" }] });
    await tick();
    expect((await get(ex.id)).state).toBe("REFUNDING");
    expect(["TX_DETECTED", "VERIFICATION_PENDING"]).toContain((await refund(ex.id))!.state);
    h.chain.evmHead += 10;
    await tick();
    expect((await get(ex.id)).state).toBe("REFUNDED");
    expect((await h.failures.refund(u.userId, ex.id)).refund).toMatchObject({ partial: true, verifiedAmount: "20000000", depositedAmount: "50000000" });
  });

  it("delayed refund: DELAYED after 6 hours, manual review after 72; never REFUNDED without a transaction", async () => {
    const { ex, sig } = await deposited();
    provider(ex.depositAddress!, sig, "REFUNDED", { refundedAmount: "50000000" });
    await tick();
    expect((await refund(ex.id))!.state).toBe("INITIATED");
    h.clock.now += REFUND_TIMING.delayedAfterMs;
    await tick();
    expect((await refund(ex.id))!.state).toBe("DELAYED");
    expect(await h.failureRecords.openReviewFor(ex.id)).toBeNull();
    h.clock.now += REFUND_TIMING.reviewAfterMs;
    await tick();
    expect(await h.failureRecords.openReviewFor(ex.id)).not.toBeNull();
    expect((await get(ex.id)).state).toBe("REFUNDING");
  });

  it("provider timeouts and unknown statuses never mark failure or refund", async () => {
    const { ex, sig } = await deposited();
    h.fake.mode = "timeout";
    await tick();
    expect((await get(ex.id)).state).toBe("PROCESSING");
    expect(await refund(ex.id)).toBeNull();
    h.fake.mode = "ok";
    provider(ex.depositAddress!, sig, "SOMETHING_NEW");
    await tick();
    expect((await get(ex.id)).state).toBe("UNKNOWN");
    expect(await refund(ex.id)).toBeNull();
  });
});

describe("recovery actions and security", () => {
  it("user-submitted refund tx is only a candidate: checked on chain, never counted until NEAR Intents lists it", async () => {
    const a = await deposited();
    provider(a.ex.depositAddress!, a.sig, "REFUNDED", { refundedAmount: "50000000" });
    await tick();
    const t = refundTx(a.refundTo, 50_000_000n);
    const r1 = await h.failures.submitRefundTx(u.userId, a.ex.id, t);
    expect(r1.refund).toMatchObject({ state: "ASSOCIATION_PENDING", verifiedAmount: "50000000", associatedAmount: "0" });
    expect(r1.transactions[0]).toMatchObject({ submitted: true, chainVerified: true, association: "PENDING_ASSOCIATION" });
    expect((await get(a.ex.id)).state).toBe("REFUNDING");
    expect(await h.failureRecords.openReviewFor(a.ex.id)).not.toBeNull();
    expect((await h.failures.refund(u.userId, a.ex.id)).transactions).toHaveLength(1); // idempotent
    await h.failures.submitRefundTx(u.userId, a.ex.id, t.toUpperCase().replace("0X", "0x"));
    expect((await h.failures.refund(u.userId, a.ex.id)).transactions).toHaveLength(1); // case variants are the same tx
    // NEAR Intents now lists it for this deposit address: association established, refund completes.
    provider(a.ex.depositAddress!, a.sig, "REFUNDED", { refundedAmount: "50000000", originChainTxHashes: [{ hash: a.depTx, explorerUrl: "x" }, { hash: t, explorerUrl: "x" }] });
    await tick();
    expect((await get(a.ex.id)).state).toBe("REFUNDED");

    const b = await deposited();
    provider(b.ex.depositAddress!, b.sig, "REFUNDED", { refundedAmount: "50000000" });
    await tick();
    expect(await code(h.failures.submitRefundTx(u.userId, b.ex.id, b.depTx))).toBe("INVALID_TX_REFERENCE"); // the deposit
    expect(await code(h.failures.submitRefundTx(u.userId, b.ex.id, t))).toBe("DUPLICATE_TX"); // another transfer's refund
    expect(await code(h.failures.submitRefundTx(u.userId, b.ex.id, "0x1234"))).toBe("INVALID_TX_REFERENCE");
    const bob = await h.newUser();
    expect(await code(h.failures.submitRefundTx(bob.userId, b.ex.id, refundTx(b.refundTo, 1n)))).toBe("EXECUTION_NOT_FOUND");
    expect(await code(h.failures.refund(bob.userId, b.ex.id))).toBe("EXECUTION_NOT_FOUND");
    expect(await code(h.failures.failure(bob.userId, b.ex.id))).toBe("EXECUTION_NOT_FOUND");
    const rejected = await h.db.select().from(recoveryAttempts).where(eq(recoveryAttempts.executionId, b.ex.id));
    expect(rejected.map((x) => x.outcome)).toEqual(expect.arrayContaining(["INVALID_TX_REFERENCE", "DUPLICATE_TX"])); // refused attempts kept
  });

  it("concurrent submissions and verifications create one record and one completion", async () => {
    const a = await deposited();
    const t = refundTx(a.refundTo, 50_000_000n);
    provider(a.ex.depositAddress!, a.sig, "REFUNDED", { refundedAmount: "50000000", originChainTxHashes: [{ hash: t, explorerUrl: "x" }] });
    h.clock.now += 5 * 60_000;
    await Promise.all([h.failures.submitRefundTx(u.userId, a.ex.id, t).catch(() => null), h.failures.submitRefundTx(u.userId, a.ex.id, t).catch(() => null), h.monitor.run({ trigger: "x" }), h.monitor.run({ trigger: "y" })]);
    await tick();
    expect((await h.db.select().from(refundTxs).where(eq(refundTxs.executionId, a.ex.id))).length).toBe(1);
    expect((await get(a.ex.id)).state).toBe("REFUNDED");
    const evs = await h.db.select().from(failureEvents).where(eq(failureEvents.executionId, a.ex.id));
    expect(evs.filter((e) => (e.detail as { to?: string }).to === "COMPLETED")).toHaveLength(1);
  });

  it("recovery actions are rate limited per execution", async () => {
    const a = await deposited();
    provider(a.ex.depositAddress!, a.sig, "REFUNDED", { refundedAmount: "50000000" });
    await tick();
    for (let i = 0; i < 10; i++) await h.failures.verifyRefund(u.userId, a.ex.id);
    expect(await code(h.failures.verifyRefund(u.userId, a.ex.id))).toBe("RATE_LIMITED");
  });

  it("a deposit already sent cannot be cancelled away", async () => {
    const r = await u.plan("Swap 50 USDC on Base to SOL on Solana");
    const wallets = await u.wallets();
    const x = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: "cancel-k", wallets });
    const f = await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets });
    const a = await h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: f.quote.id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets });
    h.chain.setBalance("base", u.evm.address, 50_000_000n, USDC);
    const p = await h.deposits.prepare({ userId: u.userId, executionId: a.execution.id, wallets });
    await h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: H() }); // not on chain yet: VERIFICATION_PENDING
    expect(await code(h.svc.cancel({ userId: u.userId, executionId: a.execution.id }))).toBe("INVALID_STATE");
  });
});

describe("manual review", () => {
  const ALICE = { reviewerId: "alice", credentialRef: "aaaaaaaaaaaa" };
  it("reviewers add notes and candidates; they cannot associate, verify or mark refunded; audit names the reviewer", async () => {
    const a = await deposited();
    provider(a.ex.depositAddress!, a.sig, "REFUNDED", { refundedAmount: "50000000", originChainTxHashes: [{ hash: refundTx(OTHER, 50_000_000n), explorerUrl: "x" }] });
    await tick();
    const rv = (await h.failureRecords.openReviewFor(a.ex.id))!;
    expect(rv.status).toBe("OPEN");
    await h.reviews.note(ALICE, rv.id, "Checked provider dashboard.", { link: "internal" });
    expect(await code(h.reviews.resolve(ALICE, rv.id, "RESOLVED_BY_VERIFICATION", "done", { x: 1 }))).toBe("INVALID_STATE");
    expect(await code(h.reviews.resolve(ALICE, rv.id, "NO_ACTION_NEEDED", "", {}))).toBe("EVIDENCE_REQUIRED");
    const real = refundTx(a.refundTo, 50_000_000n);
    const after = await h.reviews.attachRefundTx(ALICE, rv.id, real, "Found a transfer on Basescan.");
    expect(after.execution.state).toBe("REFUNDING"); // a reviewer's candidate is not proof
    expect(after.refundTransactions.find((t) => t.txHash === real)).toMatchObject({ association: "PENDING_ASSOCIATION", chainVerified: true });
    await h.reviews.requestVerification(ALICE, rv.id, "re-check after provider update");
    expect((await get(a.ex.id)).state).toBe("REFUNDING");
    const ev = await h.reviews.get(ALICE, rv.id);
    expect(ev.audit.map((x) => [x.reviewer, x.action, x.outcome])).toEqual(expect.arrayContaining([
      ["alice", "ADD_NOTE", "OK"], ["alice", "RESOLVE_REVIEW", "INVALID_STATE"], ["alice", "RESOLVE_REVIEW", "EVIDENCE_REQUIRED"], ["alice", "ATTACH_REFUND_CANDIDATE", "OK"], ["alice", "REQUEST_VERIFICATION", "OK"],
    ]));
    expect(ev.notes.every((n) => n.author === "alice")).toBe(true);
    const notes = ev.notes.length;
    const done = await h.reviews.resolve(ALICE, rv.id, "REFERRED_TO_PROVIDER", "Asked NEAR Intents to confirm the refund tx.", { ticket: "NI-1" });
    expect(done.review.status).toBe("RESOLVED");
    expect(done.notes.length).toBe(notes + 1); // append-only
    expect((await h.db.select().from(reviews).where(eq(reviews.executionId, a.ex.id))).length).toBe(1);
  });
});
