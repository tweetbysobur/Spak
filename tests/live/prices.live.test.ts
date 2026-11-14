/** LIVE (LIVE=1): reads the real Chainlink feeds on Ethereum mainnet and CoinGecko through the production reader. Read-only. */
import { describe, expect, it } from "vitest";
import { CHAINLINK_FEEDS } from "@/pricing/feeds";
import { httpPriceReader, PriceService } from "@/pricing/oracle";

describe("live independent prices", () => {
  it.each(Object.values(CHAINLINK_FEEDS).map((f) => [f.description, f] as const))("Chainlink %s: identity verified, positive, within its heartbeat", async (_d, f) => {
    const r = await httpPriceReader().chainlink(f);
    expect(r.answer > 0n).toBe(true);
    expect(Math.floor(Date.now() / 1000) - r.updatedAt).toBeLessThan(f.maxAgeSec);
    console.log(`${f.description} ${Number(r.answer) / 10 ** r.decimals} updated ${new Date(r.updatedAt * 1000).toISOString()} round ${r.roundId}`);
  }, 30_000);
  it("values 0.002 ETH and 50 USDC end to end", async () => {
    const s = new PriceService(httpPriceReader());
    const eth = await s.value({ symbol: "ETH", decimals: 18, amountUnits: "2000000000000000", providerUsd: null });
    const usdc = await s.value({ symbol: "USDC", decimals: 6, amountUnits: "50000000", providerUsd: null });
    console.log("0.002 ETH", eth.status, eth.usd, "| 50 USDC", usdc.status, usdc.usd);
    expect(eth.status).toBe("OK");
    expect(usdc.status).toBe("OK");
  }, 30_000);
});
