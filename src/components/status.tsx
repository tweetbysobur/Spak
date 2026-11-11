import { statusRole, type StatusRole } from "@/design/css";
import { Icon } from "./icons";

/** Plain-language labels for every real state. The label always accompanies the colour and icon. */
export const EXECUTION_LABEL: Record<string, string> = {
  DRAFT: "Draft", QUOTED: "Quoted", AWAITING_APPROVAL: "Awaiting approval", AWAITING_DEPOSIT: "Waiting for your deposit",
  PROCESSING: "Processing", VERIFYING_DESTINATION: "Verifying delivery", REFUNDING: "Refund in progress", COMPLETED: "Completed",
  FAILED: "Failed", REFUNDED: "Refunded", EXPIRED: "Expired", CANCELLED: "Cancelled", UNKNOWN: "Unknown or delayed",
};
export const DEPOSIT_LABEL: Record<string, string> = {
  WALLET_CONFIRMATION_REQUESTED: "Waiting for your wallet", SUBMITTED: "Submitted, not verified yet", VERIFICATION_PENDING: "Verifying on chain",
  CONFIRMED: "Deposit confirmed on chain", REJECTED: "Deposit rejected", FAILED: "Deposit transaction failed", EXPIRED: "Deposit expired",
};
export const REFUND_LABEL: Record<string, string> = {
  PENDING_PROVIDER: "Waiting for NEAR Intents to send the refund", INITIATED: "Refund started by NEAR Intents", TX_DETECTED: "Refund transaction found",
  VERIFICATION_PENDING: "Verifying the refund on chain", ASSOCIATION_PENDING: "Transfer found, not linked to this refund yet (under review)",
  PARTIAL: "Part of the reported refund verified", COMPLETED: "Refund fully verified and linked to this transfer", FAILED: "Refund could not be verified",
  DELAYED: "Refund delayed", UNKNOWN: "Refund status unknown",
};
const LABELS = { execution: EXECUTION_LABEL, deposit: DEPOSIT_LABEL, refund: REFUND_LABEL };

export const roleStyle = (role: StatusRole) => ({
  color: `var(--spak-status-${role}-foreground)`, background: `var(--spak-status-${role}-background)`, borderColor: `var(--spak-status-${role}-border)`,
});

/** Status badge: colour from the approved state mapping, plus icon and words. Never colour alone. */
export function StatusBadge({ kind = "execution", state, label }: { kind?: "execution" | "deposit" | "refund"; state: string; label?: string }) {
  const role = statusRole(kind, state);
  const text = label ?? LABELS[kind][state] ?? state.toLowerCase().replaceAll("_", " ");
  return (
    <span data-status-role={role} className="type-status inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1" style={roleStyle(role)}>
      <Icon name={role} size={14} style={{ color: `var(--spak-status-${role}-icon)` }} className={role === "processing" ? "spak-spin" : undefined} />
      {text}
    </span>
  );
}

/** Inline status message box (alerts, notices, confirmations). */
export function Notice({ role, title, children, className = "" }: { role: StatusRole; title?: string; children?: React.ReactNode; className?: string }) {
  return (
    <div role={role === "error" ? "alert" : "status"} data-status-role={role} className={`flex gap-3 rounded-card border p-4 ${className}`}
      style={{ background: `var(--spak-status-${role}-background)`, borderColor: `var(--spak-status-${role}-border)` }}>
      <Icon name={role} size={20} className="mt-0.5 shrink-0" style={{ color: `var(--spak-status-${role}-icon)` }} />
      <div className="min-w-0 flex-1">
        {title && <p className="type-error-title" style={{ color: `var(--spak-status-${role}-foreground)` }}>{title}</p>}
        {children && <div className="type-body-sm text-fg">{children}</div>}
      </div>
    </div>
  );
}

const FAILURE_ROLE: Record<string, StatusRole> = {
  REFUND_COMPLETED: "refunded", REFUND_COMPLETED_PARTIAL: "refunded",
  REFUND_EXPECTED: "pending", REFUND_ASSOCIATION_PENDING: "pending",
  REFUND_INITIATED: "processing", REFUND_VERIFICATION_PENDING: "processing", DESTINATION_DELAYED: "processing", DEPOSIT_VERIFICATION_UNAVAILABLE: "processing",
  REFUND_DELAYED: "warning", REFUND_PARTIAL: "warning", REFUND_STATUS_UNKNOWN: "warning", REFUND_RECONCILIATION_DISCREPANCY: "warning",
  PROVIDER_TIMEOUT: "warning", PROVIDER_INTERRUPTION: "warning", UNKNOWN_OUTCOME: "warning", DESTINATION_VERIFICATION_UNAVAILABLE: "warning",
  DESTINATION_UNVERIFIABLE: "warning", MANUAL_REVIEW_REQUIRED: "warning", INCOMPLETE_DEPOSIT: "warning",
  USER_CANCELLED: "neutral", QUOTE_EXPIRED: "neutral", DEPOSIT_EXPIRED: "neutral",
};
/**
 * Role for a failure classification (src/failures/classify.ts codes). Refunded only for a verified, completed refund;
 * temporary or unrecognised conditions are warnings, never success; confirmed failures are errors.
 */
export function failureRole(code: string, temporary: boolean): StatusRole {
  return FAILURE_ROLE[code] ?? (temporary ? "warning" : "error");
}
