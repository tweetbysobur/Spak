"use client";
import { useState } from "react";
import { NETWORKS } from "@/lib/spak-in/catalog";
import { postJSON, store, type QuoteRequest, type QuoteView, type TxRecord } from "@/lib/client";
import { Button, Card, Row } from "./ui";

const net = (id: string) => NETWORKS[id]?.name ?? id;

export function Review({ request, quote, onApproved, onCancel }: {
  request: QuoteRequest; quote: QuoteView; onApproved: (tx: TxRecord) => void; onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [ack, setAck] = useState(false);

  async function approve() {
    setBusy(true); setError(undefined);
    try {
      const live = await postJSON<QuoteView>("/api/quote", { ...request, approved: true });
      const tx: TxRecord = { id: live.depositAddress!, createdAt: new Date().toISOString(), request, quote: live, state: "awaiting_deposit" };
      store.saveTx(tx);
      onApproved(tx);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Review transaction</h3>
        <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs text-amber-300">Awaiting approval</span>
      </div>
      <Row k="Source network" v={net(quote.origin.blockchain)} />
      <Row k="Destination network" v={net(quote.destination.blockchain)} />
      <Row k="You send" v={`${quote.amountInFormatted} ${quote.origin.symbol}${quote.amountInUsd ? ` ($${Number(quote.amountInUsd).toFixed(2)})` : ""}`} />
      <Row k="You receive (expected)" v={`${quote.amountOutFormatted} ${quote.destination.symbol}${quote.amountOutUsd ? ` ($${Number(quote.amountOutUsd).toFixed(2)})` : ""}`} />
      <Row k="Minimum received" v={`${quote.minAmountOutFormatted} ${quote.destination.symbol}`} />
      <Row k="Max slippage" v={`${(quote.slippageBps / 100).toFixed(2)}%`} />
      <Row k="Execution fee" v={`${(quote.appFeeBps / 100).toFixed(2)}% (included in quote)`} />
      {quote.withdrawFeeFormatted && <Row k="Network fee (destination)" v={`${quote.withdrawFeeFormatted} ${quote.destination.symbol} (included)`} />}
      <Row k="Network fee (source)" v="Paid by your wallet when you deposit" />
      <Row k="Recipient" v={quote.recipient} mono />
      <Row k="Refund address" v={quote.refundTo} mono />
      {quote.timeEstimateSec !== undefined && <Row k="Estimated time" v={`~${quote.timeEstimateSec}s after deposit`} />}

      <label className="mt-4 flex items-start gap-2 text-xs text-white/70">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        I checked the recipient and amounts. Approving creates a NEAR Intents deposit address. Nothing moves until I send the deposit.
      </label>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button onClick={approve} disabled={!ack || busy}>{busy ? "Requesting deposit address" : "Approve"}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}
