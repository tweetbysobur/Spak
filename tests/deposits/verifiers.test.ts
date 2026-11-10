/** On-chain verifiers against a MOCKED chain RPC (FakeChain). Real-chain checks live in tests/live. */
import { describe, expect, it } from "vitest";
import { verifyEvmDeposit, verifyNearDeposit, verifySolanaDeposit } from "@/deposits/verifiers";
import { canMove } from "@/deposits/types";
import { FakeChain } from "./fake-chain";

const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const ME = "0x1111111111111111111111111111111111111111", DEP = "0x2222222222222222222222222222222222222222", OTHER = "0x3333333333333333333333333333333333333333";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const evm = (o: Partial<Parameters<typeof verifyEvmDeposit>[1]> = {}) => ({ network: "base", kind: "NATIVE" as const, txHash: H(1), sender: ME, depositAddress: DEP, amount: "1000", tokenContract: null, chainId: 8453, decimals: 18, ...o });

describe("EVM verifier", () => {
  it("confirms a native deposit with enough confirmations", async () => {
    const c = new FakeChain(); c.evmTx(H(1), { from: ME, to: DEP, value: 1000n, chainId: 8453 });
    expect(await verifyEvmDeposit(c, evm())).toMatchObject({ outcome: "CONFIRMED", confirmations: 11 });
  });
  it("confirms an ERC-20 deposit from Transfer logs", async () => {
    const c = new FakeChain(); c.evmTx(H(2), { from: ME, to: USDC, logs: [{ address: USDC, from: ME, to: DEP, amount: 5_000_000n }] });
    expect((await verifyEvmDeposit(c, evm({ txHash: H(2), kind: "ERC20", tokenContract: USDC, amount: "5000000" }))).outcome).toBe("CONFIRMED");
  });
  it("rejects wrong address, wrong amount, wrong sender, wrong chain", async () => {
    const c = new FakeChain();
    c.evmTx(H(3), { from: ME, to: OTHER, value: 1000n });
    c.evmTx(H(4), { from: ME, to: DEP, value: 999n });
    c.evmTx(H(5), { from: OTHER, to: DEP, value: 1000n });
    c.evmTx(H(6), { from: ME, to: DEP, value: 1000n, chainId: 1 });
    for (const n of [3, 4, 5, 6]) expect((await verifyEvmDeposit(c, evm({ txHash: H(n) }))).outcome).toBe("MISMATCH");
  });
  it("rejects a wrong token, a wrong token amount and a token sent elsewhere", async () => {
    const c = new FakeChain();
    const fake = "0x4444444444444444444444444444444444444444";
    c.evmTx(H(7), { from: ME, to: fake, logs: [{ address: fake, from: ME, to: DEP, amount: 5_000_000n }] });
    c.evmTx(H(8), { from: ME, to: USDC, logs: [{ address: USDC, from: ME, to: DEP, amount: 4_000_000n }] });
    c.evmTx(H(9), { from: ME, to: USDC, logs: [{ address: USDC, from: ME, to: OTHER, amount: 5_000_000n }] });
    for (const n of [7, 8, 9]) expect((await verifyEvmDeposit(c, evm({ txHash: H(n), kind: "ERC20", tokenContract: USDC, amount: "5000000" }))).outcome).toBe("MISMATCH");
  });
  it("reports unknown, unmined, under-confirmed and reverted transactions", async () => {
    const c = new FakeChain();
    expect((await verifyEvmDeposit(c, evm({ txHash: H(99) }))).outcome).toBe("NOT_FOUND");
    c.evmTx(H(10), { from: ME, to: DEP, value: 1000n, block: null });
    expect((await verifyEvmDeposit(c, evm({ txHash: H(10) }))).outcome).toBe("PENDING");
    c.evmTx(H(11), { from: ME, to: DEP, value: 1000n, block: c.evmHead });
    expect(await verifyEvmDeposit(c, evm({ txHash: H(11) }))).toMatchObject({ outcome: "PENDING", confirmations: 1 });
    c.evmTx(H(12), { from: ME, to: DEP, value: 1000n, status: "0x0" });
    expect((await verifyEvmDeposit(c, evm({ txHash: H(12) }))).outcome).toBe("FAILED");
  });
});

const SME = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", SDEP = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const sol = (o: object = {}) => ({ network: "solana", kind: "NATIVE" as const, txHash: "sig1", sender: SME, depositAddress: SDEP, amount: "5000", tokenContract: null, chainId: null, decimals: 9, ...o });
const tb = (owner: string, amount: string, mint = MINT) => ({ accountIndex: 1, mint, owner, uiTokenAmount: { amount } });

describe("Solana verifier", () => {
  it("confirms native SOL by the deposit account's balance change, only when finalized", async () => {
    const c = new FakeChain();
    c.solTx("sig1", { feePayer: SME, keys: [SME, SDEP], pre: [10000, 0], post: [4000, 5000] });
    expect((await verifySolanaDeposit(c, sol())).outcome).toBe("CONFIRMED");
    c.solTx("sig2", { feePayer: SME, keys: [SME, SDEP], pre: [10000, 0], post: [4000, 5000], status: "confirmed" });
    expect((await verifySolanaDeposit(c, sol({ txHash: "sig2" }))).outcome).toBe("PENDING");
  });
  it("confirms an SPL deposit by the owner's token balance change", async () => {
    const c = new FakeChain();
    c.solTx("sig3", { feePayer: SME, preToken: [tb(SDEP, "0")], postToken: [tb(SDEP, "5000")] });
    expect((await verifySolanaDeposit(c, sol({ txHash: "sig3", kind: "SPL", tokenContract: MINT }))).outcome).toBe("CONFIRMED");
  });
  it("rejects wrong mint, wrong amount, wrong payer; reports failed and unknown", async () => {
    const c = new FakeChain();
    c.solTx("w1", { feePayer: SME, postToken: [tb(SDEP, "5000", "So11111111111111111111111111111111111111112")] });
    c.solTx("w2", { feePayer: SME, postToken: [tb(SDEP, "4999")] });
    c.solTx("w3", { feePayer: SDEP, postToken: [tb(SDEP, "5000")] });
    for (const s of ["w1", "w2", "w3"]) expect((await verifySolanaDeposit(c, sol({ txHash: s, kind: "SPL", tokenContract: MINT }))).outcome).toBe("MISMATCH");
    c.solTx("f1", { feePayer: SME, err: { InstructionError: [0, "Custom"] } });
    expect((await verifySolanaDeposit(c, sol({ txHash: "f1" }))).outcome).toBe("FAILED");
    expect((await verifySolanaDeposit(c, sol({ txHash: "none" }))).outcome).toBe("NOT_FOUND");
  });
});

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const near = (o: object = {}) => ({ network: "near", kind: "NATIVE" as const, txHash: "nh1", sender: "me.near", depositAddress: "dep.near", amount: "1000", tokenContract: null, chainId: null, decimals: 24, ...o });
describe("NEAR verifier", () => {
  it("confirms a native Transfer and an ft_transfer at FINAL", async () => {
    const c = new FakeChain();
    c.nearTx("nh1", { signer: "me.near", receiver: "dep.near", actions: [{ Transfer: { deposit: "1000" } }] });
    expect((await verifyNearDeposit(c, near())).outcome).toBe("CONFIRMED");
    c.nearTx("nh2", { signer: "me.near", receiver: "usdc.near", actions: [{ FunctionCall: { method_name: "ft_transfer", args: b64({ receiver_id: "dep.near", amount: "1000" }), deposit: "1" } }] });
    expect((await verifyNearDeposit(c, near({ txHash: "nh2", kind: "NEP141", tokenContract: "usdc.near" }))).outcome).toBe("CONFIRMED");
  });
  it("rejects mismatches, reports failure, non-final and unknown", async () => {
    const c = new FakeChain();
    c.nearTx("a", { signer: "me.near", receiver: "x.near", actions: [{ Transfer: { deposit: "1000" } }] });
    c.nearTx("b", { signer: "other.near", receiver: "dep.near", actions: [{ Transfer: { deposit: "1000" } }] });
    c.nearTx("c", { signer: "me.near", receiver: "dep.near", actions: [{ Transfer: { deposit: "1" } }] });
    for (const t of ["a", "b", "c"]) expect((await verifyNearDeposit(c, near({ txHash: t }))).outcome).toBe("MISMATCH");
    c.nearTx("d", { signer: "me.near", receiver: "dep.near", actions: [{ Transfer: { deposit: "1000" } }], failure: true });
    expect((await verifyNearDeposit(c, near({ txHash: "d" }))).outcome).toBe("FAILED");
    c.nearTx("e", { signer: "me.near", receiver: "dep.near", actions: [{ Transfer: { deposit: "1000" } }], final: false });
    expect((await verifyNearDeposit(c, near({ txHash: "e" }))).outcome).toBe("PENDING");
    expect((await verifyNearDeposit(c, near({ txHash: "zz" }))).outcome).toBe("NOT_FOUND");
  });
});

describe("deposit state machine", () => {
  it("allows only forward moves and keeps final states final", () => {
    expect(canMove("WALLET_CONFIRMATION_REQUESTED", "SUBMITTED")).toBe(true);
    expect(canMove("SUBMITTED", "CONFIRMED")).toBe(true);
    expect(canMove("WALLET_CONFIRMATION_REQUESTED", "CONFIRMED")).toBe(false); // never confirmed without a tx reference
    for (const s of ["CONFIRMED", "REJECTED", "FAILED", "EXPIRED"] as const) expect(canMove(s, "VERIFICATION_PENDING")).toBe(false);
  });
});
