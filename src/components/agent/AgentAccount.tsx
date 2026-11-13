"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Button, Mono, Spinner } from "@/components/ui";
import { Notice } from "@/components/status";
import type { AgentView } from "@/agents/service";
import type { AccountView } from "@/agents/accounts";
import { discoverNearWallets, signNear } from "@/wallets/near";

interface View { availability: "AVAILABLE" | "AGENT_NOT_VERIFIED" | "UNAVAILABLE"; unavailableReason: string | null; network: string | null; account: AccountView | null; failedAttempts: AccountView[] }
interface Prepared { challengeId: string; accountId: string; network: string; parentAccountId: string; ownerAccountId: string; ownerPublicKey: string; message: string; nonce: string; recipient: string }

const STATUS: Record<string, { text: string; role: string }> = {
  CREATION_PENDING: { text: "Creation pending on NEAR", role: "processing" }, CREATED: { text: "Created, checking ownership", role: "processing" },
  OWNERSHIP_VERIFICATION_PENDING: { text: "Ownership check pending", role: "pending" }, ACTIVE: { text: "Active, ownership verified on NEAR", role: "success" },
  SUSPENDED: { text: "Suspended with the Agent", role: "warning" }, RECOVERY_REQUIRED: { text: "Needs attention", role: "error" },
  REVOKED: { text: "Revoked in SPak (account remains on NEAR)", role: "neutral" }, CREATION_FAILED: { text: "Creation failed", role: "error" },
};
const REASON: Record<string, string> = {
  OWNER_KEY_MISSING: "Your owner key is no longer a full-access key on this account.", UNEXPECTED_SPAK_KEY: "A SPak key was found on the account. SPak must never have one.",
  ACCOUNT_NOT_FOUND: "NEAR does not show this account.", NAME_TAKEN: "The name was taken before creation.", PARENT_NOT_AUTHORIZED: "SPak's parent account could not sign.",
  NEAR_UNREACHABLE: "NEAR testnet could not be reached.", TRANSACTION_FAILED: "The creation transaction failed. Nothing was charged to you.", WRONG_NETWORK: "The server is not on testnet.",
};

/**
 * Dedicated Agent NEAR account (Stage 7, testnet). Every state comes from the server, which reads NEAR itself.
 * "Active" appears only after that check. The page never sees or asks for a private key.
 */
export function AgentAccount({ agent }: { agent: AgentView }) {
  const [v, setV] = useState<View | null>(null);
  const [plan, setPlan] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => api<View>(`/api/agents/${agent.id}/account`).then(setV).catch((e) => setMsg({ ok: false, text: (e as Error).message })), [agent.id]);
  useEffect(() => { load(); }, [load, agent.status]);

  async function review() {
    setBusy(true); setMsg(null);
    try { setPlan(await api<Prepared>(`/api/agents/${agent.id}/account/prepare`, {})); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  async function approve() {
    if (!plan) return;
    setBusy(true); setMsg(null);
    try {
      const w = (await discoverNearWallets()).find((x) => x.available);
      if (!w) throw new Error("No NEAR wallet is available in this browser.");
      const s = await signNear(w.id, { message: plan.message, nonceB64: plan.nonce, recipient: plan.recipient, challengeId: plan.challengeId });
      if (!s) { setMsg({ ok: false, text: "The wallet left this page before returning a signature. Start again." }); return; }
      const r = await api<{ account: AccountView }>(`/api/agents/${agent.id}/account/create`, { challengeId: plan.challengeId, accountId: s.accountId, publicKey: s.publicKey, signature: s.signature }, "POST", { "idempotency-key": `acct-${plan.challengeId}` });
      setPlan(null);
      setMsg(r.account.status === "ACTIVE" ? { ok: true, text: `${r.account.accountId} is active. NEAR shows your key as its only full-access key.` } : { ok: false, text: STATUS[r.account.status]?.text ?? r.account.status });
    } catch (e) { setMsg({ ok: false, text: /reject|cancel|denied/i.test((e as Error).message) ? "You cancelled in your wallet. Nothing was created." : (e as Error).message }); } finally { setBusy(false); await load(); }
  }
  async function recheck() {
    setBusy(true); setMsg(null);
    try { await api(`/api/agents/${agent.id}/account/verify`, {}); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); await load(); }
  }

  const a = v?.account;
  const st = a ? STATUS[a.status] : null;
  return (
    <section aria-labelledby="agent-account-title" data-agent-account={a?.status ?? v?.availability ?? "LOADING"} className="rounded-card border border-line p-4">
      <h3 id="agent-account-title" className="type-app-subheading text-fg">Dedicated Agent NEAR account</h3>
      <p className="type-body-sm mt-1 text-fg-2">A separate NEAR account for this Agent, not your personal one. Your key becomes its only full-access key; SPak gets no key on it and cannot sign for it. Creating it grants no permissions.</p>
      {!v ? <div className="mt-3"><Spinner label="Loading" /></div> : a ? (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 [&>div]:min-w-0">
          <div><dt className="type-label text-fg-2">Status</dt><dd className="mt-1 type-status inline-flex items-center gap-2" style={{ color: `var(--spak-status-${st!.role}-foreground)` }}><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `var(--spak-status-${st!.role}-icon)` }} />{st!.text}</dd>
            {a.recoveryReason && <p className="type-caption mt-1 text-fg-2">{REASON[a.recoveryReason] ?? a.recoveryReason}</p>}</div>
          <div><dt className="type-label text-fg-2">Account ({a.network})</dt><dd className="type-body-sm mt-1 text-fg [overflow-wrap:anywhere]">{a.accountId}</dd></div>
          <div><dt className="type-label text-fg-2">Owner key</dt><dd className="mt-1"><Mono value={a.ownerPublicKey} /></dd><p className="type-caption text-fg-2">{a.ownershipVerifiedAt ? `Verified on NEAR ${new Date(a.lastVerifiedAt ?? a.ownershipVerifiedAt).toLocaleString()}` : "Not verified yet"}</p></div>
          <div><dt className="type-label text-fg-2">Created</dt><dd className="type-body-sm mt-1 text-fg">{a.createdOnChainAt ? new Date(a.createdOnChainAt).toLocaleString() : "–"}</dd><p className="type-caption text-fg-2">Sponsored by SPak on testnet · {a.sponsorship.toLowerCase().replace("_", " ")}</p></div>
          {a.status !== "REVOKED" && a.status !== "ACTIVE" && <div className="sm:col-span-2"><Button size="sm" variant="ghost" disabled={busy} onClick={recheck}>{busy ? "Checking NEAR" : "Check on NEAR again"}</Button></div>}
          {a.status === "ACTIVE" && <div className="sm:col-span-2"><Button size="sm" variant="ghost" disabled={busy} onClick={recheck}>{busy ? "Checking NEAR" : "Re-verify ownership"}</Button></div>}
        </dl>
      ) : v.availability === "UNAVAILABLE" ? (
        <p className="type-body-sm mt-3 text-fg-2" data-account-unavailable>Not available on this server yet. {v.unavailableReason}</p>
      ) : v.availability === "AGENT_NOT_VERIFIED" ? (
        <p className="type-body-sm mt-3 text-fg-2">Verify ownership of the Agent first.</p>
      ) : plan ? (
        <div className="mt-3 flex flex-col gap-3 rounded-control border border-line p-3">
          <p className="type-label text-fg">Review</p>
          <ul className="type-body-sm flex flex-col gap-1 text-fg-2">
            <li>Account: <span className="text-fg [overflow-wrap:anywhere]">{plan.accountId}</span> on NEAR {plan.network}</li>
            <li>Only full-access key: your owner key <Mono value={plan.ownerPublicKey} /></li>
            <li>Created by SPak&apos;s testnet account {plan.parentAccountId}, which keeps no control over it</li>
            <li>SPak pays the creation. You sign a message, not a transaction</li>
          </ul>
          <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={approve}>{busy ? "Waiting for your wallet" : "Approve in NEAR wallet"}</Button><Button variant="ghost" disabled={busy} onClick={() => setPlan(null)}>Cancel</Button></div>
        </div>
      ) : (
        <div className="mt-3"><Button size="sm" disabled={busy} onClick={review}>{busy ? "Preparing" : v.failedAttempts.length ? "Try again" : "Create dedicated account"}</Button></div>
      )}
      {!!v?.failedAttempts.length && !a && <p className="type-caption mt-2 text-fg-2">Last attempt: {REASON[v.failedAttempts[0].creationError ?? ""] ?? "failed"}</p>}
      {msg && <div className="mt-3"><Notice role={msg.ok ? "success" : "error"} title={msg.ok ? "Done" : "Not active"}>{msg.text}</Notice></div>}
    </section>
  );
}
