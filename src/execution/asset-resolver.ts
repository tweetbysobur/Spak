import mainnetMap from "../integrations/near-intents/data/asset-map.json";
import testnetMap from "../integrations/near-intents/data/tidepool-asset-map.json";
import { IS_TESTNET } from "../environment";
import { SPAK_TO_ONECLICK } from "../integrations/near-intents/networks";
import type { OneClickClient, OneClickToken } from "../integrations/near-intents/client";
import { getAsset, type AssetDefinition } from "../spak-in/registries/assets";
import { getNetwork } from "../spak-in/registries/networks";
import { ExecutionError } from "./errors";

/** SPak asset id to provider asset id, for this build's environment only. A testnet id has no mainnet entry and vice versa. */
const ASSET_MAP = ((IS_TESTNET ? testnetMap : mainnetMap) as { map: Record<string, string> }).map;
export const TOKEN_CACHE_MS = 5 * 60_000;

export interface ResolvedAsset {
  /** SPak canonical id, "<network>:<contract|native>". */
  id: string;
  network: string;
  /** NEAR Intents asset id, e.g. "nep141:base-0x8335….omft.near". */
  providerAssetId: string;
  providerChain: string;
  decimals: number;
  contract: string | null;
  symbol: string;
}

/**
 * Asset and Network Resolver. Turns SPak asset ids into NEAR Intents asset ids and checks them against the
 * provider's live token list. Matching is by asset id, chain, decimals and contract; never by symbol.
 */
export class AssetResolver {
  private cache: { at: number; byId: Map<string, OneClickToken> } | null = null;

  constructor(private readonly client: OneClickClient, private readonly clock: () => Date = () => new Date()) {}

  private async liveTokens(force = false): Promise<Map<string, OneClickToken>> {
    const now = this.clock().getTime();
    if (!force && this.cache && now - this.cache.at < TOKEN_CACHE_MS) return this.cache.byId;
    const list = await this.client.tokens();
    this.cache = { at: now, byId: new Map(list.map((t) => [t.assetId, t])) };
    return this.cache.byId;
  }

  async resolve(spakAssetId: string, expectedNetwork: string): Promise<ResolvedAsset> {
    const network = getNetwork(expectedNetwork);
    const providerChain = SPAK_TO_ONECLICK[expectedNetwork];
    if (!network || !providerChain) throw new ExecutionError("UNSUPPORTED_NETWORK", `Network ${expectedNetwork} is not supported for execution.`);
    const asset: AssetDefinition | undefined = getAsset(spakAssetId);
    if (!asset) throw new ExecutionError("UNSUPPORTED_ASSET", `Unknown asset ${spakAssetId}.`);
    if (asset.network !== expectedNetwork) throw new ExecutionError("UNSUPPORTED_ASSET", `${spakAssetId} is not on ${expectedNetwork}.`);
    const providerAssetId = ASSET_MAP[spakAssetId];
    if (!providerAssetId) throw new ExecutionError("UNSUPPORTED_ASSET", `${spakAssetId} has no NEAR Intents route.`);

    // A miss in a cached list is re-checked against a fresh list before refusing.
    const live = (await this.liveTokens()).get(providerAssetId) ?? (await this.liveTokens(true)).get(providerAssetId);
    if (!live) throw new ExecutionError("UNSUPPORTED_ASSET", `NEAR Intents no longer lists ${asset.symbol} on ${network.name} (${providerAssetId}).`);
    const problems: string[] = [];
    if (live.blockchain !== providerChain) problems.push(`chain ${live.blockchain} != ${providerChain}`);
    if (live.decimals !== asset.decimals) problems.push(`decimals ${live.decimals} != ${asset.decimals}`);
    if (asset.contract && live.contractAddress && live.contractAddress.toLowerCase() !== asset.contract.toLowerCase()) problems.push("contract differs");
    if (!asset.contract && live.contractAddress) problems.push("registry says native, provider lists a contract");
    if (problems.length) {
      throw new ExecutionError("ASSET_MISMATCH", `The NEAR Intents listing for ${spakAssetId} no longer matches SPak's registry (${problems.join("; ")}). Execution refused.`, { providerAssetId });
    }
    return { id: asset.id, network: asset.network, providerAssetId, providerChain, decimals: asset.decimals, contract: asset.contract, symbol: asset.symbol };
  }
}
