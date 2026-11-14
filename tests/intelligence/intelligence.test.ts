/**
 * SPak Intelligence. MOCKED chain RPC and prices (FakePrices); real SPak-in results from the real engine.
 * Live, read-only checks against mainnet are in tests/live/intelligence.live.test.ts.
 */
import { describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi } from "viem";
import { RpcAnswerError, RpcUnavailable, type ChainRpc } from "@/deposits/rpc";
import { PortfolioReader, type PortfolioWallet } from "@/intelligence/portfolio";
import { IntelligenceService } from "@/intelligence/service";
import { analyse, answerQuery, feasibility, sourceOptions, type Holding } from "@/intelligence/analysis";
import { PriceService } from "@/pricing/oracle";
import { OneClickClient } from "@/integrations/near-intents/client";
import { FakePrices } from "../pricing/fake-prices";
import assetMap from "@/integrations/near-intents/data/asset-map.json";
import { harness } from "../execution/harness";

const EVM = "0x1111111111111111111111111111111111111111";
const SOL = "So1aNaWaLLeT1111111111111111111111111111111";
const NEAR = "alice.near";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const USDC_NEAR = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const hex = (n: bigint) => `0x${n.toString(16)}`;
const out = (v: unknown) => ({ result: [...Buffer.from(JSON.stringify(v))] });

/** A chain with balances keyed by "network|owner|token" (token "native"). Anything missing is zero. */
function fakeChain(o: { balances: Record<string, bigint>; down?: string[]; brokenToken?: string } ): ChainRpc {
  return {
    async call<T>(network: string, method: string, params: unknown): Promise<T> {
      if (o.down?.includes(network)) throw new RpcUnavailable(network, "down (test)");
      const p = params as unknown[];
      if (method === "eth_getBalance") return hex(o.balances[`${network}|${(p[0] as string).toLowerCase()}|native`] ?? 0n) as T;
      if (method === "eth_call") {
        const { to, data } = p[0] as { to: string; data: string };
        if (to.toLowerCase() === o.brokenToken) throw new RpcAnswerError(-32000, "execution reverted");
        const owner = `0x${data.slice(-40)}`;
        expect(data.startsWith(encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [EVM] }).slice(0, 10))).toBe(true);
        return hex(o.balances[`${network}|${owner}|${to.toLowerCase()}`] ?? 0n) as T;
      }
      if (method === "query") {
        const q = params as { request_type: string; account_id: string; args_base64?: string };
        if (q.request_type === "view_account") {
          const b = o.balances[`${network}|${q.account_id}|native`];
          if (b === undefined) throw new RpcAnswerError("UNKNOWN_ACCOUNT", "account does not exist");
          return { amount: b.toString() } as T;
        }
        const who = JSON.parse(Buffer.from(q.args_base64!, "base64").toString()).account_id;
        return out((o.balances[`${network}|${who}|${q.account_id}`] ?? 0n).toString()) as T;
      }
      if (method === "getBalance") return { value: Number(o.balances[`${network}|${p[0]}|native`] ?? 0n) } as T;
      if (method === "getTokenAccountsByOwner") {
        const programId = (p[1] as { programId: string }).programId;
        if (!programId.startsWith("Tokenkeg")) return { value: [] } as T;
        const mints = Object.entries(o.balances).filter(([k]) => k.startsWith(`${network}|${p[0]}|`) && !k.endsWith("|native"));
        return { value: mints.map(([k, v]) => ({ account: { data: { parsed: { info: { mint: k.split("|")[2], tokenAmount: { amount: v.toString() } } } } } })) } as T;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}
const nets = (ids: string[]) => ids.map((id) => ({ id, enabled: true }));
const WALLETS: PortfolioWallet[] = [
  { id: "w_evm", family: "evm", address: EVM, label: null, networks: nets(["ethereum", "base", "arbitrum", "optimism"]) },
  { id: "w_near", family: "near", address: NEAR, label: null, networks: nets(["near"]) },
  { id: "w_sol", family: "solana", address: SOL, label: null, networks: nets(["solana"]) },
];
const BAL = {
  [`base|${EVM}|${USDC_BASE}`]: 30_500_000n, [`base|${EVM}|native`]: 2_000_000_000_000_000n,
  [`arbitrum|${EVM}|${USDC_ARB}`]: 12_000_000n,
  [`near|${NEAR}|native`]: 5n * 10n ** 24n, [`near|${NEAR}|${USDC_NEAR}`]: 7_250_000n,
  [`solana|${SOL}|native`]: 1_500_000_000n, [`solana|${SOL}|${USDC_SOL}`]: 4_000_000n,
};

describe("SPak Portfolio reader (MOCKED RPC)", () => {
  it("reads native and token balances across EVM, NEAR and Solana for several wallets, keeping wallet and network attribution", async () => {
    const r = await new PortfolioReader(fakeChain({ balances: BAL })).read(WALLETS);
    const got = r.holdings.map((h) => `${h.walletId}:${h.network}:${h.asset.symbol}:${h.units}`).sort();
    expect(got).toEqual([
      "w_evm:arbitrum:USDC:12000000", "w_evm:base:ETH:2000000000000000", "w_evm:base:USDC:30500000",
      "w_near:near:NEAR:5000000000000000000000000", "w_near:near:USDC:7250000",
      "w_sol:solana:SOL:1500000000", "w_sol:solana:USDC:4000000",
    ].sort());
    expect(r.reads.every((x) => x.status === "OK")).toBe(true);
    expect(r.reads.length).toBe(6);
  });
  it("an unreachable network is UNAVAILABLE and a failed token read is unknown, never zero", async () => {
    const r = await new PortfolioReader(fakeChain({ balances: BAL, down: ["arbitrum"], brokenToken: USDC_BASE })).read(WALLETS);
    expect(r.reads.find((x) => x.network === "arbitrum")).toMatchObject({ status: "UNAVAILABLE" });
    expect(r.reads.find((x) => x.network === "base")).toMatchObject({ status: "PARTIAL", unknownAssets: ["USDC"] });
    expect(r.holdings.some((h) => h.network === "arbitrum" || (h.network === "base" && h.asset.symbol === "USDC"))).toBe(false);
  });
  it("a NEAR account that does not exist yet reads as zero, not as an error", async () => {
    const r = await new PortfolioReader(fakeChain({ balances: {} })).read([{ id: "n", family: "near", address: "new.near", label: null, networks: nets(["near"]) }]);
    expect(r.reads[0].status).toBe("OK");
    expect(r.holdings).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ analysis (pure)
const H = (o: Partial<Holding> & Pick<Holding, "network" | "symbol" | "amount">): Holding => ({
  walletId: "w_evm", address: EVM, networkName: o.network, assetId: `${o.network}:x`, decimals: 6, native: false, units: String(Math.round(Number(o.amount) * 1e6)),
  usd: o.amount, priceSource: "CHAINLINK", priceNote: null, routable: true, ...o,
});
const readOk = (network: string, address = EVM) => ({ walletId: "w", address, network, status: "OK" as const, unknownAssets: [], error: null });

describe("SPak Intelligence analysis", () => {
  const holdings = [
    H({ network: "base", symbol: "USDC", amount: "30.5", assetId: `base:${USDC_BASE}` }),
    H({ network: "arbitrum", symbol: "USDC", amount: "12" }),
    H({ network: "base", symbol: "ETH", amount: "0.002", decimals: 18, units: "2000000000000000", native: true, usd: "4" }),
    H({ network: "near", symbol: "AURORA", amount: "10", usd: null, priceSource: null, priceNote: "no source" }),
  ];
  const s = analyse({ holdings, reads: ["base", "arbitrum", "near"].map((n) => readOk(n)), wallets: [{ id: "w_evm", family: "evm", address: EVM, label: null }], readAt: new Date("2026-11-14T00:00:00Z") });

  it("totals only priced holdings, exactly, and counts the unpriced ones", () => {
    expect(s.totals).toEqual({ usd: "46.5", priced: 3, unpriced: 1 });
  });
  it("network and asset distribution with shares of the priced total", () => {
    expect(s.byNetwork.map((n) => [n.network, n.usd, n.share])).toEqual([["base", "34.5", 74.19], ["arbitrum", "12", 25.8]]);
    expect(s.byAsset[0]).toMatchObject({ symbol: "USDC", usd: "42.5", share: 91.39 });
    expect(s.byAsset[0].networks).toEqual([{ network: "base", amount: "30.5" }, { network: "arbitrum", amount: "12" }]);
  });
  it("factual insights, each said once: largest exposure (with concentration), network share, spread, unpriced", () => {
    const k = s.insights.map((i) => i.kind);
    expect(k).toEqual(expect.arrayContaining(["LARGEST_EXPOSURE", "NETWORK_CONCENTRATION", "SPREAD_ACROSS_NETWORKS", "UNPRICED"]));
    expect(s.insights.find((i) => i.kind === "LARGEST_EXPOSURE")!.text).toBe("Your largest exposure is USDC: $42.50, 91.39% of your priced holdings, more than half in one asset.");
    expect(s.insights.find((i) => i.kind === "SPREAD_ACROSS_NETWORKS")!.text).toBe("Your USDC is spread across 2 networks: 30.5 on Base, 12 on Arbitrum.");
  });
  it("flags tokens held without gas on that network", () => {
    const t = analyse({ holdings: [H({ network: "arbitrum", symbol: "USDC", amount: "12" })], reads: [readOk("arbitrum")], wallets: [], readAt: new Date() });
    expect(t.insights.find((i) => i.kind === "NO_GAS")!.text).toMatch(/no ETH/);
  });
  it("answers portfolio questions from real holdings, filtered by asset and network", () => {
    expect(answerQuery(s, { assets: ["USDC"], networks: [] })).toMatchObject({ usd: "42.5", lines: ["30.5 USDC on base ($30.50)", "12 USDC on arbitrum ($12.00)"] });
    expect(answerQuery(s, { assets: [], networks: ["near"] }).lines).toEqual(["10 AURORA on near (no verified price)"]);
    expect(answerQuery(s, { assets: ["SOL"], networks: [] }).text).toBe("SPak found no SOL in your connected wallets.");
  });
  it("feasibility: enough, not enough, unknown, and the whole native balance", () => {
    const leg = { sourceNetwork: "base", sourceAssetId: `base:${USDC_BASE}`, refundAddress: EVM, symbol: "USDC", decimals: 6 };
    expect(feasibility(s, { ...leg, amount: "20" })).toMatchObject({ status: "OK", available: "30.5" });
    expect(feasibility(s, { ...leg, amount: "50" })).toMatchObject({ status: "INSUFFICIENT", available: "30.5" });
    expect(feasibility({ ...s, reads: [] }, { ...leg, amount: "1" }).status).toBe("UNKNOWN");
    expect(feasibility(s, { sourceNetwork: "base", sourceAssetId: "base:x", refundAddress: EVM, symbol: "ETH", decimals: 18, amount: "0.002" }).notes[0]).toMatch(/whole ETH balance/);
  });
  it("source options list every network holding the asset; instructions only where the amount fits", () => {
    const o = sourceOptions(s, { symbol: "USDC", amount: "20", destinationNetwork: "near" });
    expect(o.map((x) => [x.network, x.enough, x.instruction])).toEqual([["base", true, "Move 20 USDC from base to NEAR"], ["arbitrum", false, null]]);
  });
});

// ------------------------------------------------------------------------------- with real SPak-in results (engine)
describe("SPak Intelligence context on real SPak-in results", () => {
  async function setup() {
    const h = await harness();
    const u = await h.newUser();
    const prices = new FakePrices(() => new Date(h.clock.now));
    const wallets = await u.wallets();
    const evm = wallets.find((w) => w.family === "evm")!.address.toLowerCase();
    const nearAddr = wallets.find((w) => w.family === "near")!.address;
    const balances = { [`base|${evm}|${USDC_BASE}`]: 30_500_000n, [`base|${evm}|native`]: 10n ** 16n, [`arbitrum|${evm}|${USDC_ARB}`]: 12_000_000n, [`near|${nearAddr}|native`]: 10n ** 24n };
    // The live NEAR Intents token list, as 1Click returns it (ids from SPak's own asset map), with listed prices.
    const map = (assetMap as { map: Record<string, string> }).map;
    const listed = [[`base:${USDC_BASE}`, "base", "USDC", 6, 1], [`arbitrum:${USDC_ARB}`, "arb", "USDC", 6, 1], [`near:${USDC_NEAR}`, "near", "USDC", 6, 1], ["near:wrap.near", "near", "wNEAR", 24, 3]]
      .map(([id, chain, symbol, decimals, price]) => ({ assetId: map[id as string], blockchain: chain, symbol, decimals, price }));
    const client = new OneClickClient({ fetchImpl: (async () => new Response(JSON.stringify(listed), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch });
    const intel = new IntelligenceService({ reader: new PortfolioReader(fakeChain({ balances })), prices: new PriceService(prices, () => new Date(h.clock.now)), client, quotePublicKey: null, clock: () => new Date(h.clock.now) });
    const pw: PortfolioWallet[] = wallets.map((w, i) => ({ id: `w${i}`, family: w.family, address: w.address, label: null, networks: w.networks }));
    const snap = (await intel.snapshot(u.userId, pw)).snapshot;
    return { u, intel, snap };
  }
  it("'How much USDC do I have?' is answered with real balances across networks", async () => {
    const { u, intel, snap } = await setup();
    const c = intel.context(await u.plan("How much USDC do I have?"), snap, false);
    expect(c).toMatchObject({ kind: "PORTFOLIO_ANSWER", usd: "42.5" });
    expect((c as { lines: string[] }).lines).toEqual(["30.5 USDC on Base ($30.50)", "12 USDC on Arbitrum ($12.00)"]);
  });
  it("'Move 20 USDC from Base to NEAR' is fundable; 'Move 50 ...' is not, before any quote", async () => {
    const { u, intel, snap } = await setup();
    expect(intel.context(await u.plan("Move 20 USDC from Base to NEAR"), snap, false)).toMatchObject({ kind: "FEASIBILITY", status: "OK", available: "30.5" });
    expect(intel.context(await u.plan("Move 50 USDC from Base to NEAR"), snap, false)).toMatchObject({ kind: "FEASIBILITY", status: "INSUFFICIENT", available: "30.5" });
  });
  it("'Can I move 100 USDC to Arbitrum?' lists real holdings and offers none that cannot fund it", async () => {
    const { u, intel, snap } = await setup();
    const c = intel.context(await u.plan("Can I move 100 USDC to Arbitrum?"), snap, false) as { kind: string; options: { enough: boolean; instruction: string | null }[] };
    expect(c.kind).toBe("SOURCE_OPTIONS");
    expect(c.options).toEqual([expect.objectContaining({ enough: false, instruction: null })]);
  });
  it("'Move my USDC holdings to NEAR' asks first and shows where the USDC is (no amount assumed)", async () => {
    const { u, intel, snap } = await setup();
    const r = await u.plan("Move my USDC holdings to NEAR");
    expect(r.status).toBe("NEEDS_CLARIFICATION");
    const c = intel.context(r, snap, false) as { kind: string; options: { text: string; instruction: string | null }[] };
    expect(c.kind).toBe("SOURCE_OPTIONS");
    expect(c.options.map((o) => o.text)).toEqual(["30.5 USDC on Base", "12 USDC on Arbitrum"]);
    expect(c.options.every((o) => o.instruction === null)).toBe(true);
  });
  it("'Move all my USDC on Base to NEAR' becomes an exact amount for the user to confirm, never executed from here", async () => {
    const { u, intel, snap } = await setup();
    const r = await u.plan("Move all my USDC on Base to NEAR");
    expect(r.plan?.executable).toBe(false);
    const c = intel.context(r, snap, false) as { kind: string; options: { instruction: string | null }[] };
    expect(c.options.map((o) => o.instruction)).toEqual(["Move 30.5 USDC from Base to NEAR"]);
    const confirmed = await u.plan(c.options[0].instruction!);
    expect(confirmed.plan?.executable).toBe(true);
  });
  it("snapshots are cached for a minute and refresh on request", async () => {
    const { u, intel } = await setup();
    const pw: PortfolioWallet[] = (await u.wallets()).map((w, i) => ({ id: `w${i}`, family: w.family, address: w.address, label: null, networks: w.networks }));
    expect((await intel.snapshot(u.userId, pw)).cached).toBe(true);
    expect((await intel.snapshot(u.userId, pw, { refresh: true })).cached).toBe(false);
  });
});
