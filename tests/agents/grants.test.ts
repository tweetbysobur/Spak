/**
 * Stage 10: Agent permissions (grants) over SPak Guard, through the real execution and deposit services and real SQL
 * (PGlite). Grants are signed with real ed25519 NEP-413 signatures. MOCKED: the 1Click provider (Fake1Click), source
 * chain RPC (FakeChain) and the NEAR access-key lookup (h.nearKeys). No settlement is claimed here.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { base64, hex } from "@scure/base";
import type { ExecutionError } from "@/execution";
import { agentEvents, agentGrants, agents, approvals } from "@/database/schema";
import { AgentService, OWNERSHIP_VALID_MS } from "@/agents/service";
import { assessGrant, normalizeScope, type GrantInput } from "@/agents/grants";
import { approval, harness } from "../execution/harness";
import { nearWallet } from "../auth/keys";

const DOMAIN = "spak.test";
const USDC_BASE = "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
let owner: ReturnType<typeof nearWallet>;
let agentId: string;

const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as ExecutionError).code ?? (e as Error).message; } };
const details = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as ExecutionError).details as { reasons: string[]; rules: { rule: string; ok: boolean }[] }; } };

async function verifiedAgent(userId: string, w: ReturnType<typeof nearWallet>) {
  const id = `agt_${randomBytes(12).toString("hex")}`;
  const now = h.now();
  await h.db.insert(agents).values({
    id, userId, displayName: "Agent", status: "VERIFIED", ownerNetwork: "near", ownerAccountId: w.address, ownerPublicKey: w.publicKey,
    verificationMethod: "NEAR_NEP413_FULL_ACCESS_KEY", attestationHash: "a".repeat(64), verifiedAt: now, verificationExpiresAt: new Date(now.getTime() + OWNERSHIP_VALID_MS), createdAt: now, updatedAt: now,
  });
  h.nearKeys.set(`${w.address}|${w.publicKey}`, "FullAccess");
  return id;
}

beforeEach(async () => {
  h = await harness();
  u = await h.newUser();
  owner = nearWallet(`o${randomBytes(6).toString("hex")}.testnet`);
  agentId = await verifiedAgent(u.userId, owner);
  h.chain.setBalance("base", u.evm.address, 10_000_000_000n, USDC_BASE.split(":")[1]);
});

async function start(amount = 50, via: string | null = agentId, text = `Swap ${amount} USDC on Base to SOL on Solana`) {
  h.fake.usdIn = `${amount}.0`;
  const r = await u.plan(text);
  expect(r.status, JSON.stringify(r.errors)).toBe("VALIDATED");
  const x = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: `k-${Math.random().toString(36).slice(2)}`, wallets: await u.wallets(), agentId: via });
  const firm = (await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets: await u.wallets() })).quote;
  return { id: x.execution.id, firm, row: x.execution };
}
const agentApprove = async (x: { id: string; firm: { id: string } }) => h.svc.approveByAgent({ userId: u.userId, executionId: x.id, quoteId: x.firm.id, wallets: await u.wallets() });
const userApprove = async (x: { id: string; firm: { id: string }; row: { planHash: string; planRevision: number } }) =>
  h.svc.approve({ userId: u.userId, executionId: x.id, quoteId: x.firm.id, approval: approval(x.row.planHash, h.now(), true, x.row.planRevision), wallets: await u.wallets() });
const deposit = async (id: string) => h.deposits.prepare({ userId: u.userId, executionId: id, wallets: await u.wallets() });

let SOL = "";
async function scope(patch: Partial<GrantInput> = {}): Promise<GrantInput> {
  if (!SOL) { const x = await start(50, null, "Swap 1 USDC on Base to SOL on Solana"); SOL = (await h.records.get(x.id))!.destinationAssetId; await h.svc.cancel({ userId: u.userId, executionId: x.id }); }
  return { maxTransactionUsd: "60", dailyLimitUsd: "100", maxTransactions: 5, durationHours: 24, sourceNetworks: ["base"], destinationNetworks: ["solana"], assets: [USDC_BASE, SOL], recipients: { self: true, addresses: [] }, ...patch };
}
async function grant(input?: Partial<GrantInput>, signer = owner, opts: { tamper?: boolean; domain?: string } = {}) {
  const c = await h.grants.prepare(u.userId, agentId, await scope(input), DOMAIN);
  const s = await signer.sign(opts.tamper ? c.message.replace("$60", "$6000") : c.message, hex.encode(base64.decode(c.nonce)), c.recipient);
  return h.grants.confirm(u.userId, agentId, { challengeId: c.challengeId, accountId: owner.address, publicKey: s.publicKey, signature: s.signature, domain: opts.domain ?? DOMAIN });
}

describe("default is manual", () => {
  it("with no permission the mode is MANUAL, the Agent cannot approve, and the user still can", async () => {
    expect((await h.grants.view(u.userId, agentId)).mode).toBe("MANUAL");
    const x = await start();
    expect(await code(agentApprove(x))).toBe("AGENT_APPROVAL_REQUIRED");
    expect((await h.records.get(x.id))!.state).toBe("AWAITING_APPROVAL");
    expect((await userApprove(x)).execution.state).toBe("AWAITING_DEPOSIT");
    const [a] = await h.db.select().from(approvals).where(eq(approvals.executionId, x.id));
    expect(a).toMatchObject({ approvedBy: "USER", grantId: null });
  });
  it("a manual transfer can never be approved by the Agent, even with a permission", async () => {
    await grant();
    const x = await start(50, null);
    expect(await code(agentApprove(x))).toBe("AGENT_APPROVAL_REQUIRED");
  });
});

describe("granting needs the owner's signature over the exact permission", () => {
  it("a verified signature creates version 1, ACTIVE, PREAUTHORIZED, with history", async () => {
    const g = await grant();
    expect(g).toMatchObject({ version: 1, status: "ACTIVE", scope: { maxTransactionUsd: "60", maxTransactions: 5 }, signerPublicKey: owner.publicKey });
    const v = await h.grants.view(u.userId, agentId);
    expect(v.mode).toBe("PREAUTHORIZED");
    expect(v.usage).toEqual({ transactions: 0, dayUsd: "0" });
    expect((await h.db.select().from(agentEvents).where(eq(agentEvents.agentId, agentId))).map((e) => e.event)).toContain("GRANT_CREATED");
  });
  it("refuses another key, a tampered message, a key without full access, reuse, expiry and another site", async () => {
    expect(await code(grant({}, nearWallet(owner.address)))).toBe("AGENT_PROOF_INVALID");
    expect(await code(grant({}, owner, { tamper: true }))).toBe("AGENT_PROOF_INVALID");
    expect(await code(grant({}, owner, { domain: "evil.test" }))).toBe("AGENT_DOMAIN_MISMATCH");
    h.nearKeys.set(`${owner.address}|${owner.publicKey}`, "FunctionCall");
    expect(await code(grant())).toBe("AGENT_KEY_NOT_AUTHORIZED");
    h.nearKeys.set(`${owner.address}|${owner.publicKey}`, "FullAccess");
    const c = await h.grants.prepare(u.userId, agentId, await scope(), DOMAIN);
    const s = await owner.sign(c.message, hex.encode(base64.decode(c.nonce)), c.recipient);
    const body = { challengeId: c.challengeId, accountId: owner.address, publicKey: s.publicKey, signature: s.signature, domain: DOMAIN };
    h.clock.now += 6 * 60_000;
    expect(await code(h.grants.confirm(u.userId, agentId, body))).toBe("AGENT_CHALLENGE_EXPIRED");
    const c2 = await h.grants.prepare(u.userId, agentId, await scope(), DOMAIN);
    const s2 = await owner.sign(c2.message, hex.encode(base64.decode(c2.nonce)), c2.recipient);
    const body2 = { challengeId: c2.challengeId, accountId: owner.address, publicKey: s2.publicKey, signature: s2.signature, domain: DOMAIN };
    await h.grants.confirm(u.userId, agentId, body2);
    expect(await code(h.grants.confirm(u.userId, agentId, body2))).toBe("AGENT_CHALLENGE_USED");
    expect((await h.db.select().from(agentGrants)).length).toBe(1);
  });
  it("another user cannot prepare, view or change this Agent's permission", async () => {
    const other = await h.newUser();
    expect(await code(h.grants.prepare(other.userId, agentId, await scope(), DOMAIN))).toBe("AGENT_NOT_FOUND");
    expect(await code(h.grants.view(other.userId, agentId))).toBe("AGENT_NOT_FOUND");
    await grant();
    expect(await code(h.grants.revoke(other.userId, agentId))).toBe("AGENT_NOT_FOUND");
  });
  it("scope validation: ceiling, daily below per-transfer, unknown network or token, no recipients", () => {
    const ok = { maxTransactionUsd: "60", dailyLimitUsd: "100", maxTransactions: 5, durationHours: 24, sourceNetworks: ["base"], destinationNetworks: ["solana"], assets: [USDC_BASE], recipients: { self: true, addresses: [] } };
    expect(normalizeScope(ok, "1000").scope.assets).toEqual([USDC_BASE]);
    for (const bad of [{ maxTransactionUsd: "1001" }, { dailyLimitUsd: "50" }, { sourceNetworks: ["moon"] }, { assets: ["base:0xdead"] }, { recipients: { self: false, addresses: [] } }, { maxTransactions: 21 }, { durationHours: 169 }, { maxTransactionUsd: "-1" }, { extra: true }]) {
      expect(() => normalizeScope({ ...ok, ...bad }, "1000"), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("the Agent approves inside its permission and Guard; anything else needs the user", () => {
  it("within scope: approved by AGENT_GRANT with the grant version, and the deposit is prepared for the user's wallet", async () => {
    const g = await grant();
    const x = await start(50);
    const r = await agentApprove(x);
    expect(r.execution.state).toBe("AWAITING_DEPOSIT");
    const [a] = await h.db.select().from(approvals).where(eq(approvals.executionId, x.id));
    expect(a).toMatchObject({ approvedBy: "AGENT_GRANT", grantId: g.id, grantVersion: 1 });
    const d = await deposit(x.id);
    expect(d.transaction).toBeTruthy();
    expect((await h.grants.view(u.userId, agentId)).usage).toEqual({ transactions: 1, dayUsd: "50" });
  });

  it.each([
    ["above the per-transfer limit", { maxTransactionUsd: "40" }, "MAX_TRANSACTION"],
    ["source network not allowed", { sourceNetworks: ["arbitrum"] }, "SOURCE_NETWORK"],
    ["destination network not allowed", { destinationNetworks: ["base"] }, "DESTINATION_NETWORK"],
    ["token not allowed", { assets: [USDC_BASE] }, "DESTINATION_ASSET"],
    ["own wallets not allowed", { recipients: { self: false, addresses: [{ network: "solana", address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" }] } }, "RECIPIENT"],
  ])("outside scope (%s): AGENT_APPROVAL_REQUIRED naming the rule; nothing approved; the user can approve it", async (_n, patch, rule) => {
    await grant(patch as Partial<GrantInput>);
    const x = await start(50);
    const d = await details(agentApprove(x));
    expect(d?.rules.filter((r) => !r.ok).map((r) => r.rule)).toContain(rule);
    expect((await h.records.get(x.id))!.state).toBe("AWAITING_APPROVAL");
    expect(await h.records.activeApproval(x.id)).toBeNull();
    expect((await userApprove(x)).execution.state).toBe("AWAITING_DEPOSIT");
  });

  it("transfer count and 24-hour limits count earlier Agent approvals", async () => {
    await grant({ maxTransactions: 2, dailyLimitUsd: "60", maxTransactionUsd: "40" });
    await agentApprove(await start(30));
    const second = await start(35);
    const d = await details(agentApprove(second));
    expect(d?.rules.find((r) => r.rule === "DAILY_LIMIT")?.ok).toBe(false);
    await agentApprove(await start(20));
    const fourth = await start(10);
    expect((await details(agentApprove(fourth)))?.rules.find((r) => r.rule === "MAX_TRANSACTIONS")?.ok).toBe(false);
  });

  it("Guard still applies on top: a permission above the Guard limit is still blocked by Guard", async () => {
    await grant({ maxTransactionUsd: "60" });
    const x = await start(50);
    const p = (await h.guard.view(u.userId)).policy;
    await h.guard.update(u.userId, { version: p.version, maxTransactionUsd: "40" });
    expect(await code(agentApprove(x))).toBe("GUARD_BLOCKED");
    expect(await h.records.activeApproval(x.id)).toBeNull();
  });

  it("concurrent Agent approvals cannot exceed the transfer count", async () => {
    await grant({ maxTransactions: 1 });
    const a = await start(30), b = await start(31), c = await start(32);
    const out = await Promise.all([a, b, c].map((x) => code(agentApprove(x))));
    expect(out.filter((o) => o === "OK")).toHaveLength(1);
    expect(out.filter((o) => o === "AGENT_APPROVAL_REQUIRED")).toHaveLength(2);
    expect((await h.grants.view(u.userId, agentId)).usage?.transactions).toBe(1);
  });
});

describe("concurrency (real row locks when run with SPAK_TEST_PG_URL)", () => {
  it("ten concurrent Agent approvals under a 3-transfer permission: exactly 3 succeed, each with one Guard reservation", async () => {
    await grant({ maxTransactions: 3, dailyLimitUsd: "1000", maxTransactionUsd: "60" });
    const xs = [];
    for (let i = 0; i < 10; i++) xs.push(await start(20 + i));
    const out = await Promise.all(xs.map((x) => code(agentApprove(x))));
    expect(out.filter((o) => o === "OK")).toHaveLength(3);
    expect(out.every((o) => o === "OK" || o === "AGENT_APPROVAL_REQUIRED")).toBe(true);
    expect((await h.grants.view(u.userId, agentId)).usage?.transactions).toBe(3);
    const live = await h.db.select().from(approvals).where(eq(approvals.approvedBy, "AGENT_GRANT"));
    expect(live.filter((a) => !a.invalidatedAt)).toHaveLength(3);
  });
  it("revoking while Agent approvals are in flight: nothing approved after the revoke commits can reach a deposit", async () => {
    await grant({ maxTransactions: 10, dailyLimitUsd: "1000" });
    const xs = [];
    for (let i = 0; i < 5; i++) xs.push(await start(20 + i));
    const [results] = await Promise.all([Promise.all(xs.map((x) => code(agentApprove(x)))), h.grants.revoke(u.userId, agentId)]);
    for (const [i, x] of xs.entries()) {
      if (results[i] === "OK") expect(await code(deposit(x.id))).toBe("AGENT_GRANT_CHANGED");
      else expect(results[i]).toBe("AGENT_APPROVAL_REQUIRED");
    }
    expect((await h.grants.view(u.userId, agentId)).mode).toBe("MANUAL");
  });
});

describe("changes take effect at once; stale Agent approvals authorize nothing", () => {
  it("pause stops new Agent approvals and stops the deposit of one already approved; resume restores the same permission", async () => {
    await grant();
    const x = await start(50);
    await agentApprove(x);
    await h.grants.pause(u.userId, agentId);
    expect((await h.grants.view(u.userId, agentId)).mode).toBe("MANUAL");
    expect(await code(deposit(x.id))).toBe("AGENT_GRANT_CHANGED");
    expect(await code(agentApprove(await start(20)))).toBe("AGENT_APPROVAL_REQUIRED");
    const g = await h.grants.resume(u.userId, agentId);
    expect(g).toMatchObject({ status: "ACTIVE", version: 1 });
    expect((await deposit(x.id)).deposit.executionId).toBe(x.id);
  });

  it("revoke returns to manual and an earlier Agent approval cannot fund a deposit", async () => {
    await grant();
    const x = await start(50);
    await agentApprove(x);
    await h.grants.revoke(u.userId, agentId);
    expect((await h.grants.view(u.userId, agentId)).mode).toBe("MANUAL");
    expect(await code(deposit(x.id))).toBe("AGENT_GRANT_CHANGED");
    expect(await code(h.grants.resume(u.userId, agentId))).toBe("AGENT_INVALID_STATE");
  });

  it("a new permission version supersedes the old one; approvals under the old version are stale", async () => {
    await grant();
    const x = await start(50);
    await agentApprove(x);
    const v2 = await grant({ maxTransactionUsd: "55" });
    expect(v2.version).toBe(2);
    const hist = (await h.grants.view(u.userId, agentId)).history.map((g) => `${g.version}:${g.status}`);
    expect(hist).toEqual(["2:ACTIVE", "1:SUPERSEDED"]);
    expect(await code(deposit(x.id))).toBe("AGENT_GRANT_CHANGED");
  });

  it("expiry ends the permission for approvals and for deposits", async () => {
    await grant({ durationHours: 1 });
    const x = await start(50);
    await agentApprove(x);
    h.clock.now += 3600_000 + 1;
    expect((await h.grants.view(u.userId, agentId)).grant?.status).toBe("EXPIRED");
    expect(await code(deposit(x.id))).toBe("DEPOSIT_EXPIRED");
  });

  it("a Guard change after the Agent approved applies at deposit (full policy re-checked)", async () => {
    await grant();
    const x = await start(50);
    await agentApprove(x);
    const p = (await h.guard.view(u.userId)).policy;
    await h.guard.update(u.userId, { version: p.version, maxTransactionUsd: "40" });
    expect(await code(deposit(x.id))).toBe("GUARD_BLOCKED");
  });

  it("suspending the Agent pauses its permission; revoking the Agent revokes it", async () => {
    await grant();
    const svc = new AgentService(h.db, { clock: h.now, nearRpc: { accessKey: async () => null } });
    await svc.suspend(u.userId, agentId);
    expect((await h.grants.view(u.userId, agentId)).grant?.status).toBe("PAUSED");
    await svc.revoke(u.userId, agentId, "REVOKE");
    expect((await h.db.select().from(agentGrants))[0]).toMatchObject({ status: "REVOKED", endReason: "AGENT_REVOKED" });
  });
});

describe("assessGrant (pure)", () => {
  const now = new Date("2026-11-13T10:00:00Z");
  const g = { status: "ACTIVE", validFrom: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 1000), scope: { maxTransactionUsd: "50", dailyLimitUsd: "80", maxTransactions: 2, sourceNetworks: ["base"], destinationNetworks: ["solana"], assets: ["a", "b"], recipients: { self: true, addresses: [] } } };
  const s = { sourceNetwork: "base", destinationNetwork: "solana", sourceAssetId: "a", destinationAssetId: "b", recipient: "x", recipientKind: "SELF" as const, valueUsd: "50" };
  it("allows exactly at the limits and fails closed on unknown value, missing grant or an Agent that cannot act", () => {
    expect(assessGrant({ grant: g, agentProblem: null, subject: s, usage: { transactions: 1, dayUsd: "30" }, now }).ok).toBe(true);
    expect(assessGrant({ grant: g, agentProblem: null, subject: { ...s, valueUsd: "50.01" }, usage: { transactions: 0, dayUsd: "0" }, now }).ok).toBe(false);
    expect(assessGrant({ grant: g, agentProblem: null, subject: s, usage: { transactions: 1, dayUsd: "30.01" }, now }).ok).toBe(false);
    expect(assessGrant({ grant: g, agentProblem: null, subject: s, usage: { transactions: 2, dayUsd: "0" }, now }).ok).toBe(false);
    expect(assessGrant({ grant: g, agentProblem: null, subject: { ...s, valueUsd: null }, usage: { transactions: 0, dayUsd: "0" }, now }).ok).toBe(false);
    expect(assessGrant({ grant: null, agentProblem: null, subject: s, usage: { transactions: 0, dayUsd: "0" }, now }).ok).toBe(false);
    expect(assessGrant({ grant: g, agentProblem: "AGENT_SUSPENDED", subject: s, usage: { transactions: 0, dayUsd: "0" }, now }).ok).toBe(false);
    expect(assessGrant({ grant: { ...g, status: "PAUSED" }, agentProblem: null, subject: s, usage: { transactions: 0, dayUsd: "0" }, now }).ok).toBe(false);
    expect(assessGrant({ grant: { ...g, expiresAt: now }, agentProblem: null, subject: s, usage: { transactions: 0, dayUsd: "0" }, now }).ok).toBe(false);
  });
});
