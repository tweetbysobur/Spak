/**
 * Route audit (mainnet). For every ordered pair of SPak networks, runs a real sentence through the same steps a
 * transfer takes before any approval: SPak-in planning, asset resolution against the live NEAR Intents token list,
 * a live DRY quote (moves nothing, creates no deposit address), the quote checks SPak applies (shape, signature),
 * and the delivery-verification classification (automatic or manual review).
 *
 *   npx tsx scripts/route-audit.ts [--out docs/route-audit.json] [--only base,near]
 *
 * Read-only. No keys, no wallets, no funds. Addresses below are public placeholders used only as quote recipients.
 */
import { writeFileSync } from "node:fs";
import { SpakIn } from "../src/spak-in/engine";
import { NETWORKS } from "../src/spak-in/registries/networks";
import { findAssets } from "../src/spak-in/registries/assets";
import { OneClickClient } from "../src/integrations/near-intents/client";
import { ONECLICK_QUOTE_PUBLIC_KEY, verifyQuoteSignature } from "../src/integrations/near-intents/signature";
import { AssetResolver } from "../src/execution/asset-resolver";
import { checkQuote } from "../src/execution/quote-validator";
import { automaticDelivery, trustedSendersFromEnv } from "../src/tracking/route-trust";
import { toBaseUnits } from "../src/spak-in/lib/decimal";

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;

/** The user's own wallets: only the families a SPak user can sign in with (EVM, Solana, NEAR). */
const OWN: Record<string, string> = {
  evm: "0x2222222222222222222222222222222222222222",
  solana: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  near: "x3lang.near",
};
/** Public, well-formed recipient addresses for families SPak cannot sign in with (used as payees only). */
const PAYEE: Record<string, string> = {
  bitcoin: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  tron: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  sui: "0x5f2b0a0a4b0d0e2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4",
  xrp: "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY",
  dogecoin: "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L",
  litecoin: "LVg2kJoFNg45Nbpy53h7Fe1wKyeXVRhMH9",
  ton: "EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N",
  stellar: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
  aptos: "0x5f2b0a0a4b0d0e2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4",
};
/** About $10 of each native token, so every route is quoted at a similar size. */
const NATIVE_AMOUNT: Record<string, string> = { ETH: "0.003", POL: "40", BNB: "0.015", AVAX: "0.5", XDAI: "10", SOL: "0.06", NEAR: "4", BTC: "0.0001", TRX: "35", SUI: "3", XRP: "4", DOGE: "50", LTC: "0.1", TON: "3", XLM: "30", APT: "2" };

type Row = { route: string; text: string; stage: "PLAN" | "RESOLVE" | "QUOTE" | "CHECK" | "OK"; ok: boolean; detail: string; delivery?: "AUTOMATIC" | "MANUAL_REVIEW"; amountOut?: string; seconds?: number };

const engine = new SpakIn();
const client = new OneClickClient({ apiKey: process.env.ONECLICK_API_KEY, jwt: process.env.ONECLICK_JWT });
const resolver = new AssetResolver(client);
const trusted = trustedSendersFromEnv();
const wallets: Record<string, string> = Object.fromEntries(NETWORKS.filter((n) => OWN[n.family]).map((n) => [n.id, OWN[n.family]]));
/** "to <payee> on <network>" for destinations the user cannot hold a SPak wallet on; their own wallet otherwise. */
const to = (b: (typeof NETWORKS)[number]) => (OWN[b.family] ? "" : ` to ${PAYEE[b.family]} on ${b.name}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function audit(text: string, route: string): Promise<Row> {
  const r = await engine.interpret({ text, sessionId: `audit-${Math.random()}`, userId: "audit", wallets, mode: "MANUAL", now: new Date().toISOString() } as never);
  if (r.status !== "VALIDATED" || !r.plan) {
    const why = [...(r.errors ?? []).map((e) => e.message), ...(r.clarifications ?? []).map((c) => c.question)].join(" | ");
    return { route, text, stage: "PLAN", ok: false, detail: `${r.status}: ${why}` };
  }
  const leg = r.plan.legs[0] as unknown as { sourceNetwork: string; sourceAssetId: string; destinationNetwork: string; destinationAssetId: string; amount: { value: string }; recipient: string; refundAddress: string };
  let src, dst;
  try { src = await resolver.resolve(leg.sourceAssetId, leg.sourceNetwork); dst = await resolver.resolve(leg.destinationAssetId, leg.destinationNetwork); }
  catch (e) { return { route, text, stage: "RESOLVE", ok: false, detail: `${(e as { code?: string }).code ?? ""} ${(e as Error).message}` }; }
  const req = {
    dry: true, swapType: "EXACT_INPUT" as const, slippageTolerance: 100, originAsset: src.providerAssetId, depositType: "ORIGIN_CHAIN" as const, destinationAsset: dst.providerAssetId,
    amount: toBaseUnits(leg.amount.value, src.decimals), refundTo: leg.refundAddress, refundType: "ORIGIN_CHAIN" as const, recipient: leg.recipient, recipientType: "DESTINATION_CHAIN" as const,
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(), ...(src.providerChain === "stellar" ? { depositMode: "MEMO" as const } : {}),
  };
  let res;
  for (let attempt = 0; ; attempt++) {
    try { res = await client.quote(req as never); break; }
    catch (e) {
      const m = (e as Error).message;
      if (attempt < 2 && /429|rate|timeout|5\d\d/i.test(m)) { await sleep(2000 * (attempt + 1)); continue; }
      return { route, text, stage: "QUOTE", ok: false, detail: m.slice(0, 300) };
    }
  }
  const check = checkQuote(req as never, res, { sourceNetwork: src.network, now: new Date() });
  if (!verifyQuoteSignature(res, ONECLICK_QUOTE_PUBLIC_KEY)) check.problems.push("signature does not verify");
  const delivery = automaticDelivery(dst.network, dst.providerAssetId, trusted) ? "AUTOMATIC" as const : "MANUAL_REVIEW" as const;
  const out = `${(Number(res.quote.amountOut) / 10 ** dst.decimals).toPrecision(6)} ${dst.symbol}`;
  if (check.problems.length) return { route, text, stage: "CHECK", ok: false, detail: check.problems.join("; "), delivery, amountOut: out };
  return { route, text, stage: "OK", ok: true, detail: "", delivery, amountOut: out, seconds: res.quote.timeEstimate ?? undefined };
}

(async () => {
  const nets = NETWORKS;
  const rows: Row[] = [];
  for (const a of nets) for (const b of NETWORKS) {
    if (ONLY && !ONLY.includes(a.id) && !ONLY.includes(b.id)) continue;
    const usdcA = findAssets("USDC", a.id)[0], usdcB = findAssets("USDC", b.id)[0];
    const natA = findAssets(a.nativeSymbol, a.id)[0], natB = findAssets(b.nativeSymbol, b.id)[0];
    const cases: [string, string][] = [];
    if (a.id !== b.id && usdcA && usdcB) cases.push([`USDC ${a.id} -> USDC ${b.id}`, `Bridge 10 USDC from ${a.name} to ${b.name}${to(b)}`]);
    if (natA && usdcB) cases.push([`${a.nativeSymbol} ${a.id} -> USDC ${b.id}`, `Swap ${NATIVE_AMOUNT[a.nativeSymbol] ?? "1"} ${a.nativeSymbol} on ${a.name} to USDC on ${b.name}${to(b)}`]);
    const usdtB = findAssets("USDT", b.id)[0];
    if (usdcA && !usdcB && usdtB) cases.push([`USDC ${a.id} -> USDT ${b.id}`, `Swap 10 USDC on ${a.name} to USDT on ${b.name}${to(b)}`]);
    if (usdcA && natB) cases.push([`USDC ${a.id} -> ${b.nativeSymbol} ${b.id}`, `Swap 10 USDC on ${a.name} to ${b.nativeSymbol} on ${b.name}${to(b)}`]);
    for (const [route, text] of cases) {
      const row = await audit(text, route);
      rows.push(row);
      console.log(`${row.ok ? "OK  " : "FAIL"} ${route.padEnd(34)} ${row.ok ? `${row.amountOut} · ${row.delivery}` : `[${row.stage}] ${row.detail}`}`);
      await sleep(350);
    }
  }
  const failed = rows.filter((r) => !r.ok);
  const byStage = failed.reduce<Record<string, number>>((m, r) => ({ ...m, [r.stage]: (m[r.stage] ?? 0) + 1 }), {});
  console.log(`\n${rows.length - failed.length}/${rows.length} routes quote cleanly. Failures by stage: ${JSON.stringify(byStage)}. Automatic delivery check: ${rows.filter((r) => r.delivery === "AUTOMATIC").length}, manual review: ${rows.filter((r) => r.delivery === "MANUAL_REVIEW").length}.`);
  if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
})();
