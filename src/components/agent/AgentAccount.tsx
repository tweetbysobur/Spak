"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Button, Field, Mono, Spinner, inputCls } from "@/components/ui";
import { Notice } from "@/components/status";
import type { AgentView } from "@/agents/service";
import type { AccountView } from "@/agents/accounts";
import { discoverNearWallets, signNear } from "@/wallets/near";

interface Rotation { id: string; status: string; newPublicKey: string; oldPublicKey: string; accountId: string; failureReason: string | null }
interface Infra { state: "NOT_CONFIGURED" | "UNAVAILABLE" | "READY"; reason: string | null; network: string | null; parentAccountId: string | null; sponsorship: { remainingYocto: string; sponsoredAccounts: number; maxSponsoredAccounts: number; initialBalanceYocto: string } | null }
interface View { infrastructure: Infra; availability: "AVAILABLE" | "AGENT_NOT_VERIFIED" | "UNAVAILABLE"; unavailableReason: string | null; network: string | null; account: AccountView | null; failedAttempts: AccountView[]; rotation: Rotation | null; keyRotationAvailable: boolean; recovery: "KEY_LOST_OR_CHANGED" | "RECHECK" | "OWNER_ACTION_NEEDED" | null }
interface RotationPlan { rotationId: string; message: string; nonce: string; recipient: string; accountId: string; currentPublicKey: string; newPublicKey: string; transaction: { signerId: string; receiverId: string; actions: { type: string; publicKey: string; permission?: string }[] } }
interface Prepared { challengeId: string; accountId: string; network: string; parentAccountId: string; ownerAccountId: string; ownerPublicKey: string; message: string; nonce: string; recipient: string }

const STATUS: Record<string, { text: string; role: string }> = {
  CREATION_PENDING: { text: "Creation pending on NEAR", role: "processing" }, CREATED: { text: "Created, checking ownership", role: "processing" },
  OWNERSHIP_VERIFICATION_PENDING: { text: "Ownership check pending", role: "pending" }, ACTIVE: { text: "Active, ownership verified on NEAR", role: "success" },
  SUSPENDED: { text: "Suspended with the Agent", role: "warning" }, RECOVERY_REQUIRED: { text: "Needs attention", role: "error" },
  REVOKED: { text: "Revoked in SPak (account remains on NEAR)", role: "neutral" }, CREATION_FAILED: { text: "Creation failed", role: "error" },
};
const near = (y: string) => `${(Number(BigInt(y) / 10n ** 18n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 4 })} NEAR`;
const INFRA: Record<Infra["state"], { text: string; role: string }> = { NOT_CONFIGURED: { text: "Not configured", role: "neutral" }, UNAVAILABLE: { text: "Temporarily unavailable", role: "warning" }, READY: { text: "Ready", role: "success" } };
const RESULT: Record<string, string> = { VERIFIED: "verified", RECOVERY_REQUIRED: "needs recovery", INCONCLUSIVE: "inconclusive (NEAR did not give enough evidence)" };
const REASON: Record<string, string> = { PARENT_INSUFFICIENT_BALANCE: "SPak's testnet parent account did not have enough NEAR.",
  OWNER_KEY_MISSING: "Your owner key is no longer a full-access key on this account.", PARENT_KEY_PRESENT: "A SPak key was found on the account. SPak must never have one.", UNEXPECTED_FULL_ACCESS_KEY: "Another full-access key is on the account.", UNEXPECTED_FUNCTION_CALL_KEY: "A limited (function-call) key is on the account.", OWNER_KEY_NOT_FULL_ACCESS: "Your key is on the account but without full access.", BINDING_MISMATCH: "The account does not match the request it was created for.", VERIFICATION_UNAVAILABLE: "NEAR could not confirm the account. Check again.",
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
  const [newKey, setNewKey] = useState("");
  const [rot, setRot] = useState<RotationPlan | null>(null);
  const [txHash, setTxHash] = useState("");
  async function startRotation() {
    setBusy(true); setMsg(null);
    try {
      const p = await api<RotationPlan>(`/api/agents/${agent.id}/account/rotation/prepare`, { newPublicKey: newKey.trim() });
      const w = (await discoverNearWallets()).find((x) => x.available);
      if (!w) throw new Error("No NEAR wallet is available in this browser.");
      const s = await signNear(w.id, { message: p.message, nonceB64: p.nonce, recipient: p.recipient, challengeId: p.rotationId });
      if (!s) { setMsg({ ok: false, text: "The wallet left this page before returning a signature. Start again." }); return; }
      await api(`/api/agents/${agent.id}/account/rotation/authorize`, { rotationId: p.rotationId, publicKey: s.publicKey, signature: s.signature });
      setRot(p);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); await load(); }
  }
  async function finishRotation(rotationId: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ rotation: Rotation }>(`/api/agents/${agent.id}/account/rotation/complete`, { rotationId, ...(txHash.trim() ? { txHash: txHash.trim() } : {}) });
      setMsg(r.rotation.status === "COMPLETED" ? { ok: true, text: "NEAR shows only your new key on the account. Rotation complete." } : r.rotation.status === "AUTHORIZED" ? { ok: false, text: "NEAR does not show the change yet. Check again once your transaction is final." } : { ok: false, text: `Rotation failed: ${(r.rotation.failureReason ?? "").toLowerCase().replaceAll("_", " ")}.` });
      if (r.rotation.status !== "AUTHORIZED") setRot(null);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); await load(); }
  }

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
      {v && (
        <div className="mt-3 rounded-control bg-secondary/40 p-3 dark:bg-bg" data-infrastructure={v.infrastructure.state}>
          <p className="type-label text-fg-2">NEAR testnet infrastructure (mainnet is not available)</p>
          <p className="type-status mt-1 inline-flex items-center gap-2" style={{ color: `var(--spak-status-${INFRA[v.infrastructure.state].role}-foreground)` }}><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `var(--spak-status-${INFRA[v.infrastructure.state].role}-icon)` }} />{INFRA[v.infrastructure.state].text}</p>
          {v.infrastructure.reason && <p className="type-caption text-fg-2">{v.infrastructure.reason}</p>}
          {v.infrastructure.parentAccountId && <p className="type-caption text-fg-2">Parent account: <span className="[overflow-wrap:anywhere]">{v.infrastructure.parentAccountId}</span> (credentials stay on the server)</p>}
          {v.infrastructure.sponsorship && <p className="type-caption text-fg-2">Sponsorship: {v.infrastructure.sponsorship.sponsoredAccounts} of {v.infrastructure.sponsorship.maxSponsoredAccounts} accounts used · {near(v.infrastructure.sponsorship.remainingYocto)} of budget left · {near(v.infrastructure.sponsorship.initialBalanceYocto)} per account</p>}
        </div>
      )}
      {!v ? <div className="mt-3"><Spinner label="Loading" /></div> : a ? (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 [&>div]:min-w-0">
          <div><dt className="type-label text-fg-2">Status</dt><dd className="mt-1 type-status inline-flex items-center gap-2" style={{ color: `var(--spak-status-${st!.role}-foreground)` }}><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `var(--spak-status-${st!.role}-icon)` }} />{st!.text}</dd>
            {a.recoveryReason && <p className="type-caption mt-1 text-fg-2">{REASON[a.recoveryReason] ?? a.recoveryReason}</p>}</div>
          <div><dt className="type-label text-fg-2">Account ({a.network})</dt><dd className="type-body-sm mt-1 text-fg [overflow-wrap:anywhere]">{a.accountId}</dd></div>
          <div><dt className="type-label text-fg-2">Owner key</dt><dd className="mt-1"><Mono value={a.ownerPublicKey} /></dd><p className="type-caption text-fg-2">{a.ownershipVerifiedAt ? `Verified on NEAR ${new Date(a.lastVerifiedAt ?? a.ownershipVerifiedAt).toLocaleString()}` : "Not verified yet"}</p></div>
          <div><dt className="type-label text-fg-2">Created</dt><dd className="type-body-sm mt-1 text-fg">{a.createdOnChainAt ? new Date(a.createdOnChainAt).toLocaleString() : "–"}</dd><p className="type-caption text-fg-2">Sponsored by SPak on testnet · {a.sponsorship.toLowerCase().replace("_", " ")}</p></div>
          {a.status !== "REVOKED" && a.status !== "ACTIVE" && <div className="sm:col-span-2"><Button size="sm" variant="ghost" disabled={busy} onClick={recheck}>{busy ? "Checking NEAR" : "Check on NEAR again"}</Button></div>}
          {a.status === "ACTIVE" && <div className="sm:col-span-2"><Button size="sm" variant="ghost" disabled={busy} onClick={recheck}>{busy ? "Checking NEAR" : "Re-verify ownership"}</Button></div>}
          <div className="sm:col-span-2 border-t border-line pt-3" data-account-checks>
            <p className="type-label text-fg-2">Checks on NEAR</p>
            <ul className="type-caption mt-1 flex flex-col gap-0.5 text-fg-2">
              <li>Last successful: {a.checks.lastSuccessfulAt ? new Date(a.checks.lastSuccessfulAt).toLocaleString() : "never"}</li>
              <li>Latest result: {a.checks.lastResult ? `${RESULT[a.checks.lastResult] ?? a.checks.lastResult}${a.checks.lastAttemptAt ? `, ${new Date(a.checks.lastAttemptAt).toLocaleString()}` : ""}` : "none yet"}{a.checks.consecutiveFailures ? ` · ${a.checks.consecutiveFailures} inconclusive in a row` : ""}</li>
              <li>Next scheduled: {a.checks.nextAt ? new Date(a.checks.nextAt).toLocaleString() : "not scheduled"}</li>
            </ul>
          </div>
          <div className="sm:col-span-2 border-t border-line pt-3" data-account-authority>
            <ul className="type-body-sm flex flex-col gap-1">
              <li><span className="text-fg-2">Owner identity: </span><span className="text-fg">{agent.ownership.state === "VERIFIED" ? "verified" : "not verified"}</span><span className="text-fg-2"> (your NEAR account {agent.ownership.accountId ?? "–"})</span></li>
              <li><span className="text-fg-2">Dedicated account ownership: </span><span className="text-fg">{a.status === "ACTIVE" ? "verified on NEAR" : "not verified"}</span></li>
              <li><span className="text-fg-2">Key rotation: </span><span className="text-fg">{v!.keyRotationAvailable ? "available" : "not available"}</span></li>
            </ul>
            {v!.recovery === "KEY_LOST_OR_CHANGED" && (
              <div className="mt-2" data-recovery-unavailable><Notice role="error" title="Recovery is not available through SPak">The approved key is no longer a full-access key on this account. If you changed it with a key you hold, add back exactly the approved key or rotate through SPak with it. If the key is lost, the account cannot be recovered: SPak holds no key on it and NEAR has no recovery mechanism. Revoke the Agent and create a new one.</Notice></div>
            )}
          </div>
          {v!.keyRotationAvailable && (
            <div className="sm:col-span-2 flex flex-col gap-3 rounded-control border border-line p-3" data-key-rotation>
              <p className="type-label text-fg">Rotate the dedicated account key</p>
              {!rot && v!.rotation?.status !== "AUTHORIZED" ? <>
                <p className="type-body-sm text-fg-2">Re-verifying your owner identity does not change this key. To replace it: enter the new public key, sign with the key now on the account, then send the transaction below from a wallet that holds it. SPak cannot send it for you.</p>
                <Field label="New public key (ed25519:…)"><input className={`${inputCls} type-address`} name="newPublicKey" value={newKey} onChange={(e) => setNewKey(e.target.value)} spellCheck={false} autoComplete="off" /></Field>
                <div><Button size="sm" disabled={busy || !newKey.trim()} onClick={startRotation}>{busy ? "Waiting for your wallet" : "Authorise with current key"}</Button></div>
              </> : (() => {
                const pending = rot ?? (v!.rotation ? { rotationId: v!.rotation.id, accountId: v!.rotation.accountId, currentPublicKey: v!.rotation.oldPublicKey, newPublicKey: v!.rotation.newPublicKey } : null);
                if (!pending) return null;
                return <>
                  <p className="type-body-sm text-fg-2">Authorised. Send one transaction from <span className="text-fg [overflow-wrap:anywhere]">{pending.accountId}</span> with exactly these two actions, in this order:</p>
                  <ol className="type-body-sm list-decimal pl-5 text-fg"><li>AddKey <Mono value={pending.newPublicKey} /> with full access</li><li>DeleteKey <Mono value={pending.currentPublicKey} /></li></ol>
                  <Field label="Transaction hash (optional)"><input className={`${inputCls} type-identifier`} name="rotationTx" value={txHash} onChange={(e) => setTxHash(e.target.value)} spellCheck={false} autoComplete="off" /></Field>
                  <div><Button size="sm" disabled={busy} onClick={() => finishRotation(pending.rotationId)}>{busy ? "Checking NEAR" : "Check on NEAR"}</Button></div>
                </>;
              })()}
            </div>
          )}
        </dl>
      ) : v.availability === "UNAVAILABLE" ? (
        <p className="type-body-sm mt-3 text-fg-2" data-account-unavailable>Account creation is not available right now. {v.infrastructure.state === "NOT_CONFIGURED" ? "SPak\u2019s testnet parent account is not configured on this server." : "See the infrastructure status above."}</p>
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
