/**
 * Read-only preflight for SPak's NEAR testnet parent account (the sponsor that creates dedicated Agent accounts).
 *
 *   SPAK_AGENT_NEAR_NETWORK=testnet SPAK_AGENT_PARENT_ACCOUNT=<parent>.testnet SPAK_AGENT_PARENT_PRIVATE_KEY=... \
 *   SPAK_AGENT_INITIAL_BALANCE=0.1 SPAK_AGENT_SPONSORSHIP_BUDGET=1 SPAK_AGENT_MAX_SPONSORED_ACCOUNTS=5 \
 *   npx tsx scripts/agent-parent-preflight.ts
 *
 * Checks, from NEAR testnet itself: the configuration is complete and testnet-only, the chain id is "testnet", the
 * parent account exists, the configured key is a full-access key on it, and its spendable balance covers at least one
 * sponsored account. It creates nothing, signs nothing and moves nothing. It prints only public data: the account, the
 * PUBLIC key, balances and the verdict. Run it where the parent key already lives (the server environment), never paste
 * the key into a chat or a file in the repository.
 */
import { agentAccountConfig, nearTestnetChain } from "../src/agents/near-chain";
import { requiredForOne, spendable } from "../src/agents/accounts";

(async () => {
  const cfg = agentAccountConfig();
  if ("unavailable" in cfg) { console.log(JSON.stringify({ ready: false, reason: cfg.unavailable })); process.exit(2); }
  const chain = nearTestnetChain(cfg, process.env.SPAK_AGENT_PARENT_PRIVATE_KEY!);
  const out: Record<string, unknown> = { network: cfg.network, rpc: cfg.rpcUrl, parent: cfg.parentAccountId, parentPublicKey: chain.parentPublicKey() };
  try {
    out.chainId = await chain.chainId();
    const acct = await chain.viewAccount(cfg.parentAccountId);
    out.exists = !!acct;
    const keys = acct ? await chain.accessKeys(cfg.parentAccountId) : [];
    out.keyIsFullAccess = keys.some((k) => k.publicKey === chain.parentPublicKey() && k.permission === "FullAccess");
    out.spendableYocto = acct ? spendable(acct).toString() : "0";
    out.requiredForOneYocto = requiredForOne(cfg);
    out.ready = out.chainId === "testnet" && out.exists === true && out.keyIsFullAccess === true && BigInt(out.spendableYocto as string) >= BigInt(out.requiredForOneYocto as string);
  } catch (e) { out.ready = false; out.error = (e as Error).message.replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/g, "[redacted]"); }
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.ready ? 0 : 1);
})();
