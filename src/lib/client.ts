"use client";
import type { TxState } from "@/lib/execution/status";

export interface QuoteView {
  dry: boolean;
  depositAddress?: string;
  depositMemo?: string;
  amountInFormatted: string;
  amountInUsd?: string;
  amountOutFormatted: string;
  amountOutUsd?: string;
  minAmountOutFormatted: string;
  timeEstimateSec?: number;
  deadline: string;
  slippageBps: number;
  appFeeBps: number;
  withdrawFeeFormatted?: string;
  refundFeeFormatted?: string;
  origin: { symbol: string; blockchain: string };
  destination: { symbol: string; blockchain: string };
  recipient: string;
  refundTo: string;
}

export interface QuoteRequest {
  amount: string; sourceToken: string; sourceNetwork: string;
  destToken: string; destNetwork: string; recipient: string; refundTo: string;
  slippageBps: number;
}

export interface TxRecord {
  id: string;
  createdAt: string;
  request: QuoteRequest;
  quote: QuoteView;
  state: TxState;
  originTxHashes?: string[];
  destinationTxHashes?: string[];
}

export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

export const store = {
  addresses: () => read<Record<string, string>>("spak.addresses", {}),
  setAddresses: (a: Record<string, string>) => write("spak.addresses", a),
  history: () => read<TxRecord[]>("spak.history", []),
  saveTx: (tx: TxRecord) => {
    const h = read<TxRecord[]>("spak.history", []).filter((t) => t.id !== tx.id);
    write("spak.history", [tx, ...h].slice(0, 50));
  },
};
