/**
 * Recurring payments API through the real route handlers: real cookies, real wallet signatures, real SQL.
 * MOCKED: the 1Click provider (Fake1Click) and the chain RPC (FakeChain behind http://chain.test).
 */
import { describe, expect, it, vi } from "vitest";
import { Fake1Click, TEST_QUOTE_PUBLIC_KEY } from "../execution/fake-1click";
import { honestUsd } from "../pricing/fake-prices";
import { FakeChain } from "../deposits/fake-chain";

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

const { GET: listSchedules, POST: createSchedule } = await import("@/app/api/payments/schedules/route");
const { POST: pause } = await import("@/app/api/payments/schedules/[id]/pause/route");
const { POST: cancel } = await import("@/app/api/payments/schedules/[id]/cancel/route");
const { POST: retry } = await import("@/app/api/payments/occurrences/[id]/retry/route");

const today = new Date().toISOString().slice(0, 10);
const body = (o: Record<string, unknown> = {}) => ({ name: "Rent", sourceNetwork: "base", sourceAssetId: `base:${USDC}`, destinationNetwork: "arbitrum", destinationAssetId: "arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  amount: "50", recipient: "0x1111111111111111111111111111111111111111", frequency: "MONTHLY", startDate: today, timezone: "UTC", ...o });

describe("recurring payments API", () => {
  it("needs a session and a same-origin request", async () => {
    expect((await listSchedules(req("/api/payments/schedules", { method: "GET" }))).status).toBe(401);
    expect((await createSchedule(req("/api/payments/schedules", { body: body() }))).status).toBe(401);
    const a = await user();
    expect((await createSchedule(req("/api/payments/schedules", { cookie: a.cookie, body: body(), origin: "https://evil.example" }))).status).toBe(403);
  });
  it("validates on the server (400 with a code), creates (201), lists only the owner's, and refuses other users' ids", async () => {
    const a = await user(), b = await user();
    const bad = await j(await createSchedule(req("/api/payments/schedules", { cookie: a.cookie, body: body({ frequency: "HOURLY" }) })));
    expect(bad).toMatchObject({ status: 400, body: { error: { code: "SCHEDULE_BAD_REQUEST" } } });
    const made = await j(await createSchedule(req("/api/payments/schedules", { cookie: a.cookie, body: body() })));
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ status: "ACTIVE", recurrence: { frequency: "MONTHLY" } });
    const listA = await j(await listSchedules(req("/api/payments/schedules", { method: "GET", cookie: a.cookie })));
    expect(listA.body.schedules.map((s: { id: string }) => s.id)).toContain(made.body.id);
    const listB = await j(await listSchedules(req("/api/payments/schedules", { method: "GET", cookie: b.cookie })));
    expect(listB.body.schedules).toEqual([]);
    expect((await pause(req(`/api/payments/schedules/${made.body.id}/pause`, { cookie: b.cookie }), p(made.body.id))).status).toBe(404);
    expect((await cancel(req(`/api/payments/schedules/${made.body.id}/cancel`, { cookie: b.cookie }), p(made.body.id))).status).toBe(404);
    expect((await pause(req("/api/payments/schedules/not-an-id/pause", { cookie: a.cookie }), p("not-an-id"))).status).toBe(400);
    expect((await retry(req(`/api/payments/occurrences/occ_${"0".repeat(24)}/retry`, { cookie: a.cookie }), p(`occ_${"0".repeat(24)}`))).status).toBe(404);
  });
  it("opening the list prepares the owner's payment that is due today, with a fresh quote and nothing signed", async () => {
    const a = await user();
    const made = await j(await createSchedule(req("/api/payments/schedules", { cookie: a.cookie, body: body({ name: "Today" }) })));
    const list = await j(await listSchedules(req("/api/payments/schedules", { method: "GET", cookie: a.cookie })));
    const s = list.body.schedules.find((x: { id: string }) => x.id === made.body.id);
    expect(s.occurrences).toHaveLength(1);
    expect(s.occurrences[0]).toMatchObject({ dueDate: today, status: "PREPARED", executionState: "AWAITING_APPROVAL", action: "SIGN" });
  });
});
