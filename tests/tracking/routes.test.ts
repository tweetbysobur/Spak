/** Tracking and internal monitor routes: real handlers, real sessions, real SQL. Provider and chain MOCKED. */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Fake1Click, TEST_QUOTE_PUBLIC_KEY } from "../execution/fake-1click";
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
const { POST: createExec } = await import("@/app/api/executions/route");
const { GET: tracking } = await import("@/app/api/executions/[id]/tracking/route");
const { GET: events } = await import("@/app/api/executions/[id]/events/route");
const { GET: destination } = await import("@/app/api/executions/[id]/destination/route");
const { POST: refresh } = await import("@/app/api/executions/[id]/refresh/route");
const { GET: monitorGet, POST: monitorPost } = await import("@/app/api/internal/monitor/route");
const { evmWallet } = await import("../auth/keys");

const ORIGIN = "http://localhost:3000";
let ipn = 0;
function req(path: string, o: { method?: string; body?: unknown; cookie?: string; origin?: string; headers?: Record<string, string> } = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ipn % 250}`, origin: o.origin ?? ORIGIN, ...(o.headers ?? {}) };
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
  return { cookie: v.headers.get("set-cookie")!.split(";")[0] };
}
let alice: { cookie: string }, bob: { cookie: string }, id: string;
beforeAll(async () => {
  alice = await user(); bob = await user();
  const plan = (await j(await interpret(req("/api/spak-in/interpret", { cookie: alice.cookie, body: { text: "Bridge 10 USDC from Base to Arbitrum" } })))).body;
  id = (await j(await createExec(req("/api/executions", { cookie: alice.cookie, body: { planHash: plan.plan.hash, idempotencyKey: "track-route-1" } })))).body.execution.id;
});

describe("tracking API", () => {
  it("owner sees steps; anonymous gets 401; another user gets 404; tampered ids get 400", async () => {
    const t = await j(await tracking(req(`/api/executions/${id}/tracking`, { method: "GET", cookie: alice.cookie }), p(id)));
    expect(t.status).toBe(200);
    expect(t.body.steps.map((s: { id: string }) => s.id)).toEqual(["APPROVED", "DEPOSIT_SUBMITTED", "DEPOSIT_CONFIRMED", "PROCESSING", "DESTINATION_DETECTED", "DESTINATION_VERIFICATION", "COMPLETED"]);
    expect(t.body.destination.verifiedAmountOut).toBeNull();
    for (const [fn, path] of [[tracking, "tracking"], [events, "events"], [destination, "destination"]] as const) {
      expect((await fn(req(`/api/executions/${id}/${path}`, { method: "GET" }), p(id))).status).toBe(401);
      expect((await fn(req(`/api/executions/${id}/${path}`, { method: "GET", cookie: bob.cookie }), p(id))).status).toBe(404);
    }
    expect((await tracking(req("/api/executions/exe_..%2F..%2Fx/tracking", { method: "GET", cookie: alice.cookie }), p("exe_../../x"))).status).toBe(400);
    expect((await refresh(req(`/api/executions/${id}/refresh`, { cookie: bob.cookie, body: {} }), p(id))).status).toBe(404);
    expect((await refresh(req(`/api/executions/${id}/refresh`, { cookie: alice.cookie, origin: "https://evil.example", body: {} }), p(id))).status).toBe(403);
    expect((await refresh(req(`/api/executions/${id}/refresh`, { cookie: alice.cookie, body: { state: "COMPLETED" } }), p(id))).status).toBe(400);
    expect((await refresh(req(`/api/executions/${id}/refresh`, { cookie: alice.cookie, body: {} }), p(id))).status).toBe(200);
  });
});

describe("internal monitor endpoint", () => {
  it("fails closed without a secret, rejects wrong or missing tokens and session cookies, runs with the right one", async () => {
    delete process.env.CRON_SECRET; delete process.env.SPAK_MONITOR_SECRET;
    expect((await monitorGet(req("/api/internal/monitor", { method: "GET" }))).status).toBe(503);
    process.env.CRON_SECRET = "c".repeat(32);
    expect((await monitorGet(req("/api/internal/monitor", { method: "GET" }))).status).toBe(401);
    expect((await monitorGet(req("/api/internal/monitor", { method: "GET", cookie: alice.cookie }))).status).toBe(401);
    expect((await monitorPost(req("/api/internal/monitor", { headers: { authorization: `Bearer ${"c".repeat(31)}x` } }))).status).toBe(401);
    const ok = await j(await monitorGet(req("/api/internal/monitor", { method: "GET", headers: { authorization: `Bearer ${"c".repeat(32)}` } })));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ runId: expect.stringMatching(/^run_/), claimed: expect.any(Number) });
    expect(JSON.stringify(ok.body)).not.toContain("c".repeat(32));
    process.env.SPAK_MONITOR_SECRET = "s".repeat(32);
    expect((await monitorPost(req("/api/internal/monitor", { headers: { authorization: `Bearer ${"s".repeat(32)}` } }))).status).toBe(200);
  });
});
