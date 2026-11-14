"use client";
import { getWallets } from "@wallet-standard/app";
import { SolanaSignMessage, type SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import { base64 } from "@scure/base";

/** Solana wallets through the Wallet Standard (Phantom, Solflare, Backpack and others). */
type StdWallet = ReturnType<ReturnType<typeof getWallets>["get"]>[number];
export interface SolanaWalletInfo { id: string; name: string; icon?: string; wallet: StdWallet }

type StdAccount = { address: string; chains?: readonly string[]; features?: readonly string[] };
type ConnectFeature = { "standard:connect": { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly StdAccount[] }> } };

/**
 * Multi-chain wallets (for example ones that also hold NEAR or EVM accounts) can list a non-Solana account first.
 * Only an account on a Solana chain that can sign messages may be used; when an account declares no chains or
 * features, the wallet-level check in usable() applies.
 */
export const isSolanaSigner = (a: StdAccount) =>
  (!a.chains?.length || a.chains.some((c) => c.startsWith("solana:"))) && (!a.features?.length || a.features.includes(SolanaSignMessage));
type DisconnectFeature = { "standard:disconnect"?: { disconnect(): Promise<void> } };

const usable = (w: StdWallet) => w.chains.some((c) => c.startsWith("solana:")) && SolanaSignMessage in w.features && "standard:connect" in w.features;
const info = (w: StdWallet): SolanaWalletInfo => ({ id: w.name, name: w.name, icon: w.icon, wallet: w });

/** Current Solana wallets, updated when an extension registers late. */
export function watchSolanaWallets(onChange: (wallets: SolanaWalletInfo[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const api = getWallets();
  const emit = () => onChange(api.get().filter(usable).map(info));
  emit();
  const offRegister = api.on("register", emit);
  const offUnregister = api.on("unregister", emit);
  return () => { offRegister(); offUnregister(); };
}

/** Connect and return the account the wallet selected. pickAccount disconnects first so the wallet can offer a choice. */
export async function connectSolana(w: SolanaWalletInfo, opts: { pickAccount?: boolean } = {}): Promise<{ address: string }> {
  if (opts.pickAccount) await (w.wallet.features as unknown as DisconnectFeature)["standard:disconnect"]?.disconnect().catch(() => {});
  const { accounts } = await (w.wallet.features as unknown as ConnectFeature)["standard:connect"].connect();
  const all = [...accounts, ...(w.wallet.accounts as readonly StdAccount[])];
  if (!all.length) throw Object.assign(new Error("The wallet returned no account."), { code: "4100" });
  const acct = all.find(isSolanaSigner);
  if (!acct) throw Object.assign(new Error(`${w.name} has no Solana account that can sign. Add or select a Solana account in the wallet, then try again.`), { code: "NO_SOLANA_ACCOUNT" });
  return { address: acct.address };
}

/** solana:signMessage over the UTF-8 message. Returns the signature as base64. */
export async function signSolana(w: SolanaWalletInfo, address: string, message: string): Promise<string> {
  const account = w.wallet.accounts.find((a) => a.address === address);
  if (!account) {
    throw Object.assign(new Error("Your wallet switched accounts. Start again to sign in with the account now selected."), { code: "ACCOUNT_CHANGED" });
  }
  const feature = (w.wallet.features as unknown as SolanaSignMessageFeature)[SolanaSignMessage];
  const [out] = await feature.signMessage({ account, message: new TextEncoder().encode(message) });
  return base64.encode(out.signature);
}
