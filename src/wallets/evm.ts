"use client";
import { toHex } from "viem";

/** EIP-1193 provider, discovered through EIP-6963 (multi-wallet discovery). */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
}
export interface EvmWalletInfo {
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193;
}

/**
 * Watch for wallets that announce themselves (MetaMask, Rabby, Coinbase Wallet, Brave and others).
 * Extensions can announce late, so the listener stays on until stop() is called.
 * window.ethereum is used only when nothing announces.
 */
export function watchEvmWallets(onChange: (wallets: EvmWalletInfo[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const found = new Map<string, EvmWalletInfo>();
  const emit = () => onChange([...found.values()]);
  const onAnnounce = (e: Event) => {
    const d = (e as CustomEvent<{ info: { uuid: string; name: string; icon?: string; rdns?: string }; provider: Eip1193 }>).detail;
    if (!d?.info?.uuid || !d.provider) return;
    found.delete("injected");
    found.set(d.info.uuid, { id: d.info.rdns ?? d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider });
    emit();
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const legacy = setTimeout(() => {
    const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!found.size && eth) { found.set("injected", { id: "injected", name: "Browser wallet", provider: eth }); emit(); }
  }, 500);
  return () => { window.removeEventListener("eip6963:announceProvider", onAnnounce); clearTimeout(legacy); };
}

/**
 * Ask the wallet for an account. With pickAccount, the wallet shows its account chooser
 * (wallet_requestPermissions) instead of reusing the account the site already saw.
 */
export async function connectEvm(w: EvmWalletInfo, opts: { pickAccount?: boolean } = {}): Promise<{ address: string; chainId: number }> {
  if (opts.pickAccount) {
    await w.provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  }
  const accounts = (await w.provider.request({ method: opts.pickAccount ? "eth_accounts" : "eth_requestAccounts" })) as string[];
  if (!accounts?.[0]) throw Object.assign(new Error("The wallet returned no account."), { code: "4100" });
  const chainHex = (await w.provider.request({ method: "eth_chainId" })) as string;
  return { address: accounts[0], chainId: Number.parseInt(chainHex, 16) || 1 };
}

/**
 * EIP-191 personal_sign of the exact server message. Signing a message never sends a transaction.
 * If the wallet switched accounts after the challenge was issued, stop: the signature would not match.
 */
export async function signEvm(w: EvmWalletInfo, address: string, message: string): Promise<string> {
  const now = ((await w.provider.request({ method: "eth_accounts" })) as string[] | undefined)?.[0];
  if (now && now.toLowerCase() !== address.toLowerCase()) {
    throw Object.assign(new Error(`Your wallet switched to ${now.slice(0, 6)}…${now.slice(-4)}. Start again to sign in with that account.`), { code: "ACCOUNT_CHANGED" });
  }
  return (await w.provider.request({ method: "personal_sign", params: [toHex(message), address] })) as string;
}
