/**
 * Agent wallet association. Real SQL (PGlite with the real migrations), real EVM (secp256k1), Solana (ed25519) and
 * NEAR (NEP-413) signatures. MOCKED: NEAR RPC access-key lookup only.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { base64, hex } from "@scure/base";
import { AuthService } from "@/auth/service";
import { AuthError } from "@/auth/types";
import { AgentService, OWNERSHIP_VALID_MS } from "@/agents/service";
import { ASSOCIATION_VALID_MS, AgentWalletService, MAX_ASSOCIATIONS, associationUsable } from "@/agents/wallets";
import { agentWallets, agents, wallets } from "@/database/schema";
import type { Db } from "@/database/repositories";
import type { NearRpc } from "@/auth/verify/near";
import { freshDb } from "../auth/db";
import { evmWallet, nearWallet, solanaWallet } from "../auth/keys";

const DOMAIN = "spak.test", URI = "https://spak.test";
let db: Db, auth: AuthService, agentsSvc: AgentService, svc: AgentWalletService;
const clock = { now: Date.parse("2026-11-13T10:00:00Z") };
const keys = new Map<string, "FullAccess" | "FunctionCall">();
let rpcDown = false;
const rpc: NearRpc = { accessKey: async (a, k) => { if (rpcDown) throw new AuthError("NEAR_RPC_UNAVAILABLE", "down"); return keys.get(`${a}|${k}`) ?? null; } };
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } };

/** A signed-in user with an EVM, a Solana and a named NEAR wallet linked, and a verified Agent. */
async function setup(opts: { verify?: boolean } = {}) {
  const e = evmWallet(), s = solanaWallet(), nearId = `n${Math.random().toString(36).slice(2, 9)}.near`, n = nearWallet(nearId);
  keys.set(`${nearId}|${n.publicKey}`, "FullAccess");
  const c = await auth.createChallenge({ family: "evm", address: e.address, purpose: "SIGN_IN", domain: DOMAIN, uri: URI });
  const { userId } = await auth.verifyChallenge({ challengeId: c.challengeId, signature: (await e.sign(c.message)).signature });
  const l = await auth.createChallenge({ family: "solana", address: s.address, purpose: "LINK", domain: DOMAIN, uri: URI, userId });
  await auth.verifyChallenge({ challengeId: l.challengeId, signature: (await s.sign(l.message)).signature, currentUserId: userId });
  const nl = await auth.createChallenge({ family: "near", purpose: "LINK", domain: DOMAIN, uri: URI, userId });
  const ns = await n.sign(nl.message, Buffer.from(nl.nonce!, "base64").toString("hex"), nl.recipient!);
  await auth.verifyChallenge({ challengeId: nl.challengeId, signature: ns.signature, publicKey: ns.publicKey, accountId: nearId, currentUserId: userId });
  const ws = await auth.listWallets(userId);
  const id = (f: string) => ws.find((w) => w.family === f)!.id;
  const agent = await agentsSvc.create(userId, "Agent");
  // Agent owner: a separate implicit NEAR account (id = hex public key).
  const owner = nearWallet();
  if (opts.verify !== false) {
    const ch = await agentsSvc.challenge(userId, agent.id, { accountId: owner.address, domain: DOMAIN });
    const sig = await owner.sign(ch.message, hex.encode(base64.decode(ch.nonce)), ch.recipient);
    await agentsSvc.verify(userId, agent.id, { challengeId: ch.challengeId, method: ch.method, accountId: owner.address, publicKey: sig.publicKey, signature: sig.signature, domain: DOMAIN });
  }
  return { userId, agentId: agent.id, evm: e, sol: s, near: n, nearId, owner, ids: { evm: id("evm"), solana: id("solana"), near: id("near") } };
}
type U = Awaited<ReturnType<typeof setup>>;

/** Start and sign an association for one family. */
async function associate(u: U, family: "evm" | "solana" | "near", o: { chainId?: number; tamper?: (m: string) => string; signer?: { sign: (m: string, ...a: string[]) => Promise<{ signature: string; publicKey?: string }> } } = {}) {
  const c = await svc.challenge(u.userId, u.agentId, { walletId: u.ids[family], chainId: family === "evm" ? (o.chainId ?? 8453) : undefined, domain: DOMAIN, uri: URI });
  const msg = o.tamper ? o.tamper(c.message) : c.message;
  let proof: { challengeId: string; signature: string; publicKey?: string; accountId?: string; domain: string };
  if (family === "near") {
    const s = await (o.signer ?? u.near).sign(msg, hex.encode(base64.decode(c.nonce!)), c.recipient!);
    proof = { challengeId: c.challengeId, signature: s.signature, publicKey: s.publicKey, accountId: u.nearId, domain: DOMAIN };
  } else {
    const s = await (o.signer ?? (family === "evm" ? u.evm : u.sol)).sign(msg);
    proof = { challengeId: c.challengeId, signature: s.signature, domain: DOMAIN };
  }
  return { c, proof };
}

beforeEach(async () => {
  db = await freshDb(); keys.clear(); rpcDown = false; clock.now = Date.parse("2026-11-13T10:00:00Z");
  const now = () => new Date(clock.now);
  auth = new AuthService(db, { clock: now, nearRpc: rpc });
  agentsSvc = new AgentService(db, { clock: now, nearRpc: rpc });
  svc = new AgentWalletService(db, { clock: now, nearRpc: rpc });
});

describe("eligibility", () => {
  it("only a verified, in-date, active Agent can start an association", async () => {
    const un = await setup({ verify: false });
    expect(await code(svc.challenge(un.userId, un.agentId, { walletId: un.ids.solana, domain: DOMAIN, uri: URI }))).toBe("AGENT_INVALID_STATE");
    const u = await setup();
    expect(await code(svc.challenge(u.userId, u.agentId, { walletId: u.ids.solana, domain: DOMAIN, uri: URI }))).toBe("OK");
    clock.now += OWNERSHIP_VALID_MS + 1;
    expect(await code(svc.challenge(u.userId, u.agentId, { walletId: u.ids.solana, domain: DOMAIN, uri: URI }))).toBe("AGENT_INVALID_STATE");
  });
  it("suspended and revoked Agents cannot add wallets", async () => {
    const u = await setup();
    await agentsSvc.suspend(u.userId, u.agentId);
    expect(await code(svc.challenge(u.userId, u.agentId, { walletId: u.ids.solana, domain: DOMAIN, uri: URI }))).toBe("AGENT_INVALID_STATE");
    await agentsSvc.revoke(u.userId, u.agentId, "REVOKE");
    expect(await code(svc.challenge(u.userId, u.agentId, { walletId: u.ids.solana, domain: DOMAIN, uri: URI }))).toBe("AGENT_REVOKED");
  });
  it("another user's Agent, wallet or association is not found", async () => {
    const [u1, u2] = [await setup(), await setup()];
    expect(await code(svc.challenge(u2.userId, u1.agentId, { walletId: u1.ids.solana, domain: DOMAIN, uri: URI }))).toBe("AGENT_NOT_FOUND");
    expect(await code(svc.challenge(u2.userId, u2.agentId, { walletId: u1.ids.solana, domain: DOMAIN, uri: URI }))).toBe("AGENT_NOT_FOUND");
    const { c, proof } = await associate(u1, "solana");
    expect(await code(svc.verify(u2.userId, u2.agentId, proof))).toBe("AGENT_CHALLENGE_INVALID");
    expect(await code(svc.get(u2.userId, u1.agentId, c.associationId))).toBe("AGENT_NOT_FOUND");
    expect(await code(svc.remove(u2.userId, u2.agentId, c.associationId, "REMOVED"))).toBe("AGENT_NOT_FOUND");
    expect(await code(svc.events(u2.userId, u2.agentId, c.associationId))).toBe("AGENT_NOT_FOUND");
  });
  it("the Agent owner NEAR account is not an ordinary association", async () => {
    const u = await setup();
    // Link the owner account as a wallet, then try to associate it.
    const [a] = await db.select().from(agents).where(sql`${agents.id} = ${u.agentId}`);
    await db.update(wallets).set({ address: a.ownerAccountId! }).where(sql`${wallets.id} = ${u.ids.near}`);
    expect(await code(svc.challenge(u.userId, u.agentId, { walletId: u.ids.near, domain: DOMAIN, uri: URI }))).toBe("AGENT_BAD_REQUEST");
  });
});

describe("EVM (EIP-4361, personal_sign)", () => {
  it("valid signature associates; message binds domain, Agent, owner, address, chain, purpose, nonce, times, request id", async () => {
    const u = await setup();
    const { c, proof } = await associate(u, "evm");
    for (const s of [DOMAIN, `urn:spak:agent:${u.agentId}`, "urn:spak:owner:spak-user:", "urn:spak:purpose:AGENT_WALLET_ASSOCIATION", "Chain ID: 8453", `Request ID: ${c.challengeId}`, "Expiration Time:", "Issued At:", "Nonce:"]) expect(c.message).toContain(s);
    expect(c.message).toContain(u.evm.address); // EIP-55 checksummed
    expect(c.message).not.toContain(u.userId);
    const a = await svc.verify(u.userId, u.agentId, proof);
    expect(a).toMatchObject({ status: "ACTIVE", family: "evm", network: "base", chainId: 8453, address: u.evm.address.toLowerCase(), method: "EIP4361_PERSONAL_SIGN", signingAuthority: "NONE" });
    expect(Date.parse(a.expiresAt!) - Date.parse(a.verifiedAt!)).toBe(ASSOCIATION_VALID_MS);
  });
  it("invalid signature, another wallet's signature and an altered message are refused", async () => {
    const u = await setup();
    const a = await associate(u, "evm", { signer: evmWallet() });
    expect(await code(svc.verify(u.userId, u.agentId, a.proof))).toBe("AGENT_PROOF_INVALID");
    const b = await associate(u, "evm", { tamper: (m) => m.replace("Chain ID: 8453", "Chain ID: 1") });
    expect(await code(svc.verify(u.userId, u.agentId, b.proof))).toBe("AGENT_PROOF_INVALID");
    const c = await associate(u, "evm");
    expect(await code(svc.verify(u.userId, u.agentId, { ...c.proof, signature: "not-hex" }))).toBe("AGENT_PROOF_INVALID");
  });
  it("unsupported chain ids are refused; the chain is part of the signed message", async () => {
    const u = await setup();
    expect(await code(svc.challenge(u.userId, u.agentId, { walletId: u.ids.evm, chainId: 999999, domain: DOMAIN, uri: URI }))).toBe("AGENT_BAD_REQUEST");
    expect(await code(svc.challenge(u.userId, u.agentId, { walletId: u.ids.evm, domain: DOMAIN, uri: URI }))).toBe("AGENT_BAD_REQUEST");
    const { c } = await associate(u, "evm", { chainId: 42161 });
    expect(c.message).toContain("Chain ID: 42161");
    expect(c.chainId).toBe(42161);
  });
  it("expired, reused and other-domain challenges are refused", async () => {
    const u = await setup();
    const late = await associate(u, "evm");
    clock.now += 5 * 60_000 + 1;
    expect(await code(svc.verify(u.userId, u.agentId, late.proof))).toBe("AGENT_CHALLENGE_EXPIRED");
    const ok = await associate(u, "evm");
    expect(await code(svc.verify(u.userId, u.agentId, { ...ok.proof, domain: "evil.example" }))).toBe("AGENT_DOMAIN_MISMATCH");
    expect(await code(svc.verify(u.userId, u.agentId, ok.proof))).toBe("OK");
    expect(await code(svc.verify(u.userId, u.agentId, ok.proof))).toBe("AGENT_CHALLENGE_USED");
  });
  it("ERC-1271 smart-contract wallets are not supported: only an EOA signature verifies", async () => {
    // A contract wallet's EIP-1271 signature is not an ECDSA signature by the address, so verification fails closed.
    const u = await setup();
    const { proof } = await associate(u, "evm");
    expect(await code(svc.verify(u.userId, u.agentId, { ...proof, signature: `0x${"ab".repeat(100)}` }))).toBe("AGENT_PROOF_INVALID");
  });
});

describe("Solana (ed25519 signMessage)", () => {
  it("valid signature associates", async () => {
    const u = await setup();
    const { c, proof } = await associate(u, "solana");
    for (const s of [`${DOMAIN} wants you to associate`, u.sol.address, `Agent: ${u.agentId}`, "Purpose: AGENT_WALLET_ASSOCIATION", `Request ID: ${c.challengeId}`]) expect(c.message).toContain(s);
    expect(await svc.verify(u.userId, u.agentId, proof)).toMatchObject({ status: "ACTIVE", family: "solana", network: "solana", address: u.sol.address, publicKey: u.sol.address });
  });
  it("invalid signature, another key, altered message are refused", async () => {
    const u = await setup();
    expect(await code(svc.verify(u.userId, u.agentId, (await associate(u, "solana", { signer: solanaWallet() })).proof))).toBe("AGENT_PROOF_INVALID");
    expect(await code(svc.verify(u.userId, u.agentId, (await associate(u, "solana", { tamper: (m) => m.replace(u.agentId, "agt_000000000000000000000000") })).proof))).toBe("AGENT_PROOF_INVALID");
    const c = await associate(u, "solana");
    expect(await code(svc.verify(u.userId, u.agentId, { ...c.proof, signature: base64.encode(new Uint8Array(64)) }))).toBe("AGENT_PROOF_INVALID");
  });
  it("an invalid stored public key never verifies", async () => {
    const u = await setup();
    const c = await associate(u, "solana");
    await db.execute(sql`update spak_agent_wallet_challenges set address = 'not-base58!' where id = ${c.c.challengeId}`);
    expect(await code(svc.verify(u.userId, u.agentId, c.proof))).toBe("AGENT_PROOF_INVALID");
  });
});

describe("NEAR (NEP-413, full-access key)", () => {
  it("valid NEP-413 from a full-access key associates", async () => {
    const u = await setup();
    const { proof } = await associate(u, "near");
    expect(await svc.verify(u.userId, u.agentId, proof)).toMatchObject({ status: "ACTIVE", family: "near", address: u.nearId, publicKey: u.near.publicKey, method: "NEAR_NEP413_FULL_ACCESS_KEY" });
  });
  it("wrong account, invalid signature and a function-call key are refused", async () => {
    const u = await setup();
    const a = await associate(u, "near");
    expect(await code(svc.verify(u.userId, u.agentId, { ...a.proof, accountId: "other.near" }))).toBe("AGENT_PROOF_INVALID");
    const b = await associate(u, "near", { tamper: (m) => `${m} ` });
    expect(await code(svc.verify(u.userId, u.agentId, b.proof))).toBe("AGENT_PROOF_INVALID");
    const fc = nearWallet(u.nearId);
    keys.set(`${u.nearId}|${fc.publicKey}`, "FunctionCall");
    expect(await code(svc.verify(u.userId, u.agentId, (await associate(u, "near", { signer: fc })).proof))).toBe("AGENT_KEY_NOT_AUTHORIZED");
  });
  it("NEAR RPC failure fails closed", async () => {
    const u = await setup();
    const a = await associate(u, "near");
    rpcDown = true;
    expect(await code(svc.verify(u.userId, u.agentId, a.proof))).toBe("AGENT_VERIFICATION_UNAVAILABLE");
    expect((await svc.list(u.userId, u.agentId))[0].status).toBe("PENDING");
  });
  it("key rotation: re-verification with a new full-access key on the same account", async () => {
    const u = await setup();
    await svc.verify(u.userId, u.agentId, (await associate(u, "near")).proof);
    const k2 = nearWallet(u.nearId);
    keys.set(`${u.nearId}|${k2.publicKey}`, "FullAccess");
    const r = await svc.verify(u.userId, u.agentId, (await associate(u, "near", { signer: k2 })).proof);
    expect(r).toMatchObject({ status: "ACTIVE", publicKey: k2.publicKey });
    expect((await svc.list(u.userId, u.agentId))).toHaveLength(1);
  });
});

describe("lifecycle", () => {
  it("removal is immediate; an old proof cannot restore it; a new association needs a new challenge", async () => {
    const u = await setup();
    const a = await associate(u, "solana");
    await svc.verify(u.userId, u.agentId, a.proof);
    const pending = await associate(u, "solana"); // re-verification challenge, unused
    const r = await svc.remove(u.userId, u.agentId, a.c.associationId, "COMPROMISED");
    expect(r).toMatchObject({ status: "REVOKED", revokeReason: "COMPROMISED" });
    expect(await code(svc.verify(u.userId, u.agentId, pending.proof))).toBe("AGENT_CHALLENGE_USED");
    expect(await code(svc.verify(u.userId, u.agentId, a.proof))).toBe("AGENT_CHALLENGE_USED");
    const again = await associate(u, "solana");
    expect(again.c.associationId).not.toBe(a.c.associationId);
    await svc.verify(u.userId, u.agentId, again.proof);
    const list = await svc.list(u.userId, u.agentId);
    expect(list.map((x) => x.status).sort()).toEqual(["ACTIVE", "REVOKED"]);
    const ev = (await svc.events(u.userId, u.agentId, a.c.associationId)).map((e) => e.event);
    expect(ev).toEqual(["WALLET_ASSOCIATION_STARTED", "WALLET_CHALLENGE_ISSUED", "WALLET_ASSOCIATED", "WALLET_CHALLENGE_ISSUED", "WALLET_REPORTED_COMPROMISED"]);
  });
  it("expiry: an expired association is EXPIRED, not usable, and needs a fresh signature", async () => {
    const u = await setup();
    const a = await associate(u, "evm");
    await svc.verify(u.userId, u.agentId, a.proof);
    clock.now += ASSOCIATION_VALID_MS + 1;
    // Re-verify the Agent first so only the wallet is out of date.
    const ch = await agentsSvc.challenge(u.userId, u.agentId, { accountId: u.owner.address, domain: DOMAIN });
    const s = await u.owner.sign(ch.message, hex.encode(base64.decode(ch.nonce)), ch.recipient);
    await agentsSvc.verify(u.userId, u.agentId, { challengeId: ch.challengeId, method: ch.method, accountId: u.owner.address, publicKey: s.publicKey, signature: s.signature, domain: DOMAIN });
    expect((await svc.get(u.userId, u.agentId, a.c.associationId)).status).toBe("EXPIRED");
    const [row] = await db.select().from(agentWallets);
    const [ag] = await db.select().from(agents);
    expect(associationUsable(row, ag, new Date(clock.now))).toBe(false);
    const re = await associate(u, "evm");
    expect(re.c.associationId).toBe(a.c.associationId);
    expect((await svc.verify(u.userId, u.agentId, re.proof)).status).toBe("ACTIVE");
  });
  it("Agent suspension suspends associations; a fresh Agent proof restores in-date ones; revocation revokes all", async () => {
    const u = await setup();
    await svc.verify(u.userId, u.agentId, (await associate(u, "solana")).proof);
    const open = await associate(u, "evm");
    await agentsSvc.suspend(u.userId, u.agentId);
    expect((await svc.list(u.userId, u.agentId)).map((x) => x.status).sort()).toEqual(["SUSPENDED", "SUSPENDED"]);
    expect(await code(svc.verify(u.userId, u.agentId, open.proof))).toBe("AGENT_CHALLENGE_USED");
    const ch = await agentsSvc.challenge(u.userId, u.agentId, { accountId: u.owner.address, domain: DOMAIN });
    const s = await u.owner.sign(ch.message, hex.encode(base64.decode(ch.nonce)), ch.recipient);
    await agentsSvc.verify(u.userId, u.agentId, { challengeId: ch.challengeId, method: ch.method, accountId: u.owner.address, publicKey: s.publicKey, signature: s.signature, domain: DOMAIN });
    const after = await svc.list(u.userId, u.agentId);
    expect(after.find((x) => x.family === "solana")!.status).toBe("ACTIVE");
    expect(after.find((x) => x.family === "evm")!.status).toBe("REVOKED"); // was never verified
    await agentsSvc.revoke(u.userId, u.agentId, "REVOKE");
    expect((await svc.list(u.userId, u.agentId)).every((x) => x.status === "REVOKED")).toBe(true);
  });
  it("a challenge issued before the Agent was suspended cannot activate afterwards", async () => {
    const u = await setup();
    const a = await associate(u, "solana");
    await db.execute(sql`update spak_agents set status = 'SUSPENDED', suspended_at = now() where id = ${u.agentId}`); // suspended outside the service
    expect(await code(svc.verify(u.userId, u.agentId, a.proof))).toBe("AGENT_INVALID_STATE");
  });
  it("disconnecting the wallet from the account revokes its association, history kept", async () => {
    const u = await setup();
    const a = await associate(u, "solana");
    await svc.verify(u.userId, u.agentId, a.proof);
    await auth.removeWallet(u.userId, u.ids.solana);
    expect(await svc.get(u.userId, u.agentId, a.c.associationId)).toMatchObject({ status: "REVOKED", revokeReason: "WALLET_DISCONNECTED", address: u.sol.address });
  });
  it("concurrency: one challenge verifies once; parallel starts make one association", async () => {
    const u = await setup();
    const a = await associate(u, "solana");
    const r = await Promise.all([1, 2, 3].map(() => code(svc.verify(u.userId, u.agentId, a.proof))));
    expect(r.filter((x) => x === "OK")).toHaveLength(1);
    await Promise.all([1, 2, 3].map(() => svc.challenge(u.userId, u.agentId, { walletId: u.ids.evm, chainId: 1, domain: DOMAIN, uri: URI })));
    expect((await svc.list(u.userId, u.agentId)).filter((x) => x.family === "evm")).toHaveLength(1);
  });
  it("database refuses ACTIVE without proof fields, unknown families and duplicate live wallets", async () => {
    const u = await setup();
    const { c } = await associate(u, "solana");
    await expect(db.execute(sql`update spak_agent_wallets set status = 'ACTIVE' where id = ${c.associationId}`)).rejects.toThrow();
    await expect(db.execute(sql`update spak_agent_wallets set family = 'bitcoin' where id = ${c.associationId}`)).rejects.toThrow();
    await expect(db.execute(sql`insert into spak_agent_wallets (id, agent_id, user_id, family, network, address, method, status, created_at, updated_at) select 'awa_x', agent_id, user_id, family, network, address, method, 'PENDING', now(), now() from spak_agent_wallets where id = ${c.associationId}`)).rejects.toThrow();
  });
  it("the per-Agent limit is enforced", () => { expect(MAX_ASSOCIATIONS).toBe(20); });
});
