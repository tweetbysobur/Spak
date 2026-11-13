"use client";
import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import { guardApi, type GuardMessage, type GuardView } from "@/lib/guard";
import { SaveResult } from "./parts";
import type { Run } from "./useGuard";

const ACTIONS = {
  REQUESTS: {
    button: "Pause new transfers", title: "Pause new transfers?", confirm: "Pause new transfers",
    body: ["SPak will not quote or approve any new transfer.", "Transfers you already approved can still be funded.", "Every transfer already under way keeps being tracked, verified and, if needed, refunded."],
  },
  ALL: {
    button: "Disable all execution", title: "Disable all execution?", confirm: "Disable all execution",
    body: ["SPak will not quote or approve any new transfer.", "SPak will also not give deposit instructions, even for transfers you already approved.", "Transfers already funded keep being tracked, verified and, if needed, refunded. Nothing in flight is abandoned."],
  },
} as const;

/** Emergency controls. Pausing never needs a version, so it always works; resuming sends the current version. */
export function Emergency({ view, run }: { view: GuardView; run: Run }) {
  const [confirm, setConfirm] = useState<"REQUESTS" | "ALL" | "RESUME" | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GuardMessage | null>(null);
  const p = view.policy;
  const stopped = p.status === "PAUSED" || p.executionDisabled;
  async function act() {
    if (!confirm) return;
    setBusy(true);
    const r = confirm === "RESUME" ? await run((v) => guardApi.resume(v), "Guard resumed. New transfers are allowed again.")
      : await run(() => guardApi.pause(confirm), confirm === "ALL" ? "All execution disabled." : "New transfers paused.");
    setBusy(false); setResult(r); setConfirm(null);
  }
  return (
    <section aria-labelledby="emergency-title" data-guard-section="emergency" className="rounded-panel border p-5 sm:p-6" style={{ borderColor: "var(--spak-status-error-border)" }}>
      <h2 id="emergency-title" className="type-app-heading text-fg">Emergency controls</h2>
      <p className="type-body-sm mt-1 max-w-2xl text-fg-2">Stop SPak from starting anything new. Neither control interrupts transfers already in flight: tracking, delivery checks and refund recovery always continue.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-card border border-line p-4">
          <p className="type-app-subheading text-fg">Pause new transfers</p>
          <p className="type-body-sm mt-1 text-fg-2">No new quotes or approvals. Approved transfers can still be funded.</p>
          <Button className="mt-3" variant="danger" size="sm" disabled={p.status === "PAUSED" && !p.executionDisabled || p.executionDisabled} onClick={() => setConfirm("REQUESTS")}>{p.status === "PAUSED" && !p.executionDisabled ? "Paused" : "Pause new transfers"}</Button>
        </div>
        <div className="rounded-card border border-line p-4">
          <p className="type-app-subheading text-fg">Disable all execution</p>
          <p className="type-body-sm mt-1 text-fg-2">Also withholds deposit instructions for approved transfers.</p>
          <Button className="mt-3" variant="danger" size="sm" disabled={p.executionDisabled} onClick={() => setConfirm("ALL")}>{p.executionDisabled ? "Disabled" : "Disable all execution"}</Button>
        </div>
      </div>
      {stopped && <div className="mt-4"><Button onClick={() => setConfirm("RESUME")}>Resume Guard</Button></div>}
      <div className="mt-3"><SaveResult result={result} /></div>
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm === "RESUME" ? "Resume Guard?" : confirm ? ACTIONS[confirm].title : ""}>
        {confirm === "RESUME" ? (
          <p className="type-body-sm text-fg-2">New transfers will be allowed again, still checked against all your Guard settings{p.executionDisabled ? ", and deposit instructions will be given again" : ""}.</p>
        ) : confirm && <ul className="type-body-sm flex list-disc flex-col gap-1.5 pl-4 text-fg-2">{ACTIONS[confirm].body.map((b) => <li key={b}>{b}</li>)}</ul>}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant={confirm === "RESUME" ? "primary" : "danger"} onClick={act} disabled={busy}>{busy ? "Saving" : confirm === "RESUME" ? "Resume Guard" : confirm ? ACTIONS[confirm].confirm : ""}</Button>
          <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
        </div>
      </Modal>
    </section>
  );
}
