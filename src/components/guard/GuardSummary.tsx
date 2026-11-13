"use client";
import { useEffect, useState } from "react";
import { STATE_TEXT, guardApi, guardState, usd, type GuardView } from "@/lib/guard";
import { StatusDot } from "./parts";
import { UsageRow } from "./Limits";

/** Overview card: Guard status and 24-hour spending, straight from GET /api/guard. */
export function GuardSummary({ onOpen }: { onOpen: () => void }) {
  const [view, setView] = useState<GuardView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { guardApi.get().then(setView).catch(() => setFailed(true)); }, []);
  const s = view ? guardState(view) : failed ? "UNAVAILABLE" : null;
  return (
    <div data-guard-summary={s ?? "LOADING"}>
      <div className="flex items-center justify-between gap-2">
        <p className="type-app-subheading text-fg">SPak Guard</p>
        <button onClick={onOpen} className="type-button-sm text-primary underline-offset-2 hover:underline">Open</button>
      </div>
      {!s ? <p className="type-caption mt-1 text-fg-2">Loading</p> : (
        <>
          <div className="mt-1"><StatusDot role={STATE_TEXT[s].role}>{STATE_TEXT[s].title}</StatusDot></div>
          {view && <>
            <div className="mt-3"><UsageRow label="24-hour limit" spent={view.spending.dayUsd} limit={view.policy.limits.dailyUsd} window="last 24 hours" /></div>
            <p className="type-caption mt-1 text-fg-2">
              Per transfer up to {usd(view.policy.limits.maxTransactionUsd ?? view.ceilingUsd)} · slippage up to {view.policy.maxSlippageBps / 100}% · {view.policy.recipientMode === "APPROVED_ONLY" ? "approved recipients only" : "any recipient"}
            </p>
          </>}
          {s === "UNAVAILABLE" && <p className="type-caption mt-1 text-fg-2">Status could not be loaded. Nothing goes ahead while Guard cannot check it.</p>}
        </>
      )}
    </div>
  );
}
