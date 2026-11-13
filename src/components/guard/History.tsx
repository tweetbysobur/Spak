"use client";
import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { getNetwork } from "@/spak-in/registries/networks";
import { getAsset } from "@/spak-in/registries/assets";
import { guardApi, type HistoryItem } from "@/lib/guard";

const ACTION: Record<string, string> = {
  CREATED_DEFAULT: "Guard set up with default protections", UPDATED: "Settings changed", RECIPIENT_ADDED: "Recipient approved",
  RECIPIENT_REMOVED: "Recipient removed", PAUSED: "New transfers paused", EXECUTION_DISABLED: "All execution disabled", RESUMED: "Guard resumed",
};
const FIELD: Record<string, string> = {
  maxTransactionUsd: "Per-transfer limit", minTransactionUsd: "Minimum", dailyLimitUsd: "24-hour limit", weeklyLimitUsd: "7-day limit", monthlyLimitUsd: "30-day limit",
  maxSlippageBps: "Maximum slippage", assetMode: "Tokens", recipientMode: "Recipients", status: "Status", executionDisabled: "All execution disabled", assets: "Token rules", recipient: "Recipient",
};
const MONEY = new Set(["maxTransactionUsd", "minTransactionUsd", "dailyLimitUsd", "weeklyLimitUsd", "monthlyLimitUsd"]);
const MODE: Record<string, string> = { ANY: "any", ALLOWLIST: "allowlist only", APPROVED_ONLY: "approved only", ACTIVE: "active", PAUSED: "paused" };

function value(key: string, v: unknown): string {
  if (v === null || v === undefined) return "not set";
  if (MONEY.has(key)) return `$${v}`;
  if (key === "maxSlippageBps") return `${Number(v) / 100}%`;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return MODE[v] ?? v;
  if (key.startsWith("network:")) { const r = v as { allowSource: boolean; allowDestination: boolean; disabled: boolean }; return r.disabled ? "disabled" : [r.allowSource && "send", r.allowDestination && "receive"].filter(Boolean).join(" and ") || "not allowed"; }
  if (key === "assets") { const e = Object.entries(v as Record<string, string>); return e.length ? e.map(([id, r]) => `${getAsset(id)?.symbol ?? id} on ${getNetwork(id.split(":")[0])?.name ?? id.split(":")[0]} ${r === "ALLOW" ? "allowed" : "blocked"}`).join(", ") : "none"; }
  return JSON.stringify(v);
}

/** One readable line per changed setting, with the value before and after. */
export function describeChanges(item: HistoryItem): string[] {
  return Object.entries(item.changes ?? {}).map(([k, c]) => {
    if (k === "recipient") { const r = c as { network: string; address: string; label?: string | null }; return `${r.label ? `${r.label}, ` : ""}${r.address} on ${getNetwork(r.network)?.name ?? r.network}`; }
    const label = k.startsWith("network:") ? `${getNetwork(k.slice(8))?.name ?? k.slice(8)}` : FIELD[k] ?? k;
    const { from, to } = c as { from: unknown; to: unknown };
    return `${label}: ${value(k, from)} → ${value(k, to)}`;
  });
}

/** Read-only history of the user's Guard settings. The actor is shown as "You" or "SPak", never an internal id. */
export function History({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState(false);
  const [limit, setLimit] = useState(20);
  useEffect(() => { setError(false); guardApi.history(limit).then((r) => setItems(r.items)).catch(() => setError(true)); }, [limit, refreshKey]);
  return (
    <section aria-labelledby="history-title" data-guard-section="history" className="rounded-panel border border-line bg-elevated p-5 sm:p-6 dark:bg-surface">
      <h2 id="history-title" className="type-app-heading text-fg">History</h2>
      <p className="type-body-sm mt-1 text-fg-2">Every change to your Guard settings, newest first. Each change creates a new version.</p>
      {error ? <p className="type-body-sm mt-4 text-fg-2">History could not be loaded. Try again shortly.</p>
        : !items ? <div className="mt-4"><Spinner label="Loading history" /></div>
        : !items.length ? <p className="type-body-sm mt-4 text-fg-2">No changes yet.</p>
        : (
          <ol className="mt-4 flex flex-col">
            {items.map((h) => (
              <li key={h.version} data-history-version={h.version} className="grid gap-1 border-t border-line py-3 sm:grid-cols-[6rem_1fr_auto] sm:gap-4">
                <p className="type-label text-fg-2">Version {h.version}</p>
                <div className="min-w-0">
                  <p className="type-body-sm text-fg">{ACTION[h.action] ?? h.action} <span className="text-fg-2">· {h.actor.startsWith("user:") ? "You" : "SPak"}</span></p>
                  <ul className="type-caption mt-0.5 flex flex-col text-fg-2 [overflow-wrap:anywhere]">{describeChanges(h).map((c) => <li key={c}>{c}</li>)}</ul>
                </div>
                <p className="type-caption text-fg-2">{new Date(h.at).toLocaleString()}</p>
              </li>
            ))}
          </ol>
        )}
      {items && items.length === limit && <Button className="mt-3" variant="ghost" size="sm" onClick={() => setLimit((l) => Math.min(200, l + 30))}>Show older changes</Button>}
    </section>
  );
}
