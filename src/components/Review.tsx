"use client";
import { useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import { api, formatUnits, type ExecutionView, type IntentResult, type Prepared, type QuoteView } from "@/lib/client";
import { Button, Card, Row } from "./ui";

const net = (id: string | null) => (id ? getNetwork(id)?.name ?? id : "");
const usd = (v: string | null | undefined) => (v ? ` ($${Number(v).toFixed(2)})` : "");

/** Shows the indicative quote stored by SPak Execution and records the user's approval. */
export function Review({ intent, execution, quote: initial, onApproved, onCancel }: {
  intent: IntentResult; execution: ExecutionView; quote: QuoteView; onApproved: (e: ExecutionView) => void; onCancel: () => void;
}) {
  const [quote, setQuote] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [ack, setAck] = useState(false);
  const [dupe, setDupe] = useState(false);
  const [stale, setStale] = useState(false);

  async function approve(allowDuplicate = false) {
    setBusy(true); setError(undefined);
    try {
      const r = await api<{ execution: ExecutionView }>(`/api/executions/${execution.id}/approve`, {
        quoteId: quote.id, approval: { planHash: execution.plan.planHash, approvedAt: new Date().toISOString(), allowDuplicate },
      });
      onApproved(r.execution);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "DUPLICATE_SUSPECTED") setDupe(true);
      if (code === "QUOTE_EXPIRED" || code === "QUOTE_NOT_CURRENT" || code === "QUOTE_WORSE_THAN_APPROVED") setStale(true);
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function requote() {
    setBusy(true); setError(undefined);
    try {
      const r = await api<Prepared>(`/api/executions/${execution.id}/quote`, {});
      setQuote(r.quote); setStale(false); setAck(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const src = quote.source.assetId, dst = quote.destination.assetId;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Review transaction</h3>
        <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs text-amber-300">Awaiting approval</span>
      </div>
      <Row k="Type" v={intent.intentType.replaceAll("_", " ").toLowerCase()} />
      <Row k="Source network" v={net(quote.source.network)} />
      <Row k="Destination network" v={net(quote.destination.network)} />
      <Row k="You send" v={`${formatUnits(quote.source.amountIn, src)}${usd(quote.source.amountInUsd)}`} />
      <Row k="You receive (expected)" v={`${formatUnits(quote.destination.amountOut, dst)}${usd(quote.destination.amountOutUsd)}`} />
      <Row k="Minimum received" v={formatUnits(quote.destination.minAmountOut, dst)} />
      <Row k="Max slippage" v={`${quote.slippageBps / 100}%`} />
      {(quote.fees as { kind: string; bps?: number; amount?: string; assetId?: string; note: string }[]).map((f) => (
        <Row key={f.kind} k={f.kind === "PROVIDER_APP_FEE" ? "Execution fee" : f.kind === "DESTINATION_NETWORK" ? "Network fee (destination)" : "Refund fee"}
          v={`${f.bps !== undefined ? `${f.bps / 100}%` : formatUnits(f.amount, f.assetId ?? src)}. ${f.note}`} />
      ))}
      <Row k="Network fee (source)" v="Paid by your wallet when you send the deposit" />
      <Row k="Recipient" v={execution.recipient.address} mono />
      <Row k="Refund address" v={execution.refundAddress} mono />
      {quote.timeEstimateSec !== null && <Row k="Estimated time" v={`~${quote.timeEstimateSec}s after deposit`} />}
      <Row k="Quote valid until" v={new Date(quote.expiresAt).toLocaleTimeString()} />

      <label className="mt-4 flex items-start gap-2 text-xs text-white/70">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        I checked the recipient and amounts. Approving gets a firm NEAR Intents quote and a deposit address. Nothing moves until my wallet sends the deposit.
      </label>
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {stale ? <Button onClick={requote} disabled={busy}>Get a new quote</Button>
          : <Button onClick={() => approve(false)} disabled={!ack || busy}>{busy ? "Getting firm quote" : "Approve"}</Button>}
        {dupe && <Button variant="ghost" onClick={() => approve(true)} disabled={busy}>Yes, do it again</Button>}
        <Button variant="ghost" onClick={async () => { await api(`/api/executions/${execution.id}/cancel`, {}).catch(() => {}); onCancel(); }}>Cancel</Button>
      </div>
    </Card>
  );
}
