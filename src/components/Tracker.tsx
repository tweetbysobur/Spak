"use client";
import { useCallback, useEffect, useState } from "react";
import type { TrackingView } from "@/tracking/service";
import { getNetwork } from "@/spak-in/registries/networks";
import { api, formatUnits, type ExecutionView } from "@/lib/client";
import { Amount, Button, Card, ErrorText, Mono, Row } from "./ui";
import { Notice, StatusBadge } from "./status";
import { Icon, type IconName } from "./icons";
import { statusRole } from "@/design/css";
import { DepositPanel } from "./DepositPanel";
import { RecoveryPanel } from "./RecoveryPanel";

const TERMINAL: string[] = ["COMPLETED", "REFUNDED", "EXPIRED", "CANCELLED"];
/** The current step takes the execution's own status role, so a step waiting on the user (AWAITING_DEPOSIT) reads as
 * pending, not as processing: nothing is implied to be moving before the user sends the deposit. */
function currentStep(state: string) {
  const role = statusRole("execution", state);
  return { icon: role as IconName, color: `var(--spak-status-${role}-icon)`, label: "current step" };
}
/** Timeline step markers. A finished step uses the brand primary (a checkpoint), not the success colour: only the
 * execution status says whether the whole transfer succeeded. */
const STEP: Record<string, { icon: IconName; color: string; label: string }> = {
  done: { icon: "success", color: "var(--spak-primary)", label: "done" },
  halted: { icon: "warning", color: "var(--spak-status-warning-icon)", label: "stopped" },
  pending: { icon: "neutral", color: "var(--spak-text-muted)", label: "not started" },
};
const net = (id: string) => getNetwork(id)?.name ?? id;
const time = (s: string | null) => (s ? new Date(s).toLocaleString() : "");

function TxLink({ hash, url }: { hash: string; url: string | null | undefined }) {
  return <Mono value={hash} href={url ?? undefined} />;
}

/**
 * Live view of one execution. SPak's background monitor does the work; this page reads the tracking view and,
 * while open, asks for a permitted refresh. Completed is shown only after SPak verified delivery on chain.
 */
export function Tracker({ initial }: { initial: ExecutionView }) {
  const [x, setX] = useState(initial);
  const [t, setT] = useState<TrackingView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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

  async function cancel() {
    try { setX(await api<ExecutionView>(`/api/executions/${x.id}/cancel`, {})); } catch (e) { setError((e as Error).message); }
  }
  async function checkNow() {
    setBusy(true); setError(undefined);
    try { await load(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const d = x.deposit;
  const dst = t?.destination;
  const state = t?.state ?? x.state;
  const refundAmount = t?.refund?.record?.associatedAmount && t.refund.record.associatedAmount !== "0" ? t.refund.record.associatedAmount : null;
  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="type-app-heading text-fg">Transfer</h2>
        <StatusBadge state={state} />
      </div>
      <p className="type-body-sm mb-5 text-fg-2">{net(x.source.network)} to {net(x.destination.network)}{t ? ` · last updated ${time(t.lastCheckedAt ?? t.updatedAt)}` : ""}</p>
      {x.state === "AWAITING_DEPOSIT" && <DepositPanel execution={x} />}
      {x.state === "AWAITING_DEPOSIT" && d && <Button variant="ghost" className="mb-5" onClick={cancel}>Cancel before sending the deposit</Button>}

      {t && (
        <ol className="mb-5 flex flex-col" aria-label="Progress">
          {t.steps.map((st, i) => {
            const m = st.status === "current" ? currentStep(x.state) : STEP[st.status] ?? STEP.pending;
            return (
              <li key={st.id} className="relative flex items-start gap-3 pb-4 last:pb-0">
                {i < t.steps.length - 1 && <span aria-hidden className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-line-strong" />}
                <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-elevated dark:bg-surface" style={{ color: m.color }}>
                  <Icon name={m.icon} size={14} className={st.status === "current" && statusRole("execution", x.state) === "processing" ? "spak-spin" : undefined} />
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
                  <span className={`type-body-sm ${st.status === "pending" ? "text-fg-2" : "text-fg"}`}>{st.label}<span className="sr-only"> ({m.label})</span></span>
                  {st.at && <span className="type-caption text-fg-2">{time(st.at)}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {t?.state === "PROCESSING" && <Notice role="processing" title="Cross-chain transfer in progress" className="mb-4">NEAR Intents has the deposit and is processing the cross-chain transfer. Delivery is not confirmed yet.</Notice>}
      {t?.state === "VERIFYING_DESTINATION" && <Notice role="processing" title="Verifying delivery" className="mb-4">NEAR Intents reports a destination transaction. SPak is checking it on {net(x.destination.network)} before calling this complete.</Notice>}
      {t?.state === "COMPLETED" && <Notice role="success" title="Delivery verified" className="mb-4">Delivery verified by SPak on {net(x.destination.network)}: the recipient received {dst?.verifiedAmountOut ? formatUnits(dst.verifiedAmountOut, dst.assetId) : ""}.</Notice>}
      {t?.state === "REFUNDED" && <Notice role="refunded" title="Refund verified" className="mb-4">The transfer did not complete. SPak verified on chain that {refundAmount ? formatUnits(refundAmount, x.source.assetId) : "the refund"} returned to {x.refundAddress}.</Notice>}
      {t?.state === "UNKNOWN" && <Notice role="warning" title="Unknown or delayed" className="mb-4">Delayed or not verifiable yet. {t.note ?? ""} {t.needsReconciliation ? "SPak flagged this for manual review." : "SPak keeps checking."} Do not resend.</Notice>}

      <Row k="From" v={<Amount value={formatUnits(x.source.amountIn, x.source.assetId)} />} />
      <Row k="On" v={net(x.source.network)} />
      <Row k="To" v={net(x.destination.network)} />
      {dst?.expectedAmountOut && <Row k="Expected output (estimate)" v={<Amount value={formatUnits(dst.expectedAmountOut, dst.assetId)} />} />}
      {dst?.minAmountOut && <Row k="Minimum approved" v={<Amount value={formatUnits(dst.minAmountOut, dst.assetId)} />} />}
      <Row k="Received (verified on chain)" v={dst?.verifiedAmountOut ? <Amount value={formatUnits(dst.verifiedAmountOut, dst.assetId)} size="amount-total" /> : <span className="text-fg-2">Not verified yet</span>} />
      <Row k="Recipient" v={<Mono value={x.recipient.address} full />} />
      {t?.sourceTxs.map((s) => <Row key={s.hash} k="Source transaction" v={<TxLink hash={s.hash} url={s.explorerUrl} />} />)}
      {t?.destinationTxs.map((s) => (
        <Row key={s.txHash} k={`Destination transaction (${s.outcome.toLowerCase().replaceAll("_", " ")})`} v={<TxLink hash={s.txHash} url={s.explorerUrl} />} />
      ))}
      {t?.providerStatus && <Row k="NEAR Intents status" v={<span className="type-identifier">{t.providerStatus}</span>} />}
      <Row k="Execution ID" v={<Mono value={x.id} full />} />

      {error && <ErrorText>{error}</ErrorText>}
      {t && <RecoveryPanel executionId={x.id} view={t} onChange={setT} />}
      {t && !TERMINAL.includes(t.state) && <Button variant="secondary" className="mt-4" onClick={checkNow} disabled={busy}>{busy ? "Checking" : "Check now"}</Button>}
    </Card>
  );
}
