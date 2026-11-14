"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { Button, Field, Modal, Mono, Spinner, inputCls } from "@/components/ui";
import { Notice } from "@/components/status";
import { discoverNearWallets, signNear } from "@/wallets/near";
import { listNetworks, getNetwork } from "@/spak-in/registries/networks";
import { findAssets, getAsset } from "@/spak-in/registries/assets";
import type { AgentView } from "@/agents/service";
import type { GrantView } from "@/agents/grants";

interface View {
  mode: "MANUAL" | "PREAUTHORIZED"; grant: GrantView | null; usage: { transactions: number; dayUsd: string } | null; history: GrantView[];
  approvals: { executionId: string; grantVersion: number | null; approvedAt: string; invalidatedAt: string | null }[];
}
interface Challenge { challengeId: string; message: string; nonce: string; recipient: string; accountId: string }

/** Networks a permission can name: the families SPak executes today. */
const NETS = listNetworks().filter((n) => n.family === "evm" || n.family === "solana");
const STATUS: Record<GrantView["status"], { text: string; role: string }> = {
  ACTIVE: { text: "Active", role: "success" }, PAUSED: { text: "Paused", role: "warning" }, REVOKED: { text: "Revoked", role: "neutral" },
  SUPERSEDED: { text: "Replaced by a newer version", role: "neutral" }, EXPIRED: { text: "Expired", role: "neutral" },
};
const name = (id: string) => getNetwork(id)?.name ?? id;
const token = (id: string) => { const a = getAsset(id); return a ? `${a.symbol} on ${name(a.network)}` : id; };

function Dot({ role, children }: { role: string; children: React.ReactNode }) {
  return <span className="type-status inline-flex items-center gap-2" style={{ color: `var(--spak-status-${role}-foreground)` }}><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `var(--spak-status-${role}-icon)` }} />{children}</span>;
}

/**
 * Agent permissions (Stage 10). Manual is the default: without a signed permission the user approves every transfer.
 * A permission is created only from a NEAR wallet signature over its exact limits; the server checks it. Pause and
 * revoke take effect at once. Nothing here can raise a limit without a new signature, and Guard still applies.
 */
export function AgentPermissions({ agent }: { agent: AgentView }) {
  const [v, setV] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [f, setF] = useState({ max: "25", day: "50", count: "5", hours: "24", src: [NETS[0]?.id ?? ""], dst: [NETS[1]?.id ?? NETS[0]?.id ?? ""], symbols: "USDC, ETH", self: true, addresses: "" });

  const load = useCallback(async () => { try { setV(await api<View>(`/api/agents/${agent.id}/permissions`)); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } }, [agent.id]);
  useEffect(() => { load(); }, [load]);

  const assets = useMemo(() => {
    const syms = f.symbols.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    const nets = [...new Set([...f.src, ...f.dst])];
    return [...new Set(syms.flatMap((s) => nets.flatMap((n) => findAssets(s, n).map((a) => a.id))))];
  }, [f.symbols, f.src, f.dst]);
  const parsedAddresses = f.addresses.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(":"); return { network: l.slice(0, i).trim(), address: l.slice(i + 1).trim() }; });

  /** From the click, so the wallet popup may open. The server verifies the signature against its own copy of the message. */
  async function sign() {
    setBusy(true); setMsg(null);
    try {
      const w = (await discoverNearWallets()).find((x) => x.available);
      if (!w) throw new Error("No NEAR wallet is available in this browser.");
      const c = await api<Challenge>(`/api/agents/${agent.id}/permissions/prepare`, {
        maxTransactionUsd: f.max.trim(), dailyLimitUsd: f.day.trim(), maxTransactions: Number(f.count), durationHours: Number(f.hours),
        sourceNetworks: f.src, destinationNetworks: f.dst, assets, recipients: { self: f.self, addresses: parsedAddresses },
      });
      const s = await signNear(w.id, { message: c.message, nonceB64: c.nonce, recipient: c.recipient, challengeId: c.challengeId });
      if (!s) { setMsg({ ok: false, text: "The wallet left this page before returning a signature. Nothing changed." }); return; }
      await api(`/api/agents/${agent.id}/permissions/confirm`, { challengeId: c.challengeId, accountId: s.accountId, publicKey: s.publicKey, signature: s.signature });
      setMsg({ ok: true, text: "Permission signed and checked. Your Agent may now approve transfers within it." }); setEditing(false);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); await load(); }
  }
  async function act(kind: "pause" | "resume" | "revoke") {
    setBusy(true); setMsg(null);
    try { await api(`/api/agents/${agent.id}/permissions/${kind}`, {}); setMsg({ ok: true, text: kind === "pause" ? "Paused. Every transfer needs your approval until you resume." : kind === "resume" ? "Resumed with the same limits." : "Revoked. You approve every transfer yourself." }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); setConfirmRevoke(false); await load(); }
  }
  const toggle = (k: "src" | "dst", id: string) => setF((p) => ({ ...p, [k]: p[k].includes(id) ? p[k].filter((x) => x !== id) : [...p[k], id] }));

  if (agent.ownership.state !== "VERIFIED") return null;
  if (!v) return <Spinner label="Loading Agent permissions" />;
  const g = v.grant;
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line p-4" data-agent-mode={v.mode}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="type-app-subheading text-fg">Approvals</p>
        <Dot role={v.mode === "PREAUTHORIZED" ? "success" : "neutral"}>{v.mode === "PREAUTHORIZED" ? "Agent may approve within limits" : "You approve every transfer"}</Dot>
      </div>
      <p className="type-body-sm text-fg-2">Your Agent can approve a quote for you only inside a permission you sign. Guard still checks every transfer, and your wallet still signs every deposit.</p>
      {g && (
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2 [&>div]:min-w-0" data-grant-status={g.status}>
          <div><dt className="type-label text-fg-2">Permission</dt><dd className="mt-0.5"><Dot role={STATUS[g.status].role}>{STATUS[g.status].text}</Dot><p className="type-caption text-fg-2">Version {g.version}, until {new Date(g.expiresAt).toLocaleString()}</p></dd></div>
          <div><dt className="type-label text-fg-2">Used</dt><dd className="type-body-sm mt-0.5 text-fg"><span className="type-amount">{v.usage?.transactions ?? 0}</span> of {g.scope.maxTransactions} transfers, <span className="type-amount">${v.usage?.dayUsd ?? "0"}</span> of ${g.scope.dailyLimitUsd} in 24 hours</dd></div>
          <div><dt className="type-label text-fg-2">Per transfer</dt><dd className="type-amount mt-0.5 text-fg">up to ${g.scope.maxTransactionUsd}</dd></div>
          <div><dt className="type-label text-fg-2">Routes</dt><dd className="type-body-sm mt-0.5 text-fg">{g.scope.sourceNetworks.map(name).join(", ")} to {g.scope.destinationNetworks.map(name).join(", ")}</dd></div>
          <div className="sm:col-span-2"><dt className="type-label text-fg-2">Tokens</dt><dd className="type-body-sm mt-0.5 text-fg">{g.scope.assets.map(token).join(", ")}</dd></div>
          <div className="sm:col-span-2"><dt className="type-label text-fg-2">Recipients</dt><dd className="type-body-sm mt-0.5 text-fg [overflow-wrap:anywhere]">{[g.scope.recipients.self ? "Your own wallets" : null, ...g.scope.recipients.addresses.map((a) => `${a.address} on ${name(a.network)}`)].filter(Boolean).join(", ")}</dd></div>
          <div className="sm:col-span-2"><dt className="type-label text-fg-2">Signed by</dt><dd className="mt-0.5"><Mono value={g.signerPublicKey} /></dd></div>
        </dl>
      )}
      {msg && <Notice role={msg.ok ? "success" : "error"} title={msg.ok ? "Done" : "Not changed"}>{msg.text}</Notice>}
      <div className="flex flex-wrap gap-2">
        {g?.status === "ACTIVE" && <Button variant="secondary" size="sm" disabled={busy} onClick={() => act("pause")}>Pause</Button>}
        {g?.status === "PAUSED" && <Button variant="secondary" size="sm" disabled={busy} onClick={() => act("resume")}>Resume</Button>}
        {g && (g.status === "ACTIVE" || g.status === "PAUSED") && <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirmRevoke(true)}>Revoke</Button>}
        {!editing && <Button size="sm" variant={g ? "ghost" : "primary"} disabled={busy} onClick={() => setEditing(true)}>{g && g.status !== "EXPIRED" ? "Change limits" : "Set limits"}</Button>}
      </div>

      {editing && (
        <form className="flex flex-col gap-3 border-t border-line pt-3" aria-label="Agent permission" onSubmit={(e) => { e.preventDefault(); sign(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Per transfer (USD)"><input className={`${inputCls} type-amount`} inputMode="decimal" name="maxUsd" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></Field>
            <Field label="Per 24 hours (USD)"><input className={`${inputCls} type-amount`} inputMode="decimal" name="dayUsd" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></Field>
            <Field label="Transfers at most" hint="1 to 20"><input className={`${inputCls} type-amount`} inputMode="numeric" name="maxCount" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></Field>
            <Field label="Valid for (hours)" hint="1 to 168"><input className={`${inputCls} type-amount`} inputMode="numeric" name="hours" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
          </div>
          {(["src", "dst"] as const).map((k) => (
            <fieldset key={k}><legend className="type-label text-fg-2">{k === "src" ? "Source networks" : "Destination networks"}</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{NETS.map((n) => <label key={n.id} className="type-body-sm inline-flex min-h-9 items-center gap-2 text-fg"><input type="checkbox" checked={f[k].includes(n.id)} onChange={() => toggle(k, n.id)} className="h-4 w-4 accent-[var(--spak-primary)]" />{n.name}</label>)}</div>
            </fieldset>
          ))}
          <Field label="Tokens (symbols)" hint={assets.length ? `Allows: ${assets.map(token).join(", ")}` : "No token matches these networks."}><input className={inputCls} name="symbols" value={f.symbols} onChange={(e) => setF({ ...f, symbols: e.target.value })} /></Field>
          <label className="type-body-sm inline-flex items-center gap-2 text-fg"><input type="checkbox" checked={f.self} onChange={(e) => setF({ ...f, self: e.target.checked })} className="h-4 w-4 accent-[var(--spak-primary)]" />Send to my own verified wallets</label>
          <Field label="Other recipients" hint="One per line, as network:address, for example base:0x…"><textarea className={`${inputCls} type-address min-h-20`} name="recipients" value={f.addresses} onChange={(e) => setF({ ...f, addresses: e.target.value })} spellCheck={false} /></Field>
          <p className="type-caption text-fg-2">Your NEAR wallet signs a message listing these exact limits. It is not a transaction and costs nothing. A new permission replaces the current one.</p>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !assets.length || !f.src.length || !f.dst.length}>{busy ? "Waiting for your wallet" : "Sign with NEAR wallet"}</Button><Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
        </form>
      )}

      {v.history.length > 0 && (
        <details>
          <summary className="type-label cursor-pointer text-fg-2">Permission history</summary>
          <ol className="mt-2 flex flex-col">{v.history.map((h) => <li key={h.id} className="type-body-sm flex flex-wrap justify-between gap-3 border-t border-line py-2"><span className="text-fg">Version {h.version}: up to ${h.scope.maxTransactionUsd} each, {h.scope.maxTransactions} transfers</span><span className="text-fg-2">{STATUS[h.status].text}</span></li>)}</ol>
          {v.approvals.length > 0 && <ol className="mt-2 flex flex-col">{v.approvals.map((a) => <li key={a.executionId} className="type-body-sm flex flex-wrap justify-between gap-3 border-t border-line py-2"><Mono value={a.executionId} /><span className="type-caption text-fg-2">Approved by your Agent (v{a.grantVersion}) {new Date(a.approvedAt).toLocaleString()}</span></li>)}</ol>}
        </details>
      )}
      <Modal open={confirmRevoke} onClose={() => setConfirmRevoke(false)} title="Revoke this permission?">
        <p className="type-body-sm text-fg-2">Your Agent stops approving at once. Transfers it approved but you have not funded will need to be started again. You can sign a new permission later.</p>
        <div className="mt-4 flex gap-2"><Button variant="danger" disabled={busy} onClick={() => act("revoke")}>Revoke permission</Button><Button variant="ghost" onClick={() => setConfirmRevoke(false)}>Cancel</Button></div>
      </Modal>
    </div>
  );
}
