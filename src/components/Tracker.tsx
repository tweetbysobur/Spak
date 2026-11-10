"use client";
import { useCallback, useEffect, useState } from "react";
import type { ExecutionState } from "@/spak-in/types-client";
import type { TrackingView } from "@/tracking/service";
import { getNetwork } from "@/spak-in/registries/networks";
import { api, formatUnits, type ExecutionView } from "@/lib/client";
import { Button, Card, Row } from "./ui";
import { DepositPanel } from "./DepositPanel";
import { RecoveryPanel } from "./RecoveryPanel";

const LABEL: Record<ExecutionState, string> = {
  DRAFT: "Draft", QUOTED: "Quoted", AWAITING_APPROVAL: "Awaiting approval", AWAITING_DEPOSIT: "Waiting for your deposit",
  PROCESSING: "Processing", VERIFYING_DESTINATION: "Verifying delivery", REFUNDING: "Refund in progress", COMPLETED: "Completed", FAILED: "Failed", REFUNDED: "Refunded",
  EXPIRED: "Expired", CANCELLED: "Cancelled", UNKNOWN: "Unknown or delayed",
};
const TONE: Record<ExecutionState, string> = {
  DRAFT: "bg-white/10 text-white/70", QUOTED: "bg-white/10 text-white/70", AWAITING_APPROVAL: "bg-amber-400/15 text-amber-300",
  AWAITING_DEPOSIT: "bg-amber-400/15 text-amber-300", PROCESSING: "bg-sky-400/15 text-sky-300", VERIFYING_DESTINATION: "bg-sky-400/15 text-sky-300",
  REFUNDING: "bg-violet-400/15 text-violet-300", COMPLETED: "bg-emerald-400/15 text-emerald-300", FAILED: "bg-red-400/15 text-red-300", REFUNDED: "bg-violet-400/15 text-violet-300",
  EXPIRED: "bg-white/10 text-white/60", CANCELLED: "bg-white/10 text-white/60", UNKNOWN: "bg-white/10 text-white/60",
};
const TERMINAL: string[] = ["COMPLETED", "REFUNDED", "EXPIRED", "CANCELLED"];
const DOT: Record<string, string> = { done: "bg-emerald-400", current: "bg-sky-400 animate-pulse", halted: "bg-amber-400", pending: "bg-white/20" };
const net = (id: string) => getNetwork(id)?.name ?? id;
const time = (s: string | null) => (s ? new Date(s).toLocaleString() : "");

export function StateBadge({ state }: { state: string }) {
  const s = state as ExecutionState;
  return <span className={`rounded-full px-2.5 py-1 text-xs ${TONE[s] ?? TONE.UNKNOWN}`}>{LABEL[s] ?? state}</span>;
}

function TxLink({ hash, url }: { hash: string; url: string | null | undefined }) {
  const short = hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash;
  return url ? <a href={url} target="_blank" rel="noreferrer noopener" className="font-mono text-sky-300 underline">{short}</a> : <span className="font-mono">{short}</span>;
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
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Execution</h3>
        <StateBadge state={t?.state ?? x.state} />
      </div>
      {x.state === "AWAITING_DEPOSIT" && <DepositPanel execution={x} />}
      {x.state === "AWAITING_DEPOSIT" && d && <Button variant="ghost" className="mb-3" onClick={cancel}>Cancel before sending the deposit</Button>}

      {t && (
        <ol className="mb-4 space-y-1.5">
          {t.steps.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[s.status]}`} />
              <span className={s.status === "pending" ? "text-white/40" : ""}>{i + 1}. {s.label}</span>
              {s.at && <span className="ml-auto text-xs text-white/40">{time(s.at)}</span>}
            </li>
          ))}
        </ol>
      )}

      <Row k="Execution ID" v={x.id} mono />
      <Row k="From" v={`${formatUnits(x.source.amountIn, x.source.assetId)} on ${net(x.source.network)}`} />
      <Row k="To" v={`${net(x.destination.network)}`} />
      {dst?.expectedAmountOut && <Row k="Expected output (estimate)" v={formatUnits(dst.expectedAmountOut, dst.assetId)} />}
      {dst?.minAmountOut && <Row k="Minimum approved" v={formatUnits(dst.minAmountOut, dst.assetId)} />}
      <Row k="Received (verified on chain)" v={dst?.verifiedAmountOut ? formatUnits(dst.verifiedAmountOut, dst.assetId) : "Not verified yet"} />
      <Row k="Recipient" v={x.recipient.address} mono />
      {t?.sourceTxs.map((s) => <Row key={s.hash} k="Source transaction" v={<TxLink hash={s.hash} url={s.explorerUrl} />} />)}
      {t?.destinationTxs.map((s) => (
        <Row key={s.txHash} k={`Destination transaction (${s.outcome.toLowerCase().replaceAll("_", " ")})`} v={<TxLink hash={s.txHash} url={s.explorerUrl} />} />
      ))}
      {t?.providerStatus && <Row k="NEAR Intents status" v={t.providerStatus} />}
      {t && <Row k="Last updated" v={time(t.lastCheckedAt ?? t.updatedAt)} />}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {t?.state === "PROCESSING" && <p className="mt-3 text-sm text-sky-300">NEAR Intents has the deposit and is processing the cross-chain transfer. Delivery is not confirmed yet.</p>}
      {t?.state === "VERIFYING_DESTINATION" && <p className="mt-3 text-sm text-sky-300">NEAR Intents reports a destination transaction. SPak is checking it on {net(x.destination.network)} before calling this complete.</p>}
      {t?.state === "COMPLETED" && <p className="mt-3 text-sm text-emerald-300">Delivery verified by SPak on {net(x.destination.network)}: the recipient received {dst?.verifiedAmountOut ? formatUnits(dst.verifiedAmountOut, dst.assetId) : ""}.</p>}
      {t?.state === "REFUNDED" && <p className="mt-3 text-sm text-violet-300">The transfer did not complete. SPak verified on chain that {t.refund?.record?.verifiedAmount ? formatUnits(t.refund.record.verifiedAmount, x.source.assetId) : "the refund"} returned to {x.refundAddress}.</p>}
      {t && <RecoveryPanel executionId={x.id} view={t} onChange={setT} />}
      {t?.state === "UNKNOWN" && <p className="mt-3 text-sm text-white/70">Delayed or not verifiable yet. {t.note ?? ""} {t.needsReconciliation ? "SPak flagged this for manual review." : "SPak keeps checking."} Do not resend.</p>}
      {t && !TERMINAL.includes(t.state) && <Button variant="ghost" className="mt-3" onClick={checkNow} disabled={busy}>{busy ? "Checking" : "Check now"}</Button>}
    </Card>
  );
}
