/**
 * Builds SPak's TESTNET asset registry from Tidepool's live token list (GET /v0/tokens). Test tokens only.
 * Nothing is typed in by hand: ids, decimals and contracts come from the endpoint. Mainnet files are never touched.
 *
 *   npm run registry:sync:testnet
 *
 * Writes:
 *   src/spak-in/registries/data/testnet-assets.json                 testnet registry used by SPak-in in the testnet build
 *   src/integrations/near-intents/data/tidepool-asset-map.json      SPak testnet asset id -> Tidepool assetId
 */
import { writeFileSync } from "node:fs";
import { TESTNET_TO_TIDEPOOL } from "../src/integrations/near-intents/networks";

interface Token { assetId: string; decimals: number; blockchain: string; symbol: string; contractAddress?: string }
const URL_ = (process.env.SPAK_TIDEPOOL_API_URL ?? "https://www.usetidepool.tech").replace(/\/$/, "");
if (/chaindefuser|1click/i.test(URL_)) throw new Error("SPAK_TIDEPOOL_API_URL points at mainnet 1Click. Refusing.");
const TO_SPAK: Record<string, string> = Object.fromEntries(Object.entries(TESTNET_TO_TIDEPOOL).map(([k, v]) => [v, k]));

async function main() {
  const res = await fetch(`${URL_}/v0/tokens`);
  if (!res.ok) throw new Error(`Tidepool /v0/tokens returned ${res.status}`);
  const tokens = (await res.json()) as Token[];
  const assets: { id: string; network: string; symbol: string; decimals: number; contract: string | null }[] = [];
  const map: Record<string, string> = {};
  for (const t of tokens) {
    const network = TO_SPAK[t.blockchain];
    if (!network) continue;
    // Tidepool's ids end in .testnet; anything else would be a mainnet id and is refused.
    if (!/\.testnet$/.test(t.assetId)) throw new Error(`Tidepool token ${t.assetId} is not a testnet id.`);
    const contract = t.contractAddress ? t.contractAddress.toLowerCase() : null;
    if (contract && !/^0x[0-9a-f]{40}$/.test(contract)) throw new Error(`Unexpected EVM contract ${t.contractAddress}.`);
    const id = `${network}:${contract ?? "native"}`;
    if (map[id]) continue;
    map[id] = t.assetId;
    assets.push({ id, network, symbol: t.symbol, decimals: t.decimals, contract });
  }
  assets.sort((a, b) => a.id.localeCompare(b.id));
  const meta = { source: `${URL_}/v0/tokens`, fetchedAt: new Date().toISOString(), count: assets.length, environment: "tidepool-testnet", note: "Test tokens with no value." };
  writeFileSync("src/spak-in/registries/data/testnet-assets.json", JSON.stringify({ meta, assets }, null, 1) + "\n");
  writeFileSync("src/integrations/near-intents/data/tidepool-asset-map.json", JSON.stringify({ meta, map }, null, 1) + "\n");
  console.log(`Wrote ${assets.length} testnet assets from ${tokens.length} Tidepool tokens.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
