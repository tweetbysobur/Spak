/**
 * Stage 9: Agent-attributed execution and Agent account funding, through the real execution and deposit services
 * and real SQL (PGlite). MOCKED: the 1Click provider (Fake1Click), source-chain RPC (FakeChain) and the NEAR
 * view_account read (a fake chain object). No network, no real funds, no settlement is claimed here.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ExecutionError } from "@/execution";
import { agentAccounts, agentEvents, agentFundingChecks, agents } from "@/database/schema";
import { AgentService, OWNERSHIP_VALID_MS } from "@/agents/service";
import { AgentFundingService, MIN_FUNDED_YOCTO, assessFunding } from "@/agents/funding";
import { actingProblem } from "@/agents/authority";
import { approval, harness } from "../execution/harness";

let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
beforeEach(async () => { h = await harness(); u = await h.newUser(); });

const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as ExecutionError).code ?? (e as Error).message; } };
const KEY = "ed25519:8hSHprDq2StXwMtNd43wDTXQYsjXcD4MJTXQYsjXcc9g";

async function verifiedAgent(userId = u.userId, patch: Partial<typeof agents.$inferInsert> = {}) {
  const id = `agt_${randomBytes(12).toString("hex")}`;
  const now = h.now();
  await h.db.insert(agents).values({
    id, userId, displayName: "Test Agent", status: "VERIFIED", ownerNetwork: "near", ownerAccountId: `o${randomBytes(6).toString("hex")}.testnet`, ownerPublicKey: KEY,
    verificationMethod: "NEAR_NEP413_FULL_ACCESS_KEY", attestationHash: "a".repeat(64), verifiedAt: now, verificationExpiresAt: new Date(now.getTime() + OWNERSHIP_VALID_MS), createdAt: now, updatedAt: now, ...patch,
  });
  return id;
}
async function create(agentId: string | null, who = u, text = "Swap 50 USDC on Base to SOL on Solana") {
  const r = await who.plan(text);
  expect(r.status, JSON.stringify(r.errors)).toBe("VALIDATED");
  return h.svc.create({ userId: who.userId, planHash: r.plan!.hash, idempotencyKey: `k-${Math.random().toString(36).slice(2)}`, wallets: await who.wallets(), agentId });
}
async function firmAndApprove(x: Awaited<ReturnType<typeof create>>) {
  const firm = (await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets: await u.wallets() })).quote;
  return h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: firm.id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets: await u.wallets() });
}
const agentService = () => new AgentService(h.db, { clock: h.now, nearRpc: { accessKey: async () => null } });

describe("Agent-attributed execution (server-side authority)", () => {
  it("a verified, in-date Agent owned by the user can start a transfer; the execution records the Agent", async () => {
    const id = await verifiedAgent();
    const x = await create(id);
    expect(x.execution.agentId).toBe(id);
    expect((await h.svc.details(x.execution.id, u.userId)).agentId).toBe(id);
    const r = await firmAndApprove(x);
    expect(r.execution.state).toBe("AWAITING_DEPOSIT");
    h.chain.setBalance("base", u.evm.address, 100_000_000n, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    const d = await h.deposits.prepare({ userId: u.userId, executionId: x.execution.id, wallets: await u.wallets() });
    expect(d.deposit.executionId).toBe(x.execution.id);
  });

  it("refuses another user's Agent, an unknown Agent, and Agents that are not verified, suspended, revoked or expired", async () => {
    const other = await h.newUser();
    const foreign = await verifiedAgent(other.userId);
    expect(await code(create(foreign))).toBe("AGENT_NOT_AUTHORIZED");
    expect(await code(create(`agt_${"0".repeat(24)}`))).toBe("AGENT_NOT_AUTHORIZED");
    for (const patch of [{ status: "CREATED" }, { status: "PENDING_VERIFICATION" }, { status: "SUSPENDED", suspendedAt: h.now() }, { status: "REVOKED", revokedAt: h.now() }, { verificationExpiresAt: new Date(h.now().getTime() - 1) }]) {
      const fresh = await h.newUser();
      const id = await verifiedAgent(fresh.userId, patch);
      expect(await code(create(id, fresh)), JSON.stringify(patch)).toBe("AGENT_NOT_AUTHORIZED");
    }
    // Nothing was created or quoted for refused Agents.
    const n = await h.db.select().from(agents);
    expect(n.length).toBeGreaterThan(0);
    expect(h.fake.calls.filter((c) => c.path.startsWith("/v0/quote"))).toHaveLength(0);
  });

  it("a manual execution stays manual: no Agent is attached and none is checked", async () => {
    const x = await create(null);
    expect(x.execution.agentId).toBeNull();
    expect((await firmAndApprove(x)).execution.state).toBe("AWAITING_DEPOSIT");
  });

  it("the same plan cannot be re-attributed: manual then Agent (or the reverse) is refused, the same mode is idempotent", async () => {
    const id = await verifiedAgent();
    const r = await u.plan("Swap 50 USDC on Base to SOL on Solana");
    const base = { userId: u.userId, planHash: r.plan!.hash, wallets: await u.wallets() };
    const first = await h.svc.create({ ...base, idempotencyKey: "key-manual-1", agentId: null });
    expect(await code(h.svc.create({ ...base, idempotencyKey: "key-agent-01", agentId: id }))).toBe("AGENT_MISMATCH");
    const again = await h.svc.create({ ...base, idempotencyKey: "key-manual-1", agentId: null });
    expect(again.execution.id).toBe(first.execution.id);
  });

  it("suspending the Agent after creation stops approval; suspending after approval stops deposit preparation", async () => {
    const id = await verifiedAgent();
    const x = await create(id);
    await agentService().suspend(u.userId, id);
    expect(await code(firmAndApprove(x))).toBe("AGENT_NOT_AUTHORIZED");
    expect((await h.records.get(x.execution.id))!.state).toBe("AWAITING_APPROVAL");
    expect(await h.records.activeApproval(x.execution.id)).toBeNull();

    const fresh = await h.newUser();
    u = fresh;
    const id2 = await verifiedAgent(fresh.userId);
    const y = await create(id2, fresh);
    await firmAndApprove(y);
    await h.db.update(agents).set({ status: "REVOKED", revokedAt: h.now() }).where(eq(agents.id, id2));
    expect(await code(h.deposits.prepare({ userId: fresh.userId, executionId: y.execution.id, wallets: await fresh.wallets() }))).toBe("AGENT_NOT_AUTHORIZED");
  });

  it("an ownership proof that expires between approval and deposit stops the deposit (time is checked on the server clock)", async () => {
    const id = await verifiedAgent(u.userId, { verificationExpiresAt: new Date(h.now().getTime() + 60_000) });
    const x = await create(id);
    await firmAndApprove(x);
    h.clock.now += 61_000;
    expect(await code(h.deposits.prepare({ userId: u.userId, executionId: x.execution.id, wallets: await u.wallets() }))).toBe("AGENT_NOT_AUTHORIZED");
  });

  it("actingProblem is fail-closed for every non-current state", () => {
    const now = new Date();
    const ok = { userId: "u", status: "VERIFIED", verificationExpiresAt: new Date(now.getTime() + 1000), ownerPublicKey: KEY };
    expect(actingProblem(ok, "u", now)).toBeNull();
    expect(actingProblem(ok, "other", now)).toBe("AGENT_NOT_FOUND");
    expect(actingProblem(null, "u", now)).toBe("AGENT_NOT_FOUND");
    expect(actingProblem({ ...ok, verificationExpiresAt: null }, "u", now)).toBe("AGENT_OWNERSHIP_EXPIRED");
    expect(actingProblem({ ...ok, status: "SUSPENDED" }, "u", now)).toBe("AGENT_SUSPENDED");
  });
});

describe("Agent account funding (read from NEAR, recorded, never trusted from the browser)", () => {
  const STORAGE = 182; // bytes, a fresh account
  const reserve = BigInt(STORAGE) * 10n ** 19n;
  async function activeAccount(agentId: string, userId = u.userId, status = "ACTIVE") {
    const now = h.now();
    const id = `aac_${randomBytes(12).toString("hex")}`;
    await h.db.insert(agentAccounts).values({
      id, agentId, userId, network: "testnet", accountId: `a${randomBytes(4).toString("hex")}.spak-parent.testnet`, parentAccountId: "spak-parent.testnet", ownerPublicKey: KEY, keyType: "ed25519",
      status, creationTxHash: "tx1", creationOutcome: "SUCCESS", createdOnChainAt: now, ownershipVerifiedAt: now, activatedAt: now, consentChallengeId: "acc_test", verificationEvidence: { checkedAt: now.toISOString(), decision: "VERIFIED", reason: null, keys: [] }, sponsorship: "FUNDED", fundingYocto: "100000000000000000000000", idempotencyKey: `idem-${id}`, createdAt: now, updatedAt: now,
    });
    return id;
  }
  const svc = (view: () => Promise<{ amount: string; storageUsage?: number } | null>) => new AgentFundingService({ db: h.db, clock: h.now, chain: { viewAccount: view } });

  it("FUNDED only when the spendable balance (liquid minus storage reserve) meets the minimum; recorded with an event", async () => {
    const id = await verifiedAgent();
    await activeAccount(id);
    const amount = (reserve + BigInt(MIN_FUNDED_YOCTO)).toString();
    const f = await svc(async () => ({ amount, storageUsage: STORAGE })).check(u.userId, id);
    expect(f).toMatchObject({ result: "FUNDED", reason: null, spendableYocto: MIN_FUNDED_YOCTO, balanceYocto: amount, network: "testnet", source: "NEAR_RPC_VIEW_ACCOUNT" });
    const ev = await h.db.select().from(agentEvents).where(eq(agentEvents.agentId, id));
    expect(ev.map((e) => e.event)).toContain("FUNDING_FUNDED");
    expect(await svc(async () => null).latest(u.userId, id)).toMatchObject({ result: "FUNDED" });
  });

  it("one yocto short is UNFUNDED; a missing account is UNFUNDED; an unreachable NEAR is INCONCLUSIVE, never FUNDED", async () => {
    const id = await verifiedAgent();
    await activeAccount(id);
    const short = (reserve + BigInt(MIN_FUNDED_YOCTO) - 1n).toString();
    expect(await svc(async () => ({ amount: short, storageUsage: STORAGE })).check(u.userId, id)).toMatchObject({ result: "UNFUNDED", reason: "BELOW_MINIMUM" });
    expect(await svc(async () => null).check(u.userId, id)).toMatchObject({ result: "UNFUNDED", reason: "ACCOUNT_NOT_FOUND" });
    expect(await svc(async () => { throw new Error("timeout"); }).check(u.userId, id)).toMatchObject({ result: "INCONCLUSIVE", reason: "NEAR_UNREACHABLE", balanceYocto: null });
    expect(assessFunding({ amount: "12.5" })).toMatchObject({ result: "INCONCLUSIVE", reason: "UNREADABLE_BALANCE" });
    expect(assessFunding({ amount: "0", storageUsage: 500 })).toMatchObject({ result: "UNFUNDED", spendableYocto: "0" });
    expect((await h.db.select().from(agentFundingChecks)).length).toBe(3);
  });

  it("refuses without an ACTIVE account, for a suspended Agent, for another user's Agent, or with no NEAR reader", async () => {
    const id = await verifiedAgent();
    const read = svc(async () => ({ amount: "1", storageUsage: 0 }));
    expect(await code(read.check(u.userId, id))).toBe("AGENT_INVALID_STATE");
    await activeAccount(id, u.userId, "RECOVERY_REQUIRED");
    expect(await code(read.check(u.userId, id))).toBe("AGENT_INVALID_STATE");
    const other = await h.newUser();
    expect(await code(read.check(other.userId, id))).toBe("AGENT_NOT_FOUND");
    const id2 = await verifiedAgent(other.userId);
    await activeAccount(id2, other.userId);
    expect(await code(new AgentFundingService({ db: h.db, clock: h.now, chain: null }).check(other.userId, id2))).toBe("AGENT_VERIFICATION_UNAVAILABLE");
    await agentService().suspend(other.userId, id2);
    expect(await code(read.check(other.userId, id2))).toBe("AGENT_INVALID_STATE");
    expect((await h.db.select().from(agentFundingChecks)).length).toBe(0);
  });
});
