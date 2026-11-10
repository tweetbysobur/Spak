import type { ChainRpc } from "@/deposits/rpc";
import type { DeliveryExpectation, DeliveryResult } from "../types";
import { verifyEvmDelivery } from "./evm";
import { verifySolanaDelivery } from "./solana";
import { verifyNearDelivery } from "./near";

export function verifyDelivery(rpc: ChainRpc, family: string, e: DeliveryExpectation): Promise<DeliveryResult> {
  if (family === "evm") return verifyEvmDelivery(rpc, e);
  if (family === "solana") return verifySolanaDelivery(rpc, e);
  if (family === "near") return verifyNearDelivery(rpc, e);
  return Promise.resolve({ outcome: "UNVERIFIABLE", received: "0", confirmations: null, problems: [`SPak cannot verify ${family} destinations yet`], observed: {} });
}
export { verifyEvmDelivery, verifySolanaDelivery, verifyNearDelivery };
