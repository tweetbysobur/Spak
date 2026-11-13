"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Button, Card, Field, Modal, Mono, SectionTitle, Spinner, inputCls } from "@/components/ui";
import { Notice } from "@/components/status";
import type { Session } from "@/components/session";
import { discoverNearWallets, signNear } from "@/wallets/near";
import type { AgentView } from "@/agents/service";
import { AgentWallets } from "./AgentWallets";
import { AgentAccount } from "./AgentAccount";

interface Events { items: { id: number; event: string; fromStatus: string | null; toStatus: string | null; at: string }[] }
const EVENT: Record<string, string> = {
  CREATED: "Agent created", CHALLENGE_ISSUED: "Ownership challenge issued", VERIFICATION_STARTED: "Verification started", VERIFIED: "Ownership verified",
  REVERIFIED: "Ownership verified again", RESUMED_BY_PROOF: "Resumed with a fresh proof", VERIFICATION_FAILED: "Verification failed", SUSPENDED: "Suspended", REVOKED: "Revoked",
};
const OWNERSHIP: Record<AgentView["ownership"]["state"], { text: string; role: string }> = {
  NOT_VERIFIED: { text: "Not verified", role: "pending" }, VERIFIED: { text: "Verified by SPak", role: "success" }, EXPIRED: { text: "Verification expired", role: "warning" },
  SUSPENDED: { text: "Suspended", role: "warning" }, REVOKED: { text: "Revoked", role: "neutral" },
};

function Dot({ role, children }: { role: string; children: React.ReactNode }) {
  return <span data-agent-role={role} className="type-status inline-flex items-center gap-2" style={{ color: `var(--spak-status-${role}-foreground)` }}><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `var(--spak-status-${role}-icon)` }} />{children}</span>;
}

/**
 * Agent identity and ownership proof (Stage 5). Every state shown comes from the server. "Verified" appears only when
 * the server says the proof is current. A dedicated Agent NEAR account is shown as not available: it does not exist yet.
 */
export function AgentIdentity({ session }: { session: Session }) {
  const [agent, setAgent] = useState<AgentView | null | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [account, setAccount] = useState(session.wallets.find((w) => w.family === "near")?.address ?? "");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [events, setEvents] = useState<Events["items"] | null>(null);
  const [confirm, setConfirm] = useState<"suspend" | "revoke" | null>(null);
  const [typed, setTyped] = useState("");

  const load = useCallback(async () => {
    try { const r = await api<{ agent: AgentView | null }>("/api/agents"); setAgent(r.agent); setError(undefined); } catch (e) { setError((e as Error).message); setAgent(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (agent) api<Events>(`/api/agents/${agent.id}/events`).then((r) => setEvents(r.items)).catch(() => setEvents(null)); }, [agent]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setResult(null);
    try { setAgent((await api<{ agent: AgentView }>("/api/agents", { displayName: name })).agent); } catch (err) { setResult({ ok: false, text: (err as Error).message }); } finally { setBusy(false); }
  }

  /** Called from the click so the NEAR wallet popup may open. The server checks everything. */
  async function verify() {
    if (!agent) return;
    setBusy(true); setResult(null);
    try {
      const wallets = await discoverNearWallets();
      const w = wallets.find((x) => x.available);
      if (!w) throw new Error("No NEAR wallet is available in this browser.");
      const c = await api<{ challengeId: string; method: string; message: string; nonce: string; recipient: string; accountId: string }>(`/api/agents/${agent.id}/challenge`, { accountId: account.trim() });
      const s = await signNear(w.id, { message: c.message, nonceB64: c.nonce, recipient: c.recipient, challengeId: c.challengeId });
      if (!s) { setResult({ ok: false, text: "The wallet left this page before returning a signature. Start verification again." }); return; }
      const r = await api<{ agent: AgentView }>(`/api/agents/${agent.id}/verify`, { challengeId: c.challengeId, method: c.method, accountId: s.accountId, publicKey: s.publicKey, signature: s.signature });
      setAgent(r.agent);
      setResult({ ok: true, text: `Ownership verified for ${r.agent.ownership.accountId}.` });
    } catch (err) { setResult({ ok: false, text: (err as Error).message }); await load(); } finally { setBusy(false); }
  }

  async function act(kind: "suspend" | "revoke") {
    if (!agent) return;
    setBusy(true);
    try {
      const r = await api<{ agent: AgentView }>(`/api/agents/${agent.id}/${kind}`, kind === "revoke" ? { confirm: typed } : {});
      setResult({ ok: true, text: kind === "revoke" ? "Agent revoked. You can create a new one." : "Agent suspended. Verify ownership again to resume." });
      if (kind === "revoke") { setAgent(null); setEvents(null); } else setAgent(r.agent);
    } catch (err) { setResult({ ok: false, text: (err as Error).message }); } finally { setBusy(false); setConfirm(null); setTyped(""); }
  }

  return (
    <Card>
      <SectionTitle sub="Your Agent identity is separate from your connected wallets. Proving ownership with a NEAR key gives SPak no key and no permission to move funds.">Agent identity</SectionTitle>
      {agent === undefined ? <Spinner label="Loading your Agent" /> : error ? <Notice role="warning" title="Agent identity could not be loaded">{error}</Notice> : !agent ? (
        <form onSubmit={create} className="flex flex-col gap-3" aria-label="Create Agent identity">
          <p className="type-body-sm text-fg-2">You have no Agent identity. Creating one needs no NEAR account and grants nothing. Manual Access keeps working either way.</p>
          <Field label="Agent name"><input className={inputCls} name="agentName" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div><Button type="submit" disabled={busy || name.trim().length < 2}>{busy ? "Creating" : "Create Agent identity"}</Button></div>
        </form>
      ) : (
        <div className="flex flex-col gap-4" data-agent-status={agent.status} data-ownership={agent.ownership.state}>
          <dl className="grid gap-3 sm:grid-cols-2 [&>div]:min-w-0">
            <div><dt className="type-label text-fg-2">Agent identity</dt><dd className="mt-1"><Dot role="neutral">Created</Dot><p className="type-body-sm mt-0.5 text-fg">{agent.displayName}</p><Mono value={agent.id} /></dd></div>
            <div><dt className="type-label text-fg-2">Ownership</dt><dd className="mt-1"><Dot role={OWNERSHIP[agent.ownership.state].role}>{OWNERSHIP[agent.ownership.state].text}</Dot>
              {agent.ownership.accountId && <p className="type-body-sm mt-0.5 text-fg [overflow-wrap:anywhere]">{agent.ownership.accountId}</p>}
              {agent.ownership.expiresAt && <p className="type-caption text-fg-2">Valid until {new Date(agent.ownership.expiresAt).toLocaleDateString()}</p>}</dd></div>
            
          </dl>
          {agent.ownership.attestationHash && <p className="type-caption text-fg-2">Ownership record (kept by SPak, not on chain): <span className="type-identifier">{agent.ownership.attestationHash.slice(0, 16)}…</span></p>}

          {agent.ownership.state !== "VERIFIED" && (
            <div className="flex flex-col gap-3 rounded-card border border-line p-4">
              <p className="type-app-subheading text-fg">{agent.status === "SUSPENDED" ? "Resume with a fresh ownership proof" : agent.ownership.state === "EXPIRED" ? "Verify ownership again" : "Verify ownership"}</p>
              <p className="type-body-sm text-fg-2">Your NEAR wallet signs a message naming this Agent and the account. It is not a transaction and costs nothing. SPak checks on NEAR that the key has full access to the account.</p>
              <Field label="NEAR account" hint={agent.ownership.accountId ? "This Agent is locked to this account." : "The account you will sign with."}>
                <input className={`${inputCls} type-address`} name="nearAccount" value={agent.ownership.accountId ?? account} disabled={!!agent.ownership.accountId} onChange={(e) => setAccount(e.target.value)} spellCheck={false} autoComplete="off" />
              </Field>
              <div><Button onClick={verify} disabled={busy || !(agent.ownership.accountId ?? account).trim()}>{busy ? "Waiting for your wallet" : "Sign with NEAR wallet"}</Button></div>
            </div>
          )}

          <AgentAccount agent={agent} />
          <AgentWallets agent={agent} session={session} />

          {result && <Notice role={result.ok ? "success" : "error"} title={result.ok ? "Done" : "Not verified"}>{result.text}</Notice>}

          <div className="flex flex-wrap gap-2">
            {agent.status !== "SUSPENDED" && <Button variant="ghost" size="sm" onClick={() => setConfirm("suspend")}>Suspend</Button>}
            <Button variant="danger" size="sm" onClick={() => setConfirm("revoke")}>Revoke</Button>
          </div>

          {events && (
            <details>
              <summary className="type-label cursor-pointer text-fg-2">Identity history</summary>
              <ol className="mt-2 flex flex-col">{events.slice().reverse().map((e) => <li key={e.id} className="type-body-sm flex justify-between gap-3 border-t border-line py-2"><span className="text-fg">{EVENT[e.event] ?? e.event}</span><span className="type-caption text-fg-2">{new Date(e.at).toLocaleString()}</span></li>)}</ol>
            </details>
          )}
        </div>
      )}
      {agent && <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm === "revoke" ? "Revoke this Agent?" : "Suspend this Agent?"}>
        {confirm === "revoke" ? <>
          <p className="type-body-sm text-fg-2">Revocation is permanent. This Agent can never be used again; you can create a new one. Your wallets and transfers are not affected.</p>
          <Field label="Type REVOKE to confirm"><input className={inputCls} name="confirmRevoke" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
          <div className="mt-4 flex gap-2"><Button variant="danger" disabled={typed !== "REVOKE" || busy} onClick={() => act("revoke")}>Revoke Agent</Button><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></div>
        </> : <>
          <p className="type-body-sm text-fg-2">The Agent stops counting as verified until you sign a fresh ownership proof. Your wallets and transfers are not affected.</p>
          <div className="mt-4 flex gap-2"><Button variant="danger" disabled={busy} onClick={() => act("suspend")}>Suspend Agent</Button><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></div>
        </>}
      </Modal>}
    </Card>
  );
}
