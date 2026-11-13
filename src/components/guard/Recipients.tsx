"use client";
import { useState } from "react";
import { Button, Field, Modal, Mono, Select, inputCls } from "@/components/ui";
import { getNetwork, listNetworks } from "@/spak-in/registries/networks";
import { isAddressFor } from "@/spak-in/validator/address";
import { guardApi, type GuardMessage, type GuardView } from "@/lib/guard";
import { SaveResult } from "./parts";
import type { Run } from "./useGuard";

/**
 * Approved recipients. Each approval covers one network. The address check here is only to help typing;
 * the server validates it again and is the one that decides.
 */
export function Recipients({ view, run }: { view: GuardView; run: Run }) {
  const { recipients, recipientMode } = view.policy;
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<GuardView["policy"]["recipients"][number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GuardMessage | null>(null);
  async function remove() {
    if (!removing) return;
    setBusy(true);
    const r = await run((v) => guardApi.removeRecipient(v, removing.id), "Recipient removed.");
    setBusy(false); setResult(r); setRemoving(null);
  }
  return (
    <section aria-labelledby="recipients-title" data-guard-section="recipients" className="rounded-panel border border-line bg-elevated p-5 sm:p-6 dark:bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="recipients-title" className="type-app-heading text-fg">Approved recipients</h2>
          <p className="type-body-sm mt-1 max-w-2xl text-fg-2">
            {recipientMode === "APPROVED_ONLY" ? "Guard only lets you send to these addresses, and to your own wallets." : "Recipients are not restricted now. Turn on approved-only under Transfer protection to use this list."}
            {" "}An address approved on one network is not approved on any other.
          </p>
        </div>
        {!adding && <Button variant="ghost" size="sm" onClick={() => { setAdding(true); setResult(null); }}>Add recipient</Button>}
      </div>
      {adding && <AddRecipient run={run} close={() => setAdding(false)} />}
      <div className="mt-4"><SaveResult result={result} /></div>
      {recipients.length ? (
        <ul className="mt-2 flex flex-col">
          {recipients.map((r) => (
            <li key={r.id} data-recipient={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3">
              <div className="min-w-0">
                <p className="type-body-sm text-fg">{r.label || "No label"} <span className="text-fg-2">· {getNetwork(r.network)?.name ?? r.network} only</span></p>
                <Mono value={r.address} full />
              </div>
              <Button size="sm" variant="danger" onClick={() => setRemoving(r)}>Remove</Button>
            </li>
          ))}
        </ul>
      ) : !adding && <p className="type-body-sm mt-2 text-fg-2">No approved recipients yet.</p>}
      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Remove recipient?">
        {removing && <>
          <p className="type-body-sm text-fg-2">{removing.label || "This address"} on {getNetwork(removing.network)?.name ?? removing.network}:</p>
          <div className="mt-1"><Mono value={removing.address} full /></div>
          <p className="type-body-sm mt-3 text-fg-2">{recipientMode === "APPROVED_ONLY" ? "New transfers to it will be blocked. Transfers already approved are not affected." : "It will no longer be on your list."}</p>
          <div className="mt-5 flex flex-wrap gap-2"><Button variant="danger" onClick={remove} disabled={busy}>{busy ? "Removing" : "Remove recipient"}</Button><Button variant="ghost" onClick={() => setRemoving(null)}>Keep it</Button></div>
        </>}
      </Modal>
    </section>
  );
}

function AddRecipient({ run, close }: { run: Run; close: () => void }) {
  const [network, setNetwork] = useState("base");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GuardMessage | null>(null);
  const net = getNetwork(network)!;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const a = address.trim();
    if (!isAddressFor(net.family, a)) { setResult({ title: `That is not a valid ${net.name} address.`, reasons: [] }); return; }
    setBusy(true); setResult(null);
    const r = await run((v) => guardApi.addRecipient(v, { network, address: a, ...(label.trim() ? { label: label.trim() } : {}) }), `Recipient approved on ${net.name}.`);
    setBusy(false);
    if (r) setResult(r); else close();
  }
  return (
    <form onSubmit={submit} aria-label="Add recipient" className="mt-4 flex flex-col gap-4 rounded-card border border-line p-4">
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <Field label="Network"><Select name="network" value={network} onChange={(e) => setNetwork(e.target.value)}>{listNetworks().map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</Select></Field>
        <Field label="Address" hint={`Approved on ${net.name} only.`}><input className={`${inputCls} type-address`} name="address" autoComplete="off" spellCheck={false} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      </div>
      <Field label="Label (optional)"><input className={inputCls} name="label" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      <SaveResult result={result} />
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !address.trim()}>{busy ? "Saving" : "Approve recipient"}</Button><Button type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</Button></div>
    </form>
  );
}
