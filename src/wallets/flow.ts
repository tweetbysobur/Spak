"use client";
import { api } from "@/lib/client";
import { connectEvm, signEvm, type EvmWalletInfo } from "./evm";
import { connectSolana, signSolana, type SolanaWalletInfo } from "./solana";
import { connectNear, signNear } from "./near";

export type Purpose = "SIGN_IN" | "LINK";
export type WalletChoice =
  | { family: "evm"; info: EvmWalletInfo }
  | { family: "solana"; info: SolanaWalletInfo }
  | { family: "near"; id: string };

interface Challenge { challengeId: string; message: string; nonce?: string; recipient?: string }

/**
 * Connect, get a one-time challenge, sign it in the wallet, send the signature for verification.
 * The wallet only signs a text message. No transaction, no gas, no keys leave the wallet.
 * Returns null when a NEAR browser wallet redirected away; the flow resumes on return.
 */
export async function connectAndVerify(choice: WalletChoice, purpose: Purpose): Promise<{ walletId: string } | null> {
  if (choice.family === "evm") {
    const { address, chainId } = await connectEvm(choice.info);
    const c = await api<Challenge>("/api/auth/challenge", { family: "evm", address, purpose, chainId });
    const signature = await signEvm(choice.info, address, c.message);
    return api("/api/auth/verify", { challengeId: c.challengeId, signature });
  }
  if (choice.family === "solana") {
    const { address } = await connectSolana(choice.info);
    const c = await api<Challenge>("/api/auth/challenge", { family: "solana", address, purpose });
    const signature = await signSolana(choice.info, address, c.message);
    return api("/api/auth/verify", { challengeId: c.challengeId, signature });
  }
  const { address } = await connectNear(choice.id);
  const c = await api<Challenge>("/api/auth/challenge", { family: "near", address, purpose });
  const s = await signNear(choice.id, { message: c.message, nonceB64: c.nonce!, recipient: c.recipient!, challengeId: c.challengeId });
  if (!s) return null;
  return api("/api/auth/verify", { challengeId: c.challengeId, signature: s.signature, publicKey: s.publicKey });
}
