/**
 * Agent API through the real route handlers: real cookies, real signatures, real SQL.
 * MOCKED: NEAR RPC view_access_key (fetch to the RPC host answers from a map).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { base64, hex } from "@scure/base";

const fullAccess = new Set<string>();
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.includes("rpc.mainnet.near.org") || u.includes("fastnear")) {
    const { params } = JSON.parse(String(init!.body));
    return Response.json(fullAccess.has(`${params.account_id}|${params.public_key}`)
      ? { jsonrpc: "2.0", id: "spak", result: { permission: "FullAccess", nonce: 1 } }
      : { jsonrpc: "2.0", id: "spak", error: { cause: { name: "UNKNOWN_ACCESS_KEY" } } });
  }
  return realFetch(url, init);
});

const { POST: challenge } = await import("@/app/api/auth/challenge/route");
const { POST: verifyAuth } = await import("@/app/api/auth/verify/route");
const { GET: listAgents, POST: createAgent } = await import("@/app/api/agents/route");
const { GET: getAgent } = await import("@/app/api/agents/[id]/route");
const { POST: agentChallenge } = await import("@/app/api/agents/[id]/challenge/route");
const { POST: agentVerify } = await import("@/app/api/agents/[id]/verify/route");
const { POST: suspend } = await import("@/app/api/agents/[id]/suspend/route");
const { POST: revoke } = await import("@/app/api/agents/[id]/revoke/route");
const { GET: events } = await import("@/app/api/agents/[id]/events/route");
const { evmWallet, nearWallet } = await import("../auth/keys");

const ORIGIN = "http://localhost:3000";
let ipn = 0;
function req(path: string, o: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.11.0.${++ipn % 250}`, origin: o.origin ?? ORIGIN };
  if (o.cookie) h.cookie = o.cookie;
  return new Request(`${ORIGIN}${path}`, { method: o.method ?? "POST", headers: h, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });
async function user() {
  const e = evmWallet();
  const c = (await j(await challenge(req("/api/auth/challenge", { body: { family: "evm", address: e.address } })))).body;
  const v = await verifyAuth(req("/api/auth/verify", { body: { challengeId: c.challengeId, signature: (await e.sign(c.message)).signature } }));
  return v.headers.get("set-cookie")!.split(";")[0];
}

let alice: string, bob: string;
beforeAll(async () => { alice = await user(); bob = await user(); });

describe("Agent API", () => {
  it("requires a session and same-origin writes", async () => {
    expect((await listAgents(req("/api/agents", { method: "GET" }))).status).toBe(401);
    expect((await createAgent(req("/api/agents", { body: { displayName: "x" } }))).status).toBe(401);
    expect((await createAgent(req("/api/agents", { cookie: alice, origin: "https://evil.example", body: { displayName: "Agent" } }))).status).toBe(403);
  });
  it("create refuses client-supplied status or owner fields", async () => {
    const r = await j(await createAgent(req("/api/agents", { cookie: alice, body: { displayName: "Alice agent", status: "VERIFIED", ownerAccountId: "alice.near" } })));
    expect(r.status).toBe(400);
    expect((await j(await listAgents(req("/api/agents", { method: "GET", cookie: alice })))).body.agent).toBeNull();
  });
  it("full flow: create, challenge bound to the server's domain, verify, events; another user sees nothing", async () => {
    const created = await j(await createAgent(req("/api/agents", { cookie: alice, body: { displayName: "Alice agent" } })));
    expect(created.status).toBe(201);
    const id = created.body.agent.id;
    expect(created.body.agent).toMatchObject({ status: "CREATED", permissions: "NONE", dedicatedAccount: { state: "NOT_AVAILABLE" } });
    const w = nearWallet("alice-owner.near");
    fullAccess.add(`alice-owner.near|${w.publicKey}`);
    const ch = await j(await agentChallenge(req(`/api/agents/${id}/challenge`, { cookie: alice, body: { accountId: "alice-owner.near" } }), p(id)));
    expect(ch.status).toBe(200);
    expect(ch.body.recipient).toBe("localhost:3000");
    expect(ch.body).not.toHaveProperty("userId");
    const sig = await w.sign(ch.body.message, hex.encode(base64.decode(ch.body.nonce)), ch.body.recipient);
    const body = { challengeId: ch.body.challengeId, method: "NEAR_NEP413_FULL_ACCESS_KEY", accountId: "alice-owner.near", publicKey: sig.publicKey, signature: sig.signature };
    // Bob cannot use Alice's challenge or see her Agent.
    expect((await agentVerify(req(`/api/agents/${id}/verify`, { cookie: bob, body }), p(id))).status).toBe(404);
    expect((await getAgent(req(`/api/agents/${id}`, { method: "GET", cookie: bob }), p(id))).status).toBe(404);
    expect((await events(req(`/api/agents/${id}/events`, { method: "GET", cookie: bob }), p(id))).status).toBe(404);
    // A client-supplied verification status is refused by the strict schema.
    expect((await agentVerify(req(`/api/agents/${id}/verify`, { cookie: alice, body: { ...body, status: "VERIFIED" } }), p(id))).status).toBe(400);
    const v = await j(await agentVerify(req(`/api/agents/${id}/verify`, { cookie: alice, body }), p(id)));
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body.agent).toMatchObject({ status: "VERIFIED", ownership: { state: "VERIFIED", accountId: "alice-owner.near", attestationLocation: "OFF_CHAIN" } });
    expect(JSON.stringify(v.body)).not.toMatch(/"nonce"|"signature"|"userId"/);
    const replay = await j(await agentVerify(req(`/api/agents/${id}/verify`, { cookie: alice, body }), p(id)));
    expect(replay).toMatchObject({ status: 409, body: { error: { code: "AGENT_CHALLENGE_USED" } } });
    const ev = (await j(await events(req(`/api/agents/${id}/events`, { method: "GET", cookie: alice }), p(id)))).body.items.map((e: { event: string }) => e.event);
    expect(ev).toEqual(["CREATED", "CHALLENGE_ISSUED", "VERIFICATION_STARTED", "VERIFIED"]);
    // Bob cannot suspend or revoke it.
    expect((await suspend(req(`/api/agents/${id}/suspend`, { cookie: bob, body: {} }), p(id))).status).toBe(404);
    expect((await revoke(req(`/api/agents/${id}/revoke`, { cookie: bob, body: { confirm: "REVOKE" } }), p(id))).status).toBe(404);
    expect((await j(await suspend(req(`/api/agents/${id}/suspend`, { cookie: alice, body: {} }), p(id)))).body.agent.status).toBe("SUSPENDED");
    expect((await j(await revoke(req(`/api/agents/${id}/revoke`, { cookie: alice, body: { confirm: "REVOKE" } }), p(id)))).body.agent.status).toBe("REVOKED");
    const after = await j(await agentChallenge(req(`/api/agents/${id}/challenge`, { cookie: alice, body: { accountId: "alice-owner.near" } }), p(id)));
    expect(after).toMatchObject({ status: 409, body: { error: { code: "AGENT_REVOKED" } } });
  });
  it("malformed ids and bodies get 400", async () => {
    expect((await getAgent(req("/api/agents/x", { method: "GET", cookie: alice }), p("x"))).status).toBe(400);
    const id = "agt_" + "0".repeat(24);
    expect((await agentVerify(req(`/api/agents/${id}/verify`, { cookie: alice, body: { challengeId: "nope" } }), p(id))).status).toBe(400);
    expect((await agentChallenge(req(`/api/agents/${id}/challenge`, { cookie: alice, body: { accountId: "Not A Near Account!" } }), p(id))).status).toBe(404);
  });
});
