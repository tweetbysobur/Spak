"use client";
import { useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import { getAsset } from "@/spak-in/registries/assets";
import { api, formatUnits, type ExecutionView, type IntentResult, type Prepared, type QuoteView } from "@/lib/client";
import { classifyWalletError } from "@/wallets/errors";
import { Button, Card, Row } from "./ui";

const net = (id: string | null) => (id ? getNetwork(id)?.name ?? id : "");
const usd = (v: string | null | undefined) => (v ? ` (~$${Number(v).toFixed(2)})` : "");
const FIRM_APPROVAL_WINDOW_MS = 10 * 60_000;
type Fee = { kind: string; bps?: number; amount?: string; assetId?: string; note: string };

/**
 * Steps 1 and 2: review the indicative estimate, get the firm quote, and approve exactly that firm quote.
 * The server re-checks every approval; nothing here is trusted on its own.
 */
export function Review({ intent, execution, quote: initial, onApproved, onCancel }: {
  intent: IntentResult; execution: ExecutionView; quote: QuoteView; onApproved: (e: ExecutionView) => void; onCancel: () => void;
}) {
  const [quote, setQuote] = useState(initial);
  const [indicative, setIndicative] = useState<QuoteView | null>(initial.kind === "INDICATIVE" ? initial : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [ack, setAck] = useState(false);
  const [dupe, setDupe] = useState(false);
  const [stale, setStale] = useState(false);
  const firm = quote.kind === "FIRM";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(undefined);
    try { await fn(); } catch (e) {
      const k = classifyWalletError(e);
      if ((e as { code?: string }).code === "DUPLICATE_SUSPECTED") setDupe(true);
      if (k.kind === "QUOTE_EXPIRED") setStale(true);
      setError(k.message);
    } finally { setBusy(false); }
  };
  const getFirm = () => run(async () => {
    const r = await api<Prepared>(`/api/executions/${execution.id}/firm-quote`, { quoteId: quote.id });
    setQuote(r.quote); setAck(false);
  });
  const requote = () => run(async () => {
    const r = await api<Prepared>(`/api/executions/${execution.id}/quote`, {});
    setQuote(r.quote); setIndicative(r.quote); setStale(false); setAck(false);
  });
  const approve = (allowDuplicate = false) => run(async () => {
    const r = await api<{ execution: ExecutionView }>(`/api/executions/${execution.id}/approve`, {
      quoteId: quote.id, approval: { planHash: execution.plan.planHash, planRevision: execution.plan.revision, approvedAt: new Date().toISOString(), allowDuplicate },
    });
    onApproved(r.execution);
  });

  const src = quote.source.assetId, dst = quote.destination.assetId;
  const srcSym = getAsset(src)?.symbol ?? src, dstSym = getAsset(dst)?.symbol ?? dst;
  const fees = quote.fees as Fee[];
  const approveBy = new Date(Date.parse(quote.createdAt) + FIRM_APPROVAL_WINDOW_MS);
  return (
    <Card>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold">{firm ? "Step 2 of 7: approve the firm quote" : "Step 1 of 7: review the estimate"}</h3>
        <span className={`rounded-full px-2.5 py-1 text-xs ${firm ? "bg-sky-400/15 text-sky-300" : "bg-white/10 text-white/70"}`}>{firm ? "Firm quote" : "Indicative quote"}</span>
      </div>
      <p className="mb-3 text-xs text-white/50">
        {firm ? "These are the provider's committed terms for this deposit address. The expected output is not guaranteed; the minimum is the worst case after slippage."
          : "An estimate to check the route. You will see and approve the firm quote before anything can be sent."}
      </p>
      <Row k="Type" v={intent.intentType.replaceAll("_", " ").toLowerCase()} />
      <Row k="From" v={`${srcSym} on ${net(quote.source.network)}`} />
      <Row k="To" v={`${dstSym} on ${net(quote.destination.network)}`} />
      <Row k="You send" v={`${formatUnits(quote.source.amountIn, src)}${usd(quote.source.amountInUsd)}`} />
      <Row k="Expected to receive (not guaranteed)" v={`${formatUnits(quote.destination.amountOut, dst)}${usd(quote.destination.amountOutUsd)}`} />
      <Row k="Minimum you receive" v={formatUnits(quote.destination.minAmountOut, dst)} />
      <Row k="Max slippage" v={`${quote.slippageBps / 100}%`} />
      {fees.map((f) => (
        <Row key={f.kind} k={f.kind === "PROVIDER_APP_FEE" ? "Protocol fee" : f.kind === "DESTINATION_NETWORK" ? "Destination network fee" : "Refund fee (only if refunded)"}
          v={`${f.bps !== undefined ? `${f.bps / 100}% of the input` : formatUnits(f.amount, f.assetId ?? src)}. ${f.note}`} />
      ))}
      <Row k="Source network fee" v={`Paid in ${net(quote.source.network)} gas by your wallet; shown in the wallet before you sign`} />
      <Row k="Total cost" v={`${formatUnits(quote.source.amountIn, src)} + source network fee (protocol and destination fees come out of the output)`} />
      <Row k="Recipient" v={execution.recipient.address} mono />
      <Row k="Refund address" v={execution.refundAddress} mono />
      {firm && quote.deposit && <Row k="Deposit address" v={quote.deposit.address} mono />}
      {firm && quote.deposit?.memo && <Row k="Deposit memo (required)" v={quote.deposit.memo} mono />}
      {firm && quote.deposit?.deadline && <Row k="Deposit deadline" v={new Date(quote.deposit.deadline).toLocaleString()} />}
      <Row k={firm ? "Approve before" : "Estimate valid until"} v={(firm ? approveBy : new Date(quote.expiresAt)).toLocaleTimeString()} />
      {quote.timeEstimateSec !== null && <Row k="Estimated time" v={`~${quote.timeEstimateSec}s after the deposit confirms`} />}
      <Row k="Execution reference" v={execution.id} mono />
      <Row k="Quote reference" v={quote.id} mono />
      {firm && indicative?.destination.amountOut && quote.destination.amountOut && (
        <p className="mt-2 text-xs text-white/50">Firm expected output vs the estimate: {formatUnits(quote.destination.amountOut, dst)} vs {formatUnits(indicative.destination.amountOut, dst)}.</p>
      )}

      {firm && (
        <label className="mt-4 flex items-start gap-2 text-xs text-white/70">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
          I approve exactly this transaction: send {formatUnits(quote.source.amountIn, src)} to the deposit address above, delivering at least {formatUnits(quote.destination.minAmountOut, dst)} to the recipient. My wallet will still ask me to sign the deposit.
        </label>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {stale ? <Button onClick={requote} disabled={busy}>Get a new quote</Button>
          : firm ? <Button onClick={() => approve(false)} disabled={!ack || busy}>{busy ? "Approving" : "Approve"}</Button>
          : <Button onClick={getFirm} disabled={busy}>{busy ? "Getting firm quote" : "Get firm quote"}</Button>}
        {dupe && <Button variant="ghost" onClick={() => approve(true)} disabled={busy}>Yes, do it again</Button>}
        <Button variant="ghost" onClick={async () => { await api(`/api/executions/${execution.id}/cancel`, {}).catch(() => {}); onCancel(); }}>Cancel</Button>
      </div>
    </Card>
  );
}
