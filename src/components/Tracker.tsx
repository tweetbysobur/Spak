"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackingView } from "@/tracking/service";
import { getNetwork } from "@/spak-in/registries/networks";
import { api, formatUnits, type ExecutionView } from "@/lib/client";
import { Amount, Button, ErrorText, Mono, Row } from "./ui";
import { Icon } from "./icons";
import { DepositPanel } from "./DepositPanel";
import { RecoveryPanel } from "./RecoveryPanel";
import { Receipt } from "./tracking/Receipt";
import { TransferGuard } from "./guard/TransferGuard";
import { PHASE_ROLE, PHASE_TITLE, fundsText, notificationFor, phaseOf, phaseSummary, stagesOf, type Stage } from "./tracking/model";

const TERMINAL: string[] = ["COMPLETED", "REFUNDED", "EXPIRED", "CANCELLED"];
const net = (id: string) => getNetwork(id)?.name ?? id;
const time = (s: string | null) => (s ? new Date(s).toLocaleString() : "");
const OUTCOME: Record<string, string> = { CONFIRMED: "verified", PENDING: "pending", NOT_FOUND: "not found yet", FAILED: "failed", NO_TRANSFER: "no transfer to recipient", UNVERIFIABLE: "cannot be read by SPak", NOT_CHECKED: "not checked yet",
  NOT_DESTINATION_CHAIN: "provider reference, not a destination transaction", UNTRUSTED_SENDER: "not from the route's sender; not counted", BEFORE_DEPOSIT: "older than your deposit; not counted" };

/**
 * Progress marker. A finished stage uses the brand primary (a checkpoint), not the success colour: only the phase
 * says whether the whole transfer succeeded. The current stage takes the phase's own role, so "waiting for your
 * deposit" reads as pending, never as processing.
 */
function Marker({ s, role }: { s: Stage; role: string }) {
  if (s.status === "done") return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-on-primary"><Icon name="success" size={14} /></span>;
  if (s.status === "current") return <span className="flex h-6 w-6 items-center justify-center rounded-full border-2" style={{ borderColor: `var(--spak-status-${role}-icon)` }}><span className={`h-2 w-2 rounded-full ${role === "processing" ? "animate-pulse motion-reduce:animate-none" : ""}`} style={{ background: `var(--spak-status-${role}-icon)` }} /></span>;
  if (s.status === "halted") return <span className="flex h-6 w-6 items-center justify-center rounded-full border-2" style={{ borderColor: `var(--spak-status-${role}-icon)`, color: `var(--spak-status-${role}-icon)` }}><Icon name="warning" size={12} /></span>;
  return <span className="h-6 w-6 rounded-full border-2 border-dashed border-line-strong" />;
}

/**
 * One transfer, from approval to verified delivery. SPak's background monitor does the work; this view reads the
 * tracking view and, while open and not final, asks for a permitted refresh every 15 seconds.
 */
export function Tracker({ initial, onNotify }: { initial: ExecutionView; onNotify?: (id: string, key: string, message: string) => void }) {
  const [x, setX] = useState(initial);
  const [t, setT] = useState<TrackingView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const seen = useRef<{ state: string; deposit: boolean; review: boolean } | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    const v = refresh ? await api<TrackingView>(`/api/executions/${x.id}/refresh`, {}) : await api<TrackingView>(`/api/executions/${x.id}/tracking`);
    setT(v);
    if (v.state !== x.state) setX(await api<ExecutionView>(`/api/executions/${x.id}`));
  }, [x.id, x.state]);

  useEffect(() => {
    load(false).catch(() => {});
    if (TERMINAL.includes(x.state)) return;
    const i = setInterval(() => { load(true).catch(() => { /* keep last known state */ }); }, 15_000);
    return () => clearInterval(i);
  }, [load, x.state]);

  // Notifications: only for changes seen while this view is open, never for the state it opened in.
  useEffect(() => {
    if (!t) return;
    const deposit = t.steps.find((s) => s.id === "DEPOSIT_SUBMITTED")?.status === "done";
    const review = t.review?.status === "OPEN";
    const prev = seen.current;
    seen.current = { state: t.state, deposit, review };
    if (!prev || !onNotify) return;
    if (!prev.deposit && deposit) onNotify(x.id, "deposit", "Deposit detected. SPak is confirming it on the source chain.");
    const msg = notificationFor(prev.state, t.state);
    if (msg) onNotify(x.id, t.state, msg);
    if (!prev.review && review) onNotify(x.id, "review", "A refund needs attention: a manual review was opened.");
  }, [t, x.id, onNotify]);

  async function cancel() {
    try { setX(await api<ExecutionView>(`/api/executions/${x.id}/cancel`, {})); } catch (e) { setError((e as Error).message); }
  }
  async function checkNow() {
    setBusy(true); setError(undefined);
    try { await load(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const phase = phaseOf(x, t);
  const role = PHASE_ROLE[phase];
  const stages = stagesOf(x, t);
  const funds = fundsText(t);
  const dst = t?.destination;
  const failing = ["FAILED", "REFUND_PENDING", "REFUND_REVIEW", "REFUNDED", "UNKNOWN"].includes(phase);

  return (
    <div className="flex flex-col gap-5">
      {/* Phase: one status, in words with a dot. */}
      <section className="rounded-panel border border-line bg-elevated p-5 sm:p-6 dark:bg-surface" aria-live="polite">
        <p data-status-role={role} data-phase={phase} className="type-status inline-flex items-center gap-2" style={{ color: `var(--spak-status-${role}-foreground)` }}>
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `var(--spak-status-${role}-icon)` }} />{PHASE_TITLE[phase]}
        </p>
        <h2 className="type-app-title mt-2 text-fg"><span className="[overflow-wrap:anywhere]">{formatUnits(x.source.amountIn, x.source.assetId)}</span> <span className="text-fg-2">{net(x.source.network)} → {net(x.destination.network)}</span></h2>
        <p className="type-body mt-2 max-w-2xl text-fg-2">{phaseSummary(phase, net(x.destination.network))}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {t && !TERMINAL.includes(t.state) && <Button variant="secondary" size="sm" onClick={checkNow} disabled={busy}>{busy ? "Checking" : "Check now"}</Button>}
          {t && <span className="type-caption text-fg-2">Updated {time(t.lastCheckedAt ?? t.updatedAt)}{!TERMINAL.includes(t.state) ? " · checks every 15 s while open" : ""}</span>}
        </div>
        {error && <ErrorText>{error}</ErrorText>}
      </section>

      {x.state === "AWAITING_DEPOSIT" && <DepositPanel execution={x} />}
      {x.state === "AWAITING_DEPOSIT" && x.deposit && <div><Button variant="ghost" onClick={cancel}>Cancel before sending the deposit</Button></div>}

      {phase === "COMPLETED" && t && <Receipt x={x} t={t} />}

      {/* Progress: the main view. */}
      <section aria-labelledby="progress-title" className="rounded-panel border border-line bg-elevated p-5 sm:p-6 dark:bg-surface">
        <h3 id="progress-title" className="type-app-heading text-fg">Progress</h3>
        <ol className="mt-5" aria-label="Progress">
          {stages.map((s, i) => (
            <li key={s.id} data-stage={s.id} data-status={s.status} className="relative grid grid-cols-[1.5rem_1fr] gap-x-4 pb-6 last:pb-0">
              {i < stages.length - 1 && <span aria-hidden className={`absolute left-[11px] top-7 h-[calc(100%-1.75rem)] w-0.5 ${s.status === "done" ? "bg-primary" : "bg-line"}`} />}
              <span className="relative z-10"><Marker s={s} role={role} /></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className={`type-app-subheading ${s.status === "pending" ? "text-fg-2" : "text-fg"}`}>{s.title}<span className="sr-only"> ({s.status})</span></p>
                  {s.at && s.status !== "pending" && <p className="type-caption text-fg-2">{time(s.at)}</p>}
                </div>
                <p className="type-body-sm mt-0.5 text-fg-2">{s.detail}</p>
                {s.refs.map((r) => (
                  <div key={r.hash} className="mt-1.5 flex flex-wrap items-center gap-x-2">
                    <Mono value={r.hash} href={r.url ?? undefined} />
                    {r.label && <span className="type-caption text-fg-2">{OUTCOME[r.label] ?? r.label.toLowerCase()}</span>}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Failure, unknown and refunds: where the funds are, then the existing recovery panel. */}
      {failing && t && (
        <section className="rounded-panel border border-line bg-elevated p-5 sm:p-6 dark:bg-surface">
          <h3 className="type-app-heading text-fg">What happened</h3>
          {phase === "UNKNOWN" && <p className="type-body-sm mt-2 text-fg-2">{t.note ?? ""} {t.needsReconciliation ? "SPak flagged this for manual review." : "SPak keeps checking automatically."}</p>}
          {funds && <p className="type-body-sm mt-3"><span className="type-label text-fg">Your funds: </span><span className="text-fg-2">{funds}</span></p>}
          <RecoveryPanel executionId={x.id} view={t} onChange={setT} />
        </section>
      )}

      <TransferGuard executionId={x.id} />

      {/* Details: secondary, folded on purpose. */}
      <details className="rounded-panel border border-line bg-elevated p-5 sm:p-6 dark:bg-surface">
        <summary className="type-app-subheading cursor-pointer text-fg">Transfer details</summary>
        <div className="mt-4">
          <Row k="You send" v={<Amount value={formatUnits(x.source.amountIn, x.source.assetId)} />} />
          {dst?.minAmountOut && <Row k="Minimum approved" v={<Amount value={formatUnits(dst.minAmountOut, dst.assetId)} />} />}
          {dst?.expectedAmountOut && <Row k="Expected (estimate)" v={<Amount value={formatUnits(dst.expectedAmountOut, dst.assetId)} />} />}
          <Row k="Received (verified on chain)" v={dst?.verifiedAmountOut ? <Amount value={formatUnits(dst.verifiedAmountOut, dst.assetId)} size="amount-total" /> : <span className="text-fg-2">Not verified yet</span>} />
          <Row k="Recipient" v={<Mono value={x.recipient.address} full />} />
          {x.refundAddress && <Row k="Refund address" v={<Mono value={x.refundAddress} full />} />}
          {t?.providerStatus && <Row k="NEAR Intents status" v={<span className="type-identifier">{t.providerStatus}</span>} />}
          <Row k="Execution reference" v={<Mono value={x.id} full />} />
        </div>
      </details>
    </div>
  );
}
