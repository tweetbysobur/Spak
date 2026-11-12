"use client";
import { useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import { api, store, type IntentResult, type ProviderQuote, type Submission, type TxRecord } from "@/lib/client";
import { Button, Card, Row } from "./ui";
import { Icon } from "./Icon";

const net = (id: string | null) => (id ? getNetwork(id)?.name ?? id : "");
const usd = (v: string | null) => (v ? ` ($${Number(v).toFixed(2)})` : "");

export function Review({ intent, quote, onApproved, onCancel }: {
  intent: IntentResult; quote: ProviderQuote; onApproved: (tx: TxRecord) => void; onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [ack, setAck] = useState(false);
  const [dupe, setDupe] = useState(false);
  const plan = intent.plan!;
  const src = intent.source.asset?.symbol, dst = intent.destination.asset?.symbol;

  async function approve(allowDuplicate = false) {
    setBusy(true); setError(undefined);
    try {
      const approval = {
        intentId: plan.intentId, planId: plan.planId, planHash: plan.hash, approvedAt: new Date().toISOString(),
        idempotencyKey: `${plan.hash.slice(0, 32)}-${allowDuplicate ? "dup" : "1"}`, allowDuplicate,
      };
      const r = await api<{ submission: Submission; duplicate: boolean }>("/api/spak-in/submit", { plan, approval });
      const tx: TxRecord = { submission: r.submission, intent, quote: r.submission.quote ?? quote };
      store.saveTx(tx);
      onApproved(tx);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "DUPLICATE_SUSPECTED") setDupe(true);
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold" data-icon-hover><Icon name="approve" size={22} />Review transaction</h3>
        <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs text-amber-300">Awaiting approval</span>
      </div>
      <Row k="Type" v={intent.intentType.replaceAll("_", " ").toLowerCase()} />
      <Row k="Source network" v={net(intent.source.network)} />
      <Row k="Destination network" v={net(intent.destination.network)} />
      <Row k="You send" v={`${quote.amountIn} ${src}${usd(quote.amountInUsd)}`} />
      <Row k="You receive (expected)" v={`${quote.amountOut} ${dst}${usd(quote.amountOutUsd)}`} />
      <Row k="Minimum received" v={`${quote.minAmountOut} ${dst}`} />
      <Row k="Max slippage" v={`${plan.constraints.slippageBps / 100}%`} />
      {quote.fees.map((f) => <Row key={f.kind} k={f.kind === "PROVIDER" ? "Execution fee" : f.kind === "NETWORK" ? "Network fee (destination)" : "Refund fee"} v={`${f.amount}${f.asset ? ` ${f.asset.split(":")[0] === intent.destination.network ? dst : src}` : ""}${f.note ? `. ${f.note}` : ""}`} />)}
      <Row k="Network fee (source)" v="Paid by your wallet when you send the deposit" />
      <Row k="Recipient" v={intent.recipient?.address} mono />
      <Row k="Refund address" v={intent.refundAddress} mono />
      {quote.estimatedSeconds !== null && <Row k="Estimated time" v={`~${quote.estimatedSeconds}s after deposit`} />}
      {!!intent.assumptions.length && <ul className="mt-2 list-disc pl-4 text-xs text-white/50">{intent.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>}

      <label className="mt-4 flex items-start gap-2 text-xs text-white/70">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        I checked the recipient and amounts. Approving creates a NEAR Intents deposit address. Nothing moves until my wallet sends the deposit.
      </label>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => approve(false)} disabled={!ack || busy}>{busy ? "Preparing deposit" : "Approve"}</Button>
        {dupe && <Button variant="ghost" onClick={() => approve(true)} disabled={busy}>Yes, send it again</Button>}
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}
