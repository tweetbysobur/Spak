/**
 * Read-only readiness check for SPak's testnet Agent infrastructure. Sends no transaction and prints no secret.
 *   npx tsx scripts/agent-testnet-check.ts
 * Reads the same server environment variables the app uses (see docs/SPAK-TESTNET-SETUP.md).
 */
import { agentAccountConfig, nearTestnetChain } from "../src/agents/near-chain";
import { CREATION_BURN_YOCTO, GAS_MARGIN_YOCTO, requiredForOne, spendable } from "../src/agents/accounts";

const near = (y: string) => `${(Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(6)} NEAR`;
async function main() {
  const cfg = agentAccountConfig();
  if ("unavailable" in cfg) { console.log(`NOT CONFIGURED: ${cfg.unavailable}`); process.exit(2); }
  const chain = nearTestnetChain(cfg, process.env.SPAK_AGENT_PARENT_PRIVATE_KEY!);
  console.log(`RPC: ${cfg.rpcUrl}`);
  const id = await chain.chainId();
  console.log(`Chain id: ${id}`);
  if (id !== "testnet") { console.log("UNAVAILABLE: not testnet"); process.exit(1); }
  const parent = await chain.viewAccount(cfg.parentAccountId);
  console.log(`Parent ${cfg.parentAccountId}: ${parent ? "exists" : "NOT FOUND"}`);
  if (!parent) process.exit(1);
  const keys = await chain.accessKeys(cfg.parentAccountId);
  const pk = chain.parentPublicKey();
  console.log(`Configured key ${pk}: ${keys.some((k) => k.publicKey === pk && k.permission === "FullAccess") ? "full access on parent" : "NOT a full-access key on parent"}`);
  console.log(`Spendable: ${near(spendable(parent))}; needed per account: ${near(requiredForOne(cfg))} (initial ${near(cfg.initialBalanceYocto)} + creation ${near(CREATION_BURN_YOCTO)} + gas margin ${near(GAS_MARGIN_YOCTO)})`);
  console.log(`Budget ${near(cfg.budgetYocto)}, max accounts ${cfg.maxSponsoredAccounts}, recheck ${cfg.recheck.enabled ? `every ${cfg.recheck.intervalHours} h` : "off"}`);
}
main().catch((e) => { console.error("FAILED:", (e as Error).message); process.exit(1); });
