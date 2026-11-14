/**
 * LIVE (LIVE=1), read-only. SPak Intelligence on real mainnet data: public addresses read through SPak's RPC client,
 * valued with SPak's independent prices (Chainlink, CoinGecko with 1Click agreement), routes from real dry quotes.
 * The addresses are public bridge and user accounts; nothing is signed, sent or created.
 */
import { describe, expect, it } from "vitest";
import { httpChainRpc } from "@/deposits/rpc";
import { oneClickFromEnv } from "@/integrations/near-intents/client";
import { ONECLICK_QUOTE_PUBLIC_KEY } from "@/integrations/near-intents/signature";
import { httpPriceReader, PriceService } from "@/pricing/oracle";
import { PortfolioReader, EXECUTABLE_NETWORKS } from "@/intelligence/portfolio";
import { IntelligenceService } from "@/intelligence/service";

const EVM = "0x2cff890f0378a11913b6129b2e97417a2c302680";
const NEAR = "x3lang.near";
const SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const evmNets = EXECUTABLE_NETWORKS.filter((n) => n !== "near" && n !== "solana").map((id) => ({ id, enabled: true }));

describe("live SPak Intelligence", () => {
  it("reads, values and analyses three real wallets across all 10 networks", async () => {
    const intel = new IntelligenceService({ reader: new PortfolioReader(httpChainRpc()), prices: new PriceService(httpPriceReader()), client: oneClickFromEnv(), quotePublicKey: ONECLICK_QUOTE_PUBLIC_KEY });
    const t0 = Date.now();
    const { snapshot: s } = await intel.snapshot("live", [
      { id: "evm", family: "evm", address: EVM, label: "PoA bridge (public)", networks: evmNets },
      { id: "near", family: "near", address: NEAR, label: null, networks: [{ id: "near", enabled: true }] },
      { id: "sol", family: "solana", address: SOL, label: null, networks: [{ id: "solana", enabled: true }] },
    ]);
    console.log("read in", Date.now() - t0, "ms");
    console.log("reads", JSON.stringify(s.reads.map((r) => `${r.network}:${r.status}${r.unknownAssets.length ? `(${r.unknownAssets.join(",")})` : ""}`)));
    console.log("totals", JSON.stringify(s.totals), "byNetwork", JSON.stringify(s.byNetwork.map((n) => [n.network, n.usd, n.share])));
    console.log("top holdings", JSON.stringify(s.holdings.sort((a, b) => Number(b.usd ?? 0) - Number(a.usd ?? 0)).slice(0, 12).map((h) => `${h.amount} ${h.symbol}@${h.network}=${h.usd ?? "unpriced"}(${h.priceSource ?? h.priceNote})`)));
    console.log("insights", JSON.stringify(s.insights.map((i) => i.text)));
    expect(s.reads.filter((r) => r.status === "UNAVAILABLE").length).toBeLessThanOrEqual(2);
    expect(s.holdings.length).toBeGreaterThan(0);
    expect(Number(s.totals.usd)).toBeGreaterThan(0);
    for (const h of s.holdings) if (h.usd !== null) expect(["CHAINLINK", "COINGECKO"]).toContain(h.priceSource);

    const routes = await intel.routes({ assetId: "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "25", refundAddress: EVM, recipients: Object.fromEntries([...evmNets.map((n) => [n.id, EVM]), ["near", NEAR], ["solana", SOL]]) });
    console.log("routes", JSON.stringify(routes.map((r) => `${r.destinationNetwork}:${r.status}:${r.amountOut ?? r.detail}:${r.feePct}%:${r.delivery}`)));
    expect(routes.filter((r) => r.status === "QUOTED").length).toBeGreaterThanOrEqual(5);
  }, 300_000);
});
