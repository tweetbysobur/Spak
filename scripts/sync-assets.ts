/**
 * Builds the SPak asset registry from the NEAR Intents 1Click token list.
 * Contract addresses come from the provider's published list. Nothing is typed in by hand.
 *
 *   npm run registry:sync
 *
 * Writes:
 *   src/spak-in/registries/data/assets.json            provider-neutral registry used by SPak-in
 *   src/integrations/near-intents/data/asset-map.json   SPak asset id -> NEAR Intents assetId
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { MAINNET_TO_ONECLICK } from "../src/integrations/near-intents/networks";

/** Always the mainnet mapping, whatever environment the shell is in. The testnet registry has its own script. */
const ONECLICK_TO_SPAK: Record<string, string> = Object.fromEntries(Object.entries(MAINNET_TO_ONECLICK).map(([k, v]) => [v, k]));

interface OneClickToken { assetId: string; decimals: number; blockchain: string; symbol: string; contractAddress?: string }

const URL_ = process.env.ONECLICK_API_URL ?? "https://1click.chaindefuser.com";
if (/tidepool/i.test(URL_)) throw new Error("ONECLICK_API_URL points at Tidepool. Use npm run registry:sync:testnet for the testnet registry.");

async function main() {
  const res = await fetch(`${URL_}/v0/tokens`);
  if (!res.ok) throw new Error(`1Click /v0/tokens returned ${res.status}`);
  const tokens = (await res.json()) as OneClickToken[];
  const assets: unknown[] = [];
  const map: Record<string, string> = {};
  for (const t of tokens) {
    const network = ONECLICK_TO_SPAK[t.blockchain];
    if (!network) continue;
    const contract = t.contractAddress ? (/^0x[0-9a-fA-F]{40}$/.test(t.contractAddress) ? t.contractAddress.toLowerCase() : t.contractAddress) : null;
    const id = `${network}:${contract ?? "native"}`;
    if (map[id]) continue; // keep first; duplicates of the exact same id are provider aliases
    map[id] = t.assetId;
    assets.push({ id, network, symbol: t.symbol, decimals: t.decimals, contract });
  }
  assets.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const meta = { source: `${URL_}/v0/tokens`, fetchedAt: new Date().toISOString(), count: assets.length };
  writeFileSync("src/spak-in/registries/data/assets.json", JSON.stringify({ meta, assets }, null, 1) + "\n");
  mkdirSync("src/integrations/near-intents/data", { recursive: true });
  writeFileSync("src/integrations/near-intents/data/asset-map.json", JSON.stringify({ meta, map }, null, 1) + "\n");
  console.log(`Wrote ${assets.length} assets from ${tokens.length} provider tokens.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
