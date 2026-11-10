"use client";
import { api } from "@/lib/client";
import { connectEvm, signEvm, type EvmWalletInfo } from "./evm";
import { connectSolana, signSolana, type SolanaWalletInfo } from "./solana";
import { signNear } from "./near";

export type Purpose = "SIGN_IN" | "LINK";
export type WalletChoice =
  | { family: "evm"; info: EvmWalletInfo }
  | { family: "solana"; info: SolanaWalletInfo }
  | { family: "near"; id: string; name: string };

interface Challenge { challengeId: string; message: string; expiresAt: string; nonce?: string; recipient?: string }

/** A challenge issued for one wallet, waiting for its signature. */
export interface Prepared {
  choice: WalletChoice;
  purpose: Purpose;
  challenge: Challenge;
  /** EVM and Solana: the address the challenge names. NEAR: chosen by the wallet while signing. */
  address: string | null;
}

/** Leave a margin so a signature never reaches the server just after expiry. */
const EXPIRY_MARGIN_MS = 10_000;

/**
 * Step 1: connect (EVM, Solana) and get a one-time challenge. NEAR needs no connection step:
 * NEP-413 signMessage lets the wallet choose the account.
 */
export async function prepare(choice: WalletChoice, purpose: Purpose, opts: { pickAccount?: boolean } = {}): Promise<Prepared> {
  if (choice.family === "evm") {
    const { address, chainId } = await connectEvm(choice.info, opts);
    const challenge = await api<Challenge>("/api/auth/challenge", { family: "evm", address, purpose, chainId });
    return { choice, purpose, challenge, address };
  }
  if (choice.family === "solana") {
    const { address } = await connectSolana(choice.info, opts);
    const challenge = await api<Challenge>("/api/auth/challenge", { family: "solana", address, purpose });
    return { choice, purpose, challenge, address };
  }
  const challenge = await api<Challenge>("/api/auth/challenge", { family: "near", purpose });
  return { choice, purpose, challenge, address: null };
}

/**
 * Step 2: sign the exact server message in the wallet and send the result for verification.
 * For NEAR call this straight from a click handler so the wallet popup is allowed to open.
 * Returns null when a NEAR wallet navigated away; the result then arrives on the callback URL.
 */
export async function complete(p: Prepared): Promise<{ walletId: string } | null> {
  if (Date.parse(p.challenge.expiresAt) - Date.now() < EXPIRY_MARGIN_MS) {
    throw Object.assign(new Error("The sign-in request expired."), { code: "CHALLENGE_EXPIRED" });
  }
  const { challengeId, message } = p.challenge;
  if (p.choice.family === "evm") {
    const signature = await signEvm(p.choice.info, p.address!, message);
    return api("/api/auth/verify", { challengeId, signature });
  }
  if (p.choice.family === "solana") {
    const signature = await signSolana(p.choice.info, p.address!, message);
    return api("/api/auth/verify", { challengeId, signature });
  }
  const s = await signNear(p.choice.id, { message, nonceB64: p.challenge.nonce!, recipient: p.challenge.recipient!, challengeId });
  if (!s) return null;
  return api("/api/auth/verify", { challengeId, signature: s.signature, publicKey: s.publicKey, accountId: s.accountId });
}

/** Extension wallets (EVM, Solana) open their own prompt, so both steps can run from one click. */
export const needsSecondClick = (c: WalletChoice) => c.family === "near";
