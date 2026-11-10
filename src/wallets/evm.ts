"use client";
import { toHex } from "viem";

/** EIP-1193 provider, discovered through EIP-6963 (multi-wallet discovery). */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
export interface EvmWalletInfo {
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193;
}

/** Wallets that announce themselves (MetaMask, Rabby, Coinbase Wallet, Brave and others). Falls back to window.ethereum. */
export function discoverEvmWallets(timeoutMs = 300): Promise<EvmWalletInfo[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve([]);
    const found = new Map<string, EvmWalletInfo>();
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<{ info: { uuid: string; name: string; icon?: string; rdns?: string }; provider: Eip1193 }>).detail;
      if (d?.info?.uuid && d.provider) found.set(d.info.uuid, { id: d.info.rdns ?? d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum;
      if (!found.size && legacy) found.set("injected", { id: "injected", name: "Browser wallet", provider: legacy });
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

export async function connectEvm(w: EvmWalletInfo): Promise<{ address: string; chainId: number }> {
  const accounts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.[0]) throw new Error("The wallet returned no account.");
  const chainHex = (await w.provider.request({ method: "eth_chainId" })) as string;
  return { address: accounts[0], chainId: Number.parseInt(chainHex, 16) || 1 };
}

/** EIP-191 personal_sign of the exact server message. Signing a message never sends a transaction. */
export async function signEvm(w: EvmWalletInfo, address: string, message: string): Promise<string> {
  return (await w.provider.request({ method: "personal_sign", params: [toHex(message), address] })) as string;
}
