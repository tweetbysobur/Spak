import { verifyMessage, type Hex } from "viem";

/**
 * EOA signature check (EIP-191 personal_sign over the stored EIP-4361 message).
 * Smart-contract wallets (ERC-1271) need an RPC call and are not supported yet.
 */
export async function verifyEvmSignature(address: string, message: string, signature: string): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return false;
  try {
    return await verifyMessage({ address: address as Hex, message, signature: signature as Hex });
  } catch {
    return false;
  }
}
