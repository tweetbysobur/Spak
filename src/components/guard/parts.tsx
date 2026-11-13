"use client";
import { useState, type ReactNode } from "react";
import { Notice } from "@/components/status";
import { Button } from "@/components/ui";
import type { GuardMessage } from "@/lib/guard";

/** Status in words with a dot, in the approved semantic colours. */
export function StatusDot({ role, children }: { role: string; children: ReactNode }) {
  return (
    <span data-guard-role={role} className="type-status inline-flex items-center gap-2" style={{ color: `var(--spak-status-${role}-foreground)` }}>
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `var(--spak-status-${role}-icon)` }} />{children}
    </span>
  );
}

/** Result of a save: the server's message, never a guess. */
export function SaveResult({ result }: { result: GuardMessage | null | "saved" }) {
  if (!result) return null;
  if (result === "saved") return <p role="status" className="type-body-sm text-fg-2">Saved. Guard confirmed the change.</p>;
  return (
    <Notice role="error" title={result.title}>
      {!!result.reasons.length && <ul className="list-disc pl-4">{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
    </Notice>
  );
}

/** A section with a read view and an edit form. Editing never changes what is shown until the server confirms. */
export function Editable({ title, sub, read, edit, editLabel = "Edit", id }: {
  title: string; sub?: string; id: string; editLabel?: string;
  read: ReactNode; edit: (close: () => void) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section aria-labelledby={`${id}-title`} data-guard-section={id} className="rounded-panel border border-line bg-elevated p-5 sm:p-6 dark:bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="type-app-heading text-fg">{title}</h2>
          {sub && <p className="type-body-sm mt-1 max-w-2xl text-fg-2">{sub}</p>}
        </div>
        {!editing && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>{editLabel}</Button>}
      </div>
      <div className="mt-4">{editing ? edit(() => setEditing(false)) : read}</div>
    </section>
  );
}

/** Save and cancel for an edit form. */
export function FormActions({ busy, onCancel, label = "Save" }: { busy: boolean; onCancel: () => void; label?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={busy}>{busy ? "Saving" : label}</Button>
      <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
    </div>
  );
}
