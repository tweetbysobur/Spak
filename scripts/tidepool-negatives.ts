/**
 * Error cases on the isolated Tidepool testnet environment, against the live server, Tidepool and testnet RPCs.
 * Uses a fresh disposable wallet each run (key held in memory only, never written). Moves no funds.
 *   SPAK_E2E_BASE=http://localhost:3200 npx tsx scripts/tidepool-negatives.ts
 */
import { randomBytes } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64, hex } from "@scure/base";
import { nep413Hash } from "../src/auth/verify/near";

const BASE = process.env.SPAK_E2E_BASE ?? "http://localhost:3200";
const evm = privateKeyToAccount(generatePrivateKey());
const sk = ed25519.utils.randomSecretKey(), pk = ed25519.getPublicKey(sk), nearId = hex.encode(pk), nearPub = `ed25519:${base58.encode(pk)}`;
const sign = (c: { message: string; nonce: string; recipient: string }) => base64.encode(ed25519.sign(nep413Hash(c.message, base64.decode(c.nonce), c.recipient), sk));
let cookie = "";
async function api(path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${BASE}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const sc = r.headers.get("set-cookie"); if (sc && /spak/i.test(sc)) cookie = sc.split(";")[0];
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const out: { case: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => { out.push({ case: name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`); };

async function quoteFor(text: string, agentId: string | null) {
  const r = (await api("/api/spak-in/interpret", { text, sessionId: `n_${randomBytes(4).toString("hex")}`, timezone: "UTC" })).body;
  if (r.status !== "VALIDATED") return { interpret: r };
  const x = await api("/api/executions", { planHash: r.plan.hash, ...(agentId ? { agentId } : {}) }, { "idempotency-key": `n-${randomBytes(8).toString("hex")}` });
  return { interpret: r, x };
}

(async () => {
  const ch = (await api("/api/auth/challenge", { family: "evm", address: evm.address, chainId: 84532 })).body;
  await api("/api/auth/verify", { challengeId: ch.challengeId, signature: await evm.signMessage({ message: ch.message }) });
  const agent = (await api("/api/agents", { displayName: "Negatives" })).body.agent;
  const ac = (await api(`/api/agents/${agent.id}/challenge`, { accountId: nearId })).body;
  await api(`/api/agents/${agent.id}/verify`, { challengeId: ac.challengeId, method: ac.method, accountId: nearId, publicKey: nearPub, signature: sign(ac) });
  const pc = (await api(`/api/agents/${agent.id}/permissions/prepare`, { maxTransactionUsd: "10", dailyLimitUsd: "20", maxTransactions: 3, durationHours: 1, sourceNetworks: ["base-sepolia"], destinationNetworks: ["arbitrum-sepolia"], assets: ["base-sepolia:native", "arbitrum-sepolia:0x38d81431b9f76d9699af7517040d5221d9dea252"], recipients: { self: true, addresses: [] } })).body;
  await api(`/api/agents/${agent.id}/permissions/confirm`, { challengeId: pc.challengeId, accountId: nearId, publicKey: nearPub, signature: sign(pc) });

  // Mainnet chains do not exist in the testnet build.
  const sol = (await api("/api/spak-in/interpret", { text: "Swap 1 USDC on Base to SOL on Solana", sessionId: "n_sol", timezone: "UTC" })).body;
  check("mainnet-only chain refused in testnet build", sol.status !== "VALIDATED", `${sol.status}: ${(sol.errors ?? []).map((e: { message: string }) => e.message).join("; ").slice(0, 160)}`);

  // Provider failure: above Tidepool's 0.006 ETH per-swap cap. Tidepool itself refuses at quote time.
  const big = await quoteFor("Swap 0.01 ETH on Base to USDC on Arbitrum", agent.id);
  check("provider refusal (Tidepool cap) surfaces as a clear error", (big.x?.status ?? 0) >= 400, `${big.x?.status} ${big.x?.body?.error?.code}: ${big.x?.body?.error?.message?.slice(0, 160)}`);

  // Outside the permission: USDT is not an allowed token, so the Agent cannot approve; the user can.
  const usdt = await quoteFor("Swap 0.002 ETH on Base to USDT on Arbitrum", agent.id);
  if (usdt.x?.status && usdt.x.status < 300) {
    const f = (await api(`/api/executions/${usdt.x.body.execution.id}/firm-quote`, { quoteId: usdt.x.body.quote.id })).body.quote;
    const a = await api(`/api/executions/${usdt.x.body.execution.id}/agent-approve`, { quoteId: f.id });
    check("outside permission needs the user", a.status === 403 && a.body.error.code === "AGENT_APPROVAL_REQUIRED", `${a.status} ${a.body.error?.code}: ${(a.body.error?.details?.reasons ?? []).join(" ").slice(0, 160)}`);
  } else check("outside permission needs the user", false, `quote failed ${JSON.stringify(usdt.x?.body ?? usdt.interpret?.errors).slice(0, 160)}`);

  // Revoked permission: an Agent approval is refused afterwards.
  const ok = await quoteFor("Swap 0.003 ETH on Base to USDC on Arbitrum", agent.id);
  await api(`/api/agents/${agent.id}/permissions/revoke`, {});
  const f2 = (await api(`/api/executions/${ok.x!.body.execution.id}/firm-quote`, { quoteId: ok.x!.body.quote.id })).body.quote;
  const a2 = await api(`/api/executions/${ok.x!.body.execution.id}/agent-approve`, { quoteId: f2.id });
  check("revoked permission refuses Agent approval", a2.status === 403 && a2.body.error.code === "AGENT_APPROVAL_REQUIRED", `${a2.status} ${a2.body.error?.code}`);

  // User approval still works, then deposit preparation reads the real Base Sepolia balance: insufficient.
  const u = await api(`/api/executions/${ok.x!.body.execution.id}/approve`, { quoteId: f2.id, approval: { planHash: ok.interpret.plan.hash, planRevision: ok.x!.body.execution.plan.revision, approvedAt: new Date().toISOString(), allowDuplicate: true } });
  const d = await api(`/api/executions/${ok.x!.body.execution.id}/deposits`, {});
  check("insufficient balance is read from Base Sepolia and refused", u.status === 200 && d.status === 422 && d.body.error.code === "INSUFFICIENT_BALANCE", `approve ${u.status}; deposit ${d.status} ${d.body.error?.code}`);

  // Expiry: a quote approved after its window is refused (here: an approval timestamp outside the server's window).
  const e = await quoteFor("Swap 0.0021 ETH on Base to USDC on Arbitrum", null);
  const f3 = (await api(`/api/executions/${e.x!.body.execution.id}/firm-quote`, { quoteId: e.x!.body.quote.id })).body.quote;
  const old = await api(`/api/executions/${e.x!.body.execution.id}/approve`, { quoteId: f3.id, approval: { planHash: e.interpret.plan.hash, planRevision: e.x!.body.execution.plan.revision, approvedAt: new Date(Date.now() - 11 * 60_000).toISOString() } });
  check("expired approval refused", old.status === 410 && old.body.error.code === "APPROVAL_EXPIRED", `${old.status} ${old.body.error?.code}`);

  // Duplicate: the same transfer again within 2 minutes is flagged before approval.
  const dupe = await quoteFor("Swap 0.0021 ETH on Base to USDC on Arbitrum", null);
  if (dupe.x && dupe.x.status < 300) {
    const f4 = (await api(`/api/executions/${dupe.x.body.execution.id}/firm-quote`, { quoteId: dupe.x.body.quote.id })).body.quote;
    await api(`/api/executions/${e.x!.body.execution.id}/approve`, { quoteId: f3.id, approval: { planHash: e.interpret.plan.hash, planRevision: e.x!.body.execution.plan.revision, approvedAt: new Date().toISOString() } });
    const dd = await api(`/api/executions/${dupe.x.body.execution.id}/approve`, { quoteId: f4.id, approval: { planHash: dupe.interpret.plan.hash, planRevision: dupe.x.body.execution.plan.revision, approvedAt: new Date().toISOString() } });
    check("duplicate transfer flagged", dd.status === 409 && dd.body.error.code === "DUPLICATE_SUSPECTED", `${dd.status} ${dd.body.error?.code}`);
  } else check("duplicate transfer flagged", dupe.x?.body?.execution?.id === e.x?.body?.execution?.id, `same plan returned the same execution (${dupe.x?.status})`);

  console.log(`\n${out.filter((x) => x.pass).length}/${out.length} passed`);
  process.exit(out.every((x) => x.pass) ? 0 : 1);
})().catch((e) => { console.error("CRASHED", e); process.exit(1); });
