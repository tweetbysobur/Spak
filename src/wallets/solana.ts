"use client";
import { getWallets } from "@wallet-standard/app";
import { SolanaSignMessage, type SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import { base64 } from "@scure/base";

/** Solana wallets through the Wallet Standard (Phantom, Solflare, Backpack and others). */
type StdWallet = ReturnType<ReturnType<typeof getWallets>["get"]>[number];
export interface SolanaWalletInfo { id: string; name: string; icon?: string; wallet: StdWallet }

type ConnectFeature = { "standard:connect": { connect(): Promise<{ accounts: readonly { address: string }[] }> } };

export function discoverSolanaWallets(): SolanaWalletInfo[] {
  if (typeof window === "undefined") return [];
  return getWallets().get()
    .filter((w) => w.chains.some((c) => c.startsWith("solana:")) && SolanaSignMessage in w.features && "standard:connect" in w.features)
    .map((w) => ({ id: w.name, name: w.name, icon: w.icon, wallet: w }));
}

export async function connectSolana(w: SolanaWalletInfo): Promise<{ address: string }> {
  const { accounts } = await (w.wallet.features as unknown as ConnectFeature)["standard:connect"].connect();
  const acct = accounts[0] ?? w.wallet.accounts[0];
  if (!acct) throw new Error("The wallet returned no account.");
  return { address: acct.address };
}

/** solana:signMessage over the UTF-8 message. Returns the signature as base64. */
export async function signSolana(w: SolanaWalletInfo, address: string, message: string): Promise<string> {
  const account = w.wallet.accounts.find((a) => a.address === address);
  if (!account) throw new Error("That account is no longer connected in the wallet.");
  const feature = (w.wallet.features as unknown as SolanaSignMessageFeature)[SolanaSignMessage];
  const [out] = await feature.signMessage({ account, message: new TextEncoder().encode(message) });
  return base64.encode(out.signature);
}
