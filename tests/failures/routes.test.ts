/** Failure, refund and admin review routes: real handlers, sessions and SQL. Provider MOCKED. */
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
const { GET: failure } = await import("@/app/api/executions/[id]/failure/route");
const { GET: refund } = await import("@/app/api/executions/[id]/refund/route");
const { POST: refundSubmit } = await import("@/app/api/executions/[id]/refund/transactions/route");
const { POST: refundVerify } = await import("@/app/api/executions/[id]/refund/verify/route");
const { GET: review } = await import("@/app/api/executions/[id]/review/route");
const { GET: adminList } = await import("@/app/api/admin/reviews/route");
const { POST: adminResolve } = await import("@/app/api/admin/reviews/[id]/resolve/route");
const { evmWallet } = await import("../auth/keys");

const ORIGIN = "http://localhost:3000";
let ipn = 0;
function req(path: string, o: { method?: string; body?: unknown; cookie?: string; origin?: string; headers?: Record<string, string> } = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.11.0.${++ipn % 250}`, origin: o.origin ?? ORIGIN, ...(o.headers ?? {}) };
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
  id = (await j(await createExec(req("/api/executions", { cookie: alice.cookie, body: { planHash: plan.plan.hash, idempotencyKey: "fail-route-1" } })))).body.execution.id;
});

describe("user failure and refund API", () => {
  it("owner reads failure and refund info; others get 404; anonymous 401; bad bodies 400; wrong origin 403", async () => {
    const f = await j(await failure(req(`/api/executions/${id}/failure`, { method: "GET", cookie: alice.cookie }), p(id)));
    expect(f.status).toBe(200);
    expect(f.body.classification).toMatchObject({ category: expect.any(String), actions: expect.any(Array) });
    const r = await j(await refund(req(`/api/executions/${id}/refund`, { method: "GET", cookie: alice.cookie }), p(id)));
    expect(r.body).toMatchObject({ eligibility: { status: "NOT_APPLICABLE" }, instructions: { initiation: "AUTOMATIC", refundType: "ORIGIN_CHAIN" }, refund: null });
    for (const [fn, path] of [[failure, "failure"], [refund, "refund"], [review, "review"]] as const) {
      expect((await fn(req(`/api/executions/${id}/${path}`, { method: "GET" }), p(id))).status).toBe(401);
      expect((await fn(req(`/api/executions/${id}/${path}`, { method: "GET", cookie: bob.cookie }), p(id))).status).toBe(404);
    }
    expect((await refundSubmit(req(`/api/executions/${id}/refund/transactions`, { cookie: bob.cookie, body: { txHash: `0x${"a".repeat(64)}` } }), p(id))).status).toBe(404);
    expect((await refundSubmit(req(`/api/executions/${id}/refund/transactions`, { cookie: alice.cookie, body: { txHash: `0x${"a".repeat(64)}`, state: "REFUNDED" } }), p(id))).status).toBe(400);
    expect((await refundSubmit(req(`/api/executions/${id}/refund/transactions`, { cookie: alice.cookie, origin: "https://evil.example", body: { txHash: `0x${"a".repeat(64)}` } }), p(id))).status).toBe(403);
    // Not waiting for a refund: refused, nothing recorded.
    expect((await refundSubmit(req(`/api/executions/${id}/refund/transactions`, { cookie: alice.cookie, body: { txHash: `0x${"a".repeat(64)}` } }), p(id))).status).toBe(409);
    expect((await refundVerify(req(`/api/executions/${id}/refund/verify`, { cookie: alice.cookie, body: {} }), p(id))).status).toBe(200);
  });
});

describe("admin review API", () => {
  const sha = async (t: string) => (await import("node:crypto")).createHash("sha256").update(t).digest("hex");
  const ALICE = "alice-token-" + "a".repeat(40), BOB = "bob-token-" + "b".repeat(40);
  const auth = (t: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${t}`, ...extra });
  it("fails closed; per-reviewer credentials resolve identity on the server; client-sent names are ignored", async () => {
    delete process.env.SPAK_ADMIN_TOKEN; delete process.env.SPAK_REVIEWERS;
    expect((await adminList(req("/api/admin/reviews", { method: "GET" }))).status).toBe(503);
    process.env.SPAK_REVIEWERS = `alice:${await sha(ALICE)},bob:${await sha(BOB)}`;
    expect((await adminList(req("/api/admin/reviews", { method: "GET" }))).status).toBe(401); // missing
    expect((await adminList(req("/api/admin/reviews", { method: "GET", cookie: alice.cookie }))).status).toBe(401); // user session
    expect((await adminList(req("/api/admin/reviews", { method: "GET", headers: auth("x".repeat(48)) }))).status).toBe(401); // unknown
    expect((await adminList(req("/api/admin/reviews", { method: "GET", headers: auth(await sha(ALICE)) }))).status).toBe(401); // the hash is not the credential
    const ok = await j(await adminList(req("/api/admin/reviews?status=OPEN", { method: "GET", headers: auth(ALICE, { "x-spak-reviewer": "bob" }) })));
    expect(ok.status).toBe(200);
    expect(ok.body.reviews).toEqual([]);
    const rid = `rev_${"0".repeat(24)}`;
    const bad = await adminResolve(req(`/api/admin/reviews/${rid}/resolve`, { headers: auth(BOB), body: { resolution: "MARK_COMPLETED", note: "x", evidence: {} } }), p(rid));
    expect(bad.status).toBe(400); // no such resolution: reviewers cannot set outcomes
    const spoof = await adminResolve(req(`/api/admin/reviews/${rid}/resolve`, { headers: auth(BOB), body: { resolution: "NO_ACTION_NEEDED", note: "x", evidence: { a: 1 }, reviewer: "alice" } }), p(rid));
    expect(spoof.status).toBe(400); // identity fields in bodies are refused by the strict schema
  });
});
