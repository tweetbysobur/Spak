/**
 * Mainnet V1 route scope. Pure and shared by the server (authoritative) and the UI (to hide what the server refuses).
 *
 * A route is allowed only when SPak can take the deposit through a validated wallet flow and can verify delivery
 * itself on the destination chain:
 * - Source: EVM networks and Solana. NEAR is off as a source in V1: its deposit is manual and was never validated
 *   with a real wallet and funds. Other families have no deposit flow.
 * - Destination: EVM, Solana and NEAR, the families with a delivery verifier (src/tracking/verifiers).
 * - EVM native coins (ETH, POL, BNB, AVAX, xDAI) are off as a destination: native value moved by an internal call
 *   cannot be seen without a trace RPC, so delivery could end UNVERIFIABLE. Tokens are verified from Transfer logs.
 */
import { getAsset } from "../spak-in/registries/assets";
import { getNetwork } from "../spak-in/registries/networks";

export const V1_SOURCE_FAMILIES: readonly string[] = ["evm", "solana"];
export const V1_DESTINATION_FAMILIES: readonly string[] = ["evm", "solana", "near"];

export type RouteProblem = { code: "V1_SOURCE_NOT_SUPPORTED" | "V1_DESTINATION_NOT_SUPPORTED" | "V1_NATIVE_DESTINATION_NOT_SUPPORTED"; message: string };

export function sourceProblem(network: string): RouteProblem | null {
  const n = getNetwork(network);
  if (n && V1_SOURCE_FAMILIES.includes(n.family)) return null;
  const name = n?.name ?? network;
  return {
    code: "V1_SOURCE_NOT_SUPPORTED",
    message: n?.family === "near"
      ? "Sending from NEAR is not available yet. You can send from an EVM network or Solana, and receive on NEAR."
      : `Sending from ${name} is not available yet. You can send from an EVM network or Solana.`,
  };
}

export function destinationProblem(network: string, assetId?: string | null): RouteProblem | null {
  const n = getNetwork(network);
  const name = n?.name ?? network;
  if (!n || !V1_DESTINATION_FAMILIES.includes(n.family)) {
    return { code: "V1_DESTINATION_NOT_SUPPORTED", message: `Delivery to ${name} is not available yet: SPak cannot verify delivery on ${name} itself, and it never reports a delivery it has not verified.` };
  }
  if (assetId && n.family === "evm") {
    const a = getAsset(assetId);
    if (a && !a.contract) return { code: "V1_NATIVE_DESTINATION_NOT_SUPPORTED", message: `Receiving ${a.symbol} (the native coin) on ${name} is not available yet: SPak cannot always verify native-coin delivery on EVM networks. Choose a token such as USDC or wrapped ${a.symbol} instead.` };
  }
  return null;
}

/** First problem with a route, or null when V1 supports it. */
export function routeProblem(r: { sourceNetwork: string; destinationNetwork: string; destinationAssetId?: string | null }): RouteProblem | null {
  return sourceProblem(r.sourceNetwork) ?? destinationProblem(r.destinationNetwork, r.destinationAssetId);
}
