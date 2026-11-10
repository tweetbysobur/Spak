"use client";
import type { ExecutionPlan, IntentResult, ProviderQuote, Submission } from "@/spak-in/types-client";

export type { ExecutionPlan, IntentResult, ProviderQuote, Submission };

export interface ApiError { code: string; message: string }

/** JSON call to the SPak API. The session cookie is HttpOnly and sent by the browser; JS never reads it. */
export async function api<T>(url: string, body?: unknown, method?: "POST" | "PATCH" | "DELETE"): Promise<T> {
  const res = await fetch(url, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
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

let currentUser = "none";
export const store = {
  /** Per-user display cache. The server is the source of truth for submissions. */
  history: () => read<TxRecord[]>(`spak.history.v3.${currentUser}`, []),
  saveTx: (tx: TxRecord) => {
    const key = `spak.history.v3.${tx.submission.userId}`;
    const h = read<TxRecord[]>(key, []).filter((t) => t.submission.id !== tx.submission.id);
    write(key, [tx, ...h].slice(0, 50));
  },
  setUser: (id: string | null) => { currentUser = id ?? "none"; },
};
