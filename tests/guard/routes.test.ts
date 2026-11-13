/**
 * Guard API and Guard enforcement through the real route handlers: real cookies, real wallet signatures, real SQL.
 * MOCKED: the 1Click provider (Fake1Click).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Fake1Click } from "../execution/fake-1click";

const fake = new Fake1Click();
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith("https://1click.chaindefuser.com")) return fake.fetch(u.replace("https://1click.chaindefuser.com", "http://x"), init);
  return realFetch(url, init);
});

const { POST: challenge } = await import("@/app/api/auth/challenge/route");
const { POST: verify } = await import("@/app/api/auth/verify/route");
const { POST: interpret } = await import("@/app/api/spak-in/interpret/route");
const { POST: manual } = await import("@/app/api/spak-in/manual/route");
const { POST: createExec } = await import("@/app/api/executions/route");
const { POST: firmQuote } = await import("@/app/api/executions/[id]/firm-quote/route");
const { POST: approveExec } = await import("@/app/api/executions/[id]/approve/route");
const { GET: execGuard } = await import("@/app/api/executions/[id]/guard/route");
const { GET: getGuard, PATCH: patchGuard } = await import("@/app/api/guard/route");
const { POST: addRecipient } = await import("@/app/api/guard/recipients/route");
const { DELETE: removeRecipient } = await import("@/app/api/guard/recipients/[id]/route");
const { POST: pause } = await import("@/app/api/guard/pause/route");
const { POST: resume } = await import("@/app/api/guard/resume/route");
const { GET: history } = await import("@/app/api/guard/history/route");
const { evmWallet } = await import("../auth/keys");

const ORIGIN = "http://localhost:3000";
let ipn = 0;
function req(path: string, o: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ipn % 250}`, origin: o.origin ?? ORIGIN };
  if (o.cookie) h.cookie = o.cookie;
  return new Request(`${ORIGIN}${path}`, { method: o.method ?? "POST", headers: h, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });

async function user() {
  const e = evmWallet();
  const c = (await j(await challenge(req("/api/auth/challenge", { body: { family: "evm", address: e.address } })))).body;
  const v = await verify(req("/api/auth/verify", { body: { challengeId: c.challengeId, signature: (await e.sign(c.message)).signature } }));
  return { cookie: v.headers.get("set-cookie")!.split(";")[0], evm: e };
}
type U = Awaited<ReturnType<typeof user>>;
const guard = async (a: U) => (await j(await getGuard(req("/api/guard", { method: "GET", cookie: a.cookie })))).body;
const patch = async (a: U, body: Record<string, unknown>) => j(await patchGuard(req("/api/guard", { method: "PATCH", cookie: a.cookie, body: { version: (await guard(a)).policy.version, ...body } })));
const plan = async (a: U, text: string, extra: Record<string, unknown> = {}) => (await j(await interpret(req("/api/spak-in/interpret", { cookie: a.cookie, body: { text, ...extra } })))).body;
let n = 0;
const create = async (a: U, hash: string) => j(await createExec(req("/api/executions", { cookie: a.cookie, body: { planHash: hash, idempotencyKey: `guard-route-${++n}-${Date.now()}` } })));

let alice: U, bob: U;
beforeAll(async () => { alice = await user(); bob = await user(); });

describe("Guard API", () => {
  it("requires a session, and writes require a same-origin request", async () => {
    expect((await getGuard(req("/api/guard", { method: "GET" }))).status).toBe(401);
    expect((await patchGuard(req("/api/guard", { method: "PATCH", body: { version: 1 } }))).status).toBe(401);
    expect((await pause(req("/api/guard/pause", { body: {} }))).status).toBe(401);
    expect((await patchGuard(req("/api/guard", { method: "PATCH", cookie: alice.cookie, origin: "https://evil.example", body: { version: 1, dailyLimitUsd: "1" } }))).status).toBe(403);
  });
  it("GET returns the user's own policy, spending and the platform ceiling", async () => {
    const g = await guard(alice);
    expect(g).toMatchObject({ policy: { status: "ACTIVE", maxSlippageBps: 100 }, spending: { dayUsd: "0", weekUsd: "0", monthUsd: "0" }, ceilingUsd: "1000" });
    expect(JSON.stringify(g)).not.toMatch(/private|seed|secret/i);
  });
  it("PATCH changes settings; a user id in the body is refused, never used", async () => {
    const r = await patch(alice, { dailyLimitUsd: "500" });
    expect(r.status).toBe(200);
    expect(r.body.policy.limits.dailyUsd).toBe("500");
    const bad = await j(await patchGuard(req("/api/guard", { method: "PATCH", cookie: bob.cookie, body: { version: (await guard(bob)).policy.version, userId: "x", dailyLimitUsd: "1" } })));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("GUARD_INVALID_SETTING");
    expect((await guard(alice)).policy.limits.dailyUsd).toBe("500");
    expect((await guard(bob)).policy.limits.dailyUsd).toBeNull();
  });
  it("a stale version gets 409", async () => {
    const r = await j(await patchGuard(req("/api/guard", { method: "PATCH", cookie: alice.cookie, body: { version: 1, dailyLimitUsd: "600" } })));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("GUARD_VERSION_CONFLICT");
  });
  it("recipients: add, cannot be removed by another user, removed by the owner", async () => {
    const add = await j(await addRecipient(req("/api/guard/recipients", { cookie: alice.cookie, body: { version: (await guard(alice)).policy.version, network: "arbitrum", address: "0x4444444444444444444444444444444444444444", label: "Savings" } })));
    expect(add.status).toBe(201);
    const rid = add.body.policy.recipients[0].id;
    const steal = await j(await removeRecipient(req(`/api/guard/recipients/${rid}`, { method: "DELETE", cookie: bob.cookie, body: { version: (await guard(bob)).policy.version } }), p(rid)));
    expect(steal.status).toBe(404);
    expect((await guard(alice)).policy.recipients).toHaveLength(1);
    const del = await j(await removeRecipient(req(`/api/guard/recipients/${rid}`, { method: "DELETE", cookie: alice.cookie, body: { version: (await guard(alice)).policy.version } }), p(rid)));
    expect(del.status).toBe(200);
    expect(del.body.policy.recipients).toHaveLength(0);
  });
  it("malformed bodies and ids get 400", async () => {
    expect((await removeRecipient(req("/api/guard/recipients/x", { method: "DELETE", cookie: alice.cookie, body: { version: 1 } }), p("x"))).status).toBe(400);
    expect((await pause(req("/api/guard/pause", { cookie: alice.cookie, body: { scope: "EVERYTHING" } }))).status).toBe(400);
    expect((await resume(req("/api/guard/resume", { cookie: alice.cookie, body: {} }))).status).toBe(400);
  });
  it("history lists the user's own changes, newest first", async () => {
    const h = (await j(await history(req("/api/guard/history?limit=5", { method: "GET", cookie: alice.cookie })))).body;
    expect(h.items[0].version).toBeGreaterThan(h.items[h.items.length - 1].version);
    expect(h.items.every((x: { userId: string }) => x.userId === h.items[0].userId)).toBe(true);
  });
});

describe("Guard enforcement through the API", () => {
  it("SPak-in ignores any policy or spending the browser sends", async () => {
    const r = await plan(bob, "Bridge 10 USDC from Base to Arbitrum", { policy: { maxTransactionUsd: "1", allowedNetworks: ["ethereum"], autonomous: { enabled: true } }, runtime: { spentTodayUsd: "999999" } });
    expect(r.status).toBe("VALIDATED");
    expect(r.guard).toMatchObject({ outcome: "REQUIRES_APPROVAL", stage: "PLAN" });
    // And the other way: a permissive body cannot loosen the stored policy.
    await patch(bob, { networks: [{ network: "arbitrum", allowSource: true, allowDestination: false, disabled: false }] });
    const blocked = await plan(bob, "Bridge 11 USDC from Base to Arbitrum", { policy: { allowedNetworks: ["base", "arbitrum"] } });
    expect(blocked.guard).toMatchObject({ outcome: "BLOCKED" });
    const c = await create(bob, blocked.plan.hash);
    expect(c.status).toBe(403);
    expect(c.body.error.code).toBe("GUARD_BLOCKED");
    expect(c.body.error.message).toMatch(/Arbitrum as a destination/);
    await patch(bob, { networks: [{ network: "arbitrum", allowSource: true, allowDestination: true, disabled: false }] });
  });
  it("the manual form ignores a browser policy too", async () => {
    const r = (await j(await manual(req("/api/spak-in/manual", { cookie: bob.cookie, body: {
      intent: { type: "BRIDGE", amount: "10", sourceNetwork: "base", sourceAsset: "USDC", destinationNetwork: "arbitrum", destinationAsset: "USDC" },
      policy: { allowedNetworks: ["ethereum"] },
    } })))).body;
    expect(r.status).toBe("VALIDATED");
    expect(r.guard.outcome).toBe("REQUIRES_APPROVAL");
  });
  it("pause blocks a new transfer at the API; resume allows it", async () => {
    const r = await plan(bob, "Bridge 13 USDC from Base to Arbitrum");
    expect((await j(await pause(req("/api/guard/pause", { cookie: bob.cookie, body: { scope: "REQUESTS" } })))).body.policy.status).toBe("PAUSED");
    const c = await create(bob, r.plan.hash);
    expect(c.body.error.code).toBe("GUARD_BLOCKED");
    expect(c.body.error.message).toMatch(/paused/);
    await resume(req("/api/guard/resume", { cookie: bob.cookie, body: { version: (await guard(bob)).policy.version } }));
    expect((await create(bob, r.plan.hash)).status).toBe(201);
  });
  it("a full approval reserves spending, and only the owner can see the transfer's Guard record", async () => {
    const r = await plan(alice, "Bridge 14 USDC from Base to Arbitrum");
    const c = (await create(alice, r.plan.hash)).body;
    const id = c.execution.id;
    const f = (await j(await firmQuote(req(`/api/executions/${id}/firm-quote`, { cookie: alice.cookie, body: { quoteId: c.quote.id } }), p(id)))).body;
    const ap = await j(await approveExec(req(`/api/executions/${id}/approve`, { cookie: alice.cookie, body: { quoteId: f.quote.id, approval: { planHash: r.plan.hash, planRevision: c.execution.plan.revision, approvedAt: new Date().toISOString(), allowDuplicate: true } } }), p(id)));
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    const mine = (await j(await execGuard(req(`/api/executions/${id}/guard`, { method: "GET", cookie: alice.cookie }), p(id)))).body;
    expect(mine.reservation).toMatchObject({ status: "RESERVED", amountUsd: "50.0" });
    expect(mine.decisions.map((d: { stage: string }) => d.stage)).toContain("APPROVAL");
    expect((await execGuard(req(`/api/executions/${id}/guard`, { method: "GET", cookie: bob.cookie }), p(id))).status).toBe(404);
    expect((await guard(alice)).spending.dayUsd).toBe("50");
  });
  it("a daily limit set through the API blocks the next transfer at its first quote, with a plain reason", async () => {
    await patch(alice, { dailyLimitUsd: "60", weeklyLimitUsd: null, monthlyLimitUsd: null });
    const r = await plan(alice, "Bridge 15 USDC from Base to Arbitrum");
    const f = await create(alice, r.plan.hash);
    expect(f.status).toBe(403);
    expect(f.body.error).toMatchObject({ code: "GUARD_BLOCKED", details: { outcome: "BLOCKED", stage: "QUOTE" } });
    expect(f.body.error.message).toMatch(/last 24 hours to \$100/);
    expect(f.body.error.message).not.toMatch(/sql|stack|select|undefined/i);
  });
});
