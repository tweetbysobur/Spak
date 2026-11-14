/**
 * A-4 and A-3. Execution-bound destination verification.
 *
 * Part 1 replays the REAL Arbitrum Sepolia payout and Base Sepolia deposit of exe_adf513ec746688a2cddd7019 (first real
 * SPak settlement on the Tidepool testnet sandbox, community-run, not affiliated with NEAR or 1Click), recorded
 * unmodified from public RPCs, through the real EVM verifier and the binding rules. Mutations are applied in memory.
 *
 * Part 2 runs the full service with real SQL (PGlite or PostgreSQL 16) and MOCKED provider and chain (Fake1Click, FakeChain).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fixture from "./fixtures/tidepool-settlement-receipts.json";
import type { ChainRpc } from "@/deposits/rpc";
import { RpcUnavailable } from "@/deposits/rpc";
import { verifyEvmDelivery } from "@/tracking/verifiers/evm";
import { bind, NOT_DESTINATION_CHAIN } from "@/tracking/destination";
import { destinationVerifications, executionEvents, executions } from "@/database/schema";
import { approval, harness } from "../execution/harness";
import { statusPayload } from "../execution/fake-1click";

const PAYOUT = "0x97a4501a49beba6c8691fa26c698be34d3743aa96a8db60b870e34fb6ac42da2";
const USER = "0xbaf4cfb500a338859517f43f0ec02ec13330da3e";
const USDC_ARB_SEPOLIA = "0x38d81431b9f76d9699af7517040d5221d9dea252";
const VAULT = "0x2e6ad9e6d59bb4585ea0e6762c3b637dde29dad2";
const MIN = 3_761_050n;
const ARB_TIME = parseInt(fixture.arbitrumSepolia.block.timestamp, 16);
const BASE_TIME = parseInt(fixture.baseSepolia.block.timestamp, 16);

/** A read-only RPC answering from the recorded fixture. Optional mutations simulate other chain states. */
function fixtureRpc(o: { receipt?: (r: typeof fixture.arbitrumSepolia.receipt) => unknown; tx?: (t: typeof fixture.arbitrumSepolia.tx) => unknown; head?: number; block?: unknown; down?: boolean } = {}): ChainRpc {
  const a = structuredClone(fixture.arbitrumSepolia);
  return {
    async call<T>(_n: string, method: string, params: unknown): Promise<T> {
      if (o.down) throw new RpcUnavailable("arbitrum-sepolia", "down (test)");
      const p = params as string[];
      if (method === "eth_getTransactionByHash") return (p[0] === PAYOUT ? (o.tx ? o.tx(a.tx) : a.tx) : null) as T;
      if (method === "eth_getTransactionReceipt") return (p[0] === PAYOUT ? (o.receipt ? o.receipt(a.receipt) : a.receipt) : null) as T;
      if (method === "eth_blockNumber") return `0x${(o.head ?? parseInt(a.receipt.blockNumber, 16) + 20).toString(16)}` as T;
      if (method === "eth_getBlockByNumber") return (o.block !== undefined ? o.block : a.block) as T;
      throw new Error(`unexpected ${method}`);
    },
  };
}
const expectation = (over: Partial<Parameters<typeof verifyEvmDelivery>[1]> = {}) => ({ network: "arbitrum-sepolia", txHash: PAYOUT, recipient: USER, kind: "TOKEN" as const, tokenContract: USDC_ARB_SEPOLIA, chainId: 421614, ...over });
const trust = (...a: string[]) => new Set(a.map((x) => x.toLowerCase()));

describe("A-4 on the real Arbitrum Sepolia payout (recorded fixture)", () => {
  it("accepts the genuine transfer: right chain, token, recipient, trusted vault sender, after the source deposit, at or above the minimum", async () => {
    const r = await verifyEvmDelivery(fixtureRpc(), expectation());
    expect(r).toMatchObject({ outcome: "CONFIRMED", received: "3796820", blockTime: ARB_TIME, transfers: [{ from: VAULT, amount: "3796820" }] });
    expect(ARB_TIME).toBeGreaterThanOrEqual(BASE_TIME); // the real payout came 22 s after the real deposit
    const b = bind(r, BASE_TIME, trust(VAULT), "arbitrum-sepolia", "Arbitrum Sepolia");
    expect(b).toEqual({ outcome: "CONFIRMED", counted: 3_796_820n, problems: [] });
    expect(b.counted >= MIN).toBe(true);
  });
  it("rejects an older matching transfer (block before this execution's deposit)", async () => {
    const r = await verifyEvmDelivery(fixtureRpc(), expectation());
    expect(bind(r, ARB_TIME + 1, trust(VAULT), "arbitrum-sepolia", "Arbitrum Sepolia")).toMatchObject({ outcome: "BEFORE_DEPOSIT", counted: 0n });
  });
  it("rejects a transfer from an unexpected sender, and fails closed when no trusted sender is configured", async () => {
    const r = await verifyEvmDelivery(fixtureRpc(), expectation());
    expect(bind(r, BASE_TIME, trust("0x1111111111111111111111111111111111111111"), "arbitrum-sepolia", "Arbitrum Sepolia")).toMatchObject({ outcome: "UNTRUSTED_SENDER", counted: 0n });
    expect(bind(r, BASE_TIME, new Set(), "arbitrum-sepolia", "Arbitrum Sepolia")).toMatchObject({ outcome: "UNTRUSTED_SENDER", counted: 0n, problems: [expect.stringMatching(/manual review/)] });
  });
  it("rejects a transfer to a different recipient, and a wrong token", async () => {
    expect(await verifyEvmDelivery(fixtureRpc(), expectation({ recipient: "0x2222222222222222222222222222222222222222" }))).toMatchObject({ outcome: "NO_TRANSFER", received: "0" });
    expect(await verifyEvmDelivery(fixtureRpc(), expectation({ tokenContract: "0xc15cf5600225302675604310094f134e88705e62" }))).toMatchObject({ outcome: "NO_TRANSFER", received: "0" });
  });
  it("rejects a wrong chain id, a reverted transaction and a missing transaction", async () => {
    expect(await verifyEvmDelivery(fixtureRpc({ tx: (t) => ({ ...t, chainId: "0x1" }) }), expectation())).toMatchObject({ outcome: "FAILED" });
    expect(await verifyEvmDelivery(fixtureRpc({ receipt: (rc) => ({ ...rc, status: "0x0" }) }), expectation())).toMatchObject({ outcome: "FAILED" });
    expect(await verifyEvmDelivery(fixtureRpc(), expectation({ txHash: `0x${"1".repeat(64)}` }))).toMatchObject({ outcome: "NOT_FOUND" });
  });
  it("insufficient confirmations stay PENDING; an unreadable block time is never counted; an RPC outage throws (nothing decided)", async () => {
    const shallow = await verifyEvmDelivery(fixtureRpc({ head: parseInt(fixture.arbitrumSepolia.receipt.blockNumber, 16) + 1 }), expectation());
    expect(shallow.outcome).toBe("PENDING");
    expect(bind(shallow, BASE_TIME, trust(VAULT), "arbitrum-sepolia", "Arbitrum Sepolia").counted).toBe(0n);
    const noTime = await verifyEvmDelivery(fixtureRpc({ block: null }), expectation());
    expect(bind(noTime, BASE_TIME, trust(VAULT), "arbitrum-sepolia", "Arbitrum Sepolia")).toMatchObject({ outcome: "PENDING", counted: 0n });
    await expect(verifyEvmDelivery(fixtureRpc({ down: true }), expectation())).rejects.toBeInstanceOf(RpcUnavailable);
  });
  it("counts only trusted-sender transfers when a receipt mixes senders (integer arithmetic, no float)", async () => {
    const extra = { address: USDC_ARB_SEPOLIA, topics: [fixture.arbitrumSepolia.receipt.logs[0].topics[0], `0x${"0".repeat(24)}${"3".repeat(40)}`, `0x${"0".repeat(24)}${USER.slice(2)}`], data: `0x${(10n ** 30n).toString(16)}` };
    const r = await verifyEvmDelivery(fixtureRpc({ receipt: (rc) => ({ ...rc, logs: [...rc.logs, extra] }) }), expectation());
    expect(r.received).toBe((3_796_820n + 10n ** 30n).toString());
    const b = bind(r, BASE_TIME, trust(VAULT), "arbitrum-sepolia", "Arbitrum Sepolia");
    expect(b).toMatchObject({ outcome: "CONFIRMED", counted: 3_796_820n });
    expect(b.problems[0]).toMatch(/untrusted sender/);
  });
});

// ------------------------------------------------------------------------------------------------ service level
let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
let n = 0;
beforeEach(async () => { h = await harness(); u = await h.newUser(); });
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const SENDER = VAULT;

async function processing(text = "Swap 50 USDC on Base to USDC on Arbitrum", depositBlock?: number) {
  const r = await u.plan(text);
  const wallets = await u.wallets();
  const x = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: `k-${++n}-${Math.random()}`, wallets });
  const f = await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets });
  const a = await h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: f.quote.id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets });
  const ex = a.execution;
  h.chain.setBalance("base", u.evm.address, 100_000_000n, USDC_BASE);
  const p = await h.deposits.prepare({ userId: u.userId, executionId: ex.id, wallets });
  const tx = `0x${(++n).toString(16).padStart(64, "d")}`;
  h.chain.evmTx(tx, { network: "base", from: u.evm.address, to: USDC_BASE, block: depositBlock, logs: [{ address: USDC_BASE, from: u.evm.address, to: ex.depositAddress!, amount: BigInt(ex.amountIn) }] });
  expect((await h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: tx })).state).toBe("CONFIRMED");
  const min = BigInt((await h.records.getQuote(ex.firmQuoteId!))!.minAmountOut!);
  return { ex, sig: a.quote!.providerSignature!, min };
}
const success = (dep: string, sig: string, hashes: string[]) => h.fake.statuses.set(dep, statusPayload("SUCCESS", { amountOut: "999", destinationChainTxHashes: hashes.map((hash) => ({ hash, explorerUrl: "x" })) }, sig));
const payout = (hash: string, o: { amount: bigint; from?: string; to?: string; block?: number; token?: string }) =>
  h.chain.evmTx(hash, { network: "arbitrum", from: "0x55f2c8044d790e1b8369508c31c756c0c2ca0e93", to: o.from ?? SENDER, block: o.block, logs: [{ address: o.token ?? USDC_ARB, from: o.from ?? SENDER, to: o.to ?? u.evm.address, amount: o.amount }] });
const run = async () => { h.clock.now += 60_000; await h.monitor.run({ trigger: "test" }); h.clock.now += 60_000; return h.monitor.run({ trigger: "test" }); };
const get = async (id: string) => (await h.records.get(id))!;
const hashN = (k: string) => `0x${k.padEnd(64, "0")}`;

describe("A-4 through the service: only an execution-bound transfer completes", () => {
  it("genuine payout after the deposit, from the route sender: COMPLETED with evidence bound to deposit and quote", async () => {
    const { ex, sig, min } = await processing();
    success(ex.depositAddress!, sig, [hashN("a1")]);
    payout(hashN("a1"), { amount: min });
    await run();
    const done = await get(ex.id);
    expect(done).toMatchObject({ state: "COMPLETED", amountOutVerified: min.toString() });
    const [rec] = await h.db.select().from(destinationVerifications).where(eq(destinationVerifications.executionId, ex.id));
    expect(rec.observed).toMatchObject({ evidenceVersion: 2, quoteId: ex.firmQuoteId, source: { depositId: expect.stringMatching(/^dep_/) }, transfers: [{ from: SENDER }] });
  });
  it.each([
    ["an older matching transfer", { block: 900 }, "BEFORE_DEPOSIT"],
    ["an unexpected sender", { from: "0x3333333333333333333333333333333333333333" }, "UNTRUSTED_SENDER"],
    ["a different recipient", { to: "0x4444444444444444444444444444444444444444" }, "NO_TRANSFER"],
    ["a wrong token", { token: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9" }, "NO_TRANSFER"],
  ])("rejects %s: never COMPLETED, manual reconciliation", async (_n, o, outcome) => {
    const { ex, sig, min } = await processing();
    success(ex.depositAddress!, sig, [hashN("b2")]);
    payout(hashN("b2"), { amount: min, ...o });
    await run();
    const r = await get(ex.id);
    expect(r.state).toBe("UNKNOWN");
    expect(r.amountOutVerified).toBeNull();
    const [rec] = await h.db.select().from(destinationVerifications).where(eq(destinationVerifications.executionId, ex.id));
    expect(rec.outcome).toBe(outcome);
  });
  it("rejects an amount below the minimum (one base unit short)", async () => {
    const { ex, sig, min } = await processing();
    success(ex.depositAddress!, sig, [hashN("c3")]);
    payout(hashN("c3"), { amount: min - 1n });
    await run();
    expect(await get(ex.id)).toMatchObject({ state: "UNKNOWN", amountOutVerified: null });
  });
  it("rejects a receipt already used as evidence for another execution", async () => {
    const one = await processing();
    success(one.ex.depositAddress!, one.sig, [hashN("d4")]);
    payout(hashN("d4"), { amount: one.min });
    await run();
    expect((await get(one.ex.id)).state).toBe("COMPLETED");
    h.clock.now += 5 * 60_000; // outside the duplicate-transfer window
    const two = await processing("Swap 51 USDC on Base to USDC on Arbitrum");
    success(two.ex.depositAddress!, two.sig, [hashN("d4")]);
    await run();
    expect(await get(two.ex.id)).toMatchObject({ state: "UNKNOWN", amountOutVerified: null });
    expect((await get(two.ex.id)).lastStatusError).toMatch(/already linked to another execution/);
  });
  it("provider SUCCESS without chain evidence never completes; insufficient confirmations stay pending", async () => {
    const { ex, sig, min } = await processing();
    success(ex.depositAddress!, sig, [hashN("e5")]); // not on chain
    await run();
    expect((await get(ex.id)).state).toBe("VERIFYING_DESTINATION");
    payout(hashN("e5"), { amount: min, block: h.chain.evmHead }); // 1 confirmation
    await run();
    expect((await get(ex.id)).state).toBe("VERIFYING_DESTINATION");
  });
  it("RPC that cannot establish the facts changes nothing", async () => {
    const { ex, sig, min } = await processing();
    success(ex.depositAddress!, sig, [hashN("f6")]);
    payout(hashN("f6"), { amount: min });
    h.chain.down.add("arbitrum");
    await run();
    expect((await get(ex.id)).state).toBe("VERIFYING_DESTINATION");
    h.chain.down.delete("arbitrum"); h.chain.down.add("base"); // source deposit time unreadable
    await run();
    expect((await get(ex.id)).state).toBe("VERIFYING_DESTINATION");
    h.chain.down.delete("base");
    await run();
    expect((await get(ex.id)).state).toBe("COMPLETED");
  });
  it("mainnet EVM route with no trusted sender configured: manual review, never COMPLETED", async () => {
    h.trusted.delete("arbitrum");
    const { ex, sig, min } = await processing();
    success(ex.depositAddress!, sig, [hashN("a7")]);
    payout(hashN("a7"), { amount: min });
    await run();
    const r = await get(ex.id);
    expect(r.state).toBe("UNKNOWN");
    expect(r.lastStatusError).toMatch(/no trusted route sender is configured/);
  });
});

describe("A-3: provider references that are not destination-chain transactions", () => {
  const NEAR_REF = "isvXCRDGHHCVZ7jBjPrWmuTVXyE1oqGt4BgaNp5Wv4f";
  it("mixed references: completes on the EVM payout; the NEAR reference is never registered as a destination transaction", async () => {
    const { ex, sig, min } = await processing();
    success(ex.depositAddress!, sig, [NEAR_REF, hashN("a8")]);
    payout(hashN("a8"), { amount: min });
    await run();
    expect((await get(ex.id)).state).toBe("COMPLETED");
    const recs = await h.db.select().from(destinationVerifications).where(eq(destinationVerifications.executionId, ex.id));
    expect(recs.map((r) => r.txHash)).toEqual([hashN("a8")]);
    const v = await h.trackingService.view(u.userId, ex.id);
    expect(v.destinationTxs.map((d) => d.outcome)).toEqual(["CONFIRMED"]);
  });
  it("a historical PENDING record (created before the fix) is reclassified on refresh, kept, and the COMPLETED execution is untouched", async () => {
    const { ex, sig, min } = await processing();
    success(ex.depositAddress!, sig, [NEAR_REF, hashN("a9")]);
    payout(hashN("a9"), { amount: min });
    await run();
    const before = await get(ex.id);
    expect(before.state).toBe("COMPLETED");
    // What the pre-fix verifier left behind: the NEAR hash registered as an Arbitrum transaction, PENDING forever.
    await h.tracking.registerDestinationTx({ id: "dvf_historical0000000000000", executionId: ex.id, network: "arbitrum", txHash: NEAR_REF, recipient: ex.recipient, assetId: ex.destinationAssetId, tokenContract: USDC_ARB });
    await h.db.update(destinationVerifications).set({ attempts: 88 }).where(eq(destinationVerifications.txHash, NEAR_REF));
    // Even before any refresh, the view shows it truthfully and without an explorer link.
    const pre = (await h.trackingService.view(u.userId, ex.id)).destinationTxs.find((d) => d.txHash === NEAR_REF)!;
    expect(pre).toMatchObject({ outcome: NOT_DESTINATION_CHAIN, explorerUrl: null });
    await h.trackingService.refresh(u.userId, ex.id);
    const [rec] = await h.db.select().from(destinationVerifications).where(eq(destinationVerifications.txHash, NEAR_REF));
    expect(rec).toMatchObject({ outcome: NOT_DESTINATION_CHAIN, attempts: 89, receivedAmount: null, observed: { previousOutcome: "PENDING" } });
    expect((rec.problems as string[])[0]).toMatch(/^Provider reference, not a transaction on /);
    // Repeated refreshes change nothing further and never touch the execution.
    await h.trackingService.refresh(u.userId, ex.id);
    await h.trackingService.refresh(u.userId, ex.id);
    const [again] = await h.db.select().from(destinationVerifications).where(eq(destinationVerifications.txHash, NEAR_REF));
    expect(again.attempts).toBe(89);
    const after = await get(ex.id);
    expect({ state: after.state, amountOutVerified: after.amountOutVerified, destinationVerifiedAt: after.destinationVerifiedAt }).toEqual({ state: before.state, amountOutVerified: before.amountOutVerified, destinationVerifiedAt: before.destinationVerifiedAt });
    const events = await h.db.select().from(executionEvents).where(eq(executionEvents.executionId, ex.id));
    expect(events.filter((e) => e.toState === "COMPLETED")).toHaveLength(1);
    expect((await h.db.select().from(destinationVerifications).where(eq(destinationVerifications.executionId, ex.id))).length).toBe(2); // nothing deleted
  });
  it("a correct destination reference is never reclassified", async () => {
    const { ex, sig, min } = await processing();
    success(ex.depositAddress!, sig, [hashN("aa")]);
    payout(hashN("aa"), { amount: min });
    await run();
    await h.trackingService.refresh(u.userId, ex.id);
    const [rec] = await h.db.select().from(destinationVerifications).where(eq(destinationVerifications.executionId, ex.id));
    expect(rec.outcome).toBe("CONFIRMED");
    void executions;
  });
});
