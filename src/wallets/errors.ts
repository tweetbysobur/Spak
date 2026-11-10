/**
 * Turn wallet and API errors into one of a few outcomes the UI can act on.
 * Pure: no browser APIs, so it is unit tested.
 */
export type WalletErrorKind = "CANCELLED" | "PENDING" | "POPUP_BLOCKED" | "EXPIRED" | "ACCOUNT_CHANGED" | "NO_ACCOUNT" | "UNSUPPORTED" | "OWNED_ELSEWHERE" | "REPLAYED"
  | "WRONG_ACCOUNT" | "WRONG_NETWORK" | "INSUFFICIENT_BALANCE" | "DUPLICATE" | "QUOTE_EXPIRED" | "DEPOSIT_EXPIRED" | "UNSUPPORTED_TOKEN" | "NETWORK_INTERRUPTED" | "FAILED";

export interface WalletErrorInfo { kind: WalletErrorKind; message: string; retry: boolean }

const text = (e: unknown) => String((e as { message?: unknown })?.message ?? e ?? "");
const code = (e: unknown) => {
  const c = (e as { code?: unknown })?.code;
  return typeof c === "number" || typeof c === "string" ? String(c) : "";
};

export function classifyWalletError(e: unknown): WalletErrorInfo {
  const c = code(e), m = text(e);
  // EIP-1193 4001 and Wallet Standard / Phantom 4001: user rejected. MyNearWallet: popup closed. Meteor: cancelled action.
  if (c === "4001" || c === "ACTION_REJECTED" || /user (rejected|denied|cancel|closed)|rejected the request|request rejected|cancelled|canceled|closed the window|declined/i.test(m)) {
    return { kind: "CANCELLED", message: "Cancelled in your wallet. Nothing was signed.", retry: true };
  }
  if (c === "WRONG_ACCOUNT") return { kind: "WRONG_ACCOUNT", message: m, retry: true };
  if (c === "WRONG_NETWORK") return { kind: "WRONG_NETWORK", message: m, retry: true };
  if (c === "INSUFFICIENT_BALANCE" || /insufficient funds|insufficient balance|exceeds balance/i.test(m)) {
    return { kind: "INSUFFICIENT_BALANCE", message: c === "INSUFFICIENT_BALANCE" ? m : "Your wallet does not have enough funds for this deposit and its network fee.", retry: false };
  }
  if (c === "DUPLICATE_TX" || c === "DEPOSIT_IN_PROGRESS") return { kind: "DUPLICATE", message: m, retry: false };
  if (c === "QUOTE_EXPIRED" || c === "FIRM_QUOTE_REQUIRED" || c === "QUOTE_NOT_CURRENT") return { kind: "QUOTE_EXPIRED", message: m, retry: true };
  if (c === "DEPOSIT_EXPIRED") return { kind: "DEPOSIT_EXPIRED", message: m, retry: false };
  if (c === "UNSUPPORTED_ASSET" || c === "ASSET_MISMATCH") return { kind: "UNSUPPORTED_TOKEN", message: m, retry: false };
  if (c === "CHAIN_UNAVAILABLE" || c === "PROVIDER_UNAVAILABLE" || /failed to fetch|networkerror|load failed|network request failed/i.test(m)) {
    return { kind: "NETWORK_INTERRUPTED", message: "The connection dropped or a network is unreachable. Nothing was signed by SPak; try again.", retry: true };
  }
  if (c === "-32002" || /already pending|request already/i.test(m)) {
    return { kind: "PENDING", message: "Your wallet already has an open request. Open the wallet to finish or reject it.", retry: true };
  }
  if (/popup.*blocked|blocked.*popup/i.test(m)) {
    return { kind: "POPUP_BLOCKED", message: "Your browser blocked the wallet window. Allow pop-ups for this site and try again.", retry: true };
  }
  if (c === "CHALLENGE_EXPIRED" || c === "CHALLENGE_NOT_FOUND") {
    return { kind: "EXPIRED", message: "The sign-in request expired. Start again.", retry: true };
  }
  if (c === "CHALLENGE_USED") return { kind: "REPLAYED", message: "That sign-in request was already used. Start again.", retry: true };
  if (c === "ACCOUNT_CHANGED") return { kind: "ACCOUNT_CHANGED", message: m, retry: true };
  if (c === "WALLET_OWNED_BY_OTHER_USER") return { kind: "OWNED_ELSEWHERE", message: m, retry: false };
  if (c === "4100" || c === "4900" || /no account|returned no account|not connected|locked/i.test(m)) {
    return { kind: "NO_ACCOUNT", message: "Unlock your wallet and connect an account, then try again.", retry: true };
  }
  if (c === "4200" || /not support|cannot sign messages/i.test(m)) {
    return { kind: "UNSUPPORTED", message: "This wallet cannot sign sign-in messages. Use another wallet.", retry: false };
  }
  return { kind: "FAILED", message: m || "Something went wrong. Try again.", retry: true };
}
