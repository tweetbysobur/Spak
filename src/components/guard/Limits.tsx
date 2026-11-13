"use client";
import { useState } from "react";
import { Field, inputCls } from "@/components/ui";
import { usage, usd, type GuardMessage, type GuardPatch, type GuardView } from "@/lib/guard";
import { guardApi } from "@/lib/guard";
import { Editable, FormActions, SaveResult } from "./parts";
import type { Run } from "./useGuard";

const WINDOWS = [
  { key: "dailyLimitUsd", limit: "dailyUsd", spent: "dayUsd", label: "24-hour limit", window: "last 24 hours" },
  { key: "weeklyLimitUsd", limit: "weeklyUsd", spent: "weekUsd", label: "7-day limit", window: "last 7 days" },
  { key: "monthlyLimitUsd", limit: "monthlyUsd", spent: "monthUsd", label: "30-day limit", window: "last 30 days" },
] as const;

/** Spending used against one rolling window. A percentage and bar only when the limit is set. */
export function UsageRow({ label, spent, limit, window }: { label: string; spent: string; limit: string | null; window: string }) {
  const pct = usage(spent, limit);
  const role = pct !== null && pct >= 90 ? "warning" : "processing";
  return (
    <div data-limit={label} className="border-t border-line py-3 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="type-label text-fg">{label}</p>
        <p className="type-body-sm text-fg-2">
          <span className="type-amount text-fg">{usd(spent)}</span> used in the {window}
          {limit ? <> of <span className="type-amount text-fg">{usd(limit)}</span></> : <> · no limit set</>}
        </p>
      </div>
      {pct !== null && (
        <div className="mt-2 flex items-center gap-3">
          <div role="progressbar" aria-label={`${label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary dark:bg-bg">
            <div className={`h-full rounded-full ${role === "warning" ? "" : "bg-primary"}`} style={{ width: `${pct}%`, ...(role === "warning" ? { background: "var(--spak-status-warning-icon)" } : {}) }} />
          </div>
          <span className="type-caption w-10 text-right text-fg-2">{Math.round(pct)}%</span>
        </div>
      )}
    </div>
  );
}

const DEC = /^\d+(\.\d{1,8})?$/;

export function Limits({ view, run }: { view: GuardView; run: Run }) {
  const { limits } = view.policy;
  return (
    <Editable id="limits" title="Spending limits" editLabel="Edit limits"
      sub={`Rolling windows. Only approved transfers count: a quote never does, and cancelled, expired or refunded transfers are released. SPak's ceiling of ${usd(view.ceilingUsd)} per transfer always applies.`}
      read={
        <div>
          <div className="grid gap-3 border-b border-line pb-4 sm:grid-cols-3">
            <div><p className="type-label text-fg-2">Per transfer</p><p className="type-amount mt-1 text-fg">{limits.maxTransactionUsd ? usd(limits.maxTransactionUsd) : `SPak ceiling, ${usd(view.ceilingUsd)}`}</p></div>
            <div><p className="type-label text-fg-2">Minimum</p><p className="type-amount mt-1 text-fg">{limits.minTransactionUsd ? usd(limits.minTransactionUsd) : "Not set"}</p></div>
            <div><p className="type-label text-fg-2">SPak ceiling</p><p className="type-amount mt-1 text-fg">{usd(view.ceilingUsd)}</p></div>
          </div>
          <div className="pt-4">{WINDOWS.map((w) => <UsageRow key={w.key} label={w.label} spent={view.spending[w.spent]} limit={limits[w.limit]} window={w.window} />)}</div>
        </div>
      }
      edit={(close) => <LimitsForm view={view} run={run} close={close} />}
    />
  );
}

function LimitsForm({ view, run, close }: { view: GuardView; run: Run; close: () => void }) {
  // The policy as it was when the form opened. Only fields the user changed from it are sent, so a newer change
  // made elsewhere (and reloaded after a version conflict) is never overwritten by an untouched field.
  const [start] = useState(() => { const l = view.policy.limits; return { maxTransactionUsd: l.maxTransactionUsd ?? "", minTransactionUsd: l.minTransactionUsd ?? "", dailyLimitUsd: l.dailyUsd ?? "", weeklyLimitUsd: l.weeklyUsd ?? "", monthlyLimitUsd: l.monthlyUsd ?? "" }; });
  const [f, setF] = useState(start);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GuardMessage | null>(null);
  const fields: [keyof typeof f, string, string][] = [
    ["maxTransactionUsd", "Per-transfer limit (USD)", `Empty uses SPak's ${usd(view.ceilingUsd)} ceiling. It cannot be higher.`],
    ["minTransactionUsd", "Minimum per transfer (USD)", "Optional."],
    ["dailyLimitUsd", "24-hour limit (USD)", "Optional."], ["weeklyLimitUsd", "7-day limit (USD)", "Optional."], ["monthlyLimitUsd", "30-day limit (USD)", "Optional."],
  ];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bad = fields.find(([k]) => f[k].trim() && !DEC.test(f[k].trim()));
    if (bad) { setResult({ title: `${bad[1]} must be an amount like 250 or 250.50.`, reasons: [] }); return; }
    // Only the fields that changed. An empty field clears that limit.
    const patch: GuardPatch = {};
    for (const [k] of fields) if (f[k].trim() !== start[k]) patch[k] = f[k].trim() || null;
    if (!Object.keys(patch).length) { close(); return; }
    setBusy(true); setResult(null);
    const r = await run((v) => guardApi.update(v, patch), "Spending limits saved.");
    setBusy(false);
    if (r) setResult(r); else close();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Edit spending limits">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(([k, label, hint]) => (
          <Field key={k} label={label} hint={hint}>
            <input className={`${inputCls} type-amount`} inputMode="decimal" name={k} placeholder="Not set" value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value.replace(/[^\d.]/g, "") }))} />
          </Field>
        ))}
      </div>
      <SaveResult result={result} />
      <FormActions busy={busy} onCancel={close} />
    </form>
  );
}
