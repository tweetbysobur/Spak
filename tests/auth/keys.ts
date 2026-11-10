/** Real key material for tests. Every signature in the auth tests is produced by these keys. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64, hex } from "@scure/base";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { nep413Hash } from "@/auth/verify/near";

export function evmWallet() {
  const acct = privateKeyToAccount(generatePrivateKey());
  return { family: "evm" as const, address: acct.address, sign: async (message: string) => ({ signature: await acct.signMessage({ message }) }) };
}

export function solanaWallet() {
  const sk = ed25519.utils.randomSecretKey();
  const pk = ed25519.getPublicKey(sk);
  return {
    family: "solana" as const, address: base58.encode(pk),
    sign: async (message: string) => ({ signature: base64.encode(ed25519.sign(new TextEncoder().encode(message), sk)) }),
  };
}

/** NEP-413 signer. Implicit account (id = hex public key) unless accountId is given. */
export function nearWallet(accountId?: string) {
  const sk = ed25519.utils.randomSecretKey();
  const pk = ed25519.getPublicKey(sk);
  const publicKey = `ed25519:${base58.encode(pk)}`;
  return {
    family: "near" as const, address: accountId ?? hex.encode(pk), publicKey,
    sign: async (message: string, nonceHex: string, recipient: string) => ({
      signature: base64.encode(ed25519.sign(nep413Hash(message, hex.decode(nonceHex), recipient), sk)), publicKey,
    }),
  };
}
