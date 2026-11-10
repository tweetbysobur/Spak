/** Append-only audit trail for approvals, cancellations and other user-visible decisions. */
export interface AuditEvent {
  at: string;
  actor: string;
  event: string;
  ref: string;
  data: Record<string, unknown>;
}

export interface AuditLog {
  record(e: AuditEvent): Promise<void>;
}
