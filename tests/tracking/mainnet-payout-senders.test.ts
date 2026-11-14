/**
 * Trusted 1Click payout senders on mainnet Base and Arbitrum.
 *
 * Evidence is REAL and recorded unmodified (tests/tracking/fixtures/oneclick-mainnet-payouts.json): NEAR withdrawals from
 * intents.near resolved by the official NEAR Intents PoA bridge API to destination transactions, whose receipts were
 * read from public chain RPCs on 2026-11-14. No provider claim is trusted here: each sender is the ERC-20 Transfer
 * sender read from the chain, and each amount must equal the bridge's own withdrawal record.
 */
import { describe, expect, it } from "vitest";
import evidence from "./fixtures/oneclick-mainnet-payouts.json";
import type { ChainRpc } from "@/deposits/rpc";
import { verifyEvmDelivery } from "@/tracking/verifiers/evm";
import { bind } from "@/tracking/destination";
import { BUILTIN_TRUSTED_SENDERS, POA_BRIDGE_EVM_SENDER, trustedSendersFromEnv } from "@/tracking/route-trust";

const USDC = { arbitrum: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" } as const;

describe("mainnet payout sender evidence", () => {
  it("every sampled payout was sent by the PoA bridge sender, for the token and amount the bridge recorded", () => {
    expect(evidence.payouts.length).toBeGreaterThanOrEqual(19);
    for (const p of evidence.payouts) {
      expect(p.status).toBe("0x1");
      expect(p.transferFrom).toBe(POA_BRIDGE_EVM_SENDER);
      expect(p.txFrom).toBe(POA_BRIDGE_EVM_SENDER);
      expect(p.token).toBe(USDC[p.network as keyof typeof USDC]);
      expect(p.bridgeToken).toBe(p.token);
      expect(p.bridgeStatusChain).toBe(p.network === "arbitrum" ? "eth:42161" : "eth:8453");
      expect(BigInt(p.transferAmount)).toBe(BigInt(p.bridgeAmount));
    }
    expect(new Set(evidence.payouts.map((p) => p.network))).toEqual(new Set(["arbitrum", "base"]));
  });

  it("the built-in list trusts that sender only on Base and Arbitrum mainnet, never on testnet or other networks", () => {
    const t = trustedSendersFromEnv({}, "mainnet");
    expect(t("arbitrum")).toEqual([POA_BRIDGE_EVM_SENDER]);
    expect(t("base")).toEqual([POA_BRIDGE_EVM_SENDER]);
    for (const n of ["ethereum", "optimism", "polygon", "bsc", "avalanche", "gnosis", "solana"]) expect(t(n)).toEqual([]);
    expect(Object.values(BUILTIN_TRUSTED_SENDERS["tidepool-testnet"]).flat()).not.toContain(POA_BRIDGE_EVM_SENDER);
  });
});

describe("real Arbitrum mainnet payout through the real EVM verifier", () => {
  const rec = evidence.arbitrumFullRecord;
  const blockTime = parseInt(rec.block.timestamp, 16);
  const rpc: ChainRpc = {
    async call<T>(_n: string, method: string, params: unknown): Promise<T> {
      const p = params as string[];
      if (method === "eth_getTransactionByHash") return (p[0] === rec.tx.hash ? rec.tx : null) as T;
      if (method === "eth_getTransactionReceipt") return (p[0] === rec.tx.hash ? rec.receipt : null) as T;
      if (method === "eth_blockNumber") return `0x${(parseInt(rec.receipt.blockNumber, 16) + 1000).toString(16)}` as T;
      if (method === "eth_getBlockByNumber") return rec.block as T;
      throw new Error(`unexpected ${method}`);
    },
  };
  const expectation = { network: "arbitrum", txHash: rec.tx.hash, recipient: rec.recipient, kind: "TOKEN" as const, tokenContract: USDC.arbitrum, chainId: 42161 };

  it("binds with the built-in mainnet trust: CONFIRMED for a deposit before the payout", async () => {
    const r = await verifyEvmDelivery(rpc, expectation);
    expect(r).toMatchObject({ outcome: "CONFIRMED", received: "9000000000", transfers: [{ from: POA_BRIDGE_EVM_SENDER, amount: "9000000000" }] });
    const trusted = new Set(trustedSendersFromEnv({}, "mainnet")("arbitrum"));
    expect(bind(r, blockTime - 60, trusted, "arbitrum", "Arbitrum")).toEqual({ outcome: "CONFIRMED", counted: 9_000_000_000n, problems: [] });
  });

  it("the same real payout is rejected on a wrong chain id, before the deposit, or with no trust", async () => {
    expect(await verifyEvmDelivery(rpc, { ...expectation, chainId: 8453 })).toMatchObject({ outcome: "FAILED" });
    const r = await verifyEvmDelivery(rpc, expectation);
    expect(bind(r, blockTime + 1, new Set([POA_BRIDGE_EVM_SENDER]), "arbitrum", "Arbitrum")).toMatchObject({ outcome: "BEFORE_DEPOSIT", counted: 0n });
    expect(bind(r, blockTime - 60, new Set(), "arbitrum", "Arbitrum")).toMatchObject({ outcome: "UNTRUSTED_SENDER", counted: 0n });
  });
});
