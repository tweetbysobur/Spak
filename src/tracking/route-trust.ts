import { NETWORK_ENV, type SpakNetworkEnv } from "../environment";
import { getNetwork } from "../spak-in/registries/networks";

/**
 * Trusted route evidence for destination verification: which on-chain senders may deliver a provider payout on each
 * destination network. A destination transfer counts toward an execution only when its sender is listed here for
 * that network (and it happened after the source deposit; see DestinationVerifier).
 *
 * An empty list is a deliberate answer: SPak cannot bind a payout to the route on that network, so delivery goes to
 * manual review instead of COMPLETED. Nothing is inferred from the provider's own claims.
 *
 * Provenance of the built-in entries:
 * - NEAR mainnet: NEAR Intents withdrawals are receipts whose predecessor is the official intents.near contract
 *   (docs.near-intents.org; the same rule SPak already used to locate NEAR destination transactions).
 * - Tidepool testnet (community-run sandbox, not affiliated with NEAR or 1Click): the ERC-20 Transfer sender of every
 *   payout is Tidepool's bridge vault on that chain, as published by GET https://www.usetidepool.tech/v0/health
 *   (bridges.chains.<chain>.vault), read 2026-11-14 and matched by the real Arbitrum Sepolia payout of execution
 *   exe_adf513ec746688a2cddd7019 (tests/tracking/fixtures/tidepool-settlement-receipts.json).
 * - Base and Arbitrum mainnet: 1Click pays out PoA tokens (*.omft.near) through the official NEAR Intents PoA bridge.
 *   The bridge's own API (bridge.chaindefuser.com/rpc, withdrawal_status) links each NEAR withdrawal from intents.near
 *   to its destination transaction. 29 of 29 sampled payouts on 2026-11-14 (19 USDC: 12 Arbitrum, 7 Base; 10 native
 *   ETH: 5 Arbitrum, 5 Base) were sent by 0x2cff890f0378a11913b6129b2e97417a2c302680, with amounts equal to the bridge's records
 *   (tests/tracking/fixtures/oneclick-mainnet-payouts.json; re-derived by tests/live/payout-senders.live.test.ts).
 *   Payouts through any other bridge (for example *.omdep.near tokens) have no evidence and go to manual review.
 * - Other EVM networks and Solana on mainnet: no evidence collected. None is assumed. Operators may add addresses
 *   through SPAK_TRUSTED_DESTINATION_SENDERS only from the same kind of evidence.
 */
export const POA_BRIDGE_EVM_SENDER = "0x2cff890f0378a11913b6129b2e97417a2c302680";

export const BUILTIN_TRUSTED_SENDERS: Readonly<Record<SpakNetworkEnv, Readonly<Record<string, readonly string[]>>>> = {
  mainnet: { near: ["intents.near"], base: [POA_BRIDGE_EVM_SENDER], arbitrum: [POA_BRIDGE_EVM_SENDER] },
  "tidepool-testnet": {
    "base-sepolia": ["0x2e6ad9e6d59bb4585ea0e6762c3b637dde29dad2"],
    "arbitrum-sepolia": ["0x2e6ad9e6d59bb4585ea0e6762c3b637dde29dad2"],
    "ethereum-sepolia": ["0xc387e121e0af273d83c20b1d286c12f5c3294f38"],
    "bsc-testnet": ["0x2e6ad9e6d59bb4585ea0e6762c3b637dde29dad2"],
  },
};

export type TrustedSenders = (network: string) => readonly string[];

/** Canonical form for comparison: EVM addresses are case-insensitive; everything else is exact. */
export function canonicalSender(network: string, address: string): string {
  return getNetwork(network)?.family === "evm" ? address.toLowerCase() : address;
}

/**
 * Built-in entries plus SPAK_TRUSTED_DESTINATION_SENDERS (JSON: {"<network id>": ["<address>", ...]}). Only networks
 * of this build's environment are accepted, so a testnet address can never be trusted on mainnet or the reverse.
 * Malformed configuration throws at startup rather than being ignored.
 */
export function trustedSendersFromEnv(env: Record<string, string | undefined> = process.env, network: SpakNetworkEnv = NETWORK_ENV): TrustedSenders {
  const merged = new Map<string, Set<string>>();
  const add = (net: string, addr: string) => {
    const n = getNetwork(net);
    if (!n) throw new Error(`SPAK_TRUSTED_DESTINATION_SENDERS names ${net}, which is not a network of the ${network} build.`);
    if (n.family === "evm" && !/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error(`Trusted sender ${addr} on ${net} is not an EVM address.`);
    if (!addr || addr.length > 128) throw new Error(`Trusted sender on ${net} is malformed.`);
    if (!merged.has(net)) merged.set(net, new Set());
    merged.get(net)!.add(canonicalSender(net, addr));
  };
  for (const [net, list] of Object.entries(BUILTIN_TRUSTED_SENDERS[network])) {
    if (!getNetwork(net)) continue; // a built-in network outside this build's registry is simply not reachable
    for (const a of list) add(net, a);
  }
  const raw = env.SPAK_TRUSTED_DESTINATION_SENDERS;
  if (raw) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error("SPAK_TRUSTED_DESTINATION_SENDERS is not valid JSON."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("SPAK_TRUSTED_DESTINATION_SENDERS must be an object of network to address list.");
    for (const [net, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) throw new Error(`SPAK_TRUSTED_DESTINATION_SENDERS.${net} must be a list.`);
      for (const a of list) add(net, String(a));
    }
  }
  return (net) => [...(merged.get(net) ?? [])];
}
