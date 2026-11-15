/**
 * Deposit API through the real route handlers: real cookies, real wallet signatures, real SQL.
 * MOCKED: the 1Click provider (Fake1Click) and the chain RPC (FakeChain behind http://chain.test).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Fake1Click, TEST_QUOTE_PUBLIC_KEY } from "../execution/fake-1click";
import { honestUsd } from "../pricing/fake-prices";
import { FakeChain } from "./fake-chain";

process.env.SPAK_RPC_BASE = "http://chain.test/base";
const fake = new Fake1Click();
fake.usdIn = (b) => honestUsd(b.originAsset, b.amount); // an honest provider (S-6 cross-check)
process.env.SPAK_ONECLICK_QUOTE_PUBLIC_KEY = TEST_QUOTE_PUBLIC_KEY; // the fake signs with a test key (S-3)
const chain = new FakeChain();
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith("https://1click.chaindefuser.com")) return fake.fetch(u.replace("https://1click.chaindefuser.com", "http://x"), init);
  if (u.startsWith("http://chain.test/")) {
    const { method, params } = JSON.parse(String(init!.body));
    try { return Response.json({ jsonrpc: "2.0", id: "spak", result: await chain.call(u.split("/").pop()!, method, params) }); }
    catch (e) { return Response.json({ jsonrpc: "2.0", id: "spak", error: { code: -32000, message: (e as Error).message } }); }
  }
  return realFetch(url, init);
});

const { POST: challenge } = await import("@/app/api/auth/challenge/route");
const { POST: verify } = await import("@/app/api/auth/verify/route");
const { POST: interpret } = await import("@/app/api/spak-in/interpret/route");
const { POST: createExec } = await import("@/app/api/executions/route");
const { POST: firmQuote } = await import("@/app/api/executions/[id]/firm-quote/route");
const { POST: approveExec } = await import("@/app/api/executions/[id]/approve/route");
const { POST: prepareDep, GET: listExecDeps } = await import("@/app/api/executions/[id]/deposits/route");
const { GET: listDeps } = await import("@/app/api/deposits/route");
const { GET: getDep } = await import("@/app/api/deposits/[id]/route");
const { POST: submitDep } = await import("@/app/api/deposits/[id]/submit/route");
const { POST: verifyDep } = await import("@/app/api/deposits/[id]/verify/route");
const { POST: rejectDep } = await import("@/app/api/deposits/[id]/reject/route");
const { GET: receipt } = await import("@/app/api/executions/[id]/receipt/route");
const { evmWallet } = await import("../auth/keys");

const ORIGIN = "http://localhost:3000";
let ipn = 0;
function req(path: string, o: { method?: string; body?: unknown; cookie?: string; origin?: string; headers?: Record<string, string> } = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.8.0.${++ipn % 250}`, origin: o.origin ?? ORIGIN, ...(o.headers ?? {}) };
  if (o.cookie) h.cookie = o.cookie;
  return new Request(`${ORIGIN}${path}`, { method: o.method ?? "POST", headers: h, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

async function user() {
  const e = evmWallet();
  const c = (await j(await challenge(req("/api/auth/challenge", { body: { family: "evm", address: e.address } })))).body;
  const v = await verify(req("/api/auth/verify", { body: { challengeId: c.challengeId, signature: (await e.sign(c.message)).signature } }));
  return { cookie: v.headers.get("set-cookie")!.split(";")[0], evm: e };
}
async function approvedExec(a: Awaited<ReturnType<typeof user>>, text: string, key: string) {
  const plan = (await j(await interpret(req("/api/spak-in/interpret", { cookie: a.cookie, body: { text } })))).body;
  expect(plan.status, JSON.stringify(plan)).toBe("VALIDATED");
  const c = (await j(await createExec(req("/api/executions", { cookie: a.cookie, body: { planHash: plan.plan.hash, idempotencyKey: key } })))).body;
  const id = c.execution.id;
  const f = (await j(await firmQuote(req(`/api/executions/${id}/firm-quote`, { cookie: a.cookie, body: { quoteId: c.quote.id } }), p(id)))).body;
  const ap = await j(await approveExec(req(`/api/executions/${id}/approve`, { cookie: a.cookie, body: { quoteId: f.quote.id, approval: { planHash: plan.plan.hash, planRevision: c.execution.plan.revision, approvedAt: new Date().toISOString(), allowDuplicate: true } } }), p(id)));
  expect(ap.status, JSON.stringify(ap.body)).toBe(200);
  return ap.body.execution;
}

let alice: Awaited<ReturnType<typeof user>>, bob: Awaited<ReturnType<typeof user>>;
beforeAll(async () => { alice = await user(); bob = await user(); });

describe("deposit API", () => {
  it("requires a session and a same-origin request", async () => {
    const id = "dep_" + "0".repeat(24);
    expect((await getDep(req(`/api/deposits/${id}`, { method: "GET" }), p(id))).status).toBe(401);
    expect((await submitDep(req(`/api/deposits/${id}/submit`, { body: { txHash: "0x" } }), p(id))).status).toBe(401);
    expect((await listDeps(req("/api/deposits", { method: "GET" }))).status).toBe(401);
    expect((await submitDep(req(`/api/deposits/${id}/submit`, { cookie: alice.cookie, origin: "https://evil.example", body: { txHash: "0x" } }), p(id))).status).toBe(403);
  });

  it("prepare → submit → verify; owner only; history lists it", async () => {
    const ex = await approvedExec(alice, "Bridge 10 USDC from Base to Arbitrum", "dep-route-01");
    chain.setBalance("base", alice.evm.address, 10_000_000n, USDC);
    const pr = await j(await prepareDep(req(`/api/executions/${ex.id}/deposits`, { cookie: alice.cookie, body: {} }), p(ex.id)));
    expect(pr.status, JSON.stringify(pr.body)).toBe(200);
    expect(pr.body.transaction).toMatchObject({ family: "evm", approvals: [] });
    const depId = pr.body.deposit.id;
    expect((await getDep(req(`/api/deposits/${depId}`, { method: "GET", cookie: bob.cookie }), p(depId))).status).toBe(404);
    expect((await submitDep(req(`/api/deposits/${depId}/submit`, { cookie: bob.cookie, body: { txHash: `0x${"a".repeat(64)}` } }), p(depId))).status).toBe(404);
    expect((await submitDep(req(`/api/deposits/${depId}/submit`, { cookie: alice.cookie, body: { txHash: "not-a-hash" } }), p(depId))).status).toBe(400);

    const hash = `0x${"b".repeat(64)}`;
    chain.evmTx(hash, { from: alice.evm.address, to: USDC, logs: [{ address: USDC, from: alice.evm.address, to: ex.deposit.address, amount: 10_000_000n }] });
    const s = await j(await submitDep(req(`/api/deposits/${depId}/submit`, { cookie: alice.cookie, body: { txHash: hash } }), p(depId)));
    expect(s.status).toBe(200);
    expect(s.body.state).toBe("CONFIRMED");
    expect((await j(await verifyDep(req(`/api/deposits/${depId}/verify`, { cookie: alice.cookie, body: {} }), p(depId)))).body.state).toBe("CONFIRMED");
    expect((await j(await listDeps(req("/api/deposits", { method: "GET", cookie: alice.cookie })))).body.items[0].id).toBe(depId);
    expect((await j(await listExecDeps(req(`/api/executions/${ex.id}/deposits`, { method: "GET", cookie: alice.cookie }), p(ex.id)))).body.deposits).toHaveLength(1);
    expect((await j(await listDeps(req("/api/deposits", { method: "GET", cookie: bob.cookie })))).body.items).toHaveLength(0);
  });

  it("insufficient balance is a 4xx with a clear code; wallet rejection is recorded", async () => {
    const ex = await approvedExec(alice, "Bridge 12 USDC from Base to Arbitrum", "dep-route-02");
    chain.setBalance("base", alice.evm.address, 0n, USDC);
    const pr = await j(await prepareDep(req(`/api/executions/${ex.id}/deposits`, { cookie: alice.cookie, body: {} }), p(ex.id)));
    expect(pr.body.error.code).toBe("INSUFFICIENT_BALANCE");
    chain.setBalance("base", alice.evm.address, 12_000_000n, USDC);
    const ok = (await j(await prepareDep(req(`/api/executions/${ex.id}/deposits`, { cookie: alice.cookie, body: {} }), p(ex.id)))).body;
    const r = await j(await rejectDep(req(`/api/deposits/${ok.deposit.id}/reject`, { cookie: alice.cookie, body: { reason: "User rejected the request" } }), p(ok.deposit.id)));
    expect(r.body.state).toBe("REJECTED");
  });
});

describe("receipt API", () => {
  it("needs a session, is owner-only, and is not issued before SPak verifies delivery on the destination chain", async () => {
    const ex = await approvedExec(alice, "Pay 6 USDC from Base to 0x1111111111111111111111111111111111111111 on Arbitrum", `rcpt-${Math.random()}`);
    const path = `/api/executions/${ex.id}/receipt`;
    expect((await receipt(req(path, { method: "GET" }), p(ex.id))).status).toBe(401);
    expect((await receipt(req(path, { method: "GET", cookie: bob.cookie }), p(ex.id))).status).toBe(404);
    const r = await j(await receipt(req(path, { method: "GET", cookie: alice.cookie }), p(ex.id)));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("RECEIPT_NOT_AVAILABLE");
  });
});
