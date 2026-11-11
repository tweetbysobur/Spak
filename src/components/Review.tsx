"use client";
import { useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import { getAsset } from "@/spak-in/registries/assets";
import { api, formatUnits, type ExecutionView, type IntentResult, type Prepared, type QuoteView } from "@/lib/client";
import { classifyWalletError } from "@/wallets/errors";
import { Amount, Button, Card, ErrorText, Mono, Panel, Row } from "./ui";
import { Notice } from "./status";
import { Icon } from "./icons";

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
  const quoteRole = firm ? "pending" : "info";
  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="type-label text-fg-2">{firm ? "Step 2 of 7" : "Step 1 of 7"}</p>
        <span className="type-status inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1"
          style={{ color: `var(--spak-status-${quoteRole}-foreground)`, background: `var(--spak-status-${quoteRole}-background)`, borderColor: `var(--spak-status-${quoteRole}-border)` }}>
          <Icon name={quoteRole} size={14} />{firm ? "Firm quote" : "Indicative quote"}
        </span>
      </div>
      <h2 className="type-app-heading text-fg">{firm ? "Approve the firm quote" : "Review the estimate"}</h2>
      <p className="type-body-sm mt-1 mb-5 text-fg-2">
        {firm ? "These are the provider's committed terms for this deposit address. The expected output is not guaranteed; the minimum is the worst case after slippage."
          : "An estimate to check the route. You will see and approve the firm quote before anything can be sent."}
      </p>

      <Panel className="mb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="type-label text-fg-2">You send</span>
          <span className="text-right"><Amount value={formatUnits(quote.source.amountIn, src)} size="amount-display" />
            <span className="type-caption block text-fg-2">on {net(quote.source.network)}{usd(quote.source.amountInUsd)}</span></span>
        </div>
        <div className="my-3 border-t border-line" />
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="type-label text-fg-2">Minimum you receive</span>
          <span className="text-right"><Amount value={formatUnits(quote.destination.minAmountOut, dst)} size="amount-total" />
            <span className="type-caption block text-fg-2">on {net(quote.destination.network)}</span></span>
        </div>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="type-label text-fg-2">Expected to receive (not guaranteed)</span>
          <span className="text-right"><Amount value={formatUnits(quote.destination.amountOut, dst)} /><span className="type-amount-fee text-fg-2">{usd(quote.destination.amountOutUsd)}</span></span>
        </div>
      </Panel>

      <Row k="Type" v={intent.intentType.replaceAll("_", " ").toLowerCase()} />
      <Row k="From" v={`${srcSym} on ${net(quote.source.network)}`} />
      <Row k="To" v={`${dstSym} on ${net(quote.destination.network)}`} />
      <Row k="Max slippage" v={<span className="type-amount">{quote.slippageBps / 100}%</span>} />
      {fees.map((f) => (
        <Row key={f.kind} k={f.kind === "PROVIDER_APP_FEE" ? "Protocol fee" : f.kind === "DESTINATION_NETWORK" ? "Destination network fee" : "Refund fee (only if refunded)"}
          v={<><span className="type-amount-fee">{f.bps !== undefined ? `${f.bps / 100}% of the input` : formatUnits(f.amount, f.assetId ?? src)}</span><span className="type-caption block text-fg-2">{f.note}</span></>} />
      ))}
      <Row k="Source network fee" v={`Paid in ${net(quote.source.network)} gas by your wallet; shown in the wallet before you sign`} />
      <Row k="Total cost" strong v={<><Amount value={formatUnits(quote.source.amountIn, src)} size="amount-total" /><span className="type-caption block text-fg-2">+ source network fee (protocol and destination fees come out of the output)</span></>} />
      <Row k="Recipient" v={<Mono value={execution.recipient.address} full />} />
      <Row k="Refund address" v={<Mono value={execution.refundAddress} full />} />
      {firm && quote.deposit && <Row k="Deposit address" v={<Mono value={quote.deposit.address} full />} />}
      {firm && quote.deposit?.memo && <Row k="Deposit memo (required)" v={<Mono value={quote.deposit.memo} full />} />}
      {firm && quote.deposit?.deadline && <Row k="Deposit deadline" v={new Date(quote.deposit.deadline).toLocaleString()} />}
      <Row k={firm ? "Approve before" : "Estimate valid until"} v={(firm ? approveBy : new Date(quote.expiresAt)).toLocaleTimeString()} />
      {quote.timeEstimateSec !== null && <Row k="Estimated time" v={`~${quote.timeEstimateSec}s after the deposit confirms`} />}
      <Row k="Execution reference" v={<Mono value={execution.id} full />} />
      <Row k="Quote reference" v={<Mono value={quote.id} full />} />
      {firm && indicative?.destination.amountOut && quote.destination.amountOut && (
        <p className="type-body-sm mt-3 text-fg-2">Firm expected output vs the estimate: <span className="type-amount-fee text-fg">{formatUnits(quote.destination.amountOut, dst)}</span> vs <span className="type-amount-fee text-fg">{formatUnits(indicative.destination.amountOut, dst)}</span>.</p>
      )}

      {firm && (
        <label className="type-body-sm mt-5 flex items-start gap-3 rounded-card border border-line-strong bg-surface p-4 text-fg dark:bg-elevated">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--spak-primary)]" />
          <span>I approve exactly this transaction: send <b className="type-amount">{formatUnits(quote.source.amountIn, src)}</b> to the deposit address above, delivering at least <b className="type-amount">{formatUnits(quote.destination.minAmountOut, dst)}</b> to the recipient. My wallet will still ask me to sign the deposit.</span>
        </label>
      )}
      {dupe && <Notice role="warning" title="You started the same transfer recently" className="mt-4">Approve again only if you really want to send it twice.</Notice>}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
        <Button variant="ghost" onClick={async () => { await api(`/api/executions/${execution.id}/cancel`, {}).catch(() => {}); onCancel(); }}>Cancel</Button>
        {dupe && <Button variant="secondary" onClick={() => approve(true)} disabled={busy}>Yes, do it again</Button>}
        {stale ? <Button onClick={requote} disabled={busy}>Get a new quote</Button>
          : firm ? <Button onClick={() => approve(false)} disabled={!ack || busy}>{busy ? "Approving" : "Approve"}</Button>
          : <Button onClick={getFirm} disabled={busy}>{busy ? "Getting firm quote" : "Get firm quote"}</Button>}
      </div>
    </Card>
  );
}
