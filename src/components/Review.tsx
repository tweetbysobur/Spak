"use client";
import { useEffect, useRef, useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import { getAsset } from "@/spak-in/registries/assets";
import { api, formatUnits, type ExecutionView, type IntentResult, type Prepared, type QuoteView } from "@/lib/client";
import { classifyWalletError } from "@/wallets/errors";
import { watchEvmWallets, type EvmWalletInfo } from "@/wallets/evm";
import { watchSolanaWallets, type SolanaWalletInfo } from "@/wallets/solana";
import { checkEvmWallet, checkSolanaWallet, requestEvmNetwork, sendEvmDeposit, sendSolanaDeposit } from "@/wallets/deposit";
import type { DepositTransaction } from "@/deposits/builder";
import type { DepositView } from "@/deposits/service";
import { Amount, Button, Card, ErrorText, Mono, Panel, Row } from "./ui";
import { Notice } from "./status";
import { Icon } from "./icons";

const net = (id: string | null) => (id ? getNetwork(id)?.name ?? id : "");
const usd = (v: string | null | undefined) => (v ? ` (~$${Number(v).toFixed(2)})` : "");
const FIRM_APPROVAL_WINDOW_MS = 10 * 60_000;
type Fee = { kind: string; bps?: number; amount?: string; assetId?: string; note: string };

type Stage = "firm" | "approve" | "prepare" | "wallet" | "submit";
const STAGES: { id: Stage; label: string }[] = [
  { id: "firm", label: "Lock the firm quote" }, { id: "approve", label: "Record your approval" },
  { id: "prepare", label: "Prepare the deposit" }, { id: "wallet", label: "Sign in your wallet" }, { id: "submit", label: "Send it to SPak to track" },
];

/**
 * Review and send in one action. One button locks the firm quote, records the approval, prepares the deposit and
 * opens the wallet that owns the refund address; the wallet signature is the user's authorization. Every step is
 * re-checked by the server. It stops and asks again if the firm minimum is below the minimum shown, and hands over to
 * the transfer page (manual wallet choice) whenever a step cannot finish on its own.
 */
export function Review({ intent, execution, quote: initial, onApproved, onCancel }: {
  intent: IntentResult; execution: ExecutionView; quote: QuoteView; onApproved: (e: ExecutionView, message?: string) => void; onCancel: () => void;
}) {
  const [quote, setQuote] = useState(initial);
  const [shownMin, setShownMin] = useState(initial.destination.minAmountOut);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string>();
  const [dupe, setDupe] = useState(false);
  const [stale, setStale] = useState(false);
  const [worse, setWorse] = useState(false);
  const [evm, setEvm] = useState<EvmWalletInfo[]>([]);
  const [sol, setSol] = useState<SolanaWalletInfo[]>([]);
  const card = useRef<HTMLDivElement>(null);
  const firm = quote.kind === "FIRM";
  const nearSource = quote.route.deposit === "MANUAL_HASH";

  useEffect(() => { const a = watchEvmWallets(setEvm), b = watchSolanaWallets(setSol); card.current?.scrollIntoView({ behavior: "smooth", block: "start" }); return () => { a(); b(); }; }, []);

  const requote = async () => {
    setBusy(true); setError(undefined);
    try { const r = await api<Prepared>(`/api/executions/${execution.id}/quote`, {}); setQuote(r.quote); setShownMin(r.quote.destination.minAmountOut); setStale(false); setWorse(false); }
    catch (e) { setError(classifyWalletError(e).message); } finally { setBusy(false); }
  };

  /** The wallet in this browser that controls the refund address, on the right network (asks to switch if needed). */
  async function walletFor(tx: DepositTransaction, sender: string) {
    if (tx.family === "evm") {
      for (const w of evm) {
        let c = await checkEvmWallet(w, tx).catch(() => null);
        if (!c?.accountOk) continue;
        if (!c.networkOk) { await requestEvmNetwork(w, tx.chainId); c = await checkEvmWallet(w, tx); if (!c.networkOk) continue; }
        return { send: () => sendEvmDeposit(w, tx) };
      }
    }
    if (tx.family === "solana") {
      for (const w of sol) { const c = checkSolanaWallet(w, tx, sender); if (c.accountOk && c.chainOk && c.canSend) return { send: () => sendSolanaDeposit(w, tx, sender) }; }
    }
    return null;
  }

  async function confirm(allowDuplicate = false) {
    setBusy(true); setError(undefined); setDupe(false);
    let approved: ExecutionView | null = null;
    try {
      // 1. Firm quote. If its minimum is below what the user saw, stop and show the new terms.
      let q = quote;
      if (!firm) {
        setStage("firm");
        q = (await api<Prepared>(`/api/executions/${execution.id}/firm-quote`, { quoteId: quote.id })).quote;
        setQuote(q);
        if (q.destination.minAmountOut && shownMin && BigInt(q.destination.minAmountOut) < BigInt(shownMin)) { setWorse(true); setShownMin(q.destination.minAmountOut); setStage(null); return; }
      }
      // 2. Approval of exactly this firm quote.
      setStage("approve");
      approved = (await api<{ execution: ExecutionView }>(`/api/executions/${execution.id}/approve`, {
        quoteId: q.id, approval: { planHash: execution.plan.planHash, planRevision: execution.plan.revision, approvedAt: new Date().toISOString(), allowDuplicate },
      })).execution;
      if (nearSource) { onApproved(approved, "Approved. Send the NEAR deposit shown below from your NEAR wallet."); return; }
      // 3. Deposit instructions, built by the server from the firm quote.
      setStage("prepare");
      const p = await api<{ deposit: DepositView; transaction: DepositTransaction }>(`/api/executions/${execution.id}/deposits`, {});
      // 4. The user's wallet signs and sends. This is the authorization; nothing moves without it.
      const w = await walletFor(p.transaction, p.deposit.sender);
      if (!w) { onApproved(approved, "Approved. Choose the wallet that holds the funds to send the deposit."); return; }
      setStage("wallet");
      let txHash: string;
      try { txHash = await w.send(); }
      catch (e) {
        if (classifyWalletError(e).kind === "CANCELLED") await api(`/api/deposits/${p.deposit.id}/reject`, { reason: "Rejected in the wallet" }).catch(() => {});
        onApproved(approved, `${classifyWalletError(e).message} Nothing was sent. You can send the deposit from the transfer page.`);
        return;
      }
      // 5. SPak verifies the deposit on chain and tracks the transfer from here.
      setStage("submit");
      await api<DepositView>(`/api/deposits/${p.deposit.id}/submit`, { txHash });
      onApproved(approved, "Deposit sent. SPak is confirming it on chain and tracking the transfer.");
    } catch (e) {
      const k = classifyWalletError(e);
      if ((e as { code?: string }).code === "DUPLICATE_SUSPECTED") setDupe(true);
      if (k.kind === "QUOTE_EXPIRED") setStale(true);
      if (approved) { onApproved(approved, `${k.message} The transfer is approved; continue on the transfer page.`); return; }
      setError(k.message);
    } finally { setBusy(false); setStage(null); }
  }

  const src = quote.source.assetId, dst = quote.destination.assetId;
  const srcSym = getAsset(src)?.symbol ?? src, dstSym = getAsset(dst)?.symbol ?? dst;
  const fees = quote.fees as Fee[];
  // Share of the input value lost to fees, from the provider's own USD figures for input and output (same source, so comparable).
  const inUsd = Number(quote.source.amountInUsd), outUsd = Number(quote.destination.amountOutUsd);
  const costPct = inUsd > 0 && outUsd >= 0 && Number.isFinite(inUsd) && Number.isFinite(outUsd) ? Math.max(0, (1 - outUsd / inUsd) * 100) : null;
  const approveBy = new Date(Date.parse(quote.createdAt) + FIRM_APPROVAL_WINDOW_MS);
  const quoteRole = firm ? "pending" : "info";
  const sendLabel = `${formatUnits(quote.source.amountIn, src)} ${srcSym}`;
  return (
    <div ref={card} className="scroll-mt-20">
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="type-label text-fg-2">Review and send</p>
        <span className="type-status inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1"
          style={{ color: `var(--spak-status-${quoteRole}-foreground)`, background: `var(--spak-status-${quoteRole}-background)`, borderColor: `var(--spak-status-${quoteRole}-border)` }}>
          <Icon name={quoteRole} size={14} />{firm ? "Firm quote" : "Indicative quote"}
        </span>
      </div>
      <h2 className="type-app-heading text-fg">Check the details, then confirm</h2>
      <p className="type-body-sm mt-1 mb-5 text-fg-2">
        {nearSource ? "Confirm locks the quote and records your approval. You then send the deposit from your NEAR wallet."
          : "Confirm locks the firm quote and opens your wallet. Nothing moves until you sign there. If the firm minimum comes in lower than shown, SPak stops and asks again."}
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
      <details className="mt-2">
        <summary className="type-body-sm min-h-10 cursor-pointer py-2 text-fg-2">References</summary>
        <Row k="Execution reference" v={<Mono value={execution.id} full />} />
        <Row k="Quote reference" v={<Mono value={quote.id} full />} />
      </details>
      {worse && (
        <Notice role="warning" title="The firm quote is lower than the estimate" className="mt-4">
          The firm minimum you receive is now {formatUnits(quote.destination.minAmountOut, dst)} {dstSym}. Confirm again to accept it, or cancel.
        </Notice>
      )}
      {stage && (
        <ol className="mt-5 flex flex-col gap-2" aria-live="polite" aria-label="Progress">
          {STAGES.filter((x) => !(nearSource && ["prepare", "wallet", "submit"].includes(x.id))).map((x) => {
            const at = STAGES.findIndex((y) => y.id === stage), me = STAGES.findIndex((y) => y.id === x.id);
            const state = me < at ? "done" : me === at ? "now" : "next";
            return (
              <li key={x.id} className={`type-body-sm flex items-center gap-2 ${state === "next" ? "text-fg-2" : "text-fg"}`}>
                <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${state === "done" ? "bg-primary" : state === "now" ? "border-2 border-primary motion-safe:animate-pulse" : "border border-line-strong"}`} />
                {x.label}{state === "now" && x.id === "wallet" ? ": check your wallet" : ""}
              </li>
            );
          })}
        </ol>
      )}
      {quote.route.delivery === "MANUAL_REVIEW" && (
        <Notice role="warning" title="SPak cannot confirm delivery on this route automatically" className="mt-4">
          SPak has no verified record of who pays out {dstSym} on {net(quote.destination.network)}. The transfer still runs, but SPak will mark it for manual review instead of complete until delivery is checked by hand.
        </Notice>
      )}
      {quote.route.deposit === "MANUAL_HASH" && (
        <Notice role="neutral" title="You send this deposit from your NEAR wallet" className="mt-4">
          After you approve, SPak shows the exact NEAR transaction. Send it from your NEAR wallet, then paste the transaction hash. SPak checks it on chain.
        </Notice>
      )}
      {costPct !== null && costPct >= 5 && (
        <Notice role="warning" title={`About ${costPct.toFixed(1)}% of this amount goes to fees`} className="mt-4">
          Network and bridge fees are mostly fixed, so they weigh more on small amounts. A larger amount costs less in percentage terms.
        </Notice>
      )}
      {dupe && <Notice role="warning" title="You started the same transfer recently" className="mt-4">Approve again only if you really want to send it twice.</Notice>}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
        <Button variant="ghost" onClick={async () => { await api(`/api/executions/${execution.id}/cancel`, {}).catch(() => {}); onCancel(); }}>Cancel</Button>
        {dupe && <Button variant="secondary" onClick={() => confirm(true)} disabled={busy}>Yes, send it again</Button>}
        {stale ? <Button onClick={requote} disabled={busy}>Get a new quote</Button>
          : <Button onClick={() => confirm(false)} disabled={busy} className="sm:min-w-56">{busy ? "Working" : nearSource ? `Confirm ${sendLabel}` : `Confirm and send ${sendLabel}`}</Button>}
      </div>
    </Card>
    </div>
  );
}
