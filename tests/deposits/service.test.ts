/** Deposit service: MOCKED 1Click and MOCKED chain RPC. Real users, real plans, real approvals, real SQL. */
import { beforeEach, describe, expect, it } from "vitest";
import type { ExecutionError } from "@/execution";
import { approval, harness } from "../execution/harness";

let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
beforeEach(async () => { h = await harness(); u = await h.newUser(); });
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as ExecutionError).code ?? (e as Error).message; } };
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

async function approved(text = "Swap 50 USDC on Base to SOL on Solana", who = u) {
  const r = await who.plan(text);
  expect(r.status, JSON.stringify(r.errors)).toBe("VALIDATED");
  const wallets = await who.wallets();
  const x = await h.svc.create({ userId: who.userId, planHash: r.plan!.hash, idempotencyKey: `k-${Math.random().toString(36).slice(2)}`, wallets });
  const f = await h.svc.firmQuote({ userId: who.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets });
  const a = await h.svc.approve({ userId: who.userId, executionId: x.execution.id, quoteId: f.quote.id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets });
  return a.execution;
}
const fund = (who = u) => h.chain.setBalance("base", who.evm.address, 100_000_000n, USDC);
const prep = async (ex: { id: string }, who = u) => h.deposits.prepare({ userId: who.userId, executionId: ex.id, wallets: await who.wallets() });

describe("prepare", () => {
  it("builds an ERC-20 transfer with no token approval, from the verified wallet", async () => {
    const ex = await approved(); fund();
    const p = await prep(ex);
    expect(p.deposit).toMatchObject({ state: "WALLET_CONFIRMATION_REQUESTED", kind: "ERC20", amount: "50000000", depositAddress: ex.depositAddress });
    expect(p.transaction).toMatchObject({ family: "evm", chainId: 8453, approvals: [], request: { to: USDC, value: "0" } });
    expect(p.transaction.family === "evm" && p.transaction.request.data.startsWith("0xa9059cbb")).toBe(true); // transfer(), never approve()
    expect((await prep(ex)).deposit.id).toBe(p.deposit.id); // reuses the open attempt
  });
  it("refuses with insufficient balance, before any wallet prompt", async () => {
    const ex = await approved();
    expect(await code(prep(ex))).toBe("INSUFFICIENT_BALANCE");
  });
  it("refuses without an approval, for another user, and when the chain is unreachable", async () => {
    const r = await u.plan("Swap 50 USDC on Base to SOL on Solana");
    const x = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: "k-noapprove1", wallets: await u.wallets() });
    expect(await code(prep(x.execution))).toBe("DEPOSIT_NOT_ALLOWED");
    const ex = await approved(); fund();
    const bob = await h.newUser();
    expect(await code(prep(ex, bob))).toBe("EXECUTION_NOT_FOUND");
    h.chain.down.add("base");
    // An EVM transfer needs no chain data to build; an unreadable balance is reported as unknown, never as sufficient.
    expect((await prep(ex)).balance).toEqual({ balance: null, sufficient: null });
  });
  it("refuses after the deposit deadline", async () => {
    const ex = await approved(); fund();
    h.clock.now = ex.depositDeadline!.getTime() + 1;
    expect(await code(prep(ex))).toBe("DEPOSIT_EXPIRED");
  });
});

describe("submit and verify", () => {
  const good = (hash: string, ex: { depositAddress: string | null }, amount = 50_000_000n) =>
    h.chain.evmTx(hash, { from: u.evm.address, to: USDC, logs: [{ address: USDC, from: u.evm.address, to: ex.depositAddress!, amount }] });

  it("confirms only after the chain shows the exact transfer", async () => {
    const ex = await approved(); fund();
    const p = await prep(ex);
    h.chain.evmTx(H(1), { from: u.evm.address, to: USDC, block: null });
    const s = await h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: H(1) });
    expect(s.state).toBe("VERIFICATION_PENDING"); // browser claim alone is never success
    good(H(1), ex);
    h.clock.now += 10_000;
    const v = await h.deposits.verify({ userId: u.userId, depositId: p.deposit.id });
    expect(v.state).toBe("CONFIRMED");
    expect(await code(prep(ex))).toBe("DEPOSIT_IN_PROGRESS"); // no double funding
  });
  it("rejects wrong amount, wrong address, wrong asset", async () => {
    for (const [i, setup] of [
      (hsh: string, ex: { depositAddress: string | null }) => good(hsh, ex, 1n),
      (hsh: string) => h.chain.evmTx(hsh, { from: u.evm.address, to: USDC, logs: [{ address: USDC, from: u.evm.address, to: "0x9999999999999999999999999999999999999999", amount: 50_000_000n }] }),
      (hsh: string, ex: { depositAddress: string | null }) => h.chain.evmTx(hsh, { from: u.evm.address, to: ex.depositAddress!, value: 50_000_000n }),
    ].entries()) {
      const ex = await approved(); fund();
      const p = await prep(ex);
      setup(H(10 + i), ex);
      expect((await h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: H(10 + i) })).state).toBe("REJECTED");
    }
  });
  it("records failed transactions, and keeps unreadable chains pending", async () => {
    const ex = await approved(); fund();
    const p = await prep(ex);
    h.chain.down.add("base");
    expect((await h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: H(20) })).state).toBe("VERIFICATION_PENDING");
    h.chain.down.clear();
    h.chain.evmTx(H(20), { from: u.evm.address, to: USDC, status: "0x0" });
    h.clock.now += 10_000;
    expect((await h.deposits.verify({ userId: u.userId, depositId: p.deposit.id })).state).toBe("FAILED");
  });
  it("delayed verification: not found stays pending, then expires after the deadline", async () => {
    const ex = await approved(); fund();
    const p = await prep(ex);
    expect((await h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: H(30) })).state).toBe("VERIFICATION_PENDING");
    h.clock.now = ex.depositDeadline!.getTime() + 1;
    expect((await h.deposits.verify({ userId: u.userId, depositId: p.deposit.id })).state).toBe("EXPIRED");
  });
  it("rejects invalid and reused transaction references and other users", async () => {
    const ex = await approved(); fund();
    const p = await prep(ex);
    expect(await code(h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: "0x123" }))).toBe("INVALID_TX_REFERENCE");
    const bob = await h.newUser();
    expect(await code(h.deposits.submit({ userId: bob.userId, depositId: p.deposit.id, txHash: H(40) }))).toBe("DEPOSIT_NOT_FOUND");
    good(H(40), ex);
    await h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: H(40) });
    expect(await code(h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: H(41) }))).toBe("DUPLICATE_TX");
    const ex2 = await approved(); fund();
    const p2 = await prep(ex2);
    expect(await code(h.deposits.submit({ userId: u.userId, depositId: p2.deposit.id, txHash: H(40) }))).toBe("DUPLICATE_TX"); // replay
  });
  it("wallet rejection ends the attempt; a new one can be prepared", async () => {
    const ex = await approved(); fund();
    const p = await prep(ex);
    expect((await h.deposits.walletRejected({ userId: u.userId, depositId: p.deposit.id, reason: "User rejected" })).state).toBe("REJECTED");
    expect((await prep(ex)).deposit.id).not.toBe(p.deposit.id);
  });
});

describe("approval binding", () => {
  it("cancelling invalidates the approval so no deposit can be prepared", async () => {
    const ex = await approved(); fund();
    await h.svc.cancel({ userId: u.userId, executionId: ex.id });
    expect(await code(prep(ex))).toBe("DEPOSIT_NOT_ALLOWED");
  });
});
