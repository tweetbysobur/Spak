import { beforeEach, describe, expect, it } from "vitest";
import { AuthService, CHALLENGE_TTL_MS, SESSION_IDLE_MS, SESSION_TTL_MS } from "@/auth/service";
import type { NearRpc } from "@/auth/verify/near";
import type { Db } from "@/database/repositories";
import { freshDb } from "./db";
import { evmWallet, nearWallet, solanaWallet } from "./keys";

const DOMAIN = "spak.test", URI = "https://spak.test";
let db: Db;
let now: number;
let svc: AuthService;
const rpc: NearRpc = { accessKey: async () => null };

beforeEach(async () => {
  db = await freshDb();
  now = Date.parse("2026-11-10T10:00:00Z");
  svc = new AuthService(db, { clock: () => new Date(now), nearRpc: rpc });
});

type W = ReturnType<typeof evmWallet> | ReturnType<typeof solanaWallet> | ReturnType<typeof nearWallet>;

async function signIn(w: W) {
  const c = await svc.createChallenge({ family: w.family, address: w.address, purpose: "SIGN_IN", domain: DOMAIN, uri: URI });
  const s = await w.sign(c.message, Buffer.from(c.nonce ?? "", "base64").toString("hex"), c.recipient ?? DOMAIN);
  return svc.verifyChallenge({ challengeId: c.challengeId, signature: s.signature, publicKey: (s as { publicKey?: string }).publicKey });
}
async function link(w: W, userId: string, currentUserId = userId) {
  const c = await svc.createChallenge({ family: w.family, address: w.address, purpose: "LINK", domain: DOMAIN, uri: URI, userId });
  const s = await w.sign(c.message, Buffer.from(c.nonce ?? "", "base64").toString("hex"), c.recipient ?? DOMAIN);
  return svc.verifyChallenge({ challengeId: c.challengeId, signature: s.signature, publicKey: (s as { publicKey?: string }).publicKey, currentUserId });
}

describe("authentication", () => {
  it("first sign-in creates a user, a verified wallet and a session; second sign-in reuses the user", async () => {
    const w = evmWallet();
    const a = await signIn(w);
    expect(a.created).toBe(true);
    expect(await svc.validateSession(a.session!.token)).toMatchObject({ userId: a.userId });
    const b = await signIn(w);
    expect(b).toMatchObject({ userId: a.userId, created: false });
    expect(b.session!.token).not.toBe(a.session!.token);
  });
  it("works for Solana and NEAR wallets", async () => {
    expect((await signIn(solanaWallet())).created).toBe(true);
    expect((await signIn(nearWallet())).created).toBe(true);
  });
  it("stores only a hash of the session token", async () => {
    const a = await signIn(evmWallet());
    const rows = await db.execute("select token_hash from spak_auth_sessions") as unknown as { rows: { token_hash: string }[] };
    expect(rows.rows[0].token_hash).not.toBe(a.session!.token);
    expect(rows.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("rejects unknown and malformed tokens", async () => {
    expect(await svc.validateSession("x".repeat(43))).toBeNull();
    expect(await svc.validateSession("")).toBeNull();
    expect(await svc.validateSession(null)).toBeNull();
  });
});

describe("session expiration and logout", () => {
  it("expires after the idle window", async () => {
    const { session } = await signIn(evmWallet());
    now += SESSION_IDLE_MS - 1000;
    expect(await svc.validateSession(session!.token)).not.toBeNull(); // touches lastSeenAt
    now += SESSION_IDLE_MS - 1000;
    expect(await svc.validateSession(session!.token)).not.toBeNull();
    now += SESSION_IDLE_MS + 1;
    expect(await svc.validateSession(session!.token)).toBeNull();
  });
  it("expires at the absolute lifetime even when used", async () => {
    const { session } = await signIn(evmWallet());
    for (let t = 0; t < SESSION_TTL_MS; t += 12 * 3_600_000) { now += 12 * 3_600_000; await svc.validateSession(session!.token); }
    expect(await svc.validateSession(session!.token)).toBeNull();
  });
  it("logout revokes one session; logoutAll revokes every session", async () => {
    const w = evmWallet();
    const a = await signIn(w), b = await signIn(w);
    await svc.logout(a.session!.token);
    expect(await svc.validateSession(a.session!.token)).toBeNull();
    expect(await svc.validateSession(b.session!.token)).not.toBeNull();
    await svc.logoutAll(b.userId);
    expect(await svc.validateSession(b.session!.token)).toBeNull();
  });
});

describe("signature verification and replay protection", () => {
  it("a challenge works once", async () => {
    const w = evmWallet();
    const c = await svc.createChallenge({ family: "evm", address: w.address, purpose: "SIGN_IN", domain: DOMAIN, uri: URI });
    const { signature } = await w.sign(c.message);
    await svc.verifyChallenge({ challengeId: c.challengeId, signature });
    await expect(svc.verifyChallenge({ challengeId: c.challengeId, signature })).rejects.toMatchObject({ code: "CHALLENGE_USED" });
  });
  it("concurrent replays of one signature create one session", async () => {
    const w = evmWallet();
    const c = await svc.createChallenge({ family: "evm", address: w.address, purpose: "SIGN_IN", domain: DOMAIN, uri: URI });
    const { signature } = await w.sign(c.message);
    const r = await Promise.allSettled([1, 2, 3].map(() => svc.verifyChallenge({ challengeId: c.challengeId, signature })));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });
  it("expired challenges are refused", async () => {
    const w = evmWallet();
    const c = await svc.createChallenge({ family: "evm", address: w.address, purpose: "SIGN_IN", domain: DOMAIN, uri: URI });
    const { signature } = await w.sign(c.message);
    now += CHALLENGE_TTL_MS + 1;
    await expect(svc.verifyChallenge({ challengeId: c.challengeId, signature })).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });
  it("a signature from a different wallet fails and burns the challenge", async () => {
    const victim = evmWallet(), attacker = evmWallet();
    const c = await svc.createChallenge({ family: "evm", address: victim.address, purpose: "SIGN_IN", domain: DOMAIN, uri: URI });
    const { signature } = await attacker.sign(c.message);
    await expect(svc.verifyChallenge({ challengeId: c.challengeId, signature })).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    const { signature: real } = await victim.sign(c.message);
    await expect(svc.verifyChallenge({ challengeId: c.challengeId, signature: real })).rejects.toMatchObject({ code: "CHALLENGE_USED" });
  });
  it("a signature over an old message does not open a new challenge", async () => {
    const w = evmWallet();
    const c1 = await svc.createChallenge({ family: "evm", address: w.address, purpose: "SIGN_IN", domain: DOMAIN, uri: URI });
    const { signature } = await w.sign(c1.message);
    await svc.verifyChallenge({ challengeId: c1.challengeId, signature });
    const c2 = await svc.createChallenge({ family: "evm", address: w.address, purpose: "SIGN_IN", domain: DOMAIN, uri: URI });
    await expect(svc.verifyChallenge({ challengeId: c2.challengeId, signature })).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
  });
  it("NEAR named accounts need a full-access key on chain", async () => {
    const w = nearWallet("alice.near");
    await expect(signIn(w)).rejects.toMatchObject({ code: "KEY_NOT_AUTHORIZED" });
    svc = new AuthService(db, { clock: () => new Date(now), nearRpc: { accessKey: async (a, k) => (a === "alice.near" && k === w.publicKey ? "FullAccess" : null) } });
    expect((await signIn(w)).created).toBe(true);
  });
  it("rejects invalid addresses before issuing a challenge", async () => {
    await expect(svc.createChallenge({ family: "evm", address: "0x123", purpose: "SIGN_IN", domain: DOMAIN, uri: URI })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    await expect(svc.createChallenge({ family: "solana", address: "0x1111111111111111111111111111111111111111", purpose: "SIGN_IN", domain: DOMAIN, uri: URI })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
  });
});

describe("wallet association", () => {
  it("links several wallets across families to one user", async () => {
    const a = await signIn(evmWallet());
    await link(solanaWallet(), a.userId);
    await link(nearWallet(), a.userId);
    await link(evmWallet(), a.userId);
    const ws = await svc.listWallets(a.userId);
    expect(ws.map((w) => w.family)).toEqual(["evm", "solana", "near", "evm"]);
    expect(ws.filter((w) => w.active)).toHaveLength(1);
  });
  it("cannot link a wallet owned by another user", async () => {
    const shared = evmWallet();
    await signIn(shared);
    const b = await signIn(evmWallet());
    await expect(link(shared, b.userId)).rejects.toMatchObject({ code: "WALLET_OWNED_BY_OTHER_USER" });
  });
  it("cannot complete another user's link challenge", async () => {
    const a = await signIn(evmWallet()), b = await signIn(evmWallet());
    await expect(link(solanaWallet(), a.userId, b.userId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("cannot link without a session", async () => {
    await expect(svc.createChallenge({ family: "evm", address: evmWallet().address, purpose: "LINK", domain: DOMAIN, uri: URI })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("cannot touch another user's wallets", async () => {
    const a = await signIn(evmWallet()), b = await signIn(evmWallet());
    await expect(svc.setActiveWallet(b.userId, a.walletId)).rejects.toMatchObject({ code: "WALLET_NOT_FOUND" });
    await expect(svc.removeWallet(b.userId, a.walletId)).rejects.toMatchObject({ code: "WALLET_NOT_FOUND" });
    await expect(svc.setWalletNetworks(b.userId, a.walletId, ["base"])).rejects.toMatchObject({ code: "WALLET_NOT_FOUND" });
  });
  it("disconnect: keeps at least one wallet and moves the active pointer", async () => {
    const a = await signIn(evmWallet());
    await expect(svc.removeWallet(a.userId, a.walletId)).rejects.toMatchObject({ code: "LAST_WALLET" });
    const l = await link(solanaWallet(), a.userId);
    await svc.removeWallet(a.userId, a.walletId);
    const ws = await svc.listWallets(a.userId);
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ id: l.walletId, active: true });
  });
});

describe("networks and SPak-in wallet context", () => {
  it("network switching changes which address SPak-in sees", async () => {
    const e1 = evmWallet(), e2 = evmWallet(), s = solanaWallet();
    const a = await signIn(e1);
    const l2 = await link(e2, a.userId);
    await link(s, a.userId);
    let ctx = await svc.walletContext(a.userId);
    expect(ctx).toMatchObject({ base: e1.address.toLowerCase(), arbitrum: e1.address.toLowerCase(), solana: s.address });
    await svc.setActiveWallet(a.userId, l2.walletId);
    ctx = await svc.walletContext(a.userId);
    expect(ctx.base).toBe(e2.address.toLowerCase());
    await svc.setWalletNetworks(a.userId, l2.walletId, ["arbitrum"]);
    ctx = await svc.walletContext(a.userId);
    expect(ctx.arbitrum).toBe(e2.address.toLowerCase());
    expect(ctx.base).toBe(e1.address.toLowerCase()); // falls back to the other wallet
    await expect(svc.setWalletNetworks(a.userId, l2.walletId, ["solana"])).rejects.toMatchObject({ code: "NETWORK_NOT_SUPPORTED" });
  });
});

describe("agent identity foundation", () => {
  it("links only a verified NEAR wallet of the same user", async () => {
    const a = await signIn(evmWallet());
    expect(await svc.getAgentIdentity(a.userId)).toMatchObject({ status: "NOT_LINKED" });
    await expect(svc.linkAgentAccount(a.userId, a.walletId)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const n = nearWallet();
    const l = await link(n, a.userId);
    expect(await svc.linkAgentAccount(a.userId, l.walletId)).toMatchObject({ status: "LINKED", nearAccountId: n.address });
    expect(await svc.unlinkAgentAccount(a.userId)).toMatchObject({ status: "NOT_LINKED" });
  });
});
