import { IS_TESTNET } from "../../environment";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64, hex } from "@scure/base";
import { AuthError } from "../types";

/** NEP-413 tag: 2^31 + 413. Prevents a signed message from ever being a valid transaction. */
export const NEP413_TAG = 2147484061;

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
function str(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  return concat(u32(bytes.length), bytes);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Borsh(tag) + Borsh({ message, nonce: [u8;32], recipient, callbackUrl: Option<string> }), per NEP-413. */
export function nep413Payload(message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string): Uint8Array {
  if (nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes.");
  return concat(u32(NEP413_TAG), str(message), nonce, str(recipient), callbackUrl ? concat(new Uint8Array([1]), str(callbackUrl)) : new Uint8Array([0]));
}

export function nep413Hash(message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(nep413Payload(message, nonce, recipient, callbackUrl)).digest());
}

export function parseNearPublicKey(pk: string): Uint8Array | null {
  const m = /^ed25519:([1-9A-HJ-NP-Za-km-z]+)$/.exec(pk);
  if (!m) return null;
  try { const b = base58.decode(m[1]); return b.length === 32 ? b : null; } catch { return null; }
}

export interface NearRpc {
  /** Returns the access key permission, or null if the key is not on the account. */
  accessKey(accountId: string, publicKey: string): Promise<"FullAccess" | "FunctionCall" | null>;
}

export const MAINNET_NEAR_RPC = ["https://rpc.mainnet.near.org", "https://free.rpc.fastnear.com"];
/** Testnet build: NEAR identities (wallet sign-in, Agent owner) are NEAR testnet accounts. */
export const TESTNET_NEAR_RPC = ["https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"];
/** Testnet NEAR RPC hosts name testnet in the host (rpc.testnet.near.org) or are FastNEAR's test.rpc host. */
export const isTestnetNearRpc = (u: string) => { try { const h = new URL(u).hostname; return /(^|\.)testnet(\.|$)/.test(h) || h === "test.rpc.fastnear.com"; } catch { return false; } };
export const DEFAULT_NEAR_RPC = IS_TESTNET ? TESTNET_NEAR_RPC : MAINNET_NEAR_RPC;

/**
 * NEAR JSON-RPC view_access_key. NEAR_RPC_URL may list several endpoints, comma separated.
 * The next endpoint is tried only when one is unreachable or returns an unusable answer, never to override a "no".
 */
export function nearRpc(urls: string | string[] = process.env.NEAR_RPC_URL ?? DEFAULT_NEAR_RPC, fetchImpl: typeof fetch = fetch): NearRpc {
  const list = (Array.isArray(urls) ? urls : urls.split(",")).map((u) => u.trim()).filter(Boolean);
  // No cross-environment identity checks: a testnet build never verifies keys on mainnet NEAR, and the reverse.
  if (list.some((u) => IS_TESTNET !== isTestnetNearRpc(u))) throw new AuthError("NEAR_RPC_UNAVAILABLE", `NEAR_RPC_URL does not match this ${IS_TESTNET ? "testnet" : "mainnet"} build.`);
  const one = singleNearRpc(fetchImpl);
  return {
    async accessKey(accountId, publicKey) {
      let last: unknown;
      for (const url of list) {
        try { return await one(url, accountId, publicKey); } catch (e) { last = e; }
      }
      throw last ?? new AuthError("NEAR_RPC_UNAVAILABLE", "No NEAR RPC endpoint configured.");
    },
  };
}

function singleNearRpc(fetchImpl: typeof fetch) {
  return async (url: string, accountId: string, publicKey: string): Promise<"FullAccess" | "FunctionCall" | null> => {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "spak", method: "query", params: { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey } }),
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw new AuthError("NEAR_RPC_UNAVAILABLE", "Could not reach NEAR to confirm the key. Try again.");
      }
      const body = (await res.json().catch(() => null)) as { result?: { permission?: unknown; error?: string }; error?: { cause?: { name?: string } } } | null;
      // Older and current RPC nodes report a missing key as result.error text instead of a structured error.
      if (typeof body?.result?.error === "string" && /does not exist/.test(body.result.error)) return null;
      if (body?.result?.permission === "FullAccess") return "FullAccess";
      if (body?.result?.permission) return "FunctionCall";
      const cause = body?.error?.cause?.name;
      if (cause === "UNKNOWN_ACCESS_KEY" || cause === "UNKNOWN_ACCOUNT") return null;
      throw new AuthError("NEAR_RPC_UNAVAILABLE", "NEAR returned an unexpected response. Try again.");
  };
}

/**
 * Verify a NEP-413 signMessage result.
 * 1. ed25519 signature over sha256(NEP-413 payload) with the claimed public key.
 * 2. The key really controls the account: implicit accounts equal the key; named accounts need a FullAccess key on chain.
 */
export async function verifyNearSignature(args: {
  accountId: string; publicKey: string; signatureB64: string; message: string; nonceHex: string; recipient: string; rpc: NearRpc;
}): Promise<boolean> {
  const pub = parseNearPublicKey(args.publicKey);
  if (!pub) return false;
  let sig: Uint8Array;
  try { sig = base64.decode(args.signatureB64); } catch { return false; }
  if (sig.length !== 64) return false;
  const digest = nep413Hash(args.message, hex.decode(args.nonceHex), args.recipient);
  if (!ed25519.verify(sig, digest, pub)) return false;
  if (/^[0-9a-f]{64}$/.test(args.accountId)) {
    if (hex.encode(pub) === args.accountId) return true;
    throw new AuthError("KEY_NOT_AUTHORIZED", "This key does not control that implicit account.");
  }
  const perm = await args.rpc.accessKey(args.accountId, args.publicKey);
  if (perm !== "FullAccess") throw new AuthError("KEY_NOT_AUTHORIZED", perm ? "That key is a limited function-call key. Sign with a full-access key." : "That key is not on this NEAR account.");
  return true;
}
