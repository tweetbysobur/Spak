/**
 * LIVE NEAR testnet: dedicated account key rotation. Runs only with LIVE=1 and the complete testnet config (see
 * docs/SPAK-TESTNET-SETUP.md). The test plays the USER: it generates the owner key locally, the parent creates the
 * account with that key, and then the test (as the user's wallet) signs one transaction on the dedicated account:
 * AddKey(new, FullAccess) + DeleteKey(old). SPak's parent key never signs the rotation. Testnet tokens only.
 */
import { describe, expect, it } from "vitest";
import { agentAccountConfig, nearTestnetChain } from "@/agents/near-chain";

const cfg = agentAccountConfig();
const ready = !("unavailable" in cfg);

describe.skipIf(!ready)("NEAR testnet: dedicated account key rotation (live)", () => {
  it("rotates to a new key in one owner-signed transaction; NEAR then shows only the new key", async () => {
    if ("unavailable" in cfg) return;
    const n = await import("near-api-js");
    const { PublicKey } = await import("@near-js/crypto");
    const chain = nearTestnetChain(cfg, process.env.SPAK_AGENT_PARENT_PRIVATE_KEY!);
    expect(await chain.chainId()).toBe("testnet");
    const owner = n.KeyPair.fromRandom("ed25519"), next = n.KeyPair.fromRandom("ed25519");
    const name = `arot${Date.now().toString(16)}.${cfg.parentAccountId}`;
    const created = await chain.createSubAccount({ newAccountId: name, ownerPublicKey: owner.getPublicKey().toString(), amountYocto: cfg.initialBalanceYocto });
    console.log("[live] create", name, created.outcome, created.txHash);
    expect(created.outcome).toBe("SUCCESS");
    expect(await chain.accessKeys(name)).toEqual([{ publicKey: owner.getPublicKey().toString(), permission: "FullAccess" }]);
    const acct = new n.Account(name, new n.providers.JsonRpcProvider({ url: cfg.rpcUrl }), n.KeyPairSigner.fromSecretKey(owner.toString() as `ed25519:${string}`));
    const out = await acct.signAndSendTransaction({
      receiverId: name,
      actions: [n.transactions.addKey(PublicKey.from(next.getPublicKey().toString()), n.transactions.fullAccessKey()), n.transactions.deleteKey(PublicKey.from(owner.getPublicKey().toString()))],
      waitUntil: "FINAL", throwOnFailure: false,
    });
    console.log("[live] rotate", out.transaction_outcome?.id);
    expect(await chain.accessKeys(name)).toEqual([{ publicKey: next.getPublicKey().toString(), permission: "FullAccess" }]);
  }, 120_000);
});
