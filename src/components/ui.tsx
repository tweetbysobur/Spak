"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";

/* ------------------------------------------------------------------ surfaces */

/** Primary content surface. Light: white card, hairline border, 1px shadow. Dark: raised surface, no shadow. */
export function Card({ children, className = "", as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={`min-w-0 rounded-panel border border-line bg-elevated p-5 shadow-card dark:bg-surface sm:p-6 ${className}`}>{children}</As>;
}
/** Nested panel inside a card (secondary surface). */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-card border border-line bg-surface p-4 dark:bg-elevated ${className}`}>{children}</div>;
}
export function SectionTitle({ children, aside, sub }: { children: ReactNode; aside?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="type-app-heading text-fg">{children}</h2>{aside}</div>
      {sub && <p className="type-body-sm mt-1 text-fg-2">{sub}</p>}
    </div>
  );
}
export function Divider() { return <hr className="my-4 border-0 border-t border-line" />; }

/* ------------------------------------------------------------------ controls */

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active",
  secondary: "bg-secondary text-on-secondary hover:bg-secondary-hover active:bg-secondary-active",
  ghost: "border border-line-strong text-fg hover:bg-secondary active:bg-secondary-hover",
  danger: "border text-[var(--spak-status-error-foreground)] border-[var(--spak-status-error-border)] hover:bg-[var(--spak-status-error-background)]",
};
export function Button({ children, variant = "primary", size = "md", className = "", ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "sm" }) {
  const sz = size === "sm" ? "type-button-sm min-h-9 px-3" : "type-button min-h-11 px-4";
  return (
    <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-control transition-colors duration-[var(--spak-motion-fast)] ${sz} ${VARIANT[variant]}
      disabled:cursor-not-allowed disabled:border-disabled-line disabled:bg-disabled disabled:text-disabled-fg ${className}`}>{children}</button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="type-label text-fg-2">{label}</span>
      {children}
      {hint && <span className="type-caption text-fg-2">{hint}</span>}
    </label>
  );
}
/** Inputs and selects: 16px text (no iOS zoom), strong border (3:1), focus ring from tokens. */
export const inputCls = "type-body min-h-11 w-full min-w-0 rounded-control border border-line-strong bg-elevated px-3 py-2 text-fg placeholder:text-fg-3 dark:bg-bg disabled:bg-disabled disabled:text-disabled-fg";
export const selectCls = `${inputCls} appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9`;
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select {...props} className={`${inputCls} appearance-none pr-9 ${props.className ?? ""}`} />
      <svg aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M7 10l5 5 5-5" /></svg>
    </span>
  );
}
export function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="relative block">
      <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-2" />
      <input type="search" {...props} className={`${inputCls} pl-9 ${props.className ?? ""}`} />
    </span>
  );
}

/** `fill`: tabs share the row equally (mobile), so every tab stays visible without sideways scrolling. */
export function Tabs<T extends string>({ items, value, onChange, label, fill }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; fill?: boolean }) {
  return (
    <div role="tablist" aria-label={label} className={`flex min-w-0 gap-1 ${fill ? "" : "overflow-x-auto"}`}>
      {items.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`type-nav min-h-11 rounded-control transition-colors ${fill ? "min-w-0 flex-1 px-1 text-center leading-tight" : "whitespace-nowrap px-3"} ${value === t.id ? "bg-secondary text-on-secondary dark:bg-elevated dark:text-fg" : "text-fg-2 hover:bg-secondary hover:text-fg dark:hover:bg-elevated"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span role="status" className="inline-flex items-center gap-2 text-fg-2"><Icon name="processing" size={16} className="spak-spin" /><span className="type-body-sm">{label}</span></span>;
}
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      {/* Approved files only: Muted Sage symbol on light is decorative (allowed); the dark-theme file on dark. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo/spak-symbol-dark.svg" alt="" className="h-8 w-auto" />
      <p className="type-app-subheading text-fg">{title}</p>
      {children && <p className="type-body-sm max-w-sm text-fg-2">{children}</p>}
      {action}
    </div>
  );
}

/** Tooltip on hover and keyboard focus; the trigger keeps its own accessible text. */
export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-flex" aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className="type-caption pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-max max-w-64 -translate-x-1/2 rounded-control bg-fg px-2.5 py-1.5 text-bg shadow-overlay group-focus-within:block group-hover:block">{content}</span>
    </span>
  );
}

/** Modal dialog using the native <dialog>: focus trap, Escape to close, backdrop. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-panel border border-line bg-elevated p-0 text-fg shadow-overlay backdrop:bg-[color-mix(in_srgb,var(--spak-brand-graphite)_45%,transparent)] dark:bg-surface">
      <div className="flex items-center justify-between border-b border-line px-5 py-4"><h2 className="type-app-heading">{title}</h2>
        <button onClick={onClose} aria-label="Close" className="rounded-control p-2 text-fg-2 hover:bg-secondary"><Icon name="close" /></button></div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}

/** Toast: transient confirmation for non-critical events (copied, saved). Never for transaction outcomes. */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => { if (!message) return; const t = setTimeout(onDone, 2500); return () => clearTimeout(t); }, [message, onDone]);
  if (!message) return null;
  return <div role="status" className="type-body-sm fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-card bg-fg px-4 py-2.5 text-bg shadow-overlay">{message}</div>;
}

/* ------------------------------------------------------------------ data display */

/** Key/value row. Values are right-aligned; on narrow screens long values wrap under the key. */
export function Row({ k, v, mono, strong }: { k: string; v: ReactNode; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-line py-2.5 last:border-b-0">
      <span className="type-label shrink-0 text-fg-2">{k}</span>
      <span className={`min-w-0 max-w-full text-right text-fg ${mono ? "type-address" : strong ? "type-amount-total" : "type-body-sm"}`}>{v}</span>
    </div>
  );
}

/**
 * Amount: displays the exact formatted string (no rounding). formatUnits returns "<value> <SYMBOL>"; the symbol is
 * shown at the same size in secondary colour. Tabular numerals from the typography tokens.
 */
export function Amount({ value, size = "amount", className = "" }: { value: string; size?: "amount" | "amount-total" | "amount-display" | "amount-fee"; className?: string }) {
  const i = value.lastIndexOf(" ");
  const [num, sym] = i > 0 && /^[A-Za-z]/.test(value.slice(i + 1)) ? [value.slice(0, i), value.slice(i + 1)] : [value, ""];
  return (
    <span className={`type-${size} ${className}`}>
      {num}{sym && <> <span className="type-token-symbol text-fg-2">{sym}</span></>}
    </span>
  );
}

export const middle = (s: string, head = 6, tail = 4) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s);

/**
 * Address, hash or identifier. full: the whole value, wrapping anywhere (review and approval screens).
 * Otherwise truncated in the middle (6 + 4) with the full value in the tooltip. Always copyable.
 */
export function Mono({ value, full = false, href, copy = true }: { value: string; full?: boolean; href?: string | null; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = full ? value : middle(value);
  const body = href
    ? <a href={href} target="_blank" rel="noreferrer noopener" title={value} className="text-[var(--spak-status-processing-foreground)] underline decoration-1 underline-offset-2">{text}</a>
    : <span title={value}>{text}</span>;
  return (
    <span className="type-address inline-flex max-w-full items-start gap-1.5 text-left">
      <span className="min-w-0 [overflow-wrap:anywhere]">{body}</span>
      {copy && (
        <button type="button" aria-label={copied ? "Copied" : `Copy ${value}`} title={copied ? "Copied" : "Copy"}
          onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } }}
          className="-my-1 shrink-0 rounded-control p-1 text-fg-2 hover:bg-secondary hover:text-fg dark:hover:bg-elevated">
          <Icon name={copied ? "success" : "copy"} size={14} />
        </button>
      )}
    </span>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p role="alert" className="type-error-body mt-3 flex items-start gap-2 text-[var(--spak-status-error-foreground)]"><Icon name="error" size={16} className="mt-0.5 shrink-0" />{children}</p>;
}
