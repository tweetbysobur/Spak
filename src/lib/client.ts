"use client";
import type { ExecutionPlan, ExecutionView, IntentResult, QuoteView } from "@/spak-in/types-client";
import { getAsset } from "@/spak-in/registries/assets";
import { fromBaseUnits } from "@/spak-in/lib/decimal";

export type { ExecutionPlan, ExecutionView, IntentResult, QuoteView };

export interface ApiError { code: string; message: string }

/** JSON call to the SPak API. The session cookie is HttpOnly and sent by the browser; JS never reads it. */
export async function api<T>(url: string, body?: unknown, method?: "POST" | "PATCH" | "DELETE", headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? `Request failed (${res.status})`), { code: data.error?.code as string | undefined, details: data.error?.details });
  return data as T;
}

export interface Prepared { execution: ExecutionView; quote: QuoteView }

/**
 * Hand a validated SPak-in plan to SPak Execution. The idempotency key is derived from the plan hash,
 * so pressing the button twice returns the same execution instead of creating two.
 */
export function startExecution(planHash: string, agentId?: string | null): Promise<Prepared> {
  // An Agent transfer uses its own key: the server refuses to re-attribute a plan between manual and Agent.
  return api<Prepared>("/api/executions", agentId ? { planHash, agentId } : { planHash }, "POST", { "idempotency-key": `ui-${agentId ? "a-" : ""}${planHash.slice(0, 40)}` });
}

/** Smallest units to a readable decimal, using the verified registry decimals. */
export function formatUnits(units: string | null | undefined, assetId: string): string {
  if (!units) return "?";
  const a = getAsset(assetId);
  return a ? `${fromBaseUnits(units, a.decimals)} ${a.symbol}` : `${units} units`;
}
