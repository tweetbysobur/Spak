/** Dedicated account API through the real route handlers. This server has no testnet parent configured. */
import { beforeAll, describe, expect, it } from "vitest";
import { base64, hex } from "@scure/base";

const { POST: challenge } = await import("@/app/api/auth/challenge/route");
const { POST: verifyAuth } = await import("@/app/api/auth/verify/route");
const { POST: createAgent } = await import("@/app/api/agents/route");
const { POST: agentChallenge } = await import("@/app/api/agents/[id]/challenge/route");
const { POST: agentVerify } = await import("@/app/api/agents/[id]/verify/route");
const { GET: getAccount } = await import("@/app/api/agents/[id]/account/route");
const { POST: prepare } = await import("@/app/api/agents/[id]/account/prepare/route");
const { POST: create } = await import("@/app/api/agents/[id]/account/create/route");
const { POST: verify } = await import("@/app/api/agents/[id]/account/verify/route");
const { evmWallet, nearWallet } = await import("../auth/keys");

const ORIGIN = "http://localhost:3000";
let ipn = 0;
function req(path: string, o: { method?: string; body?: unknown; cookie?: string; origin?: string; headers?: Record<string, string> } = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.13.0.${++ipn % 250}`, origin: o.origin ?? ORIGIN, ...(o.headers ?? {}) };
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
  const cookie = v.headers.get("set-cookie")!.split(";")[0];
  const a = (await j(await createAgent(req("/api/agents", { cookie, body: { displayName: "Agent" } })))).body.agent;
  const o = nearWallet();
  const ch = (await j(await agentChallenge(req(`/api/agents/${a.id}/challenge`, { cookie, body: { accountId: o.address } }), p(a.id)))).body;
  const s = await o.sign(ch.message, hex.encode(base64.decode(ch.nonce)), ch.recipient);
  await agentVerify(req(`/api/agents/${a.id}/verify`, { cookie, body: { challengeId: ch.challengeId, method: ch.method, accountId: o.address, publicKey: s.publicKey, signature: s.signature } }), p(a.id));
  return { cookie, agentId: a.id };
}
let alice: Awaited<ReturnType<typeof user>>, bob: Awaited<ReturnType<typeof user>>;
beforeAll(async () => { delete process.env.SPAK_AGENT_NEAR_NETWORK; alice = await user(); bob = await user(); });

describe("dedicated account API", () => {
  it("requires a session and same-origin writes", async () => {
    expect((await getAccount(req(`/api/agents/${alice.agentId}/account`, { method: "GET" }), p(alice.agentId))).status).toBe(401);
    expect((await prepare(req(`/api/agents/${alice.agentId}/account/prepare`, { cookie: alice.cookie, origin: "https://evil.example", body: {} }), p(alice.agentId))).status).toBe(403);
  });
  it("without a configured testnet parent: unavailable, nothing created, no fake account", async () => {
    const v = await j(await getAccount(req(`/api/agents/${alice.agentId}/account`, { method: "GET", cookie: alice.cookie }), p(alice.agentId)));
    expect(v.body).toMatchObject({ availability: "UNAVAILABLE", account: null, network: null });
    expect((await prepare(req(`/api/agents/${alice.agentId}/account/prepare`, { cookie: alice.cookie, body: {} }), p(alice.agentId))).status).toBe(503);
    expect((await verify(req(`/api/agents/${alice.agentId}/account/verify`, { cookie: alice.cookie, body: {} }), p(alice.agentId))).status).toBe(503);
  });
  it("cross-user access is 404; strict bodies refuse a client status; create needs an Idempotency-Key", async () => {
    expect((await getAccount(req(`/api/agents/${alice.agentId}/account`, { method: "GET", cookie: bob.cookie }), p(alice.agentId))).status).toBe(404);
    expect((await prepare(req(`/api/agents/${alice.agentId}/account/prepare`, { cookie: alice.cookie, body: { status: "ACTIVE" } }), p(alice.agentId))).status).toBe(400);
    const body = { challengeId: "aac_" + "0".repeat(24), accountId: "x", publicKey: "ed25519:x", signature: "x" };
    expect((await create(req(`/api/agents/${alice.agentId}/account/create`, { cookie: alice.cookie, body }), p(alice.agentId))).status).toBe(400);
    expect((await create(req(`/api/agents/${alice.agentId}/account/create`, { cookie: alice.cookie, headers: { "idempotency-key": "key-12345678" }, body: { ...body, status: "ACTIVE" } }), p(alice.agentId))).status).toBe(400);
  });
});
