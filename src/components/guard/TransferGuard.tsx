"use client";
import { useEffect, useState } from "react";
import { RULE_LABEL, STAGE_LABEL, STATUS_WORD, guardApi, usd, type DecisionRow, type Reservation } from "@/lib/guard";
import { StatusDot } from "./parts";

const OUTCOME: Record<DecisionRow["outcome"], { text: string; role: string }> = {
  ALLOWED: { text: "Allowed", role: "success" }, REQUIRES_APPROVAL: { text: "Passed, your approval needed", role: "success" },
  BLOCKED: { text: "Blocked", role: "error" }, NEEDS_CONFIGURATION: { text: "Needs a setting", role: "warning" },
};
const RULE_ROLE = { PASS: "success", FAIL: "error", NEEDS_CONFIGURATION: "warning", NOT_APPLICABLE: "neutral" } as const;
const RESERVATION: Record<Reservation["status"], string> = {
  RESERVED: "Counts toward your limits while the transfer is under way.", CONSUMED: "Counted: the transfer was delivered.", RELEASED: "Released: the transfer did not go ahead or was refunded, so it no longer counts.",
};

/** Guard decisions recorded for one transfer, from the server. Read-only. */
export function TransferGuard({ executionId }: { executionId: string }) {
  const [data, setData] = useState<{ decisions: DecisionRow[]; reservation: Reservation | null } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { guardApi.forExecution(executionId).then(setData).catch(() => setError(true)); }, [executionId]);
  return (
    <details data-guard-checks className="rounded-panel border border-line bg-elevated p-5 sm:p-6 dark:bg-surface">
      <summary className="type-app-subheading cursor-pointer text-fg">Guard checks</summary>
      <div className="mt-4">
        {error ? <p className="type-body-sm text-fg-2">Guard checks could not be loaded.</p> : !data ? <p className="type-body-sm text-fg-2">Loading</p> : <>
          <div className="border-b border-line pb-3">
            <p className="type-label text-fg-2">Spending reservation</p>
            {data.reservation ? <p className="type-body-sm mt-1 text-fg"><span className="type-amount">{usd(data.reservation.amountUsd)}</span> · {RESERVATION[data.reservation.status]}</p>
              : <p className="type-body-sm mt-1 text-fg-2">None. Spending is reserved only when you approve.</p>}
          </div>
          {data.decisions.length ? (
            <ol className="flex flex-col">
              {data.decisions.map((d) => (
                <li key={d.id} data-decision-stage={d.stage} data-decision-outcome={d.outcome} className="border-b border-line py-3 last:border-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="type-label text-fg">{STAGE_LABEL[d.stage]} · <StatusDot role={OUTCOME[d.outcome].role}>{OUTCOME[d.outcome].text}</StatusDot></p>
                    <p className="type-caption text-fg-2">Policy version {d.policyVersion ?? "–"} · {new Date(d.at).toLocaleString()}</p>
                  </div>
                  <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {d.rules.filter((r) => r.rule !== "POLICY" || r.status !== "PASS").map((r) => (
                      <li key={r.rule} title={r.reason} className="type-body-sm flex items-start gap-2">
                        <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `var(--spak-status-${RULE_ROLE[r.status]}-icon)` }} />
                        <span><span className="text-fg">{RULE_LABEL[r.rule]} {STATUS_WORD[r.status]}</span>{r.status !== "PASS" && <span className="block text-fg-2">{r.reason}</span>}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : <p className="type-body-sm pt-3 text-fg-2">No Guard checks recorded for this transfer.</p>}
        </>}
      </div>
    </details>
  );
}
