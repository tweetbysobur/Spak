"use client";
import { useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import { api } from "@/lib/client";
import type { Session, WalletView } from "./session";
import { Button, Card } from "./ui";
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
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Connected wallets</h3>
          <Button variant="ghost" onClick={() => setLinking((x) => !x)}>{linking ? "Close" : "Link wallet"}</Button>
        </div>
        <p className="mb-4 text-xs text-white/50">SPak uses your active wallet for every network it is enabled on, and your other wallets for the rest. These addresses receive funds and refunds.</p>
        <ul className="flex flex-col gap-3">
          {session.wallets.map((w) => (
            <li key={w.id} className={`rounded-xl border p-3 ${w.active ? "border-emerald-400/40 bg-emerald-400/5" : "border-white/10"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs">{FAMILY[w.family]}</span>
                <span className="font-mono text-xs" title={w.address}>{short(w.address)}</span>
                {w.active && <span className="text-xs text-emerald-300">Active</span>}
                <span className="flex-1" />
                {!w.active && <button className="text-xs text-white/70 hover:text-white" onClick={() => patch(w, { active: true })}>Make active</button>}
                <button className="text-xs text-red-300/80 hover:text-red-300" onClick={() => run(() => api(`/api/wallets/${w.id}`, undefined, "DELETE"))}>Disconnect</button>
              </div>
              {w.networks.length > 1 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {w.networks.map((n) => (
                    <button key={n.id} onClick={() => toggle(w, n.id)} aria-pressed={n.enabled}
                      className={`rounded-full border px-2.5 py-1 text-xs ${n.enabled ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-white/10 text-white/40"}`}>
                      {getNetwork(n.id)?.name ?? n.id}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </Card>

      {linking && <WalletPicker purpose="LINK" onDone={async () => { setLinking(false); await refresh(); }} />}

      <Card>
        <h3 className="mb-1 font-semibold">SPak Agent identity</h3>
        <p className="mb-3 text-xs text-white/50">Your agent identity is a NEAR account you own. Linking it does not give SPak any key or signing power. Autonomous execution is not available yet.</p>
        {session.agent.status === "LINKED" ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-mono text-xs">{session.agent.nearAccountId}</span>
            <Button variant="ghost" onClick={() => run(() => api("/api/agent/identity", undefined, "DELETE"))}>Unlink</Button>
          </div>
        ) : nearWallets.length ? (
          <div className="flex flex-wrap gap-2">
            {nearWallets.map((w) => <Button key={w.id} variant="ghost" onClick={() => run(() => api("/api/agent/identity", { walletId: w.id }))}>Use {short(w.address)}</Button>)}
          </div>
        ) : <p className="text-xs text-white/40">Link a NEAR wallet first. Creating a new NEAR account from SPak comes later.</p>}
      </Card>

      <Card className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-xs text-white/50">Session ends {new Date(session.expiresAt).toLocaleDateString()} · {session.activeSessions} active session{session.activeSessions === 1 ? "" : "s"}</span>
        <Button variant="ghost" onClick={async () => { await api("/api/auth/logout", {}); signedOut(); }}>Sign out</Button>
        <Button variant="ghost" onClick={async () => { await api("/api/auth/logout-all", {}); signedOut(); }}>Sign out everywhere</Button>
      </Card>
    </div>
  );
}
