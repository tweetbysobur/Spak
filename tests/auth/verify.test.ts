import { describe, expect, it } from "vitest";
import { verifyEvmSignature } from "@/auth/verify/evm";
import { verifySolanaSignature } from "@/auth/verify/solana";
import { nep413Payload, verifyNearSignature, type NearRpc } from "@/auth/verify/near";
import { buildChallengeMessage } from "@/auth/messages";
import { evmWallet, nearWallet, solanaWallet } from "./keys";

const NONCE = "a".repeat(64);
const msg = (family: "evm" | "solana" | "near", address: string) => buildChallengeMessage({
  family, address, purpose: "SIGN_IN", domain: "spak.test", uri: "https://spak.test", nonce: NONCE,
  issuedAt: new Date("2026-11-10T10:00:00Z"), expiresAt: new Date("2026-11-10T10:05:00Z"),
});

describe("EVM (EIP-4361 + EIP-191)", () => {
  it("accepts the owner's signature and rejects others", async () => {
    const w = evmWallet(), other = evmWallet();
    const m = msg("evm", w.address);
    expect(m).toContain("spak.test wants you to sign in with your Ethereum account");
    expect(m).toContain(`Nonce: ${NONCE}`);
    const { signature } = await w.sign(m);
    expect(await verifyEvmSignature(w.address, m, signature)).toBe(true);
    expect(await verifyEvmSignature(other.address, m, signature)).toBe(false);
    expect(await verifyEvmSignature(w.address, m + " ", signature)).toBe(false);
    expect(await verifyEvmSignature(w.address, m, "0xdeadbeef")).toBe(false);
  });
});

describe("Solana (Wallet Standard signMessage, ed25519)", () => {
  it("accepts the owner's signature and rejects tampering", async () => {
    const w = solanaWallet(), other = solanaWallet();
    const m = msg("solana", w.address);
    const { signature } = await w.sign(m);
    expect(verifySolanaSignature(w.address, m, signature)).toBe(true);
    expect(verifySolanaSignature(other.address, m, signature)).toBe(false);
    expect(verifySolanaSignature(w.address, m.replace("SPak", "Evil"), signature)).toBe(false);
    expect(verifySolanaSignature(w.address, m, "not-base64!")).toBe(false);
  });
});

describe("NEAR (NEP-413)", () => {
  const noRpc: NearRpc = { accessKey: async () => { throw new Error("must not call RPC for implicit accounts"); } };
  it("serializes the payload per NEP-413", () => {
    const p = nep413Payload("hi", new Uint8Array(32), "spak.test");
    expect(Array.from(p.slice(0, 4))).toEqual([157, 1, 0, 128]); // 2^31 + 413, little-endian
    expect(p.length).toBe(4 + 4 + 2 + 32 + 4 + 9 + 1);
  });
  it("implicit accounts: key must equal the account id", async () => {
    const w = nearWallet();
    const m = msg("near", w.address);
    const s = await w.sign(m, NONCE, "spak.test");
    expect(await verifyNearSignature({ accountId: w.address, publicKey: s.publicKey, signatureB64: s.signature, message: m, nonceHex: NONCE, recipient: "spak.test", rpc: noRpc })).toBe(true);
    expect(await verifyNearSignature({ accountId: w.address, publicKey: s.publicKey, signatureB64: s.signature, message: m, nonceHex: NONCE, recipient: "evil.test", rpc: noRpc })).toBe(false);
    const other = nearWallet();
    await expect(verifyNearSignature({ accountId: other.address, publicKey: s.publicKey, signatureB64: s.signature, message: m, nonceHex: NONCE, recipient: "spak.test", rpc: noRpc })).rejects.toMatchObject({ code: "KEY_NOT_AUTHORIZED" });
  });
  it("named accounts: requires a FullAccess key on chain", async () => {
    const w = nearWallet("alice.near");
    const m = msg("near", w.address);
    const s = await w.sign(m, NONCE, "spak.test");
    const args = { accountId: "alice.near", publicKey: s.publicKey, signatureB64: s.signature, message: m, nonceHex: NONCE, recipient: "spak.test" };
    const rpc = (perm: "FullAccess" | "FunctionCall" | null): NearRpc => ({ accessKey: async (a, k) => (a === "alice.near" && k === s.publicKey ? perm : null) });
    expect(await verifyNearSignature({ ...args, rpc: rpc("FullAccess") })).toBe(true);
    await expect(verifyNearSignature({ ...args, rpc: rpc("FunctionCall") })).rejects.toMatchObject({ code: "KEY_NOT_AUTHORIZED" });
    await expect(verifyNearSignature({ ...args, rpc: rpc(null) })).rejects.toMatchObject({ code: "KEY_NOT_AUTHORIZED" });
  });
});
