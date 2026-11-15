/**
 * NEAR NEP-141 deposits to 1Click deposit accounts. Live 1Click firm quotes return deposit accounts with no storage on
 * the token contract (mainnet USDC, 2026-11-14), and NEP-141 rejects ft_transfer to them. MOCKED NEAR RPC.
 */
import { describe, expect, it } from "vitest";
import type { ChainRpc } from "@/deposits/rpc";
import { buildDepositTransaction } from "@/deposits/builder";
import { verifyNearDeposit } from "@/deposits/verifiers/near";
import { approval, harness } from "../execution/harness";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEP = "8066a7cc1aa4ff79df396c0edf6776566c93f475054abbe33f22b3a418d7bab8";
const USER = "e724505bc626fb193050ae9cee9fabd2f817762f873e6fbedb6c4312817d10f4";
const out = (v: unknown) => ({ result: [...Buffer.from(JSON.stringify(v))] });

function nearRpc(o: { registered: boolean; bounds?: unknown }): ChainRpc {
  return {
    async call<T>(_n: string, method: string, params: unknown): Promise<T> {
      const q = params as { method_name: string };
      if (method !== "query") throw new Error(method);
      if (q.method_name === "storage_balance_of") return out(o.registered ? { total: "1250000000000000000000", available: "0" } : null) as T;
      if (q.method_name === "storage_balance_bounds") return out(o.bounds === undefined ? { min: "1250000000000000000000", max: "1250000000000000000000" } : o.bounds) as T;
      throw new Error(q.method_name);
    },
  };
}
const input = { network: "near", assetId: `near:${USDC}`, symbol: "USDC", decimals: 6, contract: USDC, depositAddress: DEP, depositMemo: null, amount: "5000000", sender: USER };

describe("NEAR deposit instructions", () => {
  it("unregistered deposit account: storage_deposit (registration only, contract minimum) before ft_transfer, in one transaction", async () => {
    const t = await buildDepositTransaction(nearRpc({ registered: false }), input);
    expect(t).toMatchObject({ family: "near", kind: "NEP141", receiverId: USDC });
    if (t.family !== "near") throw new Error("near");
    expect(t.actions).toEqual([
      { type: "FunctionCall", methodName: "storage_deposit", args: { account_id: DEP, registration_only: true }, gas: "30000000000000", deposit: "1250000000000000000000" },
      { type: "FunctionCall", methodName: "ft_transfer", args: { receiver_id: DEP, amount: "5000000" }, gas: "30000000000000", deposit: "1" },
    ]);
    expect(t.steps.map((s) => s.action)).toEqual([`storage_deposit on ${USDC}`, `ft_transfer on ${USDC}`]);
  });
  it("registered deposit account: ft_transfer only", async () => {
    const t = await buildDepositTransaction(nearRpc({ registered: true }), input);
    if (t.family !== "near") throw new Error("near");
    expect(t.actions.map((a) => (a as { methodName: string }).methodName)).toEqual(["ft_transfer"]);
  });
  it("a contract that does not report its storage minimum fails closed", async () => {
    await expect(buildDepositTransaction(nearRpc({ registered: false, bounds: null }), input)).rejects.toMatchObject({ code: "CHAIN_UNAVAILABLE" });
  });
});

describe("NEAR deposit verification with storage registration", () => {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
  const tx = (actions: unknown[], failure = false): ChainRpc => ({
    async call<T>(): Promise<T> {
      return { final_execution_status: "FINAL", status: failure ? { Failure: {} } : { SuccessValue: "" }, transaction: { signer_id: USER, receiver_id: USDC, actions }, receipts_outcome: [{ outcome: { status: failure ? { Failure: {} } : {} } }] } as T;
    },
  });
  const e = { network: "near", txHash: "h", sender: USER, depositAddress: DEP, amount: "5000000", kind: "NEP141" as const, tokenContract: USDC };
  it("storage_deposit plus ft_transfer of the exact amount: CONFIRMED; storage NEAR is not counted as the deposit", async () => {
    const r = await verifyNearDeposit(tx([
      { FunctionCall: { method_name: "storage_deposit", args: b64({ account_id: DEP, registration_only: true }), deposit: "1250000000000000000000" } },
      { FunctionCall: { method_name: "ft_transfer", args: b64({ receiver_id: DEP, amount: "5000000" }), deposit: "1" } },
    ]), e as never);
    expect(r).toMatchObject({ outcome: "CONFIRMED", observed: { tokenTransferred: "5000000" } });
  });
  it("ft_transfer that failed for lack of storage: FAILED, never confirmed", async () => {
    const r = await verifyNearDeposit(tx([{ FunctionCall: { method_name: "ft_transfer", args: b64({ receiver_id: DEP, amount: "5000000" }), deposit: "1" } }], true), e as never);
    expect(r.outcome).toBe("FAILED");
  });
});

describe("NEAR destination: storage registration is handled by 1Click (service, MOCKED provider and chain)", () => {
  async function approved(h: Awaited<ReturnType<typeof harness>>) {
    const u = await h.newUser();
    const r = await u.plan("Bridge 5 USDC from Base to NEAR");
    const wallets = await u.wallets();
    const x = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: `k-${Math.random()}`, wallets });
    const f = await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets });
    const a = await h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: f.quote.id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets });
    h.chain.setBalance("base", u.evm.address, 100_000_000n, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    return { u, ex: a.execution, wallets };
  }
  it("registered recipient: deposit instructions are issued", async () => {
    const h = await harness();
    const { u, ex, wallets } = await approved(h);
    expect(ex.destinationNetwork).toBe("near");
    expect((await h.deposits.prepare({ userId: u.userId, executionId: ex.id, wallets })).transaction.family).toBe("evm");
  });
  it("unregistered recipient: deposit instructions are still issued (1Click registers it and charges the quoted withdrawFee)", async () => {
    const h = await harness();
    const { u, ex, wallets } = await approved(h);
    h.chain.nearUnregistered.add(`${USDC}|${ex.recipient}`);
    expect((await h.deposits.prepare({ userId: u.userId, executionId: ex.id, wallets })).transaction.family).toBe("evm");
  });
});
