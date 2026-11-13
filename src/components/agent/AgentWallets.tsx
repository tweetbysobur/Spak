"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Button, Modal, Mono, Spinner } from "@/components/ui";
import { Notice } from "@/components/status";
import type { Session } from "@/components/session";
import type { AgentView } from "@/agents/service";
import type { AssociationView } from "@/agents/wallets";
import { getNetwork } from "@/spak-in/registries/networks";
import { connectEvm, signEvm, watchEvmWallets, type EvmWalletInfo } from "@/wallets/evm";
import { connectSolana, signSolana, watchSolanaWallets, type SolanaWalletInfo } from "@/wallets/solana";
import { discoverNearWallets, signNear } from "@/wallets/near";

const FAMILY = { evm: "EVM", solana: "Solana", near: "NEAR" } as const;
const STATUS: Record<AssociationView["status"], { text: string; role: string }> = {
  PENDING: { text: "Waiting for signature", role: "pending" }, ACTIVE: { text: "Verified by SPak", role: "success" }, SUSPENDED: { text: "Suspended with the Agent", role: "warning" },
  EXPIRED: { text: "Expired, sign again", role: "warning" }, REVOKED: { text: "Removed", role: "neutral" },
};
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "–");

interface Challenge { challengeId: string; family: "evm" | "solana" | "near"; message: string; address: string; nonce?: string; recipient?: string }

/**
 * Wallet associations for the Agent (Stage 6). Associating proves you control a wallet; it gives SPak no signing
 * authority and changes nothing in Guard. A wallet shows as verified only after the server confirms the signature.
 */
export function AgentWallets({ agent, session }: { agent: AgentView; session: Session }) {
  const [items, setItems] = useState<AssociationView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [evm, setEvm] = useState<EvmWalletInfo[]>([]);
  const [sol, setSol] = useState<SolanaWalletInfo[]>([]);
  const [removing, setRemoving] = useState<AssociationView | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const load = useCallback(() => api<{ items: AssociationView[] }>(`/api/agents/${agent.id}/wallets`).then((r) => setItems(r.items)).catch(() => setItems([])), [agent.id]);
  useEffect(() => { load(); }, [load, agent.status]);
  useEffect(() => { const a = watchEvmWallets(setEvm), b = watchSolanaWallets(setSol); return () => { a(); b(); }; }, []);

  const eligible = agent.ownership.state === "VERIFIED";
  const live = (items ?? []).filter((i) => i.status !== "REVOKED");
  const removed = (items ?? []).filter((i) => i.status === "REVOKED");
  const findLive = (family: string, address: string) => live.find((i) => i.family === family && i.address === address.toLowerCase()) ?? live.find((i) => i.family === family && i.address === address);
  // Wallets on the account that can be associated: not the Agent owner account.
  const candidates = session.wallets.filter((w) => !(w.family === "near" && w.address === agent.ownership.accountId));

  /** Sign in the wallet from this click (popups need the gesture), then let the server verify. */
  async function associate(w: Session["wallets"][number]) {
    setBusy(w.id); setMsg(null);
    try {
      let chainId: number | undefined;
      let evmInfo: EvmWalletInfo | undefined, solInfo: SolanaWalletInfo | undefined;
      if (w.family === "evm") {
        evmInfo = evm[0];
        if (!evmInfo) throw new Error("No EVM wallet found in this browser.");
        const c = await connectEvm(evmInfo);
        if (c.address.toLowerCase() !== w.address.toLowerCase()) throw new Error(`Your wallet is on ${short(c.address)}. Switch it to ${short(w.address)} and try again.`);
        chainId = c.chainId;
      } else if (w.family === "solana") {
        solInfo = sol[0];
        if (!solInfo) throw new Error("No Solana wallet found in this browser.");
        const c = await connectSolana(solInfo);
        if (c.address !== w.address) throw new Error(`Your wallet is on ${short(c.address)}. Switch it to ${short(w.address)} and try again.`);
      }
      const c = await api<Challenge>(`/api/agents/${agent.id}/wallets/challenge`, { walletId: w.id, ...(chainId ? { chainId } : {}) });
      let body: Record<string, string>;
      if (w.family === "evm") body = { challengeId: c.challengeId, signature: await signEvm(evmInfo!, w.address, c.message) };
      else if (w.family === "solana") body = { challengeId: c.challengeId, signature: await signSolana(solInfo!, w.address, c.message) };
      else {
        const nw = (await discoverNearWallets()).find((x) => x.available);
        if (!nw) throw new Error("No NEAR wallet is available in this browser.");
        const s = await signNear(nw.id, { message: c.message, nonceB64: c.nonce!, recipient: c.recipient!, challengeId: c.challengeId });
        if (!s) { setMsg({ ok: false, text: "The wallet left this page before returning a signature. Start again." }); return; }
        body = { challengeId: c.challengeId, signature: s.signature, publicKey: s.publicKey, accountId: s.accountId };
      }
      const r = await api<{ association: AssociationView }>(`/api/agents/${agent.id}/wallets/verify`, body);
      setMsg({ ok: true, text: `${FAMILY[r.association.family]} wallet ${short(r.association.address)} associated. SPak still has no signing authority over it.` });
    } catch (e) {
      const code = (e as { code?: string | number }).code;
      setMsg({ ok: false, text: code === 4001 || code === "4001" || /reject|denied|cancel/i.test((e as Error).message) ? "You cancelled in your wallet. Nothing changed." : (e as Error).message });
    } finally { setBusy(null); await load(); }
  }

  async function remove(reason: "REMOVED" | "COMPROMISED") {
    if (!removing) return;
    setBusy(removing.id);
    try {
      await api(`/api/agents/${agent.id}/wallets/${removing.id}`, { reason }, "DELETE");
      setMsg({ ok: true, text: reason === "COMPROMISED" ? "Wallet removed and marked compromised." : "Wallet association removed." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); setRemoving(null); await load(); }
  }

  return (
    <section aria-labelledby="agent-wallets-title" data-agent-wallets className="rounded-card border border-line p-4">
      <h3 id="agent-wallets-title" className="type-app-subheading text-fg">Associated wallets</h3>
      <p className="type-body-sm mt-1 text-fg-2">Associating proves you control a wallet. The wallet stays yours: it keeps signing every transfer, and SPak gets no authority over it. Guard settings do not change.</p>

      {agent.ownership.accountId && (
        <div className="mt-3 rounded-control bg-secondary/40 p-3 dark:bg-bg">
          <p className="type-label text-fg-2">Agent owner NEAR account</p>
          <p className="type-body-sm text-fg [overflow-wrap:anywhere]">{agent.ownership.accountId}</p>
          <p className="type-caption text-fg-2">Owns the Agent identity. Not an associated wallet.</p>
        </div>
      )}

      {!eligible && <div className="mt-3"><Notice role="warning" title="New associations are paused">{agent.status === "SUSPENDED" ? "The Agent is suspended. Verify ownership again to resume." : agent.ownership.state === "EXPIRED" ? "The Agent's ownership verification expired. Verify it again to add wallets." : "Verify ownership of the Agent first."} Existing associations stay listed.</Notice></div>}

      {items === null ? <div className="mt-3"><Spinner label="Loading wallets" /></div> : (
        <ul className="mt-3 flex flex-col" aria-label="Wallets">
          {candidates.map((w) => {
            const a = findLive(w.family, w.address);
            const st = a ? STATUS[a.status] : null;
            const canSign = eligible && (!a || a.status === "PENDING" || a.status === "EXPIRED");
            return (
              <li key={w.id} data-association-family={w.family} data-association-status={a?.status ?? "NONE"} className="grid gap-2 border-t border-line py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="type-body-sm text-fg"><span className="type-label mr-2 rounded-control border border-line px-1.5 py-0.5 text-fg-2">{FAMILY[w.family]}</span>{w.family === "near" ? "Additional NEAR account" : `${FAMILY[w.family]} wallet`}{a?.network && a.family === "evm" ? ` · signed on ${getNetwork(a.network)?.name ?? a.network}` : ""}</p>
                  <div className="mt-1"><Mono value={w.address} /></div>
                  {st ? (
                    <p className="type-caption mt-1 inline-flex items-center gap-2" style={{ color: `var(--spak-status-${st.role}-foreground)` }}>
                      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `var(--spak-status-${st.role}-icon)` }} />{st.text}
                      {a!.verifiedAt && <span className="text-fg-2">· verified {day(a!.verifiedAt)} · until {day(a!.expiresAt)}</span>}
                    </p>
                  ) : <p className="type-caption mt-1 text-fg-2">Connected to your account, not associated with the Agent.</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canSign && <Button size="sm" variant={a ? "primary" : "ghost"} disabled={!!busy} onClick={() => associate(w)}>{busy === w.id ? "Waiting for your wallet" : a?.status === "EXPIRED" ? "Sign again" : a?.status === "PENDING" ? "Sign to finish" : "Associate"}</Button>}
                  {a && <Button size="sm" variant="danger" disabled={!!busy} onClick={() => setRemoving(a)}>Remove</Button>}
                </div>
              </li>
            );
          })}
          {!candidates.length && <li className="type-body-sm border-t border-line py-3 text-fg-2">Connect another wallet in Settings to associate it.</li>}
        </ul>
      )}

      {msg && <div className="mt-3"><Notice role={msg.ok ? "success" : "error"} title={msg.ok ? "Done" : "Not associated"}>{msg.text}</Notice></div>}

      {!!removed.length && (
        <div className="mt-3">
          <button className="type-label text-fg-2 underline-offset-2 hover:underline" onClick={() => setShowRemoved((v) => !v)}>{showRemoved ? "Hide" : "Show"} removed ({removed.length})</button>
          {showRemoved && <ul className="mt-2 flex flex-col">{removed.map((r) => <li key={r.id} className="type-caption flex flex-wrap justify-between gap-2 border-t border-line py-2 text-fg-2"><span>{FAMILY[r.family]} {short(r.address)}</span><span>Removed {day(r.revokedAt)}{r.revokeReason ? ` · ${r.revokeReason.toLowerCase().replaceAll("_", " ")}` : ""}</span></li>)}</ul>}
        </div>
      )}

      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Remove this wallet association?">
        {removing && <>
          <p className="type-body-sm text-fg-2">{FAMILY[removing.family]} wallet <span className="type-identifier">{short(removing.address)}</span> stops being associated now. Adding it again needs a new signature. The wallet itself and your transfers are not affected.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="danger" disabled={!!busy} onClick={() => remove("REMOVED")}>Remove</Button>
            <Button variant="danger" disabled={!!busy} onClick={() => remove("COMPROMISED")}>Remove, it is compromised</Button>
            <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
          </div>
        </>}
      </Modal>
    </section>
  );
}
