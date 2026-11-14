/** Multi-chain wallets can list a non-Solana account first; only a Solana account that can sign may be used. */
import { describe, expect, it } from "vitest";
import { isSolanaSigner } from "@/wallets/solana";
import { classifyWalletError } from "@/wallets/errors";

describe("Solana account selection", () => {
  it("skips NEAR and EVM accounts and accounts that cannot sign messages", () => {
    const accounts = [
      { address: "alice.near", chains: ["near:mainnet"], features: ["near:signMessage"] },
      { address: "0xabc", chains: ["eip155:1"], features: [] },
      { address: "SoLViewOnly111", chains: ["solana:mainnet"], features: ["solana:signTransaction"] },
      { address: "SoLSigner111", chains: ["solana:mainnet"], features: ["solana:signMessage", "solana:signTransaction"] },
    ];
    expect(accounts.find(isSolanaSigner)?.address).toBe("SoLSigner111");
  });
  it("an account that declares no chains or features is accepted (the wallet-level check applies)", () => {
    expect(isSolanaSigner({ address: "Plain111" })).toBe(true);
  });
  it("no usable Solana account: a clear message, not 'cannot sign sign-in messages'", () => {
    const r = classifyWalletError(Object.assign(new Error("Meteor Wallet has no Solana account that can sign. Add or select a Solana account in the wallet, then try again."), { code: "NO_SOLANA_ACCOUNT" }));
    expect(r.kind).toBe("NO_ACCOUNT");
    expect(r.message).toMatch(/no Solana account/);
  });
});
