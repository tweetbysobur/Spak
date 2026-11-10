import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 ${className}`}>{children}</div>;
}

export function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  const base = "rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const style = variant === "primary" ? "bg-emerald-400 text-black hover:bg-emerald-300" : "border border-white/15 text-white hover:bg-white/5";
  return <button {...props} className={`${base} ${style} ${props.className ?? ""}`}>{children}</button>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-white/60">
      {label}
      {children}
    </label>
  );
}

export const inputCls = "rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/60";

export function Row({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-white/50">{k}</span>
      <span className={`text-right text-white ${mono ? "break-all font-mono text-xs" : ""}`}>{v}</span>
    </div>
  );
}
