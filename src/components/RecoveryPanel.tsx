"use client";
import { PROVIDER_LABEL } from "@/environment";
import { useState } from "react";
import type { TrackingView } from "@/tracking/service";
import { api, formatUnits } from "@/lib/client";
import { classifyWalletError } from "@/wallets/errors";
import { Amount, Button, ErrorText, Mono, Row, inputCls } from "./ui";
import { REFUND_LABEL, StatusBadge, failureRole } from "./status";
import { Icon } from "./icons";

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
  const role = failureRole(f.code, f.temporary);
  const amt = (v: string) => <Amount value={formatUnits(v, asset)} />;
  const note = (text: React.ReactNode, tone: "warning" | "info" = "info") => (
    <p className="type-body-sm mt-3 flex items-start gap-2 text-fg-2"><Icon name={tone} size={16} className="mt-0.5 shrink-0" style={{ color: `var(--spak-status-${tone}-icon)` }} /><span>{text}</span></p>
  );
  const TIMING: Record<string, string> = { EXPECTED_WINDOW: "within the expected time", LATE_TRANSACTION: "late (still eligible)", EARLY_TRANSACTION: "before your deposit (not a refund)", TIMING_UNKNOWN: "time not known yet" };
  return (
    <section aria-label="What happened and what to do" className="mt-5 rounded-card border p-4 sm:p-5" style={{ borderColor: `var(--spak-status-${role}-border)`, background: `var(--spak-status-${role}-background)` }}>
      <div className="flex items-start gap-3">
        <Icon name={role} size={22} className="mt-0.5 shrink-0" style={{ color: `var(--spak-status-${role}-icon)` }} />
        <div className="min-w-0 flex-1">
          <p className="type-error-title" style={{ color: `var(--spak-status-${role}-foreground)` }}>{f.title}</p>
          <p className="type-body-sm mt-1 text-fg">{f.message}</p>
        </div>
      </div>

      <div className="mt-4 rounded-card border border-line bg-elevated px-4 py-1 dark:bg-bg">
        <Row k="Original amount" v={amt(view.source.amountIn)} />
        <Row k="Refund address" v={<Mono value={view.refund?.instructions.refundTo ?? view.refundAddress} full />} />
        {r && <Row k="Refund status" v={<StatusBadge kind="refund" state={r.state} label={REFUND_LABEL[r.state] ?? r.state} />} />}
        {r?.depositedAmount && <Row k="Deposit received" v={amt(r.depositedAmount)} />}
        {view.refund?.transactions.length ? <Row k="Refund transactions" v={<span className="type-amount">{view.refund.transactions.length}</span>} /> : null}
        <Row k={`1. Refund reported by ${PROVIDER_LABEL} (not proof)`} v={r?.expectedAmount ? amt(r.expectedAmount) : <span className="text-fg-2">Not reported</span>} />
        <Row k="2. Transfers to your refund address seen on chain" v={r?.verifiedAmount && r.verifiedAmount !== "0" ? amt(r.verifiedAmount) : <span className="text-fg-2">None yet</span>} />
        <Row k="3. Refund verified and linked to this transfer" v={r?.associatedAmount && r.associatedAmount !== "0" ? <><Amount value={formatUnits(r.associatedAmount, asset)} size="amount-total" />{r.partial && <span className="type-caption block text-fg-2">less than the deposit</span>}</> : <span className="text-fg-2">Not yet</span>} />
        {r?.outstandingAmount && r.outstandingAmount !== "0" && <Row k="Outstanding (reported, not yet verified and linked)" v={amt(r.outstandingAmount)} />}
        {r?.quotedRefundFee && <Row k="Refund fee in the quote (not subtracted by SPak)" v={<Amount value={formatUnits(r.quotedRefundFee, asset)} size="amount-fee" />} />}
        {r?.evidenceCapability && <Row k="Automatic refund verification" v={r.evidenceCapability === "CONFIRMED" ? "Available" : `Unavailable: ${PROVIDER_LABEL} does not identify refund transactions`} />}
        {r?.reconciliation && <Row k="Post-refund check" v={r.reconciliation === "DISCREPANCY" ? "Provider data changed after the refund; under review" : `Consistent${r.reconciliationCheckedAt ? ` (checked ${new Date(r.reconciliationCheckedAt).toLocaleString()})` : ""}`} />}
        {view.review && <Row k="Manual review" v={<StatusBadge kind="execution" state="AWAITING_APPROVAL" label={`${view.review.status === "OPEN" ? "Review opened" : "Review in progress"} ${new Date(view.review.openedAt).toLocaleString()}`} />} />}
        <Row k="Last updated" v={new Date(view.updatedAt).toLocaleString()} />
      </div>

      {r?.state === "PARTIAL" && note("Part of the reported refund is verified. The rest has not been seen on chain yet. Refunds can arrive in more than one transaction.", "warning")}
      {(view.refund?.transactions.length ?? 0) > 1 && note("This refund has several transactions. Each is checked on its own; only verified, linked ones are added up.")}
      {r?.evidenceCapability && r.evidenceCapability !== "CONFIRMED" && r.providerListedAmount && r.providerListedAmount !== "0" &&
        note(<>{PROVIDER_LABEL} lists <span className="type-amount-fee text-fg">{formatUnits(r.providerListedAmount, asset)}</span> in transactions for this transfer, but does not say they are the refund. SPak keeps the refund open until that is confirmed and a person has checked it.</>, "warning")}
      {r?.evidenceCapability && r.evidenceCapability !== "CONFIRMED" && r.state !== "COMPLETED" &&
        note(`${PROVIDER_LABEL} reports refund amounts but not which transaction carried the refund. SPak checks every transfer on chain but cannot prove one is your refund, so a person reviews it. Nothing is marked returned until then.`)}
      {view.refund?.transactions.some((t) => t.timing === "LATE_TRANSACTION") && note("A refund transaction arrived later than usual. Late refunds still count once verified and linked; this is not a failure.")}

      {view.refund?.transactions.map((t) => {
        const aRole = t.association === "PROVIDER_LISTED" ? "success" : t.association === "REJECTED" ? "error" : "warning";
        return (
          <div key={t.txHash} className="mt-3 rounded-card border border-line bg-elevated p-3 dark:bg-bg">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="type-label text-fg">{t.submitted ? "Submitted transaction (a candidate, not a confirmed refund)" : `Transaction listed by ${PROVIDER_LABEL}`}</span>
              <Mono value={t.txHash} href={t.explorerUrl} />
            </div>
            <p className="type-body-sm mt-1 text-fg-2">Timing: {TIMING[t.timing] ?? t.timing}</p>
            <p className="type-body-sm text-fg-2">On chain: {t.chainVerified ? <>verified, {t.receivedAmount ? <span className="type-amount-fee text-fg">{formatUnits(t.receivedAmount, asset)}</span> : ""} to your refund address</> : t.outcome.toLowerCase().replaceAll("_", " ")}</p>
            <p className="type-body-sm mt-1 flex items-start gap-1.5" style={{ color: `var(--spak-status-${aRole}-foreground)` }}><Icon name={aRole} size={15} className="mt-0.5 shrink-0" />{t.associationExplanation}</p>
            {t.rejectedReason && <p className="type-body-sm" style={{ color: "var(--spak-status-error-foreground)" }}>{t.rejectedReason}</p>}
          </div>
        );
      })}

      <p className="type-label mt-4 text-fg">What to do</p>
      <ul className="type-body-sm mt-1 list-disc pl-5 text-fg">{f.actions.filter((a) => a !== "NONE").map((a) => <li key={a}>{ACTION[a] ?? a}</li>)}</ul>
      {f.actions.includes("SUBMIT_REFUND_TX") && <p className="type-body-sm mt-3 text-fg-2">Submitting a hash does not confirm your refund. SPak checks it on chain and counts it only if {PROVIDER_LABEL} links it to this transfer.</p>}
      {f.actions.includes("SUBMIT_REFUND_TX") && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor={`refund-${executionId}`}>Refund transaction hash</label>
          <input id={`refund-${executionId}`} className={`${inputCls} type-address flex-1`} placeholder="Refund transaction hash" value={hash} onChange={(e) => setHash(e.target.value)} />
          <Button variant="secondary" title={`Submitting a hash does not confirm the refund. SPak checks it and needs ${PROVIDER_LABEL} to link it to this transfer.`} disabled={busy || hash.trim().length < 10} onClick={() => act(() => api(`/api/executions/${executionId}/refund/transactions`, { txHash: hash.trim() }))}>Submit</Button>
        </div>
      )}
      {(f.actions.includes("CHECK_AGAIN") || f.actions.includes("VERIFY_REFUND")) && r && (
        <Button variant="secondary" className="mt-3" disabled={busy} onClick={() => act(() => api(`/api/executions/${executionId}/refund/verify`, {}))}>{busy ? "Checking" : "Check refund now"}</Button>
      )}
      {msg && <ErrorText>{msg}</ErrorText>}
      <p className="type-caption mt-4 text-fg-2">Reference: <span className="type-identifier">{executionId}</span></p>
    </section>
  );
}
