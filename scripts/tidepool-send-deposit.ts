/**
 * Send ONE already-approved SPak testnet deposit, after re-checking it against the live server and chain.
 * The wallet key comes from Doppler (read-only token injected by the proxy) into memory only. Testnet only.
 *   NODE_USE_ENV_PROXY=1 SPAK_E2E_BASE=… SPAK_EXEC_ID=exe_… SPAK_EXPECT_DEPOSIT=0x… SPAK_EXPECT_WEI=… SPAK_E2E_EXPECTED_ADDRESS=0x… npx tsx scripts/tidepool-send-deposit.ts
 */
import { writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, formatEther, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { publicActionsL2 } from "viem/op-stack";
import { verifyQuoteSignature, TIDEPOOL_QUOTE_PUBLIC_KEY } from "../src/integrations/near-intents/signature";

const BASE = process.env.SPAK_E2E_BASE!, EXEC = process.env.SPAK_EXEC_ID!, DEP = getAddress(process.env.SPAK_EXPECT_DEPOSIT!), WEI = BigInt(process.env.SPAK_EXPECT_WEI!), ME = getAddress(process.env.SPAK_E2E_EXPECTED_ADDRESS!);
const OUT = process.env.SPAK_E2E_OUT ?? "/root/spak-e2e/evidence-settlement.json";
const USDC_ARB = "0x38d81431B9f76d9699AF7517040D5221D9dEA252";
const ev: Record<string, unknown> = { startedAt: new Date().toISOString(), execution: EXEC };
const save = () => writeFileSync(OUT, JSON.stringify(ev, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
const say = (k: string, v: unknown) => { ev[k] = v; save(); console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))}`); };
let cookie = "";
async function api(path: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const sc = r.headers.get("set-cookie"); if (sc && /spak/i.test(sc)) cookie = sc.split(";")[0];
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const fail = (m: string): never => { say("STOPPED", m); throw new Error(m); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

(async () => {
  const r = await fetch("https://api.doppler.com/v3/configs/config/secret?project=spak-testnet-wallet&config=dev&name=SPAK_TESTNET_WALLET_PRIVATE_KEY");
  if (r.status !== 200) fail(`Doppler ${r.status}`);
  const raw = ((await r.json()) as { value?: { raw?: string } }).value?.raw?.trim();
  if (!raw || !/^0x[0-9a-fA-F]{64}$/.test(raw)) fail("Doppler secret is not a 32-byte key");
  const acct = privateKeyToAccount(raw as Hex);
  if (acct.address !== ME) fail("wallet key does not derive the expected address");
  say("wallet", acct.address);

  const ch = (await api("/api/auth/challenge", { family: "evm", address: acct.address, chainId: 84532 })).body;
  if ((await api("/api/auth/verify", { challengeId: ch.challengeId, signature: await acct.signMessage({ message: ch.message }) })).status !== 200) fail("sign-in failed");

  // 1. The execution, its firm quote and its deposit instruction, as the server holds them now.
  const ex = (await api(`/api/executions/${EXEC}`)).body;
  if (ex?.state !== "AWAITING_DEPOSIT") fail(`execution state is ${ex?.state}`);
  const firm = ex.quotes.find((q: { id: string }) => q.id === ex.firmQuoteId);
  const deadline = Date.parse(ex.deposit?.deadline ?? "");
  const secsLeft = Math.floor((deadline - Date.now()) / 1000);
  if (!(secsLeft > 120)) fail(`deposit instruction expires in ${secsLeft}s; do not reuse it`);
  const stored = (await api(`/api/quotes/${firm.id}`)).body;
  // 2-4. Route, amount, address.
  const checks = {
    firmQuoteValid: firm.kind === "FIRM" && firm.status === "VALID",
    sourceIsBaseSepolia: ex.source.network === "base-sepolia" && ex.source.assetId === "base-sepolia:native",
    destinationIsArbitrumSepoliaUsdc: ex.destination.network === "arbitrum-sepolia" && ex.destination.assetId === "arbitrum-sepolia:0x38d81431b9f76d9699af7517040d5221d9dea252",
    amountExact: BigInt(ex.deposit.amount) === WEI && BigInt(firm.source.amountIn) === WEI,
    depositAddressMatches: getAddress(ex.deposit.address) === DEP && getAddress(firm.deposit.address) === DEP,
    recipientAndRefundAreWallet: getAddress(ex.recipient.address) === ME && getAddress(ex.refundAddress) === ME,
    secondsLeft: secsLeft,
  };
  say("prechecks", checks);
  if (Object.entries(checks).some(([k, v]) => k !== "secondsLeft" && v !== true)) fail("a pre-check failed");
  void stored; void verifyQuoteSignature; void TIDEPOOL_QUOTE_PUBLIC_KEY;

  // The deposit attempt and exact transaction SPak prepares (reuses the open attempt).
  const dp = await api(`/api/executions/${EXEC}/deposits`, {});
  if (dp.status !== 200) fail(`deposit prepare ${dp.status} ${dp.body?.error?.code}`);
  const tx = dp.body.transaction;
  if (tx.family !== "evm" || tx.kind !== "NATIVE" || tx.chainId !== 84532 || getAddress(tx.request.to) !== DEP || BigInt(tx.request.value) !== WEI || tx.request.data !== "0x" || getAddress(tx.request.from) !== ME) fail("prepared transaction differs from the instruction");

  // 5. Gas and balance: one plain value transfer, nothing else.
  const base = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") }).extend(publicActionsL2());
  const [bal, nonce, fees] = await Promise.all([base.getBalance({ address: ME }), base.getTransactionCount({ address: ME }), base.estimateFeesPerGas()]);
  const gas = await base.estimateGas({ account: ME, to: DEP, value: WEI });
  const l1 = await base.estimateL1Fee({ account: ME, to: DEP, value: WEI, gas, chain: baseSepolia });
  const maxCost = gas * fees.maxFeePerGas! + l1;
  say("gas", { gas, maxFeePerGasWei: fees.maxFeePerGas, l1FeeWei: l1, maxGasCostEth: formatEther(maxCost), balanceEth: formatEther(bal), nonce, transfersOnlyEth: formatEther(WEI) });
  if (gas !== 21000n) fail(`gas estimate ${gas} is not a plain transfer`);
  if (bal < WEI + maxCost) fail("insufficient balance");

  // Sign and send exactly this transaction.
  const wallet = createWalletClient({ account: acct, chain: baseSepolia, transport: http("https://sepolia.base.org") });
  const hash = await wallet.sendTransaction({ to: DEP, value: WEI, data: "0x", gas, nonce, maxFeePerGas: fees.maxFeePerGas!, maxPriorityFeePerGas: fees.maxPriorityFeePerGas! });
  say("sourceTx", { hash, explorer: `https://sepolia.basescan.org/tx/${hash}` });
  const sub = await api(`/api/deposits/${dp.body.deposit.id}/submit`, { txHash: hash });
  say("submitted", { status: sub.status, state: sub.body?.state });
  const rc = await base.waitForTransactionReceipt({ hash, timeout: 180_000 });
  say("sourceReceipt", { status: rc.status, block: rc.blockNumber, gasUsed: rc.gasUsed, effectiveGasPrice: rc.effectiveGasPrice });

  let dep: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < 36; i++) { dep = (await api(`/api/deposits/${dp.body.deposit.id}/verify`, {})).body; if (/CONFIRMED|VERIFIED/.test(dep?.state ?? "")) break; await sleep(5000); }
  say("spakDepositVerification", { state: dep?.state, confirmations: dep?.confirmations, verifiedAmount: dep?.verifiedAmount ?? dep?.amountVerified });

  const arb = createPublicClient({ chain: arbitrumSepolia, transport: http("https://sepolia-rollup.arbitrum.io/rpc") });
  const usdcBefore = await arb.readContract({ address: USDC_ARB, abi: erc20, functionName: "balanceOf", args: [ME] });
  say("arbitrumUsdcBeforeSettlement", usdcBefore);
  let t: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < 90; i++) {
    t = (await api(`/api/executions/${EXEC}/refresh`, {})).body;
    if (i % 3 === 0) console.log(`  ${new Date().toISOString().slice(11, 19)} state ${t?.state} provider ${t?.providerStatus ?? ""}`);
    if (["COMPLETED", "FAILED", "REFUNDED", "EXPIRED"].includes(t?.state)) break;
    await sleep(10_000);
  }
  const full = (await api(`/api/executions/${EXEC}`)).body;
  const dv = (await api(`/api/executions/${EXEC}/destination`)).body;
  const usdcAfter = await arb.readContract({ address: USDC_ARB, abi: erc20, functionName: "balanceOf", args: [ME] });
  say("settlement", { state: full.state, providerStatus: full.providerStatus, originTxHashes: full.originTxHashes, destinationTxHashes: full.destinationTxHashes });
  say("destinationVerification", { spakVerifiedAmountUnits: full.destination.amountOutVerified, verifiedAt: full.destination.verifiedAt, minimumUnits: firm.destination.minAmountOut, records: dv.verifications });
  say("independentUsdcCheck", { before: usdcBefore, after: usdcAfter, deltaUnits: usdcAfter - usdcBefore });
  say("receipt", { id: full.id, state: full.state, agentId: full.agentId, approvedAt: full.approvedAt, events: full.events });
  ev.finishedAt = new Date().toISOString(); save();
})().catch((e) => { console.log("ERROR", String((e as Error).message).replace(/0x[0-9a-fA-F]{64}/g, "<redacted>").slice(0, 300)); process.exitCode = 1; });
