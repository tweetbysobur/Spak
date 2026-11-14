/**
 * The isolated Tidepool testnet environment: registry, provider mapping, RPCs and configuration checks. Each test
 * loads the modules fresh with the build-time flag set, the way a separate testnet build would.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function testnet() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SPAK_NETWORK_ENV", "tidepool-testnet");
  return {
    env: await import("@/environment"),
    nets: await import("@/spak-in/registries/networks"),
    assets: await import("@/spak-in/registries/assets"),
    map: (await import("@/integrations/near-intents/data/tidepool-asset-map.json")).default as { map: Record<string, string> },
    mapping: await import("@/integrations/near-intents/networks"),
    rpc: await import("@/deposits/rpc"),
    explorers: await import("@/tracking/explorers"),
    provider: await import("@/integrations/near-intents/provider"),
  };
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("environment flag", () => {
  it("defaults to mainnet, accepts tidepool-testnet, refuses anything else", async () => {
    const { parseNetworkEnv } = await import("@/environment");
    expect(parseNetworkEnv(undefined)).toBe("mainnet");
    expect(parseNetworkEnv("tidepool-testnet")).toBe("tidepool-testnet");
    expect(() => parseNetworkEnv("testnet")).toThrow();
    expect(() => parseNetworkEnv("Tidepool")).toThrow();
  });
});

describe("testnet build: separate registry, no mainnet ids", () => {
  it("networks are only the four EVM testnets, with their public chain ids", async () => {
    const t = await testnet();
    expect(t.env.IS_TESTNET).toBe(true);
    expect(t.nets.listNetworks().map((n) => `${n.id}:${n.chainId}`)).toEqual(["base-sepolia:84532", "arbitrum-sepolia:421614", "ethereum-sepolia:11155111", "bsc-testnet:97"]);
    for (const id of ["base", "arbitrum", "ethereum", "solana", "near"]) expect(t.nets.getNetwork(id)).toBeUndefined();
    expect(t.nets.lookupNetworkAlias("base")).toBe("base-sepolia");
    expect(t.nets.lookupUnsupportedNetwork("solana")).toMatch(/not in SPak's testnet environment/);
  });
  it("assets come from Tidepool's token list; every id is a testnet id and maps to a .testnet provider id", async () => {
    const t = await testnet();
    const all = t.assets.listAssets();
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(t.assets.ASSET_REGISTRY_META.source).toMatch(/usetidepool\.tech\/v0\/tokens$/);
    for (const a of all) {
      expect(t.nets.getNetwork(a.network)?.testnet).toBe(true);
      expect(t.map.map[a.id]).toMatch(/\.testnet$/);
    }
    expect(t.assets.findAssets("USDC", "base-sepolia")).toEqual([{ id: "base-sepolia:0x38d81431b9f76d9699af7517040d5221d9dea252", network: "base-sepolia", symbol: "USDC", decimals: 6, contract: "0x38d81431b9f76d9699af7517040d5221d9dea252" }]);
    expect(t.assets.findAssets("ETH", "base-sepolia")[0]).toMatchObject({ id: "base-sepolia:native", decimals: 18, contract: null });
  });
  it("provider mapping, RPCs and explorers are testnet only", async () => {
    const t = await testnet();
    expect(t.mapping.SPAK_TO_ONECLICK).toEqual({ "base-sepolia": "base", "arbitrum-sepolia": "arb", "ethereum-sepolia": "eth", "bsc-testnet": "bsc" });
    expect(t.rpc.endpointsFor("base")).toEqual([]);
    expect(t.rpc.endpointsFor("base-sepolia")[0]).toBe("https://sepolia.base.org");
    expect(t.explorers.txExplorerUrl("base-sepolia", "0xab")).toBe("https://sepolia.basescan.org/tx/0xab");
    expect(t.explorers.txExplorerUrl("base", "0xab")).toBeNull();
  });
  it("mainnet build: the testnet registry is not visible", async () => {
    vi.resetModules();
    const nets = await import("@/spak-in/registries/networks");
    expect(nets.getNetwork("base")?.chainId).toBe("8453");
    expect(nets.getNetwork("base-sepolia")).toBeUndefined();
    const assets = await import("@/spak-in/registries/assets");
    expect(assets.listAssets().some((a) => a.network.includes("sepolia"))).toBe(false);
  });
});

describe("provider configuration: strict separation, no fallback", () => {
  const T = { SPAK_EXECUTION_ENV: "tidepool-testnet", SPAK_TIDEPOOL_API_URL: "https://www.usetidepool.tech" };
  it("testnet: Tidepool with the maker key enforced", async () => {
    const { providerConfig } = await testnet().then((t) => t.provider);
    expect(providerConfig(T, "tidepool-testnet")).toMatchObject({ kind: "TIDEPOOL_TESTNET", baseUrl: "https://www.usetidepool.tech", quotePublicKey: "ed25519:U1Mu4u1nHnHmgABpCkfDGXt2FZj8k29UGqhkMAu4iWY" });
  });
  it.each([
    ["no SPAK_EXECUTION_ENV", { SPAK_TIDEPOOL_API_URL: T.SPAK_TIDEPOOL_API_URL }],
    ["no Tidepool URL", { SPAK_EXECUTION_ENV: "tidepool-testnet" }],
    ["1Click URL as Tidepool", { ...T, SPAK_TIDEPOOL_API_URL: "https://1click.chaindefuser.com" }],
    ["unknown host", { ...T, SPAK_TIDEPOOL_API_URL: "https://example.com" }],
    ["plain http", { ...T, SPAK_TIDEPOOL_API_URL: "http://www.usetidepool.tech" }],
    ["1Click URL also set", { ...T, ONECLICK_API_URL: "https://1click.chaindefuser.com" }],
    ["1Click key also set", { ...T, ONECLICK_API_KEY: "k" }],
    ["bad maker key", { ...T, SPAK_TIDEPOOL_QUOTE_PUBLIC_KEY: "nope" }],
  ])("testnet refuses: %s", async (_n, env) => {
    const { providerConfig } = (await testnet()).provider;
    expect(() => providerConfig(env as Record<string, string>, "tidepool-testnet")).toThrow();
  });
  it.each([
    ["Tidepool URL as 1Click", { ONECLICK_API_URL: "https://www.usetidepool.tech" }],
    ["Tidepool variable present", { SPAK_TIDEPOOL_API_URL: "https://www.usetidepool.tech" }],
    ["testnet execution env", { SPAK_EXECUTION_ENV: "tidepool-testnet" }],
  ])("mainnet refuses: %s", async (_n, env) => {
    vi.resetModules();
    const { providerConfig } = await import("@/integrations/near-intents/provider");
    expect(() => providerConfig(env as Record<string, string>, "mainnet")).toThrow();
  });
  it("mainnet default is unchanged: 1Click, signature check off unless opted in", async () => {
    vi.resetModules();
    const { providerConfig } = await import("@/integrations/near-intents/provider");
    expect(providerConfig({}, "mainnet")).toMatchObject({ kind: "ONECLICK_MAINNET", baseUrl: "https://1click.chaindefuser.com", quotePublicKey: null });
    expect(providerConfig({ SPAK_ONECLICK_VERIFY_SIGNATURES: "1" }, "mainnet").quotePublicKey).toMatch(/^ed25519:/);
  });
});

describe("database environment marker", () => {
  it("the first server claims an empty database; the other environment is refused; a testnet build never claims a populated one", async () => {
    vi.resetModules();
    const { freshDb } = await import("../auth/db");
    const { assertDatabaseEnvironment } = await import("@/database/environment");
    const { users } = await import("@/database/schema");
    const a = await freshDb();
    await assertDatabaseEnvironment(a, "tidepool-testnet");
    await assertDatabaseEnvironment(a, "tidepool-testnet");
    await expect(assertDatabaseEnvironment(a, "mainnet")).rejects.toThrow(/belongs to the "tidepool-testnet"/);
    const b = await freshDb();
    await b.insert(users).values({ id: "usr_existing", createdAt: new Date() } as typeof users.$inferInsert);
    await expect(assertDatabaseEnvironment(b, "tidepool-testnet")).rejects.toThrow(/already has users/);
    await assertDatabaseEnvironment(b, "mainnet");
  });
});
