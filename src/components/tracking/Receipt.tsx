"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { getNetwork } from "@/spak-in/registries/networks";
import { formatUnits, type ExecutionView } from "@/lib/client";
import type { TrackingView } from "@/tracking/service";
import { Amount, Mono } from "@/components/ui";

const net = (id: string) => getNetwork(id)?.name ?? id;
type Fee = { kind: string; bps?: number; amount?: string; assetId?: string; note?: string };
const FEE_NAME: Record<string, string> = { PROVIDER_APP_FEE: "Protocol fee, reflected in the output", DESTINATION_NETWORK: "Destination network fee, deducted from the output" };
const feeText = (f: Fee) => (f.amount && f.assetId ? formatUnits(f.amount, f.assetId) : f.bps != null ? `${f.bps / 100}%` : f.note ?? "–");

function Line({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line py-3 sm:grid-cols-[13rem_1fr] sm:gap-6">
      <dt className="type-label text-fg-2">{k}</dt>
      <dd className="min-w-0 text-fg [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/**
 * Receipt for a COMPLETED transfer. Every value comes from the execution, its firm quote and SPak's destination
 * verification. A value the server does not have shows a dash; nothing is filled in.
 */
export function Receipt({ x, t }: { x: ExecutionView; t: TrackingView }) {
  const firm = x.quotes.find((q) => q.id === x.firmQuoteId);
  // The refund fee applies only to refunds, so a completed receipt leaves it out.
  const fees = ((firm?.fees ?? []) as Fee[]).filter((f) => f.kind !== "REFUND");
  const verified = t.destinationTxs.filter((d) => d.outcome === "CONFIRMED");
  const dash = <span className="text-fg-2">–</span>;
  const isPayment = x.recipient.kind === "EXTERNAL";
  const [dl, setDl] = useState<string | null>(null);
  /** The server issues the receipt only after its own destination check; this saves exactly what it returns. */
  async function download() {
    setDl(null);
    try {
      const r = await api<unknown>(`/api/executions/${x.id}/receipt`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = `spak-${isPayment ? "payment" : "transfer"}-receipt-${x.id}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setDl((e as Error).message); }
  }
  return (
    <section aria-labelledby="receipt-title" className="rounded-panel border border-line bg-elevated p-5 sm:p-6 dark:bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="receipt-title" className="type-app-heading text-fg">{isPayment ? "Payment receipt" : "Receipt"}</h3>
        <p className="type-caption text-fg-2">{t.destination.verifiedAt ? new Date(t.destination.verifiedAt).toLocaleString() : ""}</p>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div><p className="type-label text-fg-2">You sent</p><div className="mt-1"><Amount value={formatUnits(x.source.amountIn, x.source.assetId)} size="amount-display" /></div><p className="type-caption text-fg-2">on {net(x.source.network)}</p></div>
        <div><p className="type-label text-fg-2">{isPayment ? "Recipient received" : "You received"}</p><div className="mt-1">{t.destination.verifiedAmountOut ? <Amount value={formatUnits(t.destination.verifiedAmountOut, t.destination.assetId)} size="amount-display" /> : dash}</div><p className="type-caption text-fg-2">on {net(x.destination.network)}</p></div>
      </div>
      <dl className="mt-5">
        <Line k="Recipient"><Mono value={x.recipient.address} full /></Line>
        <Line k="Source transaction">{t.sourceTxs.length ? t.sourceTxs.map((s) => <div key={s.hash}><Mono value={s.hash} href={s.explorerUrl ?? undefined} /></div>) : dash}</Line>
        <Line k="Destination transaction">{verified.length ? verified.map((d) => <div key={d.txHash}><Mono value={d.txHash} href={d.explorerUrl ?? undefined} /></div>) : dash}</Line>
        <Line k="Fees">{fees.length ? <ul className="flex flex-col gap-0.5">{fees.map((f, i) => <li key={i} className="type-body-sm"><span className="type-amount-fee">{feeText(f)}</span> <span className="text-fg-2">{FEE_NAME[f.kind] ?? f.kind.toLowerCase().replaceAll("_", " ")}</span></li>)}</ul> : dash}<p className="type-caption text-fg-2">Plus the source network fee paid by your wallet.</p></Line>
        <Line k="Minimum approved">{t.destination.minAmountOut ? <Amount value={formatUnits(t.destination.minAmountOut, t.destination.assetId)} /> : dash}</Line>
        <Line k="Verification"><span className="type-body-sm inline-flex items-center gap-2"><span aria-hidden className="h-2 w-2 rounded-full bg-[var(--spak-status-success-icon)]" />Verified on chain by SPak</span></Line>
        <Line k="Execution reference"><Mono value={x.id} full /></Line>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={download} className="type-button-sm min-h-10 rounded-control border border-line-strong px-4 text-fg hover:bg-secondary">Download receipt</button>
        <span className="type-caption text-fg-2">Anyone can check it: open the source and destination transactions on the explorer.</span>
      </div>
      {dl && <p role="alert" className="type-body-sm mt-2 text-[var(--spak-status-error-foreground)]">{dl}</p>}
    </section>
  );
}
