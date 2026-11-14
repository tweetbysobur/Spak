/**
 * Execution API through the real route handlers: real cookies, real wallet signatures, real SQL (PGlite).
 * The NEAR Intents provider is MOCKED (fetch to 1click.chaindefuser.com is answered by Fake1Click).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Fake1Click, TEST_QUOTE_PUBLIC_KEY } from "./fake-1click";
import { honestUsd } from "../pricing/fake-prices";

const fake = new Fake1Click();
fake.usdIn = (b) => honestUsd(b.originAsset, b.amount); // an honest provider (S-6 cross-check)
process.env.SPAK_ONECLICK_QUOTE_PUBLIC_KEY = TEST_QUOTE_PUBLIC_KEY; // the fake signs with a test key (S-3)
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", (url: string | URL, init?: RequestInit) =>
  String(url).startsWith("https://1click.chaindefuser.com") ? fake.fetch(String(url).replace("https://1click.chaindefuser.com", "http://x"), init) : realFetch(url, init));

const { POST: challenge } = await import("@/app/api/auth/challenge/route");
const { POST: verify } = await import("@/app/api/auth/verify/route");
const { POST: interpret } = await import("@/app/api/spak-in/interpret/route");
const { POST: createExec, GET: listExec } = await import("@/app/api/executions/route");
const { GET: getExec } = await import("@/app/api/executions/[id]/route");
const { POST: approveExec } = await import("@/app/api/executions/[id]/approve/route");
const { POST: firmQuote } = await import("@/app/api/executions/[id]/firm-quote/route");
const { GET: statusExec } = await import("@/app/api/executions/[id]/status/route");
const { POST: requoteExec } = await import("@/app/api/executions/[id]/quote/route");
const { POST: cancelExec } = await import("@/app/api/executions/[id]/cancel/route");
const { GET: getQuote } = await import("@/app/api/quotes/[id]/route");
const { evmWallet, solanaWallet } = await import("../auth/keys");

const ORIGIN = "http://localhost:3000";
let ipn = 0;
function req(path: string, o: { method?: string; body?: unknown; cookie?: string; origin?: string | null; headers?: Record<string, string> } = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.7.0.${++ipn % 250}`, ...(o.headers ?? {}) };
  if (o.origin !== null) h.origin = o.origin ?? ORIGIN;
  if (o.cookie) h.cookie = o.cookie;
  return new Request(`${ORIGIN}${path}`, { method: o.method ?? "POST", headers: h, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });

async function user() {
  const e = evmWallet(), s = solanaWallet();
  const c = (await j(await challenge(req("/api/auth/challenge", { body: { family: "evm", address: e.address } })))).body;
  const v = await verify(req("/api/auth/verify", { body: { challengeId: c.challengeId, signature: (await e.sign(c.message)).signature } }));
  const cookie = v.headers.get("set-cookie")!.split(";")[0];
  const l = (await j(await challenge(req("/api/auth/challenge", { body: { family: "solana", address: s.address, purpose: "LINK" }, cookie })))).body;
  await verify(req("/api/auth/verify", { body: { challengeId: l.challengeId, signature: (await s.sign(l.message)).signature }, cookie }));
  return { cookie, sol: s };
}
async function plan(cookie: string, text = "Swap 50 USDC on Base to SOL on Solana") {
  const r = (await j(await interpret(req("/api/spak-in/interpret", { cookie, body: { text } })))).body;
  expect(r.status).toBe("VALIDATED");
  return r.plan.hash as string;
}

let alice: Awaited<ReturnType<typeof user>>;
let bob: Awaited<ReturnType<typeof user>>;
beforeAll(async () => { alice = await user(); bob = await user(); });

describe("execution API", () => {
  it("requires a session on every endpoint", async () => {
    const id = "exe_" + "0".repeat(24);
    for (const r of [
      await createExec(req("/api/executions", { body: { planHash: "a".repeat(64) }, headers: { "idempotency-key": "k-12345678" } })),
      await listExec(req("/api/executions", { method: "GET" })),
      await getExec(req(`/api/executions/${id}`, { method: "GET" }), p(id)),
      await approveExec(req(`/api/executions/${id}/approve`, { body: {} }), p(id)),
      await statusExec(req(`/api/executions/${id}/status`, { method: "GET" }), p(id)),
      await getQuote(req(`/api/quotes/qte_${"0".repeat(24)}`, { method: "GET" }), p(`qte_${"0".repeat(24)}`)),
    ]) expect(r.status).toBe(401);
  });

  it("full flow: create (201) → same key (200, same id) → approve → status → history → quote", async () => {
    const planHash = await plan(alice.cookie);
    const c = await j(await createExec(req("/api/executions", { cookie: alice.cookie, body: { planHash }, headers: { "idempotency-key": "flow-key-0001" } })));
    expect(c.status).toBe(201);
    expect(c.body.execution).toMatchObject({ state: "AWAITING_APPROVAL", recipient: { address: alice.sol.address, kind: "SELF" } });
    expect(c.body.quote).toMatchObject({ kind: "INDICATIVE", status: "VALID", source: { providerAssetId: expect.stringMatching(/^nep141:base-/) } });
    expect(JSON.stringify(c.body)).not.toMatch(/"request"|"response"/); // raw provider payloads stay server-side
    const again = await j(await createExec(req("/api/executions", { cookie: alice.cookie, body: { planHash }, headers: { "idempotency-key": "flow-key-0001" } })));
    expect(again.status).toBe(200);
    expect(again.body.execution.id).toBe(c.body.execution.id);

    const id = c.body.execution.id;
    const f = await j(await firmQuote(req(`/api/executions/${id}/firm-quote`, { cookie: alice.cookie, body: { quoteId: c.body.quote.id } }), p(id)));
    expect(f.body.quote).toMatchObject({ kind: "FIRM", deposit: { address: expect.stringMatching(/^0x/) } });
    const a = await j(await approveExec(req(`/api/executions/${id}/approve`, { cookie: alice.cookie, body: { quoteId: f.body.quote.id, approval: { planHash, planRevision: c.body.execution.plan.revision, approvedAt: new Date().toISOString() } } }), p(id)));
    expect(a.status).toBe(200);
    expect(a.body.execution.deposit).toMatchObject({ network: "base", amount: "50000000", address: expect.stringMatching(/^0x/) });
    const st = await j(await statusExec(req(`/api/executions/${id}/status`, { method: "GET", cookie: alice.cookie }), p(id)));
    expect(st.body.state).toBe("AWAITING_DEPOSIT"); // provider answers 404 for an unfunded deposit address
    const hist = await j(await listExec(req("/api/executions?limit=5", { method: "GET", cookie: alice.cookie })));
    expect(hist.body.items[0].id).toBe(id);
    const q = await j(await getQuote(req(`/api/quotes/${a.body.quote.id}`, { method: "GET", cookie: alice.cookie }), p(a.body.quote.id)));
    expect(q.body).toMatchObject({ kind: "FIRM", providerReference: { provider: "near-intents" } });
    expect(q.body.providerReference.signature).toBeTruthy();
  });

  it("another user gets 404 for my execution and quote, and cannot execute my plan", async () => {
    const planHash = await plan(alice.cookie, "Bridge 10 USDC from Base to Arbitrum");
    const c = (await j(await createExec(req("/api/executions", { cookie: alice.cookie, body: { planHash, idempotencyKey: "xuser-key-01" } })))).body;
    const id = c.execution.id;
    expect((await getExec(req(`/api/executions/${id}`, { method: "GET", cookie: bob.cookie }), p(id))).status).toBe(404);
    expect((await getQuote(req(`/api/quotes/${c.quote.id}`, { method: "GET", cookie: bob.cookie }), p(c.quote.id))).status).toBe(404);
    expect((await requoteExec(req(`/api/executions/${id}/quote`, { cookie: bob.cookie, body: {} }), p(id))).status).toBe(404);
    expect((await cancelExec(req(`/api/executions/${id}/cancel`, { cookie: bob.cookie, body: {} }), p(id))).status).toBe(404);
    const steal = await j(await createExec(req("/api/executions", { cookie: bob.cookie, body: { planHash, idempotencyKey: "steal-key-01" } })));
    expect(steal.status).toBe(404);
    expect(steal.body.error.code).toBe("PLAN_NOT_OWNED");
  });

  it("validates input and enforces CSRF", async () => {
    expect((await createExec(req("/api/executions", { cookie: alice.cookie, body: { planHash: "nope" }, headers: { "idempotency-key": "k-12345678" } }))).status).toBe(400);
    expect((await createExec(req("/api/executions", { cookie: alice.cookie, body: { planHash: "a".repeat(64) } }))).status).toBe(400); // no idempotency key
    expect((await getExec(req("/api/executions/../../etc", { method: "GET", cookie: alice.cookie }), p("../../etc"))).status).toBe(400);
    expect((await createExec(req("/api/executions", { cookie: alice.cookie, origin: "https://evil.example", body: { planHash: "a".repeat(64) }, headers: { "idempotency-key": "k-12345678" } }))).status).toBe(403);
  });

  it("maps provider outages to 503 without leaking provider details", async () => {
    const planHash = await plan(alice.cookie, "Bridge 20 USDC from Base to Arbitrum");
    fake.mode = "http500";
    const r = await j(await createExec(req("/api/executions", { cookie: alice.cookie, body: { planHash, idempotencyKey: "outage-key-1" } })));
    fake.mode = "ok";
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("PROVIDER_UNAVAILABLE");
  });
});
