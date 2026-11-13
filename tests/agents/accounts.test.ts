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
    // Unverifiable evidence is never activation: the account needs a re-check (hardening: RECOVERY_REQUIRED, reason recorded).
    expect(await svc.create(u.userId, u.agentId, body)).toMatchObject({ status: "RECOVERY_REQUIRED", recoveryReason: "VERIFICATION_UNAVAILABLE" });
    near.accessKeys = orig;
    expect((await svc.verify(u.userId, u.agentId)).status).toBe("ACTIVE");
  });
});

describe("ownership verification", () => {
  it("a SPak key on the account is refused: RECOVERY_REQUIRED, never ACTIVE", async () => {
    const u = await verifiedUser();
    near.mode = "adds-parent-key";
    expect(await svc.create(u.userId, u.agentId, (await consent(u)).body)).toMatchObject({ status: "RECOVERY_REQUIRED", recoveryReason: "PARENT_KEY_PRESENT" });
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

/* ------------------------------------------------ hardening: strict verification ------------------------------------------------ */

describe("hardening: exact account authority", () => {
  const OWNER = "ed25519:Owner111111111111111111111111111111111111111";
  const ev = (keys: { publicKey: string; permission: "FullAccess" | "FunctionCall" }[], o: Partial<import("@/agents/accounts").AccountEvidence> = {}) => ({ readable: true, chainId: "testnet", exists: true, keys, checkedAt: "t", ...o });
  const expectAuth = { accountId: "a.p.testnet", ownerPublicKey: OWNER, parentPublicKey: PARENT_PK };
  it("assessAccount: only the approved owner key with full access passes", async () => {
    const { assessAccount } = await import("@/agents/accounts");
    expect(assessAccount(ev([{ publicKey: OWNER, permission: "FullAccess" }]), expectAuth, true)).toEqual({ ok: true, reason: null });
    const cases: [ReturnType<typeof ev>, boolean, string][] = [
      [ev([{ publicKey: OWNER, permission: "FullAccess" }, { publicKey: "ed25519:Other", permission: "FullAccess" }]), true, "UNEXPECTED_FULL_ACCESS_KEY"],
      [ev([{ publicKey: OWNER, permission: "FullAccess" }, { publicKey: "ed25519:Fc", permission: "FunctionCall" }]), true, "UNEXPECTED_FUNCTION_CALL_KEY"],
      [ev([{ publicKey: "ed25519:Other", permission: "FullAccess" }]), true, "OWNER_KEY_MISSING"],
      [ev([{ publicKey: OWNER, permission: "FunctionCall" }]), true, "OWNER_KEY_NOT_FULL_ACCESS"],
      [ev([{ publicKey: OWNER, permission: "FullAccess" }, { publicKey: PARENT_PK, permission: "FullAccess" }]), true, "PARENT_KEY_PRESENT"],
      [ev([], { readable: false }), true, "VERIFICATION_UNAVAILABLE"],
      [ev([], { exists: false }), true, "ACCOUNT_NOT_FOUND"],
      [ev([{ publicKey: OWNER, permission: "FullAccess" }], { chainId: "mainnet" }), true, "WRONG_NETWORK"],
      [ev([{ publicKey: OWNER, permission: "FullAccess" }]), false, "BINDING_MISMATCH"],
    ];
    for (const [e, bound, reason] of cases) expect(assessAccount(e, expectAuth, bound)).toEqual({ ok: false, reason });
  });

  async function active() {
    const u = await verifiedUser();
    const a = await svc.create(u.userId, u.agentId, (await consent(u)).body);
    expect(a.status).toBe("ACTIVE");
    return { u, a };
  }
  const reverify = (u: { userId: string; agentId: string }) => svc.verify(u.userId, u.agentId);

  it("active account records evidence: exactly the owner key with full access", async () => {
    const { a } = await active();
    expect(a.evidence).toMatchObject({ decision: "VERIFIED", reason: null, keys: [{ publicKey: a.ownerPublicKey, permission: "FullAccess" }] });
  });
  for (const [label, keys, reason] of [
    ["unexpected additional full-access key", (o: string) => [{ publicKey: o, permission: "FullAccess" }, { publicKey: "ed25519:Backup", permission: "FullAccess" }], "UNEXPECTED_FULL_ACCESS_KEY"],
    ["unexpected function-call key", (o: string) => [{ publicKey: o, permission: "FullAccess" }, { publicKey: "ed25519:Fc", permission: "FunctionCall" }], "UNEXPECTED_FUNCTION_CALL_KEY"],
    ["missing owner key", () => [{ publicKey: "ed25519:Other", permission: "FullAccess" }], "OWNER_KEY_MISSING"],
    ["incorrect owner key permission", (o: string) => [{ publicKey: o, permission: "FunctionCall" }], "OWNER_KEY_NOT_FULL_ACCESS"],
    ["parent key present", (o: string) => [{ publicKey: o, permission: "FullAccess" }, { publicKey: PARENT_PK, permission: "FullAccess" }], "PARENT_KEY_PRESENT"],
  ] as const) {
    it(`${label}: RECOVERY_REQUIRED with evidence`, async () => {
      const { u, a } = await active();
      near.accounts.set(a.accountId, keys(a.ownerPublicKey) as never);
      const r = await reverify(u);
      expect(r).toMatchObject({ status: "RECOVERY_REQUIRED", recoveryReason: reason, evidence: { decision: "RECOVERY_REQUIRED", reason } });
    });
  }
  it("RPC failure, account unavailable and wrong network: RECOVERY_REQUIRED, never active", async () => {
    const { u, a } = await active();
    near.down = true;
    expect(await reverify(u)).toMatchObject({ status: "RECOVERY_REQUIRED", recoveryReason: "VERIFICATION_UNAVAILABLE" });
    near.down = false;
    expect((await reverify(u)).status).toBe("ACTIVE");
    near.chain = "mainnet";
    expect(await reverify(u)).toMatchObject({ status: "RECOVERY_REQUIRED", recoveryReason: "WRONG_NETWORK" });
    near.chain = "testnet";
    near.accounts.delete(a.accountId);
    expect(await reverify(u)).toMatchObject({ status: "RECOVERY_REQUIRED", recoveryReason: "ACCOUNT_NOT_FOUND" });
  });
  it("consent bound to another Agent or account: BINDING_MISMATCH", async () => {
    const { u, a } = await active();
    await db.execute(sql`update spak_agent_account_challenges set account_id = 'zzz.spak-agents.testnet' where id = (select consent_challenge_id from spak_agent_accounts where id = ${a.id})`);
    expect(await reverify(u)).toMatchObject({ status: "RECOVERY_REQUIRED", recoveryReason: "BINDING_MISMATCH" });
  });
  it("Agent suspended or revoked while NEAR is being read: never activated", async () => {
    for (const action of ["suspend", "revoke"] as const) {
      const u = await verifiedUser();
      const { body } = await consent(u);
      const orig = near.accessKeys.bind(near);
      near.accessKeys = async (id: string) => {
        const k = await orig(id);
        if (id !== PARENT) { near.accessKeys = orig; if (action === "suspend") await agentsSvc.suspend(u.userId, u.agentId); else await agentsSvc.revoke(u.userId, u.agentId, "REVOKE"); }
        return k;
      };
      const r = await svc.create(u.userId, u.agentId, body);
      expect(r.status).toBe(action === "suspend" ? "SUSPENDED" : "REVOKED");
      expect((await svc.view(u.userId, u.agentId)).account?.activatedAt ?? null).toBeNull();
    }
  });
  it("re-verifying the Agent owner identity never re-activates the account on its own", async () => {
    const { u, a } = await active();
    await agentsSvc.suspend(u.userId, u.agentId);
    near.accounts.set(a.accountId, [{ publicKey: "ed25519:Other", permission: "FullAccess" }]);
    const ch = await agentsSvc.challenge(u.userId, u.agentId, { accountId: u.owner.address, domain: DOMAIN });
    const s = await u.owner.sign(ch.message, hex.encode(base64.decode(ch.nonce)), ch.recipient);
    await agentsSvc.verify(u.userId, u.agentId, { challengeId: ch.challengeId, method: ch.method, accountId: u.owner.address, publicKey: s.publicKey, signature: s.signature, domain: DOMAIN });
    expect((await svc.view(u.userId, u.agentId)).account!.status).toBe("OWNERSHIP_VERIFICATION_PENDING");
    expect(await reverify(u)).toMatchObject({ status: "RECOVERY_REQUIRED", recoveryReason: "OWNER_KEY_MISSING" });
    expect(await code(svc.verify(u.userId, u.agentId))).toBe("OK");
  });
  it("verification never moves a suspended account by itself", async () => {
    const { u } = await active();
    await agentsSvc.suspend(u.userId, u.agentId);
    expect((await reverify(u)).status).toBe("SUSPENDED");
  });

  /* ---------------------------------------------- key rotation and lost keys ---------------------------------------------- */

  async function rotationAuthorized() {
    const { u, a } = await active();
    const next = nearWallet();
    const p = await svc.prepareRotation(u.userId, u.agentId, { newPublicKey: next.publicKey, domain: DOMAIN });
    expect(p.transaction).toEqual({ signerId: a.accountId, receiverId: a.accountId, actions: [{ type: "AddKey", publicKey: next.publicKey, permission: "FullAccess" }, { type: "DeleteKey", publicKey: a.ownerPublicKey }] });
    const s = await u.owner.sign(p.message, hex.encode(base64.decode(p.nonce)), p.recipient);
    const r = await svc.authorizeRotation(u.userId, u.agentId, { rotationId: p.rotationId, publicKey: s.publicKey, signature: s.signature, domain: DOMAIN });
    expect(r.status).toBe("AUTHORIZED");
    return { u, a, next, p };
  }
  it("rotation: authorised by the current dedicated-account key, completed only when NEAR shows the new key alone", async () => {
    const { u, a, next, p } = await rotationAuthorized();
    near.accounts.set(a.accountId, [{ publicKey: next.publicKey, permission: "FullAccess" }]); // the owner's own transaction landed
    const done = await svc.completeRotation(u.userId, u.agentId, { rotationId: p.rotationId, txHash: "owner_tx" });
    expect(done).toMatchObject({ status: "COMPLETED", txHash: "owner_tx" });
    const v = (await svc.view(u.userId, u.agentId)).account!;
    expect(v).toMatchObject({ status: "ACTIVE", ownerPublicKey: next.publicKey, evidence: { keys: [{ publicKey: next.publicKey, permission: "FullAccess" }] } });
  });
  it("rotation: old key not removed (both keys present) fails and the account needs recovery", async () => {
    const { u, a, next, p } = await rotationAuthorized();
    near.accounts.set(a.accountId, [{ publicKey: a.ownerPublicKey, permission: "FullAccess" }, { publicKey: next.publicKey, permission: "FullAccess" }]);
    expect(await svc.completeRotation(u.userId, u.agentId, { rotationId: p.rotationId })).toMatchObject({ status: "FAILED", failureReason: "UNEXPECTED_KEYS" });
    expect((await svc.view(u.userId, u.agentId)).account).toMatchObject({ status: "RECOVERY_REQUIRED", recoveryReason: "UNEXPECTED_FULL_ACCESS_KEY", ownerPublicKey: a.ownerPublicKey });
  });
  it("rotation: failed transaction leaves the account unchanged and active", async () => {
    const { u, a, p } = await rotationAuthorized();
    near.txStatus = async () => "FAILURE";
    expect(await svc.completeRotation(u.userId, u.agentId, { rotationId: p.rotationId, txHash: "bad" })).toMatchObject({ status: "FAILED", failureReason: "TRANSACTION_FAILED" });
    expect((await svc.view(u.userId, u.agentId)).account).toMatchObject({ status: "ACTIVE", ownerPublicKey: a.ownerPublicKey });
  });
  it("rotation: unknown outcome stays authorised; a later NEAR read completes it", async () => {
    const { u, a, next, p } = await rotationAuthorized();
    near.txStatus = async () => "UNKNOWN";
    expect((await svc.completeRotation(u.userId, u.agentId, { rotationId: p.rotationId, txHash: "pending" })).status).toBe("AUTHORIZED");
    near.accounts.set(a.accountId, [{ publicKey: next.publicKey, permission: "FullAccess" }]);
    expect(await svc.verify(u.userId, u.agentId)).toMatchObject({ status: "ACTIVE", ownerPublicKey: next.publicKey });
    expect((await svc.view(u.userId, u.agentId)).rotation).toBeNull();
  });
  it("rotation authorisation: wrong key, bad signature, key not on the account, expired, reused, SPak key as replacement", async () => {
    const { u, a } = await active();
    expect(await code(svc.prepareRotation(u.userId, u.agentId, { newPublicKey: PARENT_PK, domain: DOMAIN }))).toBe("AGENT_BAD_REQUEST");
    expect(await code(svc.prepareRotation(u.userId, u.agentId, { newPublicKey: a.ownerPublicKey, domain: DOMAIN }))).toBe("AGENT_BAD_REQUEST");
    const p1 = await svc.prepareRotation(u.userId, u.agentId, { newPublicKey: nearWallet().publicKey, domain: DOMAIN });
    expect(await code(svc.prepareRotation(u.userId, u.agentId, { newPublicKey: nearWallet().publicKey, domain: DOMAIN }))).toBe("AGENT_EXISTS");
    const stranger = nearWallet();
    const s1 = await stranger.sign(p1.message, hex.encode(base64.decode(p1.nonce)), p1.recipient);
    expect(await code(svc.authorizeRotation(u.userId, u.agentId, { rotationId: p1.rotationId, publicKey: s1.publicKey, signature: s1.signature, domain: DOMAIN }))).toBe("AGENT_PROOF_INVALID");
    expect(await code(svc.authorizeRotation(u.userId, u.agentId, { rotationId: p1.rotationId, publicKey: s1.publicKey, signature: s1.signature, domain: DOMAIN }))).toBe("AGENT_CHALLENGE_USED");
    const p2 = await svc.prepareRotation(u.userId, u.agentId, { newPublicKey: nearWallet().publicKey, domain: DOMAIN });
    expect(await code(svc.authorizeRotation(u.userId, u.agentId, { rotationId: p2.rotationId, publicKey: a.ownerPublicKey, signature: base64.encode(new Uint8Array(64)), domain: DOMAIN }))).toBe("AGENT_PROOF_INVALID");
    const p3 = await svc.prepareRotation(u.userId, u.agentId, { newPublicKey: nearWallet().publicKey, domain: DOMAIN });
    near.accounts.set(a.accountId, [{ publicKey: "ed25519:Other", permission: "FullAccess" }]); // the current key was removed on chain
    const s3 = await u.owner.sign(p3.message, hex.encode(base64.decode(p3.nonce)), p3.recipient);
    expect(await code(svc.authorizeRotation(u.userId, u.agentId, { rotationId: p3.rotationId, publicKey: s3.publicKey, signature: s3.signature, domain: DOMAIN }))).toBe("AGENT_KEY_NOT_AUTHORIZED");
  });
  it("rotation challenge expires; re-verifying the owner identity does not authorise a rotation", async () => {
    const { u } = await active();
    const p = await svc.prepareRotation(u.userId, u.agentId, { newPublicKey: nearWallet().publicKey, domain: DOMAIN });
    clock.now += 5 * 60_000 + 1;
    const s = await u.owner.sign(p.message, hex.encode(base64.decode(p.nonce)), p.recipient);
    expect(await code(svc.authorizeRotation(u.userId, u.agentId, { rotationId: p.rotationId, publicKey: s.publicKey, signature: s.signature, domain: DOMAIN }))).toBe("AGENT_CHALLENGE_EXPIRED");
    // completeRotation on a rotation that was never authorised changes nothing
    expect((await svc.completeRotation(u.userId, u.agentId, { rotationId: p.rotationId })).status).toBe("CHALLENGED");
  });
  it("lost key: recovery is not offered, rotation is not available, SPak has no way in", async () => {
    const { u, a } = await active();
    near.accounts.set(a.accountId, [{ publicKey: "ed25519:SomeoneElse", permission: "FullAccess" }]);
    await svc.verify(u.userId, u.agentId);
    const v = await svc.view(u.userId, u.agentId);
    expect(v).toMatchObject({ keyRotationAvailable: false, recovery: "KEY_LOST_OR_CHANGED", account: { status: "RECOVERY_REQUIRED" } });
    expect(await code(svc.prepareRotation(u.userId, u.agentId, { newPublicKey: nearWallet().publicKey, domain: DOMAIN }))).toBe("AGENT_INVALID_STATE");
    expect(near.creates).toBe(1); // SPak never sends another transaction to the account
  });
});
