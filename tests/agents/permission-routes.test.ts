/** Agent permission, Agent approval and funding API through the real route handlers (embedded database, no NEAR network). */
import { beforeAll, describe, expect, it } from "vitest";
import { base64, hex } from "@scure/base";

const { POST: challenge } = await import("@/app/api/auth/challenge/route");
const { POST: verifyAuth } = await import("@/app/api/auth/verify/route");
const { POST: createAgent } = await import("@/app/api/agents/route");
const { POST: agentChallenge } = await import("@/app/api/agents/[id]/challenge/route");
const { POST: agentVerify } = await import("@/app/api/agents/[id]/verify/route");
const { GET: getPermissions } = await import("@/app/api/agents/[id]/permissions/route");
const { POST: prepare } = await import("@/app/api/agents/[id]/permissions/prepare/route");
const { POST: confirm } = await import("@/app/api/agents/[id]/permissions/confirm/route");
const { POST: pause } = await import("@/app/api/agents/[id]/permissions/pause/route");
const { POST: resume } = await import("@/app/api/agents/[id]/permissions/resume/route");
const { POST: revoke } = await import("@/app/api/agents/[id]/permissions/revoke/route");
const { POST: agentApprove } = await import("@/app/api/executions/[id]/agent-approve/route");
const { GET: getFunding, POST: checkFunding } = await import("@/app/api/agents/[id]/account/funding/route");
const { evmWallet, nearWallet } = await import("../auth/keys");

const ORIGIN = "http://localhost:3000";
let ipn = 0;
function req(path: string, o: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.14.0.${++ipn % 250}`, origin: o.origin ?? ORIGIN };
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
  return { cookie, agentId: a.id as string, owner: o };
}
const SCOPE = { maxTransactionUsd: "25", dailyLimitUsd: "50", maxTransactions: 3, durationHours: 24, sourceNetworks: ["base"], destinationNetworks: ["solana"], assets: ["base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"], recipients: { self: true, addresses: [] } };
let alice: Awaited<ReturnType<typeof user>>, bob: Awaited<ReturnType<typeof user>>;
beforeAll(async () => { alice = await user(); bob = await user(); });

describe("permission API", () => {
  it("requires a session and same-origin writes", async () => {
    expect((await getPermissions(req(`/api/agents/${alice.agentId}/permissions`, { method: "GET" }), p(alice.agentId))).status).toBe(401);
    expect((await prepare(req(`/api/agents/${alice.agentId}/permissions/prepare`, { cookie: alice.cookie, origin: "https://evil.example", body: SCOPE }), p(alice.agentId))).status).toBe(403);
    expect((await agentApprove(req(`/api/executions/exe_${"0".repeat(24)}/agent-approve`, { body: { quoteId: `qte_${"0".repeat(24)}` } }), p(`exe_${"0".repeat(24)}`))).status).toBe(401);
  });

  it("starts MANUAL; a signed permission makes it PREAUTHORIZED; pause, resume and revoke work; history is kept", async () => {
    const g0 = await j(await getPermissions(req(`/api/agents/${alice.agentId}/permissions`, { method: "GET", cookie: alice.cookie }), p(alice.agentId)));
    expect(g0.body).toMatchObject({ mode: "MANUAL", grant: null, history: [], approvals: [] });
    const c = await j(await prepare(req(`/api/agents/${alice.agentId}/permissions/prepare`, { cookie: alice.cookie, body: SCOPE }), p(alice.agentId)));
    expect(c.status).toBe(200);
    expect(c.body.message).toContain("Per transfer: up to $25");
    const s = await alice.owner.sign(c.body.message, hex.encode(base64.decode(c.body.nonce)), c.body.recipient);
    const g = await j(await confirm(req(`/api/agents/${alice.agentId}/permissions/confirm`, { cookie: alice.cookie, body: { challengeId: c.body.challengeId, accountId: alice.owner.address, publicKey: s.publicKey, signature: s.signature } }), p(alice.agentId)));
    expect(g.status).toBe(200);
    expect(g.body.grant).toMatchObject({ status: "ACTIVE", version: 1 });
    expect((await j(await pause(req(`/api/agents/${alice.agentId}/permissions/pause`, { cookie: alice.cookie, body: {} }), p(alice.agentId)))).body.grant.status).toBe("PAUSED");
    expect((await j(await getPermissions(req(`/api/agents/${alice.agentId}/permissions`, { method: "GET", cookie: alice.cookie }), p(alice.agentId)))).body.mode).toBe("MANUAL");
    expect((await j(await resume(req(`/api/agents/${alice.agentId}/permissions/resume`, { cookie: alice.cookie, body: {} }), p(alice.agentId)))).body.grant.status).toBe("ACTIVE");
    expect((await j(await revoke(req(`/api/agents/${alice.agentId}/permissions/revoke`, { cookie: alice.cookie, body: {} }), p(alice.agentId)))).body.grant.status).toBe("REVOKED");
    const after = await j(await getPermissions(req(`/api/agents/${alice.agentId}/permissions`, { method: "GET", cookie: alice.cookie }), p(alice.agentId)));
    expect(after.body).toMatchObject({ mode: "MANUAL", grant: null });
    expect(after.body.history).toHaveLength(1);
  });

  it("the browser cannot smuggle status, mode or limits past the signed scope, or touch another user's Agent", async () => {
    expect((await prepare(req(`/api/agents/${bob.agentId}/permissions/prepare`, { cookie: bob.cookie, body: { ...SCOPE, status: "ACTIVE" } }), p(bob.agentId))).status).toBe(400);
    expect((await prepare(req(`/api/agents/${bob.agentId}/permissions/prepare`, { cookie: bob.cookie, body: { ...SCOPE, maxTransactionUsd: "1000000" } }), p(bob.agentId))).status).toBe(400);
    expect((await getPermissions(req(`/api/agents/${alice.agentId}/permissions`, { method: "GET", cookie: bob.cookie }), p(alice.agentId))).status).toBe(404);
    expect((await pause(req(`/api/agents/${alice.agentId}/permissions/pause`, { cookie: bob.cookie, body: {} }), p(alice.agentId))).status).toBe(404);
    const c = await j(await prepare(req(`/api/agents/${bob.agentId}/permissions/prepare`, { cookie: bob.cookie, body: SCOPE }), p(bob.agentId)));
    const s = await bob.owner.sign(c.body.message.replace("$25", "$900"), hex.encode(base64.decode(c.body.nonce)), c.body.recipient);
    const r = await confirm(req(`/api/agents/${bob.agentId}/permissions/confirm`, { cookie: bob.cookie, body: { challengeId: c.body.challengeId, accountId: bob.owner.address, publicKey: s.publicKey, signature: s.signature } }), p(bob.agentId));
    expect(r.status).toBe(401);
    expect((await j(await getPermissions(req(`/api/agents/${bob.agentId}/permissions`, { method: "GET", cookie: bob.cookie }), p(bob.agentId)))).body.mode).toBe("MANUAL");
  });

  it("Agent approval of an unknown execution is not found; a malformed body is refused", async () => {
    const id = `exe_${"1".repeat(24)}`;
    expect((await agentApprove(req(`/api/executions/${id}/agent-approve`, { cookie: alice.cookie, body: { quoteId: `qte_${"0".repeat(24)}` } }), p(id))).status).toBe(404);
    expect((await agentApprove(req(`/api/executions/${id}/agent-approve`, { cookie: alice.cookie, body: { quoteId: "x" } }), p(id))).status).toBe(400);
  });

  it("funding: no observation yet, and no check without an active dedicated account", async () => {
    expect((await j(await getFunding(req(`/api/agents/${alice.agentId}/account/funding`, { method: "GET", cookie: alice.cookie }), p(alice.agentId)))).body).toEqual({ funding: null });
    expect((await checkFunding(req(`/api/agents/${bob.agentId}/account/funding`, { cookie: bob.cookie, body: {} }), p(bob.agentId))).status).toBe(409);
  });
});
