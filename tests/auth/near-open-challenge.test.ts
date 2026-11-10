import { beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "@/auth/service";
import type { Db } from "@/database/repositories";
import { freshDb } from "./db";
import { evmWallet, nearWallet } from "./keys";

let svc: AuthService;
let db: Db;
const D = { domain: "spak.test", uri: "https://spak.test" };
beforeEach(async () => { db = await freshDb(); svc = new AuthService(db, { nearRpc: { accessKey: async () => null } }); });

const nonceHex = (b64?: string) => Buffer.from(b64 ?? "", "base64").toString("hex");

describe("NEAR challenges where the wallet picks the account (NEP-413)", () => {
  it("binds the account the wallet signed with", async () => {
    const w = nearWallet();
    const c = await svc.createChallenge({ family: "near", purpose: "SIGN_IN", ...D });
    expect(c.message).not.toContain(w.address);
    expect(c.message).toMatch(/sign in with your NEAR account:\n\n/);
    const s = await w.sign(c.message, nonceHex(c.nonce), c.recipient!);
    const r = await svc.verifyChallenge({ challengeId: c.challengeId, signature: s.signature, publicKey: s.publicKey, accountId: w.address });
    expect(r.created).toBe(true);
    expect((await svc.listWallets(r.userId))[0]).toMatchObject({ family: "near", address: w.address });
  });
  it("cannot claim an account the key does not control", async () => {
    const attacker = nearWallet(), victim = nearWallet();
    const c = await svc.createChallenge({ family: "near", purpose: "SIGN_IN", ...D });
    const s = await attacker.sign(c.message, nonceHex(c.nonce), c.recipient!);
    await expect(svc.verifyChallenge({ challengeId: c.challengeId, signature: s.signature, publicKey: s.publicKey, accountId: victim.address })).rejects.toMatchObject({ code: "KEY_NOT_AUTHORIZED" });
  });
  it("requires the account id, and rejects a mismatch on account-bound challenges", async () => {
    const w = nearWallet();
    const open = await svc.createChallenge({ family: "near", purpose: "SIGN_IN", ...D });
    const s = await w.sign(open.message, nonceHex(open.nonce), open.recipient!);
    await expect(svc.verifyChallenge({ challengeId: open.challengeId, signature: s.signature, publicKey: s.publicKey })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const bound = await svc.createChallenge({ family: "near", address: w.address, purpose: "SIGN_IN", ...D });
    const s2 = await w.sign(bound.message, nonceHex(bound.nonce), bound.recipient!);
    await expect(svc.verifyChallenge({ challengeId: bound.challengeId, signature: s2.signature, publicKey: s2.publicKey, accountId: "someone.near" })).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
  });
  it("is still one-time", async () => {
    const w = nearWallet();
    const c = await svc.createChallenge({ family: "near", purpose: "SIGN_IN", ...D });
    const s = await w.sign(c.message, nonceHex(c.nonce), c.recipient!);
    await svc.verifyChallenge({ challengeId: c.challengeId, signature: s.signature, publicKey: s.publicKey, accountId: w.address });
    await expect(svc.verifyChallenge({ challengeId: c.challengeId, signature: s.signature, publicKey: s.publicKey, accountId: w.address })).rejects.toMatchObject({ code: "CHALLENGE_USED" });
  });
  it("links an open-challenge NEAR wallet to the signed-in user only", async () => {
    const owner = await (async () => {
      const e = evmWallet();
      const c = await svc.createChallenge({ family: "evm", address: e.address, purpose: "SIGN_IN", ...D });
      return svc.verifyChallenge({ challengeId: c.challengeId, signature: (await e.sign(c.message)).signature });
    })();
    const n = nearWallet();
    const c = await svc.createChallenge({ family: "near", purpose: "LINK", userId: owner.userId, ...D });
    const s = await n.sign(c.message, nonceHex(c.nonce), c.recipient!);
    const r = await svc.verifyChallenge({ challengeId: c.challengeId, signature: s.signature, publicKey: s.publicKey, accountId: n.address, currentUserId: owner.userId });
    expect(r.userId).toBe(owner.userId);
  });
  it("EVM and Solana still require an address", async () => {
    await expect(svc.createChallenge({ family: "evm", purpose: "SIGN_IN", ...D })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    await expect(svc.createChallenge({ family: "solana", purpose: "SIGN_IN", ...D })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
  });
});
