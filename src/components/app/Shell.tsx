"use client";
import { PROVIDER_LABEL } from "@/environment";
import { startTour } from "./Tour";
import { IS_TESTNET } from "@/environment";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon, type IconName } from "@/components/icons";
import { short } from "@/components/WalletsPanel";
import type { Session } from "@/components/session";
import { api } from "@/lib/client";

export type View = "overview" | "execute" | "activity" | "payments" | "portfolio" | "guard" | "agent" | "settings" | "guide";

/** Navigation. `planned` items open honest pages that say what is and is not live. */
export const NAV: { id: View; label: string; icon: IconName; planned?: boolean }[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "execute", label: "Execute", icon: "execute" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "payments", label: "Payments", icon: "wallet" },
  { id: "portfolio", label: "Intelligence", icon: "portfolio" },
  { id: "guard", label: "SPak Guard", icon: "guard" },
  { id: "agent", label: "Agent", icon: "agent" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "guide", label: "Guide", icon: "info" },
];
/** Phones show the four most used destinations in the bottom bar; the rest are in the account menu. */
const MOBILE: View[] = ["overview", "execute", "activity", "settings"];

const FAMILY: Record<string, string> = { evm: "EVM", solana: "Solana", near: "NEAR" };

function NavItem({ item, active, onSelect, compact = false }: { item: (typeof NAV)[number]; active: boolean; onSelect: (v: View) => void; compact?: boolean }) {
  return (
    <button onClick={() => onSelect(item.id)} aria-current={active ? "page" : undefined} data-tour={item.id}
      className={compact
        ? `type-caption flex min-h-14 flex-1 flex-col items-center justify-center gap-1 ${active ? "text-primary" : "text-fg-2"}`
        : `type-nav flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left transition-colors ${active ? "bg-secondary text-fg dark:bg-elevated" : "text-fg-2 hover:bg-secondary hover:text-fg dark:hover:bg-elevated"}`}>
      <Icon name={item.icon} size={compact ? 20 : 18} className={active ? "text-primary" : ""} />
      <span className="truncate">{item.label}</span>
      {item.planned && !compact && <span className="type-caption ml-auto rounded-full border border-dashed border-line-strong px-2 text-fg-2">Planned</span>}
    </button>
  );
}

/** Account menu: active wallet, session, and the destinations that do not fit the phone bar. */
function AccountMenu({ session, onSelect, signedOut }: { session: Session; onSelect: (v: View) => void; signedOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const w = session.wallets.find((x) => x.active) ?? session.wallets[0];
  const go = (v: View) => { setOpen(false); onSelect(v); };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" title={w?.address} data-tour="account"
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-3 text-fg hover:bg-secondary dark:hover:bg-elevated">
        <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--spak-status-success-icon)]" />
        <span className="type-label hidden text-fg-2 sm:inline">{w ? FAMILY[w.family] : ""}</span>
        <span className="type-address">{w ? short(w.address) : "No wallet"}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-40 w-72 rounded-card border border-line bg-elevated p-2 shadow-overlay dark:bg-surface">
          <div className="px-3 py-2">
            <p className="type-caption text-fg-2">Signed in with</p>
            <p className="type-address mt-1 break-all text-fg">{w?.address}</p>
            <p className="type-caption mt-1 text-fg-2">{session.wallets.length} wallet{session.wallets.length === 1 ? "" : "s"} linked · session ends {new Date(session.expiresAt).toLocaleDateString()}</p>
          </div>
          <div className="my-1 border-t border-line" />
          {NAV.filter((n) => !MOBILE.includes(n.id)).map((n) => (
            <button key={n.id} role="menuitem" onClick={() => go(n.id)} className="type-body-sm flex min-h-10 w-full items-center gap-3 rounded-control px-3 text-fg hover:bg-secondary lg:hidden dark:hover:bg-elevated">
              <Icon name={n.icon} size={16} className="text-fg-2" />{n.label}
            </button>
          ))}
          <button role="menuitem" onClick={() => { setOpen(false); startTour(); }} className="type-body-sm flex min-h-10 w-full items-center gap-3 rounded-control px-3 text-fg hover:bg-secondary dark:hover:bg-elevated">
            <Icon name="info" size={16} className="text-fg-2" />Take the tour
          </button>
          <button role="menuitem" onClick={() => go("settings")} className="type-body-sm flex min-h-10 w-full items-center gap-3 rounded-control px-3 text-fg hover:bg-secondary dark:hover:bg-elevated">
            <Icon name="wallet" size={16} className="text-fg-2" />Manage wallets
          </button>
          <button role="menuitem" onClick={async () => { await api("/api/auth/logout", {}); signedOut(); }}
            className="type-body-sm flex min-h-10 w-full items-center gap-3 rounded-control px-3 text-fg hover:bg-secondary dark:hover:bg-elevated">
            <Icon name="logout" size={16} className="text-fg-2" />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell({ session, view, onSelect, signedOut, title, notice, children }: {
  session: Session; view: View; onSelect: (v: View) => void; signedOut: () => void; title: string; notice?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_1fr]">
      {/* Sidebar: desktop */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-bg px-4 py-5 lg:flex">
        <Link href="/" aria-label="SPak home" className="px-3"><Logo className="h-7" /></Link>
        <nav aria-label="App" className="mt-8 flex flex-col gap-1">
          {NAV.map((n) => <NavItem key={n.id} item={n} active={view === n.id} onSelect={onSelect} />)}
        </nav>
        <div className="mt-auto rounded-card border border-line p-3">
          <p className="type-label text-fg">Your wallet signs every deposit</p>
          <p className="type-caption mt-1 text-fg-2">SPak prepares; you approve, or your Agent within limits you signed; your wallet signs. {IS_TESTNET ? "Executed through the Tidepool testnet sandbox." : `Executed through ${PROVIDER_LABEL}.`}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col overflow-x-clip">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-line bg-bg">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-8">
            <Link href="/" aria-label="SPak home" className="lg:hidden"><Logo compact className="h-7" /></Link>
            <h1 className="type-app-heading truncate text-fg">{title}</h1>
            <span className="flex-1" />
            <ThemeToggle />
            <AccountMenu session={session} onSelect={onSelect} signedOut={signedOut} />
          </div>
          {IS_TESTNET && (
            <p data-testnet-banner className="type-caption border-t border-line px-4 py-2 text-fg-2 sm:px-8">
              <span className="font-medium text-fg">Testnet.</span> Test tokens with no value, settled by Tidepool, a community-run sandbox not affiliated with NEAR or 1Click. Never send real funds.
            </p>
          )}
        </header>

        <main className="mx-auto w-full max-w-[72rem] flex-1 px-4 pb-28 pt-6 sm:px-8 lg:pb-12">
          {notice}
          {children}
        </main>
      </div>

      {/* Bottom bar: phones and tablets */}
      <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-bg pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.filter((n) => MOBILE.includes(n.id)).map((n) => <NavItem key={n.id} item={n} active={view === n.id} onSelect={onSelect} compact />)}
      </nav>
    </div>
  );
}
