import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64 } from "@scure/base";

/** Wallet Standard solana:signMessage returns raw ed25519 signature bytes over the UTF-8 message. Sent as base64. */
export function verifySolanaSignature(address: string, message: string, signatureB64: string): boolean {
  try {
    const pub = base58.decode(address);
    const sig = base64.decode(signatureB64);
    if (pub.length !== 32 || sig.length !== 64) return false;
    return ed25519.verify(sig, new TextEncoder().encode(message), pub);
  } catch {
    return false;
  }
}
