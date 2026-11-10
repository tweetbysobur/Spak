"use client";
import { useEffect, useState } from "react";
import { NETWORKS } from "@/lib/spak-in/catalog";
import { STATE_LABEL, TERMINAL, type TxState } from "@/lib/execution/status";
import { store, type TxRecord } from "@/lib/client";
import { Card, Row } from "./ui";

const TONE: Record<TxState, string> = {
  draft: "bg-white/10 text-white/70", awaiting_approval: "bg-amber-400/15 text-amber-300",
  awaiting_deposit: "bg-amber-400/15 text-amber-300", processing: "bg-sky-400/15 text-sky-300",
  completed: "bg-emerald-400/15 text-emerald-300", failed: "bg-red-400/15 text-red-300",
  refunded: "bg-violet-400/15 text-violet-300", expired: "bg-white/10 text-white/60",
  unknown: "bg-white/10 text-white/60",
};

export function StateBadge({ state }: { state: TxState }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs ${TONE[state]}`}>{STATE_LABEL[state]}</span>;
}

export function Tracker({ initial }: { initial: TxRecord }) {
  const [tx, setTx] = useState(initial);

  useEffect(() => {
    if (TERMINAL.includes(tx.state)) return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/status?depositAddress=${encodeURIComponent(tx.id)}&deadline=${encodeURIComponent(tx.quote.deadline)}`).then((x) => x.json());
        // A 404 before the first deposit is expected. Keep waiting instead of showing "unknown".
        const state: TxState = r.state === "unknown" && tx.state === "awaiting_deposit" ? "awaiting_deposit" : r.state;
        setTx((prev) => {
          const next = { ...prev, state, originTxHashes: r.originTxHashes, destinationTxHashes: r.destinationTxHashes };
          store.saveTx(next);
          return next;
        });
      } catch { /* keep last known state; retry next tick */ }
    }, 5000);
    return () => clearInterval(id);
  }, [tx.id, tx.state, tx.quote.deadline]);

  const q = tx.quote;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Execution</h3>
        <StateBadge state={tx.state} />
      </div>
      {tx.state === "awaiting_deposit" && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm">
          <p className="mb-2 text-amber-200">Send exactly {q.amountInFormatted} {q.origin.symbol} on {NETWORKS[q.origin.blockchain]?.name} to:</p>
          <p className="break-all font-mono text-xs text-white">{q.depositAddress}</p>
          {q.depositMemo && <p className="mt-2 font-mono text-xs">Memo: {q.depositMemo}</p>}
          <p className="mt-2 text-xs text-white/50">Deposit before {new Date(q.deadline).toLocaleTimeString()}. SPak watches this address and updates when NEAR Intents sees your deposit.</p>
        </div>
      )}
      <Row k="Route" v={`${q.amountInFormatted} ${q.origin.symbol} → ${q.amountOutFormatted} ${q.destination.symbol}`} />
      <Row k="Recipient" v={q.recipient} mono />
      {!!tx.originTxHashes?.length && <Row k="Deposit tx" v={tx.originTxHashes.join(", ")} mono />}
      {!!tx.destinationTxHashes?.length && <Row k="Delivery tx" v={tx.destinationTxHashes.join(", ")} mono />}
      {tx.state === "completed" && <p className="mt-3 text-sm text-emerald-300">NEAR Intents verified delivery to the recipient.</p>}
      {tx.state === "refunded" && <p className="mt-3 text-sm text-violet-300">The swap did not complete. Funds went back to {q.refundTo}.</p>}
      {tx.state === "unknown" && <p className="mt-3 text-sm text-white/60">No confirmed status yet. SPak keeps checking. Do not resend.</p>}
    </Card>
  );
}
