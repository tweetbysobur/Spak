import { isAddressFor } from "../spak-in/validator/address";
import { AuthError, type WalletFamily } from "./types";

/** Canonical stored form. EVM and NEAR are case-insensitive; Solana base58 is case-sensitive. */
export function normalizeAddress(family: WalletFamily, address: string): string {
  const a = address.trim();
  const ok = family === "evm" ? isAddressFor("evm", a) : family === "solana" ? isAddressFor("solana", a) : isAddressFor("near", a.toLowerCase());
  if (!ok) throw new AuthError("INVALID_ADDRESS", `Not a valid ${family} address.`);
  return family === "solana" ? a : a.toLowerCase();
}
