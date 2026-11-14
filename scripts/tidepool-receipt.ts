/**
 * Re-check one testnet execution and print its SPak receipt: signs in with the wallet key from Doppler (memory only),
 * asks SPak to refresh tracking and destination verification, and prints state, events and verification records.
 * Sends no transaction.  NODE_USE_ENV_PROXY=1 SPAK_E2E_BASE=… SPAK_EXEC_ID=exe_… npx tsx scripts/tidepool-receipt.ts
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
const BASE = process.env.SPAK_E2E_BASE!, EXEC = process.env.SPAK_EXEC_ID!;
let cookie = "";
async function api(path: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const sc = r.headers.get("set-cookie"); if (sc && /spak/i.test(sc)) cookie = sc.split(";")[0];
  return (await r.json().catch(() => null)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
(async () => {
  const r = await fetch("https://api.doppler.com/v3/configs/config/secret?project=spak-testnet-wallet&config=dev&name=SPAK_TESTNET_WALLET_PRIVATE_KEY");
  const acct = privateKeyToAccount(((await r.json()) as { value: { raw: string } }).value.raw.trim() as Hex);
  const ch = await api("/api/auth/challenge", { family: "evm", address: acct.address, chainId: 84532 });
  await api("/api/auth/verify", { challengeId: ch.challengeId, signature: await acct.signMessage({ message: ch.message }) });
  const t = await api(`/api/executions/${EXEC}/refresh`, {});
  const ex = await api(`/api/executions/${EXEC}`);
  const dv = await api(`/api/executions/${EXEC}/destination`);
  console.log(JSON.stringify({ refreshedState: t?.state, state: ex.state, providerStatus: ex.providerStatus, amountOutVerified: ex.destination.amountOutVerified, verifiedAt: ex.destination.verifiedAt, origin: ex.originTxHashes, destination: ex.destinationTxHashes,
    verifications: dv.verifications.map((v: any) => ({ txHash: v.txHash, outcome: v.outcome, receivedAmount: v.receivedAmount, confirmations: v.confirmations })), // eslint-disable-line @typescript-eslint/no-explicit-any
    events: ex.events.map((e: any) => `${e.at.slice(11, 19)} ${e.from} -> ${e.to} | ${e.reason}`) }, null, 1)); // eslint-disable-line @typescript-eslint/no-explicit-any
})().catch((e) => { console.log("ERROR", String(e.message).replace(/0x[0-9a-fA-F]{64}/g, "<redacted>")); process.exitCode = 1; });
