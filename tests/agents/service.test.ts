/**
 * Agent identity and ownership proof. Real SQL (PGlite with the real migrations), real ed25519 keys and real NEP-413
 * signatures. MOCKED: the NEAR RPC access-key lookup (a map of account → key → permission).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { base64, hex } from "@scure/base";
import { AuthService } from "@/auth/service";
import { AgentError, AgentService, OWNERSHIP_VALID_MS, TRANSITIONS, canonical, ownershipCurrent } from "@/agents/service";
import { AuthError } from "@/auth/types";
import { agentEvents, agents } from "@/database/schema";
import type { Db } from "@/database/repositories";
import type { NearRpc } from "@/auth/verify/near";
import { freshDb } from "../auth/db";
import { evmWallet, nearWallet } from "../auth/keys";

const DOMAIN = "spak.test";
let db: Db, svc: AgentService, auth: AuthService;
const clock = { now: Date.parse("2026-11-13T10:00:00Z") };
const keys = new Map<string, "FullAccess" | "FunctionCall">();
let rpcDown = false;
const rpc: NearRpc = { accessKey: async (a, k) => { if (rpcDown) throw new AuthError("NEAR_RPC_UNAVAILABLE", "down"); return keys.get(`${a}|${k}`) ?? null; } };

async function user() {
  const e = evmWallet();
  const c = await auth.createChallenge({ family: "evm", address: e.address, purpose: "SIGN_IN", domain: DOMAIN, uri: `https://${DOMAIN}` });
  return (await auth.verifyChallenge({ challengeId: c.challengeId, signature: (await e.sign(c.message)).signature })).userId;
}
/** A NEAR account with a full-access key on chain (mocked RPC). */
function nearAccount(id = `owner${Math.random().toString(36).slice(2, 8)}.near`, perm: "FullAccess" | "FunctionCall" = "FullAccess") {
  const w = nearWallet(id);
  keys.set(`${id}|${w.publicKey}`, perm);
  return w;
}
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as AgentError).code ?? (e as Error).message; } };
async function prove(userId: string, agentId: string, w: ReturnType<typeof nearWallet>, opts: { tamper?: (m: string) => string; domain?: string } = {}) {
  const c = await svc.challenge(userId, agentId, { accountId: w.address, domain: DOMAIN });
  const nonceHex = hex.encode(base64.decode(c.nonce));
  const s = await w.sign(opts.tamper ? opts.tamper(c.message) : c.message, nonceHex, c.recipient);
  return { c, proof: { challengeId: c.challengeId, method: "NEAR_NEP413_FULL_ACCESS_KEY", accountId: w.address, publicKey: s.publicKey, signature: s.signature, domain: opts.domain ?? DOMAIN } };
}

beforeEach(async () => {
  db = await freshDb(); keys.clear(); rpcDown = false; clock.now = Date.parse("2026-11-13T10:00:00Z");
  const now = () => new Date(clock.now);
  auth = new AuthService(db, { clock: now, nearRpc: rpc });
  svc = new AgentService(db, { clock: now, nearRpc: rpc });
});

describe("identity", () => {
  it("creates an Agent without any NEAR account, with no permissions and no dedicated account", async () => {
    const u = await user();
    const a = await svc.create(u, "My agent");
    expect(a).toMatchObject({ status: "CREATED", schemaVersion: 1, permissions: "NONE", dedicatedAccount: { state: "NOT_AVAILABLE" }, ownership: { state: "NOT_VERIFIED", accountId: null, attestationHash: null } });
    expect(a.id).toMatch(/^agt_[0-9a-f]{24}$/);
    expect((await svc.events(u, a.id)).map((e) => e.event)).toEqual(["CREATED"]);
  });
  it("one live Agent per user; a revoked one does not block a new one", async () => {
    const u = await user();
    const a = await svc.create(u, "One");
    expect(await code(svc.create(u, "Two"))).toBe("AGENT_EXISTS");
    expect((await Promise.all([code(svc.create(await user(), "Other")), code(svc.create(u, "Again"))]))[1]).toBe("AGENT_EXISTS");
    await svc.revoke(u, a.id, "REVOKE");
    expect(await code(svc.create(u, "Three"))).toBe("OK");
    const cur = await svc.current(u);
    expect(cur.agent?.displayName).toBe("Three");
    expect(cur.revoked.map((r) => r.displayName)).toEqual(["One"]);
  });
  it("names are validated", async () => {
    const u = await user();
    for (const n of ["", " a ", "x".repeat(41), "bad\u0007name"]) expect(await code(svc.create(u, n))).toBe("AGENT_BAD_REQUEST");
  });
  it("another user's Agent is not found for every operation", async () => {
    const [u1, u2] = [await user(), await user()];
    const a = await svc.create(u1, "Mine");
    const w = nearAccount();
    for (const p of [svc.get(u2, a.id), svc.events(u2, a.id), svc.suspend(u2, a.id), svc.revoke(u2, a.id, "REVOKE"), svc.challenge(u2, a.id, { accountId: w.address, domain: DOMAIN })]) expect(await code(p)).toBe("AGENT_NOT_FOUND");
    const { proof } = await prove(u1, a.id, w);
    expect(await code(svc.verify(u2, a.id, proof))).toBe("AGENT_NOT_FOUND");
    expect((await svc.get(u1, a.id)).status).toBe("PENDING_VERIFICATION");
  });
});

describe("ownership proof", () => {
  it("valid NEP-413 proof from a full-access key verifies, records an attestation and grants nothing", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount("alice.near");
    const { c, proof } = await prove(u, a.id, w);
    expect(c.message).toContain(`Agent: ${a.id}`);
    expect(c.message).toContain("NEAR account: alice.near");
    expect(c.message).toContain(`Domain: ${DOMAIN}`);
    expect(c.message).toContain("Purpose: AGENT_OWNERSHIP");
    expect(c.message).not.toContain(u); // privacy-preserving user reference only
    const v = await svc.verify(u, a.id, proof);
    expect(v).toMatchObject({ status: "VERIFIED", permissions: "NONE", dedicatedAccount: { state: "NOT_AVAILABLE" }, ownership: { state: "VERIFIED", network: "near", accountId: "alice.near", publicKey: w.publicKey, method: "NEAR_NEP413_FULL_ACCESS_KEY", attestationLocation: "OFF_CHAIN" } });
    expect(Date.parse(v.ownership.expiresAt!) - Date.parse(v.ownership.verifiedAt!)).toBe(OWNERSHIP_VALID_MS);
    const [row] = await db.select().from(agents).where(sql`${agents.id} = ${a.id}`);
    expect(v.ownership.attestationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.attestation).toMatchObject({ type: "spak.agent.ownership", v: 1, agentId: a.id, accountId: "alice.near" });
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(canonical(row.attestation)).digest("hex")).toBe(v.ownership.attestationHash);
    expect((await svc.events(u, a.id)).map((e) => e.event)).toEqual(["CREATED", "CHALLENGE_ISSUED", "VERIFICATION_STARTED", "VERIFIED"]);
  });
  it("an invalid signature, modified message or wrong key fails closed and leaves the status unchanged", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount();
    const tampered = await prove(u, a.id, w, { tamper: (m) => m.replace(/Agent: agt_\w+/, "Agent: agt_000000000000000000000000") });
    expect(await code(svc.verify(u, a.id, tampered.proof))).toBe("AGENT_PROOF_INVALID");
    const bad = await prove(u, a.id, w);
    expect(await code(svc.verify(u, a.id, { ...bad.proof, signature: base64.encode(new Uint8Array(64)) }))).toBe("AGENT_PROOF_INVALID");
    // A different key that is not on the account.
    const other = nearWallet(w.address);
    const wrong = await prove(u, a.id, other);
    expect(await code(svc.verify(u, a.id, wrong.proof))).toBe("AGENT_KEY_NOT_AUTHORIZED");
    expect((await svc.get(u, a.id)).status).toBe("PENDING_VERIFICATION");
    expect((await svc.events(u, a.id)).filter((e) => e.event === "VERIFICATION_FAILED")).toHaveLength(3);
  });
  it("a function-call key is not enough", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount(undefined, "FunctionCall");
    expect(await code(svc.verify(u, a.id, (await prove(u, a.id, w)).proof))).toBe("AGENT_KEY_NOT_AUTHORIZED");
  });
  it("expired, reused and replayed challenges are refused", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount();
    const late = await prove(u, a.id, w);
    clock.now += 5 * 60_000 + 1;
    expect(await code(svc.verify(u, a.id, late.proof))).toBe("AGENT_CHALLENGE_EXPIRED");
    const ok = await prove(u, a.id, w);
    expect(await code(svc.verify(u, a.id, ok.proof))).toBe("OK");
    expect(await code(svc.verify(u, a.id, ok.proof))).toBe("AGENT_CHALLENGE_USED");
  });
  it("a proof bound to one Agent cannot verify another, and the account must match the challenge", async () => {
    const [u1, u2] = [await user(), await user()];
    const a1 = await svc.create(u1, "A1"), a2 = await svc.create(u2, "A2");
    const w = nearAccount();
    const p1 = await prove(u1, a1.id, w);
    expect(await code(svc.verify(u2, a2.id, { ...p1.proof }))).toBe("AGENT_CHALLENGE_INVALID");
    const p2 = await prove(u1, a1.id, w);
    expect(await code(svc.verify(u1, a1.id, { ...p2.proof, accountId: "someone.near" }))).toBe("AGENT_PROOF_INVALID");
  });
  it("wrong domain and unsupported methods are refused", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount();
    const p = await prove(u, a.id, w, { domain: "evil.example" });
    expect(await code(svc.verify(u, a.id, p.proof))).toBe("AGENT_DOMAIN_MISMATCH");
    const q = await prove(u, a.id, w);
    expect(await code(svc.verify(u, a.id, { ...q.proof, method: "ERC191" }))).toBe("AGENT_UNSUPPORTED_METHOD");
  });
  it("NEAR RPC unavailable fails closed", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount();
    const p = await prove(u, a.id, w);
    rpcDown = true;
    expect(await code(svc.verify(u, a.id, p.proof))).toBe("AGENT_VERIFICATION_UNAVAILABLE");
    expect((await svc.get(u, a.id)).ownership.state).toBe("NOT_VERIFIED");
  });
  it("concurrent submissions of one challenge: exactly one verifies", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount();
    const p = await prove(u, a.id, w);
    const r = await Promise.all([code(svc.verify(u, a.id, p.proof)), code(svc.verify(u, a.id, p.proof)), code(svc.verify(u, a.id, p.proof))]);
    expect(r.filter((x) => x === "OK")).toHaveLength(1);
    expect(r.filter((x) => x === "AGENT_CHALLENGE_USED")).toHaveLength(2);
  });
  it("a NEAR account can own only one live Agent", async () => {
    const [u1, u2] = [await user(), await user()];
    const a1 = await svc.create(u1, "A1"), a2 = await svc.create(u2, "A2");
    const w = nearAccount();
    await svc.verify(u1, a1.id, (await prove(u1, a1.id, w)).proof);
    expect(await code(svc.verify(u2, a2.id, (await prove(u2, a2.id, w)).proof))).toBe("AGENT_OWNER_IN_USE");
  });
});

describe("lifecycle", () => {
  it("transition table: revoked is terminal; failed proofs never verify", () => {
    expect(TRANSITIONS.REVOKED).toEqual([]);
    expect(TRANSITIONS.CREATED).not.toContain("VERIFIED");
    expect(TRANSITIONS.SUSPENDED).not.toContain("PENDING_VERIFICATION");
  });
  it("suspend, then resume only with a fresh proof", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount();
    await svc.verify(u, a.id, (await prove(u, a.id, w)).proof);
    const s = await svc.suspend(u, a.id);
    expect(s).toMatchObject({ status: "SUSPENDED", ownership: { state: "SUSPENDED" } });
    expect(await code(svc.suspend(u, a.id))).toBe("OK");
    const r = await svc.verify(u, a.id, (await prove(u, a.id, w)).proof);
    expect(r).toMatchObject({ status: "VERIFIED", suspendedAt: null });
    expect((await svc.events(u, a.id)).map((e) => e.event)).toContain("RESUMED_BY_PROOF");
  });
  it("suspending closes open challenges", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount();
    const p = await prove(u, a.id, w);
    await svc.suspend(u, a.id);
    expect(await code(svc.verify(u, a.id, p.proof))).toBe("AGENT_CHALLENGE_USED");
  });
  it("the owner account is locked once verified: another account needs a new Agent", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount();
    await svc.verify(u, a.id, (await prove(u, a.id, w)).proof);
    await svc.suspend(u, a.id);
    expect(await code(svc.challenge(u, a.id, { accountId: nearAccount().address, domain: DOMAIN }))).toBe("AGENT_OWNER_LOCKED");
  });
  it("key rotation on the same account re-verifies with the new full-access key", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount("rot.near");
    await svc.verify(u, a.id, (await prove(u, a.id, w)).proof);
    const w2 = nearAccount("rot.near");
    const v = await svc.verify(u, a.id, (await prove(u, a.id, w2)).proof);
    expect(v.ownership.publicKey).toBe(w2.publicKey);
    expect((await svc.events(u, a.id)).map((e) => e.event)).toContain("REVERIFIED");
  });
  it("revocation is permanent and needs explicit confirmation", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount();
    expect(await code(svc.revoke(u, a.id, "yes"))).toBe("AGENT_BAD_REQUEST");
    await svc.revoke(u, a.id, "REVOKE");
    for (const p of [svc.suspend(u, a.id), svc.revoke(u, a.id, "REVOKE"), svc.challenge(u, a.id, { accountId: w.address, domain: DOMAIN })]) expect(await code(p)).toBe("AGENT_REVOKED");
    expect((await svc.get(u, a.id)).status).toBe("REVOKED");
  });
  it("a challenge issued before revocation cannot verify after it", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount();
    const p = await prove(u, a.id, w);
    await svc.revoke(u, a.id, "REVOKE");
    expect(await code(svc.verify(u, a.id, p.proof))).toBe("AGENT_REVOKED");
  });
  it("verification expires: status stays VERIFIED but ownership is not current", async () => {
    const u = await user(); const a = await svc.create(u, "Agent"); const w = nearAccount();
    await svc.verify(u, a.id, (await prove(u, a.id, w)).proof);
    clock.now += OWNERSHIP_VALID_MS + 1;
    const v = await svc.get(u, a.id);
    expect(v).toMatchObject({ status: "VERIFIED", ownership: { state: "EXPIRED" } });
    const [row] = await db.select().from(agents);
    expect(ownershipCurrent(row, new Date(clock.now))).toBe(false);
  });
  it("database refuses VERIFIED without proof fields, unknown statuses, and edits to the audit trail", async () => {
    const u = await user(); const a = await svc.create(u, "Agent");
    await expect(db.execute(sql`update spak_agents set status = 'VERIFIED' where id = ${a.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update spak_agents set status = 'ACTIVE' where id = ${a.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update spak_agents set status = 'REVOKED' where id = ${a.id}`)).rejects.toThrow(); // revoked_at required
    await expect(db.update(agentEvents).set({ event: "FORGED" })).rejects.toThrow();
    expect((await svc.get(u, a.id)).status).toBe("CREATED");
  });
});
