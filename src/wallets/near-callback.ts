/**
 * Parse a NEP-413 browser-wallet callback (#accountId=…&publicKey=…&signature=…&state=…, or #error=…).
 * Pure function, unit tested. The result is untrusted until the server verifies the signature.
 */
export type NearCallback =
  | { kind: "none" }
  | { kind: "signed"; challengeId: string; accountId: string; publicKey: string; signature: string }
  | { kind: "error"; message: string }
  | { kind: "rejected"; message: string };

export function parseNearCallback(hash: string, pendingChallengeId: string | null): NearCallback {
  if (!hash || hash.length < 2) return { kind: "none" };
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const isNear = p.has("signature") || p.has("errorCode") || p.has("error") || (p.has("state") && p.has("accountId"));
  if (!isNear) return { kind: "none" };
  const state = p.get("state");
  if (!pendingChallengeId || !state || state !== pendingChallengeId) {
    return { kind: "rejected", message: "Ignored a wallet response this tab did not request. Sign in again." };
  }
  if (p.has("error") || p.has("errorCode")) {
    const reason = p.get("errorMessage") ?? p.get("error") ?? p.get("errorCode") ?? "";
    return { kind: "error", message: /reject|cancel|denied/i.test(reason) ? "Cancelled in your wallet. Nothing was signed." : `The wallet reported an error: ${reason.slice(0, 120)}` };
  }
  // URLSearchParams turns "+" into a space; base64 signatures contain "+".
  const signature = p.get("signature")?.replace(/ /g, "+") ?? "";
  const publicKey = p.get("publicKey") ?? "";
  const accountId = p.get("accountId") ?? "";
  if (!signature || !publicKey || !accountId) return { kind: "error", message: "The wallet returned an incomplete signature. Sign in again." };
  if (signature.length > 200 || publicKey.length > 100 || accountId.length > 64) return { kind: "error", message: "The wallet response is malformed." };
  return { kind: "signed", challengeId: state, accountId, publicKey, signature };
}
