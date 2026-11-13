/**
 * Dedicated Agent NEAR accounts. Real SQL (PGlite with the real migrations) and real NEP-413 consent signatures.
 * MOCKED: NEAR testnet (FakeNear below models accounts, keys and transaction outcomes). No real account is created here;
 * the live testnet test is tests/live/agent-account.live.test.ts and needs an authorised parent account.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { base64, hex } from "@scure/base";
import { AuthService } from "@/auth/service";
import { AgentService, OWNERSHIP_VALID_MS } from "@/agents/service";
import { ACCOUNT_TRANSITIONS, AgentAccountService, MAX_ATTEMPTS_PER_DAY, agentAccountName } from "@/agents/accounts";
import { NearUnavailable, agentAccountConfig, type AgentAccountConfig, type AgentNearChain, type CreateOutcome } from "@/agents/near-chain";
import { agentAccounts } from "@/database/schema";
import type { Db } from "@/database/repositories";
import { freshDb } from "../auth/db";
import { evmWallet, nearWallet } from "../auth/keys";

const DOMAIN = "spak.test", PARENT = "spak-agents.testnet", PARENT_PK = "ed25519:ParentKey1111111111111111111111111111111111";
const cfg: AgentAccountConfig = { network: "testnet", rpcUrl: "https://rpc.testnet.near.org", parentAccountId: PARENT, initialBalanceYocto: "10000000000000000000000", budgetYocto: "30000000000000000000000" };

class FakeNear implements AgentNearChain {
  readonly network = "testnet" as const;
  readonly parentAccountId = PARENT;
  accounts = new Map<string, { publicKey: string; permission: "FullAccess" | "FunctionCall" }[]>([[PARENT, [{ publicKey: PARENT_PK, permission: "FullAccess" }]]]);
  mode: "ok" | "fail" | "unknown-landed" | "unknown-lost" | "adds-parent-key" | "throws" = "ok";
  chain = "testnet"; down = false; creates = 0;
  parentPublicKey() { return PARENT_PK; }
  private up() { if (this.down) throw new NearUnavailable("down"); }
  async chainId() { this.up(); return this.chain; }
  async viewAccount(id: string) { this.up(); return this.accounts.has(id) ? { amount: "1" } : null; }
  async accessKeys(id: string) { this.up(); const k = this.accounts.get(id); if (!k) throw new NearUnavailable("missing"); return k; }
  async txStatus() { return this.mode === "unknown-lost" ? "FAILURE" as const : "UNKNOWN" as const; }
  async createSubAccount(a: { newAccountId: string; ownerPublicKey: string; amountYocto: string }): Promise<CreateOutcome> {
    this.creates++;
    if (this.mode === "fail") return { txHash: "tx_fail", outcome: "FAILURE" };
    const keys = [{ publicKey: a.ownerPublicKey, permission: "FullAccess" as const }, ...(this.mode === "adds-parent-key" ? [{ publicKey: PARENT_PK, permission: "FullAccess" as const }] : [])];
    if (this.mode === "unknown-lost") return { txHash: "tx_lost", outcome: "UNKNOWN" };
    this.accounts.set(a.newAccountId, keys);
    if (this.mode === "unknown-landed") return { txHash: "tx_unknown", outcome: "UNKNOWN" };
    return { txHash: `tx_${this.creates}`, outcome: "SUCCESS" };
  }
}

let db: Db, auth: AuthService, agentsSvc: AgentService, svc: AgentAccountService, near: FakeNear;
const clock = { now: Date.parse("2026-11-13T10:00:00Z") };
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } };
let n = 0;

async function verifiedUser() {
  const e = evmWallet();
  const c = await auth.createChallenge({ family: "evm", address: e.address, purpose: "SIGN_IN", domain: DOMAIN, uri: `https://${DOMAIN}` });
  const { userId } = await auth.verifyChallenge({ challengeId: c.challengeId, signature: (await e.sign(c.message)).signature });
  const a = await agentsSvc.create(userId, "Agent");
  const owner = nearWallet(); // implicit account: the key is the account
  const ch = await agentsSvc.challenge(userId, a.id, { accountId: owner.address, domain: DOMAIN });
  const s = await owner.sign(ch.message, hex.encode(base64.decode(ch.nonce)), ch.recipient);
  await agentsSvc.verify(userId, a.id, { challengeId: ch.challengeId, method: ch.method, accountId: owner.address, publicKey: s.publicKey, signature: s.signature, domain: DOMAIN });
  return { userId, agentId: a.id, owner };
}
async function consent(u: Awaited<ReturnType<typeof verifiedUser>>, o: { signer?: ReturnType<typeof nearWallet>; key?: string } = {}) {
  const p = await svc.prepare(u.userId, u.agentId, DOMAIN);
  const s = await (o.signer ?? u.owner).sign(p.message, hex.encode(base64.decode(p.nonce)), p.recipient);
  return { p, body: { challengeId: p.challengeId, accountId: u.owner.address, publicKey: s.publicKey, signature: s.signature, idempotencyKey: o.key ?? `k${++n}`, domain: DOMAIN } };
}

beforeEach(async () => {
  db = await freshDb(); clock.now = Date.parse("2026-11-13T10:00:00Z");
  const now = () => new Date(clock.now);
  auth = new AuthService(db, { clock: now, nearRpc: { accessKey: async () => null } });
  agentsSvc = new AgentService(db, { clock: now, nearRpc: { accessKey: async () => null } });
  near = new FakeNear();
  svc = new AgentAccountService({ db, config: cfg, chain: near, clock: now, ownerRpc: { accessKey: async () => null } });
});

describe("configuration", () => {
  it("testnet only: mainnet, non-testnet parents and RPCs, missing keys and missing amounts are refused", () => {
    const ok = { SPAK_AGENT_NEAR_NETWORK: "testnet", SPAK_AGENT_PARENT_ACCOUNT: PARENT, SPAK_AGENT_PARENT_PRIVATE_KEY: "ed25519:x", SPAK_AGENT_INITIAL_BALANCE_YOCTO: "1", SPAK_AGENT_SPONSOR_BUDGET_YOCTO: "10" };
    expect(agentAccountConfig(ok)).toMatchObject({ network: "testnet", parentAccountId: PARENT });
    for (const bad of [{ SPAK_AGENT_NEAR_NETWORK: "mainnet" }, { SPAK_AGENT_PARENT_ACCOUNT: "spak.near" }, { SPAK_AGENT_NEAR_RPC_URL: "https://rpc.mainnet.near.org" }, { SPAK_AGENT_PARENT_PRIVATE_KEY: undefined }, { SPAK_AGENT_INITIAL_BALANCE_YOCTO: "0.1" }, { SPAK_AGENT_NEAR_NETWORK: undefined }]) {
      expect(agentAccountConfig({ ...ok, ...bad })).toHaveProperty("unavailable");
    }
  });
  it("unconfigured server: unavailable, nothing created", async () => {
    const u = await verifiedUser();
    const off = new AgentAccountService({ db, config: { unavailable: "not configured" }, chain: null });
    expect((await off.view(u.userId, u.agentId)).availability).toBe("UNAVAILABLE");
    expect(await code(off.prepare(u.userId, u.agentId, DOMAIN))).toBe("AGENT_VERIFICATION_UNAVAILABLE");
  });
  it("names are deterministic, non-personal, under the parent, and change per attempt", () => {
    const a = agentAccountName("agt_x", PARENT), b = agentAccountName("agt_x", PARENT, 1);
    expect(a).toMatch(/^a[0-9a-f]{16}\.spak-agents\.testnet$/);
    expect(a).toBe(agentAccountName("agt_x", PARENT));
    expect(b).not.toBe(a);
  });
});

describe("creation", () => {
  it("creates in one transaction with the owner key as the only full-access key, then verifies it on chain", async () => {
    const u = await verifiedUser();
    const { p, body } = await consent(u);
    expect(p.message).toContain(`Account: ${p.accountId}`);
    expect(p.message).toContain(`Owner key: ${p.ownerPublicKey}`);
    expect(p.message).toContain("SPak gets no key on it");
    const acc = await svc.create(u.userId, u.agentId, body);
    expect(acc).toMatchObject({ status: "ACTIVE", network: "testnet", accountId: p.accountId, parentAccountId: PARENT, sponsorship: "FUNDED", creationOutcome: "SUCCESS", signingAuthority: "OWNER_ONLY" });
    expect(near.accounts.get(p.accountId)).toEqual([{ publicKey: p.ownerPublicKey, permission: "FullAccess" }]);
    expect(near.accounts.get(p.accountId)!.some((k) => k.publicKey === PARENT_PK)).toBe(false);
  });
  it("idempotent: same key or second call returns the same account; one transaction", async () => {
    const u = await verifiedUser();
    const { body } = await consent(u, { key: "same" });
    const a = await svc.create(u.userId, u.agentId, body);
    expect((await svc.create(u.userId, u.agentId, body)).id).toBe(a.id);
    expect(await code(svc.prepare(u.userId, u.agentId, DOMAIN))).toBe("AGENT_EXISTS");
    expect(near.creates).toBe(1);
  });
  it("concurrent creation attempts: one account, one funding", async () => {
    const u = await verifiedUser();
    const c1 = await consent(u), c2 = await consent(u);
    const r = await Promise.all([code(svc.create(u.userId, u.agentId, c1.body)), code(svc.create(u.userId, u.agentId, c2.body))]);
    expect(r.filter((x) => x === "OK")).toHaveLength(2); // the second returns the existing account
    expect(await db.select().from(agentAccounts)).toHaveLength(1);
    expect(near.creates).toBe(1);
  });
  it("name collision: a taken name is skipped at prepare; taken at create time fails without funding", async () => {
    const u = await verifiedUser();
    near.accounts.set(agentAccountName(u.agentId, PARENT), [{ publicKey: "ed25519:other", permission: "FullAccess" }]);
    const { p, body } = await consent(u);
    expect(p.accountId).toBe(agentAccountName(u.agentId, PARENT, 1));
    near.accounts.set(p.accountId, [{ publicKey: "ed25519:squatter", permission: "FullAccess" }]);
    expect(await svc.create(u.userId, u.agentId, body)).toMatchObject({ status: "CREATION_FAILED", creationError: "NAME_TAKEN", sponsorship: "NOT_SPENT" });
    expect(near.creates).toBe(0);
  });
  it("parent without authority, wrong network and unreachable NEAR fail without a transaction", async () => {
    const u = await verifiedUser();
    near.accounts.set(PARENT, [{ publicKey: PARENT_PK, permission: "FunctionCall" }]);
    expect((await svc.create(u.userId, u.agentId, (await consent(u)).body)).creationError).toBe("PARENT_NOT_AUTHORIZED");
    near.accounts.set(PARENT, [{ publicKey: PARENT_PK, permission: "FullAccess" }]);
    near.chain = "mainnet";
    expect(await code(svc.prepare(u.userId, u.agentId, DOMAIN))).toBe("AGENT_VERIFICATION_UNAVAILABLE");
    near.chain = "testnet"; near.down = true;
    expect(await code(svc.prepare(u.userId, u.agentId, DOMAIN))).toBe("AGENT_VERIFICATION_UNAVAILABLE");
    expect(near.creates).toBe(0);
  });
  it("failed transaction: CREATION_FAILED, sponsorship not spent, retry makes a new attempt", async () => {
    const u = await verifiedUser();
    near.mode = "fail";
    expect(await svc.create(u.userId, u.agentId, (await consent(u)).body)).toMatchObject({ status: "CREATION_FAILED", creationOutcome: "FAILURE", sponsorship: "NOT_SPENT" });
    near.mode = "ok";
    const again = await svc.create(u.userId, u.agentId, (await consent(u)).body);
    expect(again.status).toBe("ACTIVE");
    expect((await svc.view(u.userId, u.agentId)).failedAttempts).toHaveLength(1);
  });
  it("unknown outcome: stays pending, never active, until NEAR shows the account", async () => {
    const u = await verifiedUser();
    near.mode = "unknown-lost";
    near.txStatus = async () => "UNKNOWN";
    const a = await svc.create(u.userId, u.agentId, (await consent(u)).body);
    expect(a).toMatchObject({ status: "CREATION_PENDING", creationOutcome: "UNKNOWN" });
    near.txStatus = async () => "FAILURE";
    expect((await svc.verify(u.userId, u.agentId)).status).toBe("CREATION_FAILED");
    const u2 = await verifiedUser();
    near.mode = "unknown-landed";
    near.txStatus = async () => "UNKNOWN";
    const b = await svc.create(u2.userId, u2.agentId, (await consent(u2)).body);
    expect(b.status).toBe("ACTIVE"); // reconciled from the account itself: owner key present, SPak key absent
  });
  it("network failure during verification never activates", async () => {
    const u = await verifiedUser();
    const { body } = await consent(u);
    const orig = near.accessKeys.bind(near);
    let calls = 0;
    near.accessKeys = async (id: string) => { if (id !== PARENT && ++calls) throw new NearUnavailable("down"); return orig(id); };
    expect((await svc.create(u.userId, u.agentId, body)).status).toBe("OWNERSHIP_VERIFICATION_PENDING");
    near.accessKeys = orig;
    expect((await svc.verify(u.userId, u.agentId)).status).toBe("ACTIVE");
  });
});

describe("ownership verification", () => {
  it("a SPak key on the account is refused: RECOVERY_REQUIRED, never ACTIVE", async () => {
    const u = await verifiedUser();
    near.mode = "adds-parent-key";
    expect(await svc.create(u.userId, u.agentId, (await consent(u)).body)).toMatchObject({ status: "RECOVERY_REQUIRED", recoveryReason: "UNEXPECTED_SPAK_KEY" });
  });
  it("owner key removed or account gone: RECOVERY_REQUIRED; restoring the key re-verifies", async () => {
    const u = await verifiedUser();
    const a = await svc.create(u.userId, u.agentId, (await consent(u)).body);
    const keys = near.accounts.get(a.accountId)!;
    near.accounts.set(a.accountId, [{ publicKey: "ed25519:someoneelse", permission: "FullAccess" }]);
    expect(await svc.verify(u.userId, u.agentId)).toMatchObject({ status: "RECOVERY_REQUIRED", recoveryReason: "OWNER_KEY_MISSING" });
    near.accounts.set(a.accountId, keys);
    expect((await svc.verify(u.userId, u.agentId)).status).toBe("ACTIVE");
    near.accounts.delete(a.accountId);
    expect(await svc.verify(u.userId, u.agentId)).toMatchObject({ status: "RECOVERY_REQUIRED", recoveryReason: "ACCOUNT_NOT_FOUND" });
  });
  it("owner key with only function-call access is not ownership", async () => {
    const u = await verifiedUser();
    const a = await svc.create(u.userId, u.agentId, (await consent(u)).body);
    near.accounts.set(a.accountId, [{ publicKey: a.ownerPublicKey, permission: "FunctionCall" }]);
    expect((await svc.verify(u.userId, u.agentId)).status).toBe("RECOVERY_REQUIRED");
  });
});

describe("consent and eligibility", () => {
  it("an unverified, expired, suspended or revoked Agent cannot create", async () => {
    const u = await verifiedUser();
    clock.now += OWNERSHIP_VALID_MS + 1;
    expect(await code(svc.prepare(u.userId, u.agentId, DOMAIN))).toBe("AGENT_INVALID_STATE");
    const v = await verifiedUser();
    await agentsSvc.suspend(v.userId, v.agentId);
    expect(await code(svc.prepare(v.userId, v.agentId, DOMAIN))).toBe("AGENT_INVALID_STATE");
    await agentsSvc.revoke(v.userId, v.agentId, "REVOKE");
    expect(await code(svc.prepare(v.userId, v.agentId, DOMAIN))).toBe("AGENT_REVOKED");
  });
  it("consent must be the owner's verified key, for this Agent, user and domain, used once", async () => {
    const [u, w] = [await verifiedUser(), await verifiedUser()];
    const wrongKey = await consent(u, { signer: nearWallet(u.owner.address) });
    expect(await code(svc.create(u.userId, u.agentId, wrongKey.body))).toBe("AGENT_PROOF_INVALID");
    const c = await consent(u);
    expect(await code(svc.create(w.userId, w.agentId, c.body))).toBe("AGENT_CHALLENGE_INVALID");
    expect(await code(svc.create(u.userId, u.agentId, { ...c.body, domain: "evil.example" }))).toBe("AGENT_DOMAIN_MISMATCH");
    const tampered = { ...c.body, signature: base64.encode(new Uint8Array(64)) };
    expect(await code(svc.create(u.userId, u.agentId, tampered))).toBe("AGENT_PROOF_INVALID");
    expect(await code(svc.create(u.userId, u.agentId, c.body))).toBe("AGENT_CHALLENGE_USED");
    const late = await consent(u);
    clock.now += 5 * 60_000 + 1;
    expect(await code(svc.create(u.userId, u.agentId, late.body))).toBe("AGENT_CHALLENGE_EXPIRED");
    expect(near.creates).toBe(0);
  });
  it("another user's Agent is not found", async () => {
    const [u, w] = [await verifiedUser(), await verifiedUser()];
    for (const p of [svc.view(w.userId, u.agentId), svc.prepare(w.userId, u.agentId, DOMAIN), svc.verify(w.userId, u.agentId)]) expect(await code(p)).toBe("AGENT_NOT_FOUND");
  });
});

describe("sponsorship controls", () => {
  it("budget cap: funding stops when the budget would be exceeded", async () => {
    for (let i = 0; i < 3; i++) { const u = await verifiedUser(); expect((await svc.create(u.userId, u.agentId, (await consent(u)).body)).status).toBe("ACTIVE"); }
    const u = await verifiedUser();
    expect(await code(svc.create(u.userId, u.agentId, (await consent(u)).body))).toBe("AGENT_VERIFICATION_UNAVAILABLE");
    expect(near.creates).toBe(3);
  });
  it("failed attempts do not consume budget; per-user attempts are limited", async () => {
    const u = await verifiedUser();
    near.mode = "fail";
    for (let i = 0; i < MAX_ATTEMPTS_PER_DAY; i++) await svc.create(u.userId, u.agentId, (await consent(u)).body);
    near.mode = "ok";
    expect(await code(svc.create(u.userId, u.agentId, (await consent(u)).body))).toBe("AGENT_BAD_REQUEST");
    const [{ s }] = await db.execute(sql`select coalesce(sum(cast(funding_yocto as numeric)),0)::text as s from spak_agent_accounts where sponsorship in ('RESERVED','FUNDED')`).then((r) => (r as unknown as { rows: { s: string }[] }).rows);
    expect(s).toBe("0");
  });
});

describe("lifecycle", () => {
  it("transition table: failed and revoked are final; active requires verification first", () => {
    expect(ACCOUNT_TRANSITIONS.REVOKED).toEqual([]);
    expect(ACCOUNT_TRANSITIONS.CREATION_FAILED).toEqual([]);
    expect(ACCOUNT_TRANSITIONS.CREATED).not.toContain("ACTIVE");
    expect(ACCOUNT_TRANSITIONS.CREATION_PENDING).not.toContain("ACTIVE");
  });
  it("Agent suspension suspends the account; re-verifying the Agent needs the account re-verified; revocation keeps it on chain", async () => {
    const u = await verifiedUser();
    const a = await svc.create(u.userId, u.agentId, (await consent(u)).body);
    await agentsSvc.suspend(u.userId, u.agentId);
    expect((await svc.view(u.userId, u.agentId)).account!.status).toBe("SUSPENDED");
    const ch = await agentsSvc.challenge(u.userId, u.agentId, { accountId: u.owner.address, domain: DOMAIN });
    const s = await u.owner.sign(ch.message, hex.encode(base64.decode(ch.nonce)), ch.recipient);
    await agentsSvc.verify(u.userId, u.agentId, { challengeId: ch.challengeId, method: ch.method, accountId: u.owner.address, publicKey: s.publicKey, signature: s.signature, domain: DOMAIN });
    expect((await svc.view(u.userId, u.agentId)).account!.status).toBe("OWNERSHIP_VERIFICATION_PENDING");
    expect((await svc.verify(u.userId, u.agentId)).status).toBe("ACTIVE");
    await agentsSvc.revoke(u.userId, u.agentId, "REVOKE");
    expect((await svc.view(u.userId, u.agentId)).account!.status).toBe("REVOKED");
    expect(near.accounts.has(a.accountId)).toBe(true); // never deleted
  });
  it("database refuses mainnet, ACTIVE without proof fields, unknown states and a second live account per Agent", async () => {
    const u = await verifiedUser();
    const a = await svc.create(u.userId, u.agentId, (await consent(u)).body);
    await expect(db.execute(sql`update spak_agent_accounts set network = 'mainnet' where id = ${a.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update spak_agent_accounts set account_id = 'x.spak.near' where id = ${a.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update spak_agent_accounts set ownership_verified_at = null where id = ${a.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update spak_agent_accounts set status = 'LIVE' where id = ${a.id}`)).rejects.toThrow();
    await expect(db.execute(sql`insert into spak_agent_accounts select 'aga_x', agent_id, user_id, network, 'b' || account_id, parent_account_id, owner_public_key, key_type, 'CREATION_PENDING', 'RESERVED', funding_yocto, null, null, null, 'k2', null, null, null, null, null, 1, 1, now(), now() from spak_agent_accounts where id = ${a.id}`)).rejects.toThrow();
  });
});
