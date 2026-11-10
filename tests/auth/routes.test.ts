/**
 * HTTP-level tests: the real Next.js route handlers, real Request/Response objects, real cookies,
 * real signatures and a real (in-memory PGlite) Postgres with the project migrations.
 */
import { describe, expect, it } from "vitest";
import { POST as challenge } from "@/app/api/auth/challenge/route";
import { POST as verify } from "@/app/api/auth/verify/route";
import { GET as session } from "@/app/api/auth/session/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { PATCH as patchWallet } from "@/app/api/wallets/[id]/route";
import { POST as interpret } from "@/app/api/spak-in/interpret/route";
import { POST as manual } from "@/app/api/spak-in/manual/route";
import { POST as cancel } from "@/app/api/executions/[id]/cancel/route";
import { evmWallet, solanaWallet } from "./keys";

const ORIGIN = "http://localhost:3000";
let ip = 0;
function req(path: string, opts: { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? `10.0.0.${++ip % 250}` };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = opts.cookie;
  return new Request(`${ORIGIN}${path}`, { method: opts.method ?? "POST", headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
}
const json = async (r: Response) => r.json() as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const cookieOf = (r: Response) => r.headers.get("set-cookie")?.split(";")[0] ?? "";

async function signInEvm(w = evmWallet()) {
  const c = await json(await challenge(req("/api/auth/challenge", { body: { family: "evm", address: w.address } })));
  const { signature } = await w.sign(c.message);
  const r = await verify(req("/api/auth/verify", { body: { challengeId: c.challengeId, signature } }));
  return { res: r, cookie: cookieOf(r), wallet: w, body: await json(r.clone()) };
}

describe("auth routes", () => {
  it("sign-in sets an HttpOnly, SameSite=Lax session cookie and the session route sees the user", async () => {
    const { res, cookie } = await signInEvm();
    expect(res.status).toBe(200);
    const set = res.headers.get("set-cookie")!;
    expect(set).toMatch(/^spak_session=/);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=lax/i);
    expect(set).toMatch(/Path=\//);
    const s = await json(await session(req("/api/auth/session", { method: "GET", cookie })));
    expect(s.authenticated).toBe(true);
    expect(s.wallets).toHaveLength(1);
  });

  it("logout revokes the session server-side", async () => {
    const { cookie } = await signInEvm();
    const out = await logout(req("/api/auth/logout", { body: {}, cookie }));
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await json(await session(req("/api/auth/session", { method: "GET", cookie })))).authenticated).toBe(false);
  });

  it("CSRF: foreign Origin and missing Origin without same-origin fetch metadata are refused", async () => {
    const w = evmWallet();
    expect((await challenge(req("/api/auth/challenge", { body: { family: "evm", address: w.address }, origin: "https://evil.example" }))).status).toBe(403);
    expect((await challenge(req("/api/auth/challenge", { body: { family: "evm", address: w.address }, origin: null }))).status).toBe(403);
  });

  it("rate limits challenge requests per IP", async () => {
    const w = evmWallet();
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await challenge(req("/api/auth/challenge", { body: { family: "evm", address: w.address }, ip: "10.9.9.9" }))).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it("validates input", async () => {
    expect((await challenge(req("/api/auth/challenge", { body: { family: "bitcoin", address: "x" } }))).status).toBe(400);
    expect((await challenge(req("/api/auth/challenge", { body: { family: "evm", address: "0x12" } }))).status).toBe(400);
    expect((await verify(req("/api/auth/verify", { body: { challengeId: "nope", signature: "0x00" } }))).status).toBe(400);
  });

  it("replaying a verified signature is refused", async () => {
    const w = evmWallet();
    const c = await json(await challenge(req("/api/auth/challenge", { body: { family: "evm", address: w.address } })));
    const { signature } = await w.sign(c.message);
    expect((await verify(req("/api/auth/verify", { body: { challengeId: c.challengeId, signature } }))).status).toBe(200);
    expect((await verify(req("/api/auth/verify", { body: { challengeId: c.challengeId, signature } }))).status).toBe(409);
  });

  it("linking needs a session, and a wallet cannot be taken from another account", async () => {
    const a = await signInEvm();
    const b = await signInEvm();
    // no session: LINK challenge is refused
    expect((await challenge(req("/api/auth/challenge", { body: { family: "evm", address: evmWallet().address, purpose: "LINK" } }))).status).toBe(401);
    // b tries to link a's wallet
    const c = await json(await challenge(req("/api/auth/challenge", { body: { family: "evm", address: a.wallet.address, purpose: "LINK" }, cookie: b.cookie })));
    const { signature } = await a.wallet.sign(c.message);
    const r = await verify(req("/api/auth/verify", { body: { challengeId: c.challengeId, signature }, cookie: b.cookie }));
    expect(r.status).toBe(409);
    expect((await json(r)).error.code).toBe("WALLET_OWNED_BY_OTHER_USER");
    // b cannot modify a's wallet
    const res = await patchWallet(req(`/api/wallets/${a.body.walletId}`, { method: "PATCH", body: { active: true }, cookie: b.cookie }), { params: Promise.resolve({ id: a.body.walletId }) });
    expect(res.status).toBe(404);
  });
});

describe("protected SPak-in routes", () => {
  it("refuse anonymous callers; the old x-spak-user header no longer works", async () => {
    const r = new Request(`${ORIGIN}/api/spak-in/interpret`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-spak-user": "anon_someone_12345" }, body: JSON.stringify({ text: "swap 1 eth on base to usdc" }) });
    expect((await interpret(r)).status).toBe(401);
    expect((await manual(req("/api/spak-in/manual", { body: {} }))).status).toBe(401);
    expect((await cancel(req("/api/executions/x/cancel", { body: {} }), { params: Promise.resolve({ id: "x" }) })).status).toBe(401);
  });

  it("use verified wallets as SPak-in context and ignore client-sent addresses", async () => {
    const { cookie } = await signInEvm();
    const sol = solanaWallet();
    const c = await json(await challenge(req("/api/auth/challenge", { body: { family: "solana", address: sol.address, purpose: "LINK" }, cookie })));
    const { signature } = await sol.sign(c.message);
    expect((await verify(req("/api/auth/verify", { body: { challengeId: c.challengeId, signature }, cookie }))).status).toBe(200);

    const attacker = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    const r = await json(await interpret(req("/api/spak-in/interpret", { cookie, body: { text: "Swap 50 USDC on Base to SOL on Solana", sessionId: "c1", wallets: { solana: attacker } } })));
    expect(r.status).toBe("VALIDATED");
    expect(r.recipient.address).toBe(sol.address);
    expect(r.recipient.address).not.toBe(attacker);
    expect(r.sessionId.startsWith(r.sessionId.split(":")[0])).toBe(true);

    // follow-ups still work through the authenticated session
    const f = await json(await interpret(req("/api/spak-in/interpret", { cookie, body: { text: "make it 100 instead", sessionId: "c1" } })));
    expect(f).toMatchObject({ status: "VALIDATED", revision: 1, source: { amount: { value: "100" } } });
  });

  it("network switching changes the wallet SPak-in uses", async () => {
    const { cookie, body } = await signInEvm();
    // turn Base off for the only EVM wallet: SPak-in must now ask for a refund address on Base
    await patchWallet(req(`/api/wallets/${body.walletId}`, { method: "PATCH", body: { networks: ["arbitrum"] }, cookie }), { params: Promise.resolve({ id: body.walletId }) });
    const r = await json(await interpret(req("/api/spak-in/interpret", { cookie, body: { text: "Bridge 10 USDC from Base to Arbitrum" } })));
    expect(r.missingFields).toContain("refundAddress");
  });
});
