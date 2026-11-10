import type { ChainRpc } from "../rpc";
import type { DepositExpectation, VerificationResult } from "../types";
import { verifyEvmDeposit } from "./evm";
import { verifyNearDeposit } from "./near";
import { verifySolanaDeposit } from "./solana";

export function verifyDeposit(rpc: ChainRpc, family: "evm" | "solana" | "near", e: DepositExpectation): Promise<VerificationResult> {
  return family === "evm" ? verifyEvmDeposit(rpc, e) : family === "solana" ? verifySolanaDeposit(rpc, e) : verifyNearDeposit(rpc, e);
}
export { verifyEvmDeposit, verifySolanaDeposit, verifyNearDeposit };
