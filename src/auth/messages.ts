import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";
import type { ChallengePurpose, WalletFamily } from "./types";

export interface ChallengeInput {
  family: WalletFamily;
  address: string;
  purpose: ChallengePurpose;
  domain: string;
  uri: string;
  nonce: string; // 64 hex chars (32 bytes)
  issuedAt: Date;
  expiresAt: Date;
  chainId?: number;
}

const statement = (p: ChallengePurpose) =>
  p === "SIGN_IN"
    ? "Sign in to SPak. This proves you own this wallet. It does not approve any transaction or cost gas."
    : "Link this wallet to your SPak account. This proves you own it. It does not approve any transaction or cost gas.";

/**
 * The exact text the wallet signs. The server stores it and verifies against the stored copy,
 * so a client can never substitute its own message.
 */
export function buildChallengeMessage(c: ChallengeInput): string {
  if (c.family === "evm") {
    // EIP-4361 (Sign-In with Ethereum). Address must be EIP-55 checksummed in the message.
    return createSiweMessage({
      domain: c.domain, address: toChecksum(c.address), statement: statement(c.purpose), uri: c.uri, version: "1",
      chainId: c.chainId ?? 1, nonce: c.nonce, issuedAt: c.issuedAt, expirationTime: c.expiresAt,
    });
  }
  // Solana and NEAR: same fields as EIP-4361, plain text (Sign-In With Solana layout).
  // A NEAR challenge may leave the account open: the wallet picks it and the server binds it at verification.
  return [
    `${c.domain} wants you to sign in with your ${c.family === "solana" ? "Solana" : "NEAR"} account:`,
    ...(c.address ? [c.address] : []),
    "",
    statement(c.purpose),
    "",
    `URI: ${c.uri}`,
    "Version: 1",
    `Nonce: ${c.nonce}`,
    `Issued At: ${c.issuedAt.toISOString()}`,
    `Expiration Time: ${c.expiresAt.toISOString()}`,
  ].join("\n");
}

function toChecksum(a: string): `0x${string}` {
  return getAddress(a);
}
