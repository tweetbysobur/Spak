"use client";
import { Buffer } from "buffer";
import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";

/** NEAR wallets through NEAR Wallet Selector. Messages are signed with NEP-413 signMessage. */
let selector: Promise<WalletSelector> | undefined;
export function nearSelector(): Promise<WalletSelector> {
  selector ??= setupWalletSelector({ network: "mainnet", modules: [setupMeteorWallet(), setupMyNearWallet()] });
  return selector;
}

export interface NearWalletInfo { id: string; name: string; icon?: string; available: boolean }

export async function discoverNearWallets(): Promise<NearWalletInfo[]> {
  const s = await nearSelector();
  return s.store.getState().modules.map((m) => ({ id: m.id, name: m.metadata.name, icon: m.metadata.iconUrl, available: m.metadata.available }));
}

/** Get the NEAR account id. Browser wallets (MyNearWallet) may redirect here and back. */
export async function connectNear(id: string): Promise<{ address: string }> {
  const wallet = await (await nearSelector()).wallet(id);
  let accounts = await wallet.getAccounts();
  // No contractId: sign in for identity only. No function-call access key is requested.
  if (!accounts.length) accounts = (await (wallet.signIn as (p: { contractId?: string }) => Promise<typeof accounts>)({})) ?? [];
  if (!accounts[0]) throw new Error("The NEAR wallet returned no account.");
  return { address: accounts[0].accountId };
}

const PENDING = "spak.near.pending";

/**
 * NEP-413 signMessage. Injected wallets return the result. Browser wallets redirect to the wallet and back
 * with the result in the URL hash; the pending challenge is kept in sessionStorage for that case.
 */
export async function signNear(id: string, args: { message: string; nonceB64: string; recipient: string; challengeId: string }) {
  const wallet = await (await nearSelector()).wallet(id);
  if (!wallet.signMessage) throw new Error("This NEAR wallet cannot sign messages.");
  try { sessionStorage.setItem(PENDING, args.challengeId); } catch { /* storage blocked: redirect wallets will not resume */ }
  const res = await wallet.signMessage({
    message: args.message, recipient: args.recipient, nonce: Buffer.from(args.nonceB64, "base64"),
    callbackUrl: window.location.href.split("#")[0], state: args.challengeId,
  });
  if (!res) return null; // redirected
  try { sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
  return { signature: res.signature, publicKey: res.publicKey, accountId: res.accountId };
}

/** After a redirect back from a browser wallet: read the NEP-413 result from the URL hash. */
export function takeNearRedirectResult(): { challengeId: string; signature: string; publicKey: string } | null {
  if (typeof window === "undefined" || !window.location.hash.includes("signature=")) return null;
  const p = new URLSearchParams(window.location.hash.slice(1));
  let pending: string | null = null;
  try { pending = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
  history.replaceState(null, "", window.location.pathname + window.location.search);
  const challengeId = p.get("state") ?? pending;
  // URLSearchParams turns "+" into a space; base64 signatures contain "+".
  const signature = p.get("signature")?.replace(/ /g, "+") ?? null, publicKey = p.get("publicKey");
  return challengeId && signature && publicKey && challengeId === pending ? { challengeId, signature, publicKey } : null;
}
