/** Agent wallet association through the real route handlers. MOCKED: NEAR RPC (implicit owner account needs none). */
import { beforeAll, describe, expect, it } from "vitest";
import { base64, hex } from "@scure/base";

const { POST: challenge } = await import("@/app/api/auth/challenge/route");
const { POST: verifyAuth } = await import("@/app/api/auth/verify/route");
const { POST: createAgent } = await import("@/app/api/agents/route");
const { POST: agentChallenge } = await import("@/app/api/agents/[id]/challenge/route");
const { POST: agentVerify } = await import("@/app/api/agents/[id]/verify/route");
const { GET: list } = await import("@/app/api/agents/[id]/wallets/route");
const { POST: wChallenge } = await import("@/app/api/agents/[id]/wallets/challenge/route");
const { POST: wVerify } = await import("@/app/api/agents/[id]/wallets/verify/route");
const { GET: wGet, DELETE: wDelete } = await import("@/app/api/agents/[id]/wallets/[associationId]/route");
const { GET: wEvents } = await import("@/app/api/agents/[id]/wallets/[associationId]/events/route");
const { evmWallet, nearWallet } = await import("../auth/keys");
const { AuthService } = await import("@/auth/service");
const { getDb } = await import("@/database");

const ORIGIN = "http://localhost:3000";
let ipn = 0;
function req(path: string, o: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.12.0.${++ipn % 250}`, origin: o.origin ?? ORIGIN };
  if (o.cookie) h.cookie = o.cookie;
  return new Request(`${ORIGIN}${path}`, { method: o.method ?? "POST", headers: h, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
}
const p = (id: string, associationId?: string) => ({ params: Promise.resolve({ id, associationId: associationId ?? "" }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });

/** Signed-in user with a verified Agent (implicit NEAR owner, no RPC needed). */
async function user() {
  const e = evmWallet();
  const c = (await j(await challenge(req("/api/auth/challenge", { body: { family: "evm", address: e.address } })))).body;
  const v = await verifyAuth(req("/api/auth/verify", { body: { challengeId: c.challengeId, signature: (await e.sign(c.message)).signature } }));
  const cookie = v.headers.get("set-cookie")!.split(";")[0];
  const a = (await j(await createAgent(req("/api/agents", { cookie, body: { displayName: "Agent" } })))).body.agent;
  const o = nearWallet();
  const ch = (await j(await agentChallenge(req(`/api/agents/${a.id}/challenge`, { cookie, body: { accountId: o.address } }), p(a.id)))).body;
  const s = await o.sign(ch.message, hex.encode(base64.decode(ch.nonce)), ch.recipient);
  expect((await agentVerify(req(`/api/agents/${a.id}/verify`, { cookie, body: { challengeId: ch.challengeId, method: ch.method, accountId: o.address, publicKey: s.publicKey, signature: s.signature } }), p(a.id))).status).toBe(200);
  const db = await getDb();
  const ws = await new AuthService(db).listWallets((await new AuthService(db).validateSession(decodeURIComponent(cookie.split("=")[1])))!.userId);
  return { cookie, agentId: a.id, evm: e, evmWalletId: ws[0].id };
}

let alice: Awaited<ReturnType<typeof user>>, bob: Awaited<ReturnType<typeof user>>;
beforeAll(async () => { alice = await user(); bob = await user(); });

describe("Agent wallet association API", () => {
  it("requires a session and same-origin writes", async () => {
    expect((await list(req(`/api/agents/${alice.agentId}/wallets`, { method: "GET" }), p(alice.agentId))).status).toBe(401);
    expect((await wChallenge(req(`/api/agents/${alice.agentId}/wallets/challenge`, { cookie: alice.cookie, origin: "https://evil.example", body: { walletId: alice.evmWalletId, chainId: 8453 } }), p(alice.agentId))).status).toBe(403);
  });
  it("full EVM flow; strict bodies; cross-user 404; removal; history; no signing authority", async () => {
    // Unknown fields such as a client-set status are refused.
    expect((await wChallenge(req(`/api/agents/${alice.agentId}/wallets/challenge`, { cookie: alice.cookie, body: { walletId: alice.evmWalletId, chainId: 8453, status: "ACTIVE" } }), p(alice.agentId))).status).toBe(400);
    expect((await wChallenge(req(`/api/agents/${alice.agentId}/wallets/challenge`, { cookie: alice.cookie, body: { walletId: alice.evmWalletId, chainId: 8453, address: "0x1111111111111111111111111111111111111111" } }), p(alice.agentId))).status).toBe(400);
    const c = await j(await wChallenge(req(`/api/agents/${alice.agentId}/wallets/challenge`, { cookie: alice.cookie, body: { walletId: alice.evmWalletId, chainId: 8453 } }), p(alice.agentId)));
    expect(c.status).toBe(200);
    expect(c.body.message).toContain("localhost:3000");
    expect(c.body).not.toHaveProperty("userId");
    const sig = (await alice.evm.sign(c.body.message)).signature;
    expect((await wVerify(req(`/api/agents/${bob.agentId}/wallets/verify`, { cookie: bob.cookie, body: { challengeId: c.body.challengeId, signature: sig } }), p(bob.agentId))).status).toBe(400);
    expect((await wVerify(req(`/api/agents/${alice.agentId}/wallets/verify`, { cookie: alice.cookie, body: { challengeId: c.body.challengeId, signature: sig, status: "ACTIVE" } }), p(alice.agentId))).status).toBe(400);
    const v = await j(await wVerify(req(`/api/agents/${alice.agentId}/wallets/verify`, { cookie: alice.cookie, body: { challengeId: c.body.challengeId, signature: sig } }), p(alice.agentId)));
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body.association).toMatchObject({ status: "ACTIVE", family: "evm", network: "base", signingAuthority: "NONE" });
    expect(JSON.stringify(v.body)).not.toMatch(/userId|nonce|"signature"/);
    const id = v.body.association.id;
    expect((await wGet(req(`/api/agents/${alice.agentId}/wallets/${id}`, { method: "GET", cookie: bob.cookie }), p(alice.agentId, id))).status).toBe(404);
    expect((await wDelete(req(`/api/agents/${alice.agentId}/wallets/${id}`, { method: "DELETE", cookie: bob.cookie, body: {} }), p(alice.agentId, id))).status).toBe(404);
    const del = await j(await wDelete(req(`/api/agents/${alice.agentId}/wallets/${id}`, { method: "DELETE", cookie: alice.cookie, body: { reason: "COMPROMISED" } }), p(alice.agentId, id)));
    expect(del.body.association).toMatchObject({ status: "REVOKED", revokeReason: "COMPROMISED" });
    const ev = (await j(await wEvents(req(`/api/agents/${alice.agentId}/wallets/${id}/events`, { method: "GET", cookie: alice.cookie }), p(alice.agentId, id)))).body.items.map((e: { event: string }) => e.event);
    expect(ev).toContain("WALLET_ASSOCIATED");
    expect(ev).toContain("WALLET_REPORTED_COMPROMISED");
    expect((await j(await list(req(`/api/agents/${alice.agentId}/wallets`, { method: "GET", cookie: alice.cookie }), p(alice.agentId)))).body.items).toHaveLength(1);
  });
  it("malformed ids get 400", async () => {
    expect((await wGet(req(`/api/agents/${alice.agentId}/wallets/x`, { method: "GET", cookie: alice.cookie }), p(alice.agentId, "x"))).status).toBe(400);
  });
});
