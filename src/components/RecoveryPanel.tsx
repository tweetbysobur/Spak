"use client";
import { useState } from "react";
import type { TrackingView } from "@/tracking/service";
import { api, formatUnits } from "@/lib/client";
import { classifyWalletError } from "@/wallets/errors";
import { Button, inputCls, Row } from "./ui";

const REFUND_LABEL: Record<string, string> = {
  PENDING_PROVIDER: "Waiting for NEAR Intents to send the refund", INITIATED: "Refund started by NEAR Intents", TX_DETECTED: "Refund transaction found",
  VERIFICATION_PENDING: "Verifying the refund on chain", COMPLETED: "Refund verified on chain", FAILED: "Refund could not be verified",
  DELAYED: "Refund delayed", UNKNOWN: "Refund status unknown",
};
const ACTION: Record<string, string> = {
  WAIT: "No action needed. SPak keeps checking.", CHECK_AGAIN: "You can check again now.", START_NEW_TRANSFER: "Start a new transfer when ready. SPak never resends a deposit for you.",
  SUBMIT_REFUND_TX: "If the refund shows in your wallet, paste its transaction hash below.", VERIFY_REFUND: "Ask SPak to verify the refund now.",
  CONTACT_SUPPORT: "Contact SPak support with the execution ID.", MANUAL_REVIEW: "SPak's team reviews this by hand.",
};

/**
 * What happened, where the funds are, and what to do next. Funds are called returned only after SPak verified
 * the refund on chain. Never offers to resend a deposit or start a transfer automatically.
 */
export function RecoveryPanel({ executionId, view, onChange }: { executionId: string; view: TrackingView; onChange: (v: TrackingView) => void }) {
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const f = view.failure, r = view.refund?.record, asset = view.source.assetId;
  if (!f || f.category === "NONE") return null;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(undefined);
    try { await fn(); onChange(await api<TrackingView>(`/api/executions/${executionId}/tracking`)); }
    catch (e) { setMsg(classifyWalletError(e).message); } finally { setBusy(false); }
  };
  const tone = f.temporary ? "border-sky-400/30 bg-sky-400/5" : f.category === "REFUND" && f.code.startsWith("REFUND_COMPLETED") ? "border-emerald-400/30 bg-emerald-400/5" : "border-amber-400/30 bg-amber-400/5";
  return (
    <div className={`mt-4 rounded-xl border p-4 text-sm ${tone}`}>
      <p className="mb-1 font-medium">{f.title}</p>
      <p className="mb-3 text-white/70">{f.message}</p>
      <Row k="Original amount" v={formatUnits(view.source.amountIn, asset)} />
      <Row k="Refund address" v={view.refund?.instructions.refundTo ?? view.refundAddress} mono />
      {r && <Row k="Refund status" v={REFUND_LABEL[r.state] ?? r.state} />}
      {r?.depositedAmount && <Row k="Deposit received" v={formatUnits(r.depositedAmount, asset)} />}
      {r?.expectedAmount && <Row k="Refund reported by NEAR Intents (not verified)" v={formatUnits(r.expectedAmount, asset)} />}
      <Row k="Refund verified on chain" v={r?.verifiedAmount ? `${formatUnits(r.verifiedAmount, asset)}${r.partial ? " (partial)" : ""}` : "Not yet"} />
      {view.refund?.transactions.map((t) => (
        <Row key={t.txHash} k={`Refund transaction (${t.outcome.toLowerCase().replaceAll("_", " ")})`}
          v={t.explorerUrl ? <a className="font-mono text-sky-300 underline" href={t.explorerUrl} target="_blank" rel="noreferrer noopener">{t.txHash.slice(0, 10)}…{t.txHash.slice(-8)}</a> : t.txHash} />
      ))}
      {view.review && <Row k="Manual review" v={`${view.review.status === "OPEN" ? "Opened" : "In progress"} ${new Date(view.review.openedAt).toLocaleString()}`} />}
      <Row k="Last updated" v={new Date(view.updatedAt).toLocaleString()} />

      <ul className="mt-3 list-disc pl-4 text-xs text-white/70">{f.actions.filter((a) => a !== "NONE").map((a) => <li key={a}>{ACTION[a] ?? a}</li>)}</ul>
      {f.actions.includes("SUBMIT_REFUND_TX") && (
        <div className="mt-3 flex gap-2">
          <input className={`${inputCls} flex-1 font-mono`} placeholder="Refund transaction hash" value={hash} onChange={(e) => setHash(e.target.value)} />
          <Button variant="ghost" disabled={busy || hash.trim().length < 10} onClick={() => act(() => api(`/api/executions/${executionId}/refund/transactions`, { txHash: hash.trim() }))}>Submit</Button>
        </div>
      )}
      {(f.actions.includes("CHECK_AGAIN") || f.actions.includes("VERIFY_REFUND")) && r && (
        <Button variant="ghost" className="mt-3" disabled={busy} onClick={() => act(() => api(`/api/executions/${executionId}/refund/verify`, {}))}>{busy ? "Checking" : "Check refund now"}</Button>
      )}
      {msg && <p role="alert" className="mt-2 text-sm text-red-400">{msg}</p>}
      <p className="mt-3 text-xs text-white/40">Reference: {executionId}</p>
    </div>
  );
}
