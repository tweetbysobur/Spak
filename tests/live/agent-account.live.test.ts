/**
 * LIVE NEAR testnet: creates a real dedicated Agent account. Runs only with LIVE=1 and a complete testnet config:
 * SPAK_AGENT_NEAR_NETWORK=testnet, SPAK_AGENT_PARENT_ACCOUNT, SPAK_AGENT_PARENT_PRIVATE_KEY, SPAK_AGENT_INITIAL_BALANCE_YOCTO,
 * SPAK_AGENT_SPONSOR_BUDGET_YOCTO. Testnet tokens only. The owner key is generated here and its secret never leaves the test.
 */
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { agentAccountConfig, nearTestnetChain } from "@/agents/near-chain";

const cfg = agentAccountConfig();
const ready = !("unavailable" in cfg);

describe.skipIf(!ready)("NEAR testnet: dedicated Agent account (live)", () => {
  it("creates name.parent.testnet with only the owner key, then reads it back from NEAR", async () => {
    if ("unavailable" in cfg) return;
    const chain = nearTestnetChain(cfg, process.env.SPAK_AGENT_PARENT_PRIVATE_KEY!);
    expect(await chain.chainId()).toBe("testnet");
    const ownerPk = `ed25519:${base58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()))}`;
    const name = `alive${Date.now().toString(16)}.${cfg.parentAccountId}`;
    expect(await chain.viewAccount(name)).toBeNull();
    const out = await chain.createSubAccount({ newAccountId: name, ownerPublicKey: ownerPk, amountYocto: cfg.initialBalanceYocto });
    expect(out.outcome).toBe("SUCCESS");
    const keys = await chain.accessKeys(name);
    expect(keys).toEqual([{ publicKey: ownerPk, permission: "FullAccess" }]);
    expect(keys.some((k) => k.publicKey === chain.parentPublicKey())).toBe(false);
  }, 60_000);
});
