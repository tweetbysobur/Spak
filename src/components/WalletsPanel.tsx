"use client";
import { useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import { api } from "@/lib/client";
import type { Session, WalletView } from "./session";
import { Button, Card, ErrorText, Mono, SectionTitle } from "./ui";
import { WalletPicker } from "./WalletPicker";

const FAMILY: Record<string, string> = { evm: "EVM", solana: "Solana", near: "NEAR" };
export const short = (a: string) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Manual Access account management: wallets, active wallet, networks, agent identity, sign out. */
export function WalletsPanel({ session, refresh, signedOut }: { session: Session; refresh: () => Promise<void>; signedOut: () => void }) {
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); }
  };
  const patch = (w: WalletView, body: object) => run(() => api(`/api/wallets/${w.id}`, body, "PATCH"));
  const toggle = (w: WalletView, net: string) => {
    const on = w.networks.filter((n) => n.enabled).map((n) => n.id);
    return patch(w, { networks: on.includes(net) ? on.filter((n) => n !== net) : [...on, net] });
  };
  const nearWallets = session.wallets.filter((w) => w.family === "near");

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <SectionTitle aside={<Button variant="secondary" size="sm" onClick={() => setLinking((x) => !x)}>{linking ? "Close" : "Link wallet"}</Button>}
          sub="SPak uses your active wallet for every network it is enabled on, and your other wallets for the rest. These addresses receive funds and refunds.">
          Connected wallets
        </SectionTitle>
        <ul className="flex flex-col gap-3">
          {session.wallets.map((w) => (
            <li key={w.id} className={`rounded-card border p-4 ${w.active ? "border-primary bg-surface dark:bg-elevated" : "border-line"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="type-label rounded-control border border-line px-2 py-0.5 text-fg-2">{FAMILY[w.family]}</span>
                <Mono value={w.address} />
                {w.active && <span className="type-status rounded-full bg-primary px-2 py-0.5 text-on-primary">Active</span>}
                <span className="flex-1" />
                {!w.active && <Button variant="ghost" size="sm" onClick={() => patch(w, { active: true })}>Make active</Button>}
                <Button variant="danger" size="sm" onClick={() => run(() => api(`/api/wallets/${w.id}`, undefined, "DELETE"))}>Disconnect</Button>
              </div>
              {w.networks.length > 1 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {w.networks.map((n) => (
                    <button key={n.id} onClick={() => toggle(w, n.id)} aria-pressed={n.enabled}
                      className={`type-button-sm inline-flex min-h-9 items-center gap-1 rounded-full border px-3 ${n.enabled ? "border-primary bg-primary text-on-primary" : "border-line-strong text-fg-2 hover:bg-secondary"}`}>
                      {n.enabled && <span aria-hidden>✓</span>}{getNetwork(n.id)?.name ?? n.id}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        {error && <ErrorText>{error}</ErrorText>}
      </Card>

      {linking && <WalletPicker purpose="LINK" onDone={async () => { setLinking(false); await refresh(); }} />}

      <Card>
        <SectionTitle sub="Your agent identity is a NEAR account you own. Linking it does not give SPak any key or signing power. Autonomous execution is not available yet.">SPak Agent identity</SectionTitle>
        {session.agent.status === "LINKED" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Mono value={session.agent.nearAccountId ?? ""} full />
            <Button variant="ghost" onClick={() => run(() => api("/api/agent/identity", undefined, "DELETE"))}>Unlink</Button>
          </div>
        ) : nearWallets.length ? (
          <div className="flex flex-wrap gap-2">
            {nearWallets.map((w) => <Button key={w.id} variant="ghost" onClick={() => run(() => api("/api/agent/identity", { walletId: w.id }))}>Use {short(w.address)}</Button>)}
          </div>
        ) : <p className="type-body-sm text-fg-2">Link a NEAR wallet first. Creating a new NEAR account from SPak comes later.</p>}
      </Card>

      <Card className="flex flex-wrap items-center gap-2">
        <span className="type-body-sm flex-1 text-fg-2">Session ends {new Date(session.expiresAt).toLocaleDateString()} · {session.activeSessions} active session{session.activeSessions === 1 ? "" : "s"}</span>
        <Button variant="ghost" onClick={async () => { await api("/api/auth/logout", {}); signedOut(); }}>Sign out</Button>
        <Button variant="ghost" onClick={async () => { await api("/api/auth/logout-all", {}); signedOut(); }}>Sign out everywhere</Button>
      </Card>
    </div>
  );
}
