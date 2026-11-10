"use client";
import { useEffect, useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import type { ExecutionState } from "@/spak-in/types-client";
import { api, formatUnits, type ExecutionView } from "@/lib/client";
import { Button, Card, Row } from "./ui";

const LABEL: Record<ExecutionState, string> = {
  DRAFT: "Draft", QUOTED: "Quoted", AWAITING_APPROVAL: "Awaiting approval", AWAITING_DEPOSIT: "Waiting for your deposit",
  PROCESSING: "Processing", COMPLETED: "Completed", FAILED: "Failed", REFUNDED: "Refunded", EXPIRED: "Expired",
  CANCELLED: "Cancelled", UNKNOWN: "Unknown or delayed",
};
const TONE: Record<ExecutionState, string> = {
  DRAFT: "bg-white/10 text-white/70", QUOTED: "bg-white/10 text-white/70", AWAITING_APPROVAL: "bg-amber-400/15 text-amber-300",
  AWAITING_DEPOSIT: "bg-amber-400/15 text-amber-300", PROCESSING: "bg-sky-400/15 text-sky-300", COMPLETED: "bg-emerald-400/15 text-emerald-300",
  FAILED: "bg-red-400/15 text-red-300", REFUNDED: "bg-violet-400/15 text-violet-300", EXPIRED: "bg-white/10 text-white/60",
  CANCELLED: "bg-white/10 text-white/60", UNKNOWN: "bg-white/10 text-white/60",
};
const TERMINAL: string[] = ["COMPLETED", "FAILED", "REFUNDED", "EXPIRED", "CANCELLED"];

export function StateBadge({ state }: { state: string }) {
  const s = state as ExecutionState;
  return <span className={`rounded-full px-2.5 py-1 text-xs ${TONE[s] ?? TONE.UNKNOWN}`}>{LABEL[s] ?? state}</span>;
}

/** Live view of one execution. Polls SPak Execution, which asks NEAR Intents. */
export function Tracker({ initial }: { initial: ExecutionView }) {
  const [x, setX] = useState(initial);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (TERMINAL.includes(x.state)) return;
    const t = setInterval(async () => {
      try { setX(await api<ExecutionView>(`/api/executions/${x.id}/status`)); } catch { /* keep last known state */ }
    }, 5000);
    return () => clearInterval(t);
  }, [x.id, x.state]);

  async function cancel() {
    try { setX(await api<ExecutionView>(`/api/executions/${x.id}/cancel`, {})); } catch (e) { setError((e as Error).message); }
  }

  const d = x.deposit;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Execution</h3>
        <StateBadge state={x.state} />
      </div>
      {d && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm">
          <p className="mb-2 text-amber-200">From your wallet, send exactly {formatUnits(d.amount, d.assetId)} on {getNetwork(d.network)?.name} to:</p>
          <p className="break-all font-mono text-xs text-white">{d.address}</p>
          {d.memo && <p className="mt-2 font-mono text-xs">Memo: {d.memo}</p>}
          {d.deadline && <p className="mt-2 text-xs text-white/50">Send before {new Date(d.deadline).toLocaleString()}. SPak checks NEAR Intents for the deposit.</p>}
          <Button variant="ghost" className="mt-3" onClick={cancel}>Cancel, I will not send it</Button>
        </div>
      )}
      <Row k="Send" v={formatUnits(x.source.amountIn, x.source.assetId)} />
      {x.destination.amountOutSettled && <Row k="Delivered" v={formatUnits(x.destination.amountOutSettled, x.destination.assetId)} />}
      <Row k="Recipient" v={x.recipient.address} mono />
      <Row k="Reference" v={x.id} mono />
      {(x.destinationTxHashes as string[]).length > 0 && <Row k="Destination tx" v={(x.destinationTxHashes as string[]).join(", ")} mono />}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {x.state === "COMPLETED" && <p className="mt-3 text-sm text-emerald-300">NEAR Intents reported delivery with a destination transaction.</p>}
      {x.state === "REFUNDED" && <p className="mt-3 text-sm text-violet-300">The transaction did not complete. Funds went back to {x.refundAddress}.</p>}
      {x.state === "UNKNOWN" && <p className="mt-3 text-sm text-white/60">No confirmed status yet. SPak keeps checking. Do not resend.</p>}
    </Card>
  );
}
