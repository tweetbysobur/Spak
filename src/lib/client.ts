"use client";
import type { ExecutionPlan, IntentResult, ProviderQuote, Submission } from "@/spak-in/types-client";

export type { ExecutionPlan, IntentResult, ProviderQuote, Submission };

/** Anonymous per-browser id. Placeholder until wallet or NEAR account sign-in exists. */
export function userId(): string {
  try {
    let id = localStorage.getItem("spak.user");
    if (!id) { id = `anon_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`; localStorage.setItem("spak.user", id); }
    return id;
  } catch { return "anon_ephemeral_session"; }
}

export interface ApiError { code: string; message: string }

export async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-spak-user": userId() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? `Request failed (${res.status})`), { code: data.error?.code as string | undefined });
  return data as T;
}

/** Saved record of an approved transaction, for the History tab. */
export interface TxRecord {
  submission: Submission;
  intent: IntentResult;
  quote: ProviderQuote;
}

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } }

// Old builds stored addresses under NEAR Intents codes. Map them to SPak network ids once.
const LEGACY: Record<string, string> = { eth: "ethereum", arb: "arbitrum", op: "optimism", pol: "polygon", avax: "avalanche", sol: "solana", btc: "bitcoin" };

export const store = {
  addresses: () => {
    const raw = read<Record<string, string>>("spak.addresses", {});
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [LEGACY[k] ?? k, v]));
  },
  setAddresses: (a: Record<string, string>) => write("spak.addresses", a),
  history: () => read<TxRecord[]>("spak.history.v2", []),
  saveTx: (tx: TxRecord) => {
    const h = read<TxRecord[]>("spak.history.v2", []).filter((t) => t.submission.id !== tx.submission.id);
    write("spak.history.v2", [tx, ...h].slice(0, 50));
  },
};
