"use client";
import { useEffect, useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import type { ExecutionState } from "@/spak-in/types-client";
import { api, store, type Submission, type TxRecord } from "@/lib/client";
import { Button, Card, Row } from "./ui";

const LABEL: Record<ExecutionState, string> = {
  PREPARING: "Preparing", AWAITING_DEPOSIT: "Waiting for your deposit", PROCESSING: "Processing", COMPLETED: "Completed",
  FAILED: "Failed", REFUNDED: "Refunded", EXPIRED: "Expired", CANCELLED: "Cancelled", UNKNOWN: "Unknown or delayed",
};
const TONE: Record<ExecutionState, string> = {
  PREPARING: "bg-white/10 text-white/70", AWAITING_DEPOSIT: "bg-amber-400/15 text-amber-300", PROCESSING: "bg-sky-400/15 text-sky-300",
  COMPLETED: "bg-emerald-400/15 text-emerald-300", FAILED: "bg-red-400/15 text-red-300", REFUNDED: "bg-violet-400/15 text-violet-300",
  EXPIRED: "bg-white/10 text-white/60", CANCELLED: "bg-white/10 text-white/60", UNKNOWN: "bg-white/10 text-white/60",
};
const TERMINAL: ExecutionState[] = ["COMPLETED", "FAILED", "REFUNDED", "EXPIRED", "CANCELLED"];

export function StateBadge({ state }: { state: ExecutionState }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs ${TONE[state]}`}>{LABEL[state]}</span>;
}

export function Tracker({ initial }: { initial: TxRecord }) {
  const [tx, setTx] = useState(initial);
  const [error, setError] = useState<string>();
  const s = tx.submission;

  useEffect(() => {
    if (TERMINAL.includes(s.state)) return;
    const t = setInterval(async () => {
      try {
        const next = await api<Submission>(`/api/spak-in/submissions/${s.id}`);
        setTx((p) => { const n = { ...p, submission: next }; store.saveTx(n); return n; });
      } catch { /* keep last known state; retry next tick */ }
    }, 5000);
    return () => clearInterval(t);
  }, [s.id, s.state]);

  async function cancel() {
    try {
      const next = await api<Submission>(`/api/spak-in/submissions/${s.id}/cancel`, {});
      setTx((p) => { const n = { ...p, submission: next }; store.saveTx(n); return n; });
    } catch (e) { setError((e as Error).message); }
  }

  const d = s.deposit;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Execution</h3>
        <StateBadge state={s.state} />
      </div>
      {s.state === "AWAITING_DEPOSIT" && d && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm">
          <p className="mb-2 text-amber-200">From your wallet, send exactly {d.amount} {tx.intent.source.asset?.symbol} on {getNetwork(d.network)?.name} to:</p>
          <p className="break-all font-mono text-xs text-white">{d.address}</p>
          {d.memo && <p className="mt-2 font-mono text-xs">Memo: {d.memo}</p>}
          <p className="mt-2 text-xs text-white/50">Send before {new Date(d.deadline).toLocaleTimeString()}. SPak watches this address and updates when NEAR Intents sees the deposit.</p>
          <Button variant="ghost" className="mt-3" onClick={cancel}>Cancel, I will not send it</Button>
        </div>
      )}
      <Row k="Route" v={`${tx.quote.amountIn} ${tx.intent.source.asset?.symbol} → ${tx.quote.amountOut} ${tx.intent.destination.asset?.symbol}`} />
      <Row k="Recipient" v={tx.intent.recipient?.address} mono />
      <Row k="Reference" v={s.id} mono />
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {s.state === "COMPLETED" && <p className="mt-3 text-sm text-emerald-300">NEAR Intents verified delivery to the recipient.</p>}
      {s.state === "REFUNDED" && <p className="mt-3 text-sm text-violet-300">The transaction did not complete. Funds went back to {tx.intent.refundAddress}.</p>}
      {s.state === "UNKNOWN" && <p className="mt-3 text-sm text-white/60">No confirmed status yet. SPak keeps checking. Do not resend.</p>}
    </Card>
  );
}
