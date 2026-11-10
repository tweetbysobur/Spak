/** Destination-delivery verifiers against a MOCKED chain RPC (FakeChain). Real-chain checks: tests/live/tracking.live.test.ts. */
import { describe, expect, it } from "vitest";
import { verifyEvmDelivery, verifyNearDelivery, verifySolanaDelivery } from "@/tracking/verifiers";
import { FakeChain } from "../deposits/fake-chain";

const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const SOLVER = "0x5555555555555555555555555555555555555555", ME = "0x1111111111111111111111111111111111111111", OTHER = "0x3333333333333333333333333333333333333333";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", FAKE_TOKEN = "0x4444444444444444444444444444444444444444";
const evm = (n: number, o: object = {}) => ({ network: "base", txHash: H(n), recipient: ME, kind: "TOKEN" as const, tokenContract: USDC, ...o });

describe("EVM delivery (mocked)", () => {
  it("confirms a valid Transfer event to the recipient, summing several, from any emitting path", async () => {
    const c = new FakeChain();
    c.evmTx(H(1), { from: SOLVER, to: "0x9999999999999999999999999999999999999999", logs: [{ address: USDC, from: SOLVER, to: ME, amount: 3n }, { address: USDC, from: OTHER, to: ME, amount: 4n }, { address: USDC, from: SOLVER, to: OTHER, amount: 100n }] });
    expect(await verifyEvmDelivery(c, evm(1))).toMatchObject({ outcome: "CONFIRMED", received: "7" });
  });
  it("wrong recipient, wrong token contract, failed tx, insufficient confirmations, unknown", async () => {
    const c = new FakeChain();
    c.evmTx(H(2), { from: SOLVER, to: USDC, logs: [{ address: USDC, from: SOLVER, to: OTHER, amount: 5n }] });
    expect((await verifyEvmDelivery(c, evm(2))).outcome).toBe("NO_TRANSFER");
    c.evmTx(H(3), { from: SOLVER, to: FAKE_TOKEN, logs: [{ address: FAKE_TOKEN, from: SOLVER, to: ME, amount: 5n }] });
    const wrongToken = await verifyEvmDelivery(c, evm(3));
    expect(wrongToken).toMatchObject({ outcome: "NO_TRANSFER" });
    expect(wrongToken.problems[0]).toMatch(/different token/);
    c.evmTx(H(4), { from: SOLVER, to: USDC, status: "0x0", logs: [] });
    expect((await verifyEvmDelivery(c, evm(4))).outcome).toBe("FAILED");
    c.evmTx(H(5), { from: SOLVER, to: USDC, block: c.evmHead, logs: [{ address: USDC, from: SOLVER, to: ME, amount: 5n }] });
    expect(await verifyEvmDelivery(c, evm(5))).toMatchObject({ outcome: "PENDING", confirmations: 1, received: "5" });
    expect((await verifyEvmDelivery(c, evm(6))).outcome).toBe("NOT_FOUND");
  });
  it("native: direct transfer counts; internal transfers are unverifiable, never assumed", async () => {
    const c = new FakeChain();
    c.evmTx(H(7), { from: SOLVER, to: ME, value: 10n });
    expect(await verifyEvmDelivery(c, evm(7, { kind: "NATIVE", tokenContract: null }))).toMatchObject({ outcome: "CONFIRMED", received: "10" });
    c.evmTx(H(8), { from: SOLVER, to: OTHER, value: 10n });
    expect((await verifyEvmDelivery(c, evm(8, { kind: "NATIVE", tokenContract: null }))).outcome).toBe("UNVERIFIABLE");
  });
});

const R = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", SOLV = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", WSOL = "So11111111111111111111111111111111111111112";
const tb = (owner: string, amount: string, mint = MINT) => ({ accountIndex: 2, mint, owner, uiTokenAmount: { amount } });
const sol = (sig: string, o: object = {}) => ({ network: "solana", txHash: sig, recipient: R, kind: "TOKEN" as const, tokenContract: MINT, ...o });

describe("Solana delivery (mocked)", () => {
  it("confirms SPL by the recipient owner's balance change (new token account included); native SOL by lamports", async () => {
    const c = new FakeChain();
    c.solTx("s1", { feePayer: SOLV, preToken: [], postToken: [tb(R, "900")] });
    expect(await verifySolanaDelivery(c, sol("s1"))).toMatchObject({ outcome: "CONFIRMED", received: "900" });
    c.solTx("s2", { feePayer: SOLV, keys: [SOLV, R], pre: [10_000, 5], post: [4_000, 6_005] });
    expect(await verifySolanaDelivery(c, sol("s2", { kind: "NATIVE", tokenContract: null }))).toMatchObject({ outcome: "CONFIRMED", received: "6000" });
  });
  it("wrong recipient, wrong mint (wrapped SOL is not native), failed, non-finalized, unknown", async () => {
    const c = new FakeChain();
    c.solTx("w1", { feePayer: SOLV, postToken: [tb(SOLV, "900")] });
    expect((await verifySolanaDelivery(c, sol("w1"))).outcome).toBe("NO_TRANSFER");
    c.solTx("w2", { feePayer: SOLV, postToken: [tb(R, "900", WSOL)] });
    expect((await verifySolanaDelivery(c, sol("w2"))).outcome).toBe("NO_TRANSFER");
    expect((await verifySolanaDelivery(c, sol("w2", { kind: "NATIVE", tokenContract: null }))).outcome).toBe("NO_TRANSFER");
    c.solTx("f1", { feePayer: SOLV, err: { InstructionError: [0, "x"] } });
    expect((await verifySolanaDelivery(c, sol("f1"))).outcome).toBe("FAILED");
    c.solTx("p1", { feePayer: SOLV, postToken: [tb(R, "900")], status: "confirmed" });
    expect(await verifySolanaDelivery(c, sol("p1"))).toMatchObject({ outcome: "PENDING", received: "900" });
    expect((await verifySolanaDelivery(c, sol("none"))).outcome).toBe("NOT_FOUND");
  });
});

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const near = (h: string, o: object = {}) => ({ network: "near", txHash: h, recipient: "me.near", kind: "TOKEN" as const, tokenContract: "usdc.near", ...o });
describe("NEAR delivery (mocked)", () => {
  it("confirms ft_transfer receipts and native Transfer receipts to the recipient; ignores gas refunds", async () => {
    const c = new FakeChain();
    c.nearRxTx("n1", { receipts: [{ id: "r1", receiver: "usdc.near", actions: [{ FunctionCall: { method_name: "ft_transfer", args: b64({ receiver_id: "me.near", amount: "77" }) } }] }] });
    expect(await verifyNearDelivery(c, near("n1"))).toMatchObject({ outcome: "CONFIRMED", received: "77" });
    c.nearRxTx("n2", { receipts: [{ id: "r1", receiver: "me.near", actions: [{ Transfer: { deposit: "1000" } }] }, { id: "r2", receiver: "me.near", predecessor: "system", actions: [{ Transfer: { deposit: "5" } }] }] });
    expect(await verifyNearDelivery(c, near("n2", { kind: "NATIVE", tokenContract: null }))).toMatchObject({ outcome: "CONFIRMED", received: "1000" });
  });
  it("wrong recipient, failed receipt, failed tx, non-final, unknown", async () => {
    const c = new FakeChain();
    c.nearRxTx("a", { receipts: [{ id: "r", receiver: "usdc.near", actions: [{ FunctionCall: { method_name: "ft_transfer", args: b64({ receiver_id: "x.near", amount: "77" }) } }] }] });
    expect((await verifyNearDelivery(c, near("a"))).outcome).toBe("NO_TRANSFER");
    c.nearRxTx("b", { receipts: [{ id: "r", receiver: "usdc.near", failed: true, actions: [{ FunctionCall: { method_name: "ft_transfer", args: b64({ receiver_id: "me.near", amount: "77" }) } }] }] });
    expect((await verifyNearDelivery(c, near("b"))).outcome).toBe("NO_TRANSFER");
    c.nearRxTx("c", { failure: true, receipts: [] });
    expect((await verifyNearDelivery(c, near("c"))).outcome).toBe("FAILED");
    c.nearRxTx("d", { final: false, receipts: [{ id: "r", receiver: "usdc.near", actions: [{ FunctionCall: { method_name: "ft_transfer", args: b64({ receiver_id: "me.near", amount: "77" }) } }] }] });
    expect((await verifyNearDelivery(c, near("d"))).outcome).toBe("PENDING");
    expect((await verifyNearDelivery(c, near("zz"))).outcome).toBe("NOT_FOUND");
  });
});
