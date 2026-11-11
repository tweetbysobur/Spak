import { createHash, timingSafeEqual } from "node:crypto";

export interface Reviewer { reviewerId: string; credentialRef: string }

const sha = (s: string) => createHash("sha256").update(s).digest();

/**
 * Reviewer credentials, configured server-side. SPAK_REVIEWERS lists one entry per person:
 *   reviewer-id:sha256-hex-of-their-token[,reviewer-id:sha256-hex,...]
 * Only token hashes are configured; raw tokens are never stored or logged. Each person has a separate token, so the
 * identity recorded on every action is the one bound to the credential presented, never a name sent by the client.
 * Legacy SPAK_ADMIN_TOKEN (raw, 32+ chars) maps to the single shared identity "shared-admin", which does not identify
 * an individual. Unknown or malformed credentials are rejected.
 */
export function parseReviewers(spec: string | undefined, legacyToken: string | undefined): { id: string; hash: Buffer }[] {
  const out: { id: string; hash: Buffer }[] = [];
  for (const part of (spec ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z0-9._-]{2,64}):([0-9a-fA-F]{64})$/.exec(part);
    if (m && !out.some((r) => r.id === m[1])) out.push({ id: m[1], hash: Buffer.from(m[2], "hex") });
  }
  if (legacyToken && legacyToken.length >= 32) out.push({ id: "shared-admin", hash: sha(legacyToken) });
  return out;
}

export function resolveReviewer(token: string, reviewers: { id: string; hash: Buffer }[]): Reviewer | null {
  if (!token || token.length < 32) return null;
  const h = sha(token);
  let found: string | null = null;
  for (const r of reviewers) if (timingSafeEqual(h, r.hash) && !found) found = r.id; // compare against all; constant work
  return found ? { reviewerId: found, credentialRef: h.toString("hex").slice(0, 12) } : null;
}
