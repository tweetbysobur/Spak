/**
 * Refund transaction association (Phase 5.1). MOCKED provider and chain; real SQL. A matching transfer is never proof
 * that it is this execution's refund: only provider listing for this execution's deposit address associates.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { refundTxs, reviews } from "@/database/schema";
import type { ExecutionError } from "@/execution";
import { parseReviewers, resolveReviewer } from "@/server/reviewers";
import { createHash } from "node:crypto";
import { approval, harness } from "../execution/harness";
import { statusPayload } from "../execution/fake-1click";

let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
beforeEach(async () => { h = await harness(); u = await h.newUser(); });
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", BRIDGE = "0x7777777777777777777777777777777777777777";
let n = 0;
const H = () => `0x${(++n).toString(16).padStart(64, "c")}`;
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as ExecutionError).code ?? (e as Error).message; } };

async function deposited() {
  const r = await u.plan("Swap 50 USDC on Base to SOL on Solana");
  const wallets = await u.wallets();
  const x = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: `k-${++n}-${Math.random()}`, wallets });
  const f = await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets });
  const a = await h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: f.quote.id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets });
  h.chain.setBalance("base", u.evm.address, 50_000_000n, USDC);
  const p = await h.deposits.prepare({ userId: u.userId, executionId: a.execution.id, wallets });
  const depTx = H();
  h.chain.evmTx(depTx, { from: u.evm.address, to: USDC, logs: [{ address: USDC, from: u.evm.address, to: a.execution.depositAddress!, amount: 50_000_000n }] });
  await h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: depTx });
  return { ex: a.execution, sig: a.quote!.providerSignature!, depTx };
}
const refundTx = (to: string, amount: bigint, o: { block?: number; network?: string } = {}) => {
  const hash = H();
  h.chain.evmTx(hash, { network: o.network, from: BRIDGE, to: USDC, block: o.block, logs: [{ address: USDC, from: BRIDGE, to, amount }] });
  return hash;
};
const provider = (dep: string, sig: string, status: string, extra: Record<string, unknown>) => h.fake.statuses.set(dep, statusPayload(status, extra, sig));
const listed = (...hashes: string[]) => ({ originChainTxHashes: hashes.map((hash) => ({ hash, explorerUrl: "x" })) });
const tick = async () => { h.clock.now += 5 * 60_000; await h.monitor.run({ trigger: "t" }); };
const state = async (id: string) => (await h.records.get(id))!.state;
const rtx = async (id: string) => h.db.select().from(refundTxs).where(eq(refundTxs.executionId, id));

describe("association", () => {
  it("provider-listed, chain-verified, in-window refund with provider confirmation completes", async () => {
    const { ex, sig, depTx } = await deposited();
    const t = refundTx(ex.refundAddress, 50_000_000n);
    provider(ex.depositAddress!, sig, "REFUNDED", { refundedAmount: "50000000", ...listed(depTx, t) });
    await tick();
    expect(await state(ex.id)).toBe("REFUNDED");
    const [row] = await rtx(ex.id);
    expect(row).toMatchObject({ association: "PROVIDER_LISTED", source: "PROVIDER", sender: BRIDGE, refundId: ex.id });
    expect(row.checks).toMatchObject({ exists: "PASS", success: "PASS", recipient: "PASS", asset: "PASS", amount: "PASS", finality: "PASS", time: "PASS", association: "PASS", provider: "PASS" });
    expect(row.associationEvidence).toMatchObject({ type: "PROVIDER_STATUS_ORIGIN_TX", depositAddress: ex.depositAddress });
    expect(row.txTimestamp).toBeInstanceOf(Date);
  });

  it("right recipient, token and amount but unrelated (user or reviewer submitted): never associated", async () => {
    const { ex, sig } = await deposited();
    provider(ex.depositAddress!, sig, "REFUNDED", { refundedAmount: "50000000" });
    await tick();
    const t = refundTx(ex.refundAddress, 50_000_000n);
    await h.failures.submitRefundTx(u.userId, ex.id, t);
    for (let i = 0; i < 3; i++) await tick();
    expect(await state(ex.id)).toBe("REFUNDING");
    expect((await h.failureRecords.refund(ex.id))).toMatchObject({ state: "ASSOCIATION_PENDING", associatedAmount: "0", verifiedAmount: "50000000" });
    expect((await rtx(ex.id))[0].checks).toMatchObject({ recipient: "PASS", asset: "PASS", amount: "PASS", time: "PASS", association: "FAIL" });
    const rv = (await h.failureRecords.openReviewFor(ex.id))!;
    const t2 = refundTx(ex.refundAddress, 50_000_000n);
    await h.reviews.attachRefundTx({ reviewerId: "alice", credentialRef: "x" }, rv.id, t2, "Looks like the refund.");
    expect(await state(ex.id)).toBe("REFUNDING");
    expect((await rtx(ex.id)).every((r) => r.association === "PENDING_ASSOCIATION")).toBe(true);
  });

  it("transactions before the deposit are rejected, even when provider-listed", async () => {
    const { ex, sig } = await deposited();
    const early = refundTx(ex.refundAddress, 50_000_000n, { block: 900 });
    provider(ex.depositAddress!, sig, "REFUNDED", { refundedAmount: "50000000", ...listed(early) });
    await tick();
    expect(await state(ex.id)).toBe("REFUNDING");
    expect((await rtx(ex.id))[0]).toMatchObject({ association: "REJECTED" });
    expect((await rtx(ex.id))[0].rejectedReason).toMatch(/before the deposit/);

  });

  it("wrong source chain: a hash that exists only on another network is never verified", async () => {
    const { ex, sig } = await deposited();
    const other = refundTx(ex.refundAddress, 50_000_000n, { network: "arbitrum" });
    provider(ex.depositAddress!, sig, "REFUNDED", { refundedAmount: "50000000", ...listed(other) });
    await tick(); await tick();
    expect(await state(ex.id)).toBe("REFUNDING");
    expect((await rtx(ex.id))[0]).toMatchObject({ outcome: "NOT_FOUND" });
  });

  it("chain shows a provider-listed transfer but the provider has not reported REFUNDED: not refunded", async () => {
    const { ex, sig, depTx } = await deposited();
    const t = refundTx(ex.refundAddress, 50_000_000n);
    provider(ex.depositAddress!, sig, "FAILED", listed(depTx, t));
    await tick();
    expect(await state(ex.id)).toBe("FAILED");
    expect(await h.failureRecords.refund(ex.id)).toMatchObject({ state: "VERIFICATION_PENDING", associatedAmount: "50000000" });
  });

  it("provider REFUNDED without an amount never completes; review opened", async () => {
    const { ex, sig } = await deposited();
    const t = refundTx(ex.refundAddress, 50_000_000n);
    provider(ex.depositAddress!, sig, "REFUNDED", listed(t));
    await tick();
    expect(await state(ex.id)).toBe("REFUNDING");
    expect(await h.failureRecords.openReviewFor(ex.id)).not.toBeNull();
  });
});

describe("uniqueness and concurrency", () => {
  it("one transaction cannot be associated with two executions, even submitted at the same time", async () => {
    const a = await deposited(), b = await deposited();
    for (const x of [a, b]) provider(x.ex.depositAddress!, x.sig, "REFUNDED", { refundedAmount: "50000000" });
    await tick();
    const t = refundTx(a.ex.refundAddress, 50_000_000n);
    const res = await Promise.all([code(h.failures.submitRefundTx(u.userId, a.ex.id, t)), code(h.failures.submitRefundTx(u.userId, b.ex.id, t))]);
    expect(res.sort()).toEqual(["DUPLICATE_TX", "OK"]);
    expect((await h.db.select().from(refundTxs).where(eq(refundTxs.txHash, t))).length).toBe(1);
  });
  it("duplicate review creation yields one open case", async () => {
    const { ex } = await deposited();
    await Promise.all([1, 2, 3].map(() => h.failures.flagForReview(ex.id, "x", "spak")));
    expect((await h.db.select().from(reviews).where(eq(reviews.executionId, ex.id))).length).toBe(1);
  });
});

describe("reviewer identity", () => {
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");
  const A = "alice-" + "1".repeat(40), B = "bob-" + "2".repeat(40);
  const conf = parseReviewers(`alice:${sha(A)},bob:${sha(B)}`, undefined);
  it("each credential maps to exactly its reviewer; unknown, short and hash-as-token are refused", () => {
    expect(resolveReviewer(A, conf)?.reviewerId).toBe("alice");
    expect(resolveReviewer(B, conf)?.reviewerId).toBe("bob"); // bob cannot be alice
    expect(resolveReviewer("x".repeat(40), conf)).toBeNull();
    expect(resolveReviewer("short", conf)).toBeNull();
    expect(resolveReviewer(sha(A), conf)).toBeNull();
    expect(resolveReviewer(A, conf)?.credentialRef).not.toContain(A.slice(0, 10));
  });
  it("legacy shared token is labelled as a shared identity, not a person", () => {
    const legacy = parseReviewers(undefined, "z".repeat(40));
    expect(resolveReviewer("z".repeat(40), legacy)?.reviewerId).toBe("shared-admin");
  });
});
