/** 1Click keeps retired asset ids in /v0/tokens with "(DEPRECATED)" in the symbol; their quotes do not verify (2026-11-14). MOCKED provider. */
import { describe, expect, it } from "vitest";
import { AssetResolver } from "@/execution/asset-resolver";
import type { OneClickClient } from "@/integrations/near-intents/client";
import map from "@/integrations/near-intents/data/asset-map.json";

const ID = "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const provider = (map as { map: Record<string, string> }).map[ID];
const client = (symbol: string) => ({ tokens: async () => [{ assetId: provider, blockchain: "base", symbol, decimals: 6, contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }] }) as unknown as OneClickClient;

describe("retired provider assets", () => {
  it("a live listing resolves", async () => {
    expect((await new AssetResolver(client("USDC")).resolve(ID, "base")).providerAssetId).toBe(provider);
  });
  it("a listing marked deprecated is refused before any quote", async () => {
    await expect(new AssetResolver(client("USDC(DEPRECATED)")).resolve(ID, "base")).rejects.toMatchObject({ code: "UNSUPPORTED_ASSET" });
  });
  it("the registry holds no retired ids for networks that moved bridges", () => {
    for (const [k, v] of Object.entries((map as { map: Record<string, string> }).map)) {
      if (/^(polygon|bsc|avalanche):/.test(k)) expect(v, k).not.toMatch(/omni\.hot\.tg/);
    }
  });
});
