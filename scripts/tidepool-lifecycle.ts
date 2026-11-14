/**
 * Real end-to-end lifecycle on the isolated Tidepool testnet environment. Test tokens only; never mainnet.
 *
 *   SPAK_E2E_BASE=http://localhost:3200 SPAK_E2E_KEYS=/path/outside/repo/keys.json npx tsx scripts/tidepool-lifecycle.ts [--negative-only]
 *
 * It drives a running SPak testnet server through its HTTP API exactly as the browser does (session cookie,
 * same-origin). The disposable keys play the USER's wallets: the EVM key signs sign-in and the deposit, the NEAR
 * implicit key proves Agent ownership and signs the Agent permission. The server never sees a private key and signs
 * nothing. Keys are created on first run in SPAK_E2E_KEYS (mode 0600, outside the repository); only addresses print.
 *
 * Every result is labelled REAL (from the live testnet or Tidepool) or BLOCKED (with the exact reason). Nothing is
 * simulated here. Evidence is written to SPAK_E2E_OUT (JSON).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64, hex } from "@scure/base";
import { nep413Hash } from "../src/auth/verify/near";

const BASE = process.env.SPAK_E2E_BASE ?? "http://localhost:3200";
const KEYS = process.env.SPAK_E2E_KEYS;
const OUT = process.env.SPAK_E2E_OUT ?? "tidepool-lifecycle-evidence.json";
const AMOUNT_ETH = process.env.SPAK_E2E_AMOUNT_ETH ?? "0.002";
const NEG_ONLY = process.argv.includes("--negative-only");
if (!KEYS) throw new Error("Set SPAK_E2E_KEYS to a file path outside the repository.");
if (KEYS.startsWith(process.cwd())) throw new Error("SPAK_E2E_KEYS must be outside the repository.");

// ------------------------------------------------------------------------------------------------ disposable keys
type Keys = { evm: Hex; near: string; createdAt: string };
const keys: Keys = existsSync(KEYS) ? JSON.parse(readFileSync(KEYS, "utf8")) : { evm: generatePrivateKey(), near: hex.encode(ed25519.utils.randomSecretKey()), createdAt: new Date().toISOString() };
if (!existsSync(KEYS)) writeFileSync(KEYS, JSON.stringify(keys), { mode: 0o600 });
const evm = privateKeyToAccount(keys.evm);
const nearSk = hex.decode(keys.near), nearPk = ed25519.getPublicKey(nearSk);
const nearId = hex.encode(nearPk), nearPub = `ed25519:${base58.encode(nearPk)}`;
const signNep413 = (c: { message: string; nonce: string; recipient: string }) => base64.encode(ed25519.sign(nep413Hash(c.message, base64.decode(c.nonce), c.recipient), nearSk));

const base = createPublicClient({ chain: baseSepolia, transport: http(process.env.SPAK_RPC_BASE_SEPOLIA ?? "https://sepolia.base.org") });
const arb = createPublicClient({ chain: arbitrumSepolia, transport: http(process.env.SPAK_RPC_ARBITRUM_SEPOLIA ?? "https://sepolia-rollup.arbitrum.io/rpc") });

// ------------------------------------------------------------------------------------------------ evidence
type Step = { n: number; step: string; status: "REAL" | "BLOCKED" | "FAILED"; detail: string; data?: unknown };
const steps: Step[] = [];
const ev: Record<string, unknown> = { environment: "tidepool-testnet", base: BASE, wallet: evm.address, agentOwner: nearId, startedAt: new Date().toISOString(), steps };
const log = (n: number, step: string, status: Step["status"], detail: string, data?: unknown) => {
  steps.push({ n, step, status, detail, ...(data !== undefined ? { data } : {}) });
  console.log(`${String(n).padStart(2)} ${status.padEnd(7)} ${step}: ${detail}`);
  writeFileSync(OUT, JSON.stringify(ev, null, 1));
};

// ------------------------------------------------------------------------------------------------ HTTP
let cookie = "";
async function api<T = any>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const sc = r.headers.get("set-cookie"); if (sc && /spak/i.test(sc)) cookie = sc.split(";")[0];
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}
const must = <T>(r: { status: number; body: T }, what: string): T => { if (r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Disposable user wallet (EVM): ${evm.address}`);
  console.log(`Disposable Agent owner (NEAR testnet implicit): ${nearId}`);

  // 1-2. Wallet connection and ownership: the server verifies an EIP-4361 signature from the disposable key.
  const ch = must(await api<{ challengeId: string; message: string }>("/api/auth/challenge", { family: "evm", address: evm.address, chainId: baseSepolia.id }), "challenge");
  must(await api("/api/auth/verify", { challengeId: ch.challengeId, signature: await evm.signMessage({ message: ch.message }) }), "verify");
  const session = must(await api<{ wallets: { address: string; networks: { id: string; enabled: boolean }[] }[] }>("/api/auth/session"), "session");
  const nets = session.wallets?.[0]?.networks?.filter((n) => n.enabled).map((n) => n.id) ?? [];
  log(1, "Wallet connection", "REAL", `signed in with ${evm.address}; enabled networks: ${nets.join(", ")}`);
  log(2, "Wallet ownership verification", "REAL", "EIP-4361 signature verified by the server");

  // 3. Agent identity: NEP-413 proof from the owner key, verified by the server.
  const agent = (await api<{ agent: { id: string } | null }>("/api/agents")).body.agent ?? must(await api<{ agent: { id: string } }>("/api/agents", { displayName: "Testnet Agent" }), "create agent").agent;
  const ac = must(await api<{ challengeId: string; method: string; message: string; nonce: string; recipient: string }>(`/api/agents/${agent.id}/challenge`, { accountId: nearId }), "agent challenge");
  must(await api(`/api/agents/${agent.id}/verify`, { challengeId: ac.challengeId, method: ac.method, accountId: nearId, publicKey: nearPub, signature: signNep413(ac) }), "agent verify");
  log(3, "Agent identity verification", "REAL", `Agent ${agent.id} owned by ${nearId} (NEP-413, implicit account)`);

  // 4. Agent funding: needs an ACTIVE dedicated account (created by SPak's testnet parent account).
  const acct = (await api<{ account: { status: string; accountId: string } | null; infrastructure: { state: string; reason: string | null } }>(`/api/agents/${agent.id}/account`)).body;
  if (acct.account?.status === "ACTIVE") {
    const f = await api(`/api/agents/${agent.id}/account/funding`, {});
    log(4, "Agent funding check", f.status === 200 ? "REAL" : "FAILED", JSON.stringify(f.body).slice(0, 200), f.body);
  } else {
    log(4, "Agent funding check", "BLOCKED", `no ACTIVE dedicated Agent account (infrastructure ${acct.infrastructure?.state}: ${acct.infrastructure?.reason ?? "n/a"}). The read path itself is key-free; see the report.`);
  }

  // Agent permission: signed by the owner key over exact limits.
  const scope = { maxTransactionUsd: "10", dailyLimitUsd: "20", maxTransactions: 3, durationHours: 24, sourceNetworks: ["base-sepolia"], destinationNetworks: ["arbitrum-sepolia"],
    assets: ["base-sepolia:native", "arbitrum-sepolia:0x38d81431b9f76d9699af7517040d5221d9dea252"], recipients: { self: true, addresses: [] } };
  const pc = must(await api<{ challengeId: string; message: string; nonce: string; recipient: string }>(`/api/agents/${agent.id}/permissions/prepare`, scope), "permission prepare");
  const grant = must(await api<{ grant: { id: string; version: number } }>(`/api/agents/${agent.id}/permissions/confirm`, { challengeId: pc.challengeId, accountId: nearId, publicKey: nearPub, signature: signNep413(pc) }), "permission confirm").grant;

  // 5-8. Instruction, interpretation, plan, Guard.
  const text = `Swap ${AMOUNT_ETH} ETH on Base to USDC on Arbitrum`;
  const r = must(await api<any>("/api/spak-in/interpret", { text, sessionId: `e2e_${randomBytes(4).toString("hex")}`, mode: "AGENT", timezone: "UTC" }), "interpret"); // eslint-disable-line @typescript-eslint/no-explicit-any
  log(5, "Natural-language instruction", "REAL", text);
  log(6, "SPak-in interpretation", r.status === "VALIDATED" ? "REAL" : "FAILED", `${r.status} ${r.intentType}: ${r.source?.network} ${r.source?.symbol ?? ""} -> ${r.destination?.network} (${r.mode ?? ""})`, { status: r.status, errors: r.errors });
  if (r.status !== "VALIDATED") throw new Error(`interpretation: ${JSON.stringify(r.errors ?? r.clarifications)}`);
  log(7, "Execution plan", "REAL", `plan ${r.plan.hash.slice(0, 16)}… executable=${r.plan.executable} legs=${r.plan.legs.length}`, { planHash: r.plan.hash, leg: r.plan.legs[0] });
  log(8, "Guard evaluation (plan)", r.guard?.outcome === "REQUIRES_APPROVAL" ? "REAL" : "FAILED", `${r.guard?.outcome}: ${(r.guard?.reasons ?? []).join("; ") || "all rules pass"}`);

  // 10. Quote (indicative then firm) from Tidepool, signature verified by the server.
  const x = await api<any>("/api/executions", { planHash: r.plan.hash, agentId: agent.id }, { "idempotency-key": `e2e-${r.plan.hash.slice(0, 32)}` }); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (x.status >= 300) { log(10, "Quote generation", "FAILED", JSON.stringify(x.body).slice(0, 300)); throw new Error("quote"); }
  const exe = x.body.execution, ind = x.body.quote;
  const firm = must(await api<any>(`/api/executions/${exe.id}/firm-quote`, { quoteId: ind.id }), "firm quote").quote; // eslint-disable-line @typescript-eslint/no-explicit-any
  log(10, "Quote generation", "REAL", `Tidepool firm quote ${firm.id}: ${firm.source.amountIn} wei -> min ${firm.destination.minAmountOut} USDC units (~$${firm.source.amountInUsd}); deposit ${firm.deposit?.address}; correlation ${firm.providerReference.correlationId}; signature verified against Tidepool's maker key`, { firm });

  // Duplicate request: the same plan and key return the same execution.
  const dup = must(await api<any>("/api/executions", { planHash: r.plan.hash, agentId: agent.id }, { "idempotency-key": `e2e-${r.plan.hash.slice(0, 32)}` }), "duplicate"); // eslint-disable-line @typescript-eslint/no-explicit-any
  log(10.1, "Duplicate request", dup.execution.id === exe.id ? "REAL" : "FAILED", `same execution returned (${dup.execution.id})`);

  // 9 + 11. Agent permission evaluated server-side; the Agent approves inside the permission and Guard.
  const ap = await api<any>(`/api/executions/${exe.id}/agent-approve`, { quoteId: firm.id }); // eslint-disable-line @typescript-eslint/no-explicit-any
  log(9, "Agent permission evaluation", ap.status === 200 ? "REAL" : "FAILED", ap.status === 200 ? `inside permission v${grant.version} (${grant.id})` : JSON.stringify(ap.body).slice(0, 300));
  log(11, "Approval", ap.status === 200 ? "REAL" : "FAILED", ap.status === 200 ? `approved by the Agent under the signed permission; state ${ap.body.execution.state}` : "not approved");
  if (ap.status !== 200) throw new Error("approval");

  // 12. Deposit instruction (server reads the wallet's balance on Base Sepolia).
  const dp = await api<any>(`/api/executions/${exe.id}/deposits`, {}); // eslint-disable-line @typescript-eslint/no-explicit-any
  const bal = await base.getBalance({ address: evm.address });
  ev.balanceBeforeWei = bal.toString();
  if (dp.status >= 300) {
    log(12, "Deposit instruction", dp.body?.error?.code === "INSUFFICIENT_BALANCE" ? "REAL" : "FAILED", `${dp.body?.error?.code}: ${dp.body?.error?.message}`);
    log(13, "User-signed testnet deposit", "BLOCKED", `wallet ${evm.address} holds ${formatEther(bal)} Base Sepolia ETH; needs ${AMOUNT_ETH} plus gas. Fund it (see report) and run again.`);
    return;
  }
  const tx = dp.body.transaction;
  log(12, "Deposit instruction", "REAL", `${tx.kind} on chain ${tx.chainId}: send ${tx.request.value} wei to ${tx.request.to}; deposit ${dp.body.deposit.id}`, { transaction: tx });
  if (NEG_ONLY) return;

  // 13. The user's wallet (disposable key) signs and sends the exact prepared transaction.
  const wallet = createWalletClient({ account: evm, chain: baseSepolia, transport: http(process.env.SPAK_RPC_BASE_SEPOLIA ?? "https://sepolia.base.org") });
  if (tx.request.from.toLowerCase() !== evm.address.toLowerCase() || tx.chainId !== baseSepolia.id) throw new Error("prepared transaction is not for this wallet and chain");
  const hash = await wallet.sendTransaction({ to: tx.request.to, value: BigInt(tx.request.value), data: tx.request.data });
  log(13, "User-signed testnet deposit", "REAL", `${hash} https://sepolia.basescan.org/tx/${hash}`);
  must(await api(`/api/deposits/${dp.body.deposit.id}/submit`, { txHash: hash }), "deposit submit");

  // 14. Source confirmation: the chain receipt, and SPak's own verification of it.
  const rc = await base.waitForTransactionReceipt({ hash, timeout: 180_000 });
  let dep: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < 30; i++) { dep = (await api(`/api/deposits/${dp.body.deposit.id}/verify`, {})).body; if (/CONFIRMED|VERIFIED/.test(dep?.state ?? "")) break; await sleep(5000); }
  log(14, "Source transaction confirmation", rc.status === "success" ? "REAL" : "FAILED", `receipt ${rc.status} in block ${rc.blockNumber}; SPak deposit state ${dep?.state}`, { receipt: { blockNumber: rc.blockNumber.toString(), status: rc.status }, deposit: dep });

  // 15-16. Tidepool settles; SPak tracks and verifies delivery on Arbitrum Sepolia itself.
  let t: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < 90; i++) {
    t = (await api(`/api/executions/${exe.id}/refresh`, {})).body;
    if (process.env.SPAK_MONITOR_SECRET) await fetch(`${BASE}/api/internal/monitor`, { method: "POST", headers: { authorization: `Bearer ${process.env.SPAK_MONITOR_SECRET}` } }).catch(() => {});
    if (["COMPLETED", "FAILED", "REFUNDED", "EXPIRED"].includes(t?.state)) break;
    await sleep(10_000);
  }
  const full = must(await api<any>(`/api/executions/${exe.id}`), "execution"); // eslint-disable-line @typescript-eslint/no-explicit-any
  log(15, "Tidepool execution", full.providerStatus === "SUCCESS" ? "REAL" : "FAILED", `Tidepool status ${full.providerStatus}; origin ${JSON.stringify(full.originTxHashes)}; destination ${JSON.stringify(full.destinationTxHashes)}`, { providerStatus: full.providerStatus, origin: full.originTxHashes, destination: full.destinationTxHashes });
  const dv = must(await api<any>(`/api/executions/${exe.id}/destination`), "destination"); // eslint-disable-line @typescript-eslint/no-explicit-any
  log(16, "Destination delivery verification", full.state === "COMPLETED" && full.destination.amountOutVerified ? "REAL" : "FAILED", `state ${full.state}; SPak verified ${full.destination.amountOutVerified ?? "nothing"} USDC units on Arbitrum Sepolia (min ${firm.destination.minAmountOut})`, { verifications: dv.verifications });
  const usdc = await arb.readContract({ address: "0x38d81431B9f76d9699AF7517040D5221D9dEA252", abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [evm.address] });
  ev.arbitrumUsdcBalanceAfter = usdc.toString();
  log(17, "Receipt", full.state === "COMPLETED" ? "REAL" : "FAILED", `execution ${exe.id} ${full.state}; ${full.events.length} events; independent Arbitrum USDC balance ${usdc}`, { events: full.events });
}

main().catch((e) => { log(99, "Run stopped", "FAILED", (e as Error).message); process.exitCode = 1; }).finally(() => { ev.finishedAt = new Date().toISOString(); writeFileSync(OUT, JSON.stringify(ev, null, 1)); console.log(`Evidence: ${OUT}`); void parseEther; });
