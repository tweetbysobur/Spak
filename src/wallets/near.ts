"use client";
import { Buffer } from "buffer";
import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { parseNearCallback, type NearCallback } from "./near-callback";

/**
 * NEAR wallets through NEAR Wallet Selector 10. Sign-in uses NEP-413 signMessage only.
 * We never call wallet.signIn(): for Meteor that would add an on-chain function-call key, and identity does not need one.
 * The wallet chooses the account while signing and returns it with the signature.
 */
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

const PENDING = "spak.near.pending";

/**
 * NEP-413 signMessage. Call it directly from a click handler: MyNearWallet and Meteor's web wallet open a
 * popup, and browsers block popups that do not follow a user gesture.
 * Returns null only if the wallet navigated away (redirect fallback); the result then arrives via the callback URL.
 */
export async function signNear(id: string, args: { message: string; nonceB64: string; recipient: string; challengeId: string }) {
  const wallet = await (await nearSelector()).wallet(id);
  if (!wallet.signMessage) throw Object.assign(new Error("This NEAR wallet cannot sign messages."), { code: "4200" });
  try { sessionStorage.setItem(PENDING, args.challengeId); } catch { /* storage blocked: redirect fallback cannot resume */ }
  try {
    const res = await wallet.signMessage({
      message: args.message, recipient: args.recipient, nonce: Buffer.from(args.nonceB64, "base64"),
      callbackUrl: window.location.href.split("#")[0], state: args.challengeId,
    });
    if (!res) return null;
    if (!res.signature || !res.publicKey || !res.accountId) throw new Error("The NEAR wallet returned an incomplete signature.");
    return { signature: res.signature, publicKey: res.publicKey, accountId: res.accountId };
  } finally {
    try { if (sessionStorage.getItem(PENDING) === args.challengeId) sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
  }
}

/**
 * Redirect fallback: a browser wallet that cannot use a popup sends the user back to callbackUrl with the
 * result in the URL hash. Only a callback for the challenge this tab started is accepted (login-CSRF guard),
 * and the URL is cleaned so a reload cannot resubmit it. The server still verifies everything.
 */
export function takeNearRedirectResult(): NearCallback | null {
  if (typeof window === "undefined") return null;
  let pending: string | null = null;
  try { pending = sessionStorage.getItem(PENDING); } catch { /* ignore */ }
  const r = parseNearCallback(window.location.hash, pending);
  if (r.kind !== "none") {
    try { sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return r.kind === "none" ? null : r;
}
