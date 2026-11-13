"use client";
import { useMemo, useState } from "react";
import { Field, Mono, SearchInput, Select, inputCls } from "@/components/ui";
import { Button } from "@/components/ui";
import { getNetwork, listNetworks } from "@/spak-in/registries/networks";
import { getAsset, listAssets } from "@/spak-in/registries/assets";
import { guardApi, type GuardMessage, type GuardPatch, type GuardView } from "@/lib/guard";
import { Editable, FormActions, SaveResult, StatusDot } from "./parts";
import type { Run } from "./useGuard";

const netName = (id: string) => getNetwork(id)?.name ?? id;

/* ---------------------------------------------------------------- protection ---------------------------------------------------------------- */

export function Protection({ view, run }: { view: GuardView; run: Run }) {
  const p = view.policy;
  return (
    <Editable id="protection" title="Transfer protection" editLabel="Edit"
      sub="Every transfer needs your approval in your wallet. These settings decide what Guard lets you approve."
      read={
        <dl className="grid gap-4 sm:grid-cols-3">
          <div><dt className="type-label text-fg-2">Maximum slippage</dt><dd className="type-amount mt-1 text-fg">{p.maxSlippageBps / 100}%</dd></div>
          <div><dt className="type-label text-fg-2">Tokens</dt><dd className="type-body-sm mt-1 text-fg">{p.assetMode === "ANY" ? "Any token, except blocked ones" : "Only tokens on your allowlist"}</dd></div>
          <div><dt className="type-label text-fg-2">Recipients</dt><dd className="type-body-sm mt-1 text-fg">{p.recipientMode === "ANY" ? "Any recipient" : "Only approved recipients"}</dd></div>
        </dl>
      }
      edit={(close) => <ProtectionForm view={view} run={run} close={close} />}
    />
  );
}

function ProtectionForm({ view, run, close }: { view: GuardView; run: Run; close: () => void }) {
  // Compared with the policy as it was when the form opened, so untouched settings never overwrite newer ones.
  const [p] = useState(() => view.policy);
  const [slip, setSlip] = useState(String(p.maxSlippageBps / 100));
  const [assetMode, setAssetMode] = useState(p.assetMode);
  const [recipientMode, setRecipientMode] = useState(p.recipientMode);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GuardMessage | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bps = Math.round(Number(slip) * 100);
    if (!/^\d+(\.\d{1,2})?$/.test(slip) || bps < 1 || bps > 5000) { setResult({ title: "Maximum slippage must be between 0.01% and 50%.", reasons: [] }); return; }
    const patch: GuardPatch = {};
    if (bps !== p.maxSlippageBps) patch.maxSlippageBps = bps;
    if (assetMode !== p.assetMode) patch.assetMode = assetMode;
    if (recipientMode !== p.recipientMode) patch.recipientMode = recipientMode;
    if (!Object.keys(patch).length) { close(); return; }
    setBusy(true); setResult(null);
    const r = await run((v) => guardApi.update(v, patch), "Transfer protection saved.");
    setBusy(false);
    if (r) setResult(r); else close();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Edit transfer protection">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Maximum slippage (%)" hint="Quotes above it are refused, never adjusted."><input className={`${inputCls} type-amount`} inputMode="decimal" name="slippage" value={slip} onChange={(e) => setSlip(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
        <Field label="Tokens" hint={assetMode === "ALLOWLIST" ? "Add the tokens you use under Tokens." : undefined}>
          <Select name="assetMode" value={assetMode} onChange={(e) => setAssetMode(e.target.value as typeof assetMode)}><option value="ANY">Any token, except blocked</option><option value="ALLOWLIST">Allowlist only</option></Select>
        </Field>
        <Field label="Recipients" hint={recipientMode === "APPROVED_ONLY" ? "Sending to your own wallets is always allowed." : undefined}>
          <Select name="recipientMode" value={recipientMode} onChange={(e) => setRecipientMode(e.target.value as typeof recipientMode)}><option value="ANY">Any recipient</option><option value="APPROVED_ONLY">Approved recipients only</option></Select>
        </Field>
      </div>
      <SaveResult result={result} />
      <FormActions busy={busy} onCancel={close} />
    </form>
  );
}

/* ----------------------------------------------------------------- networks ----------------------------------------------------------------- */

export function Networks({ view, run }: { view: GuardView; run: Run }) {
  const rules = view.policy.networks;
  const all = listNetworks();
  return (
    <Editable id="networks" title="Networks" editLabel="Edit networks"
      sub="Sending from and delivering to a network are separate permissions. A disabled network blocks both, and also stops deposits for transfers you already approved."
      read={(() => {
        // Say it once: networks with the default (send and receive) are summarised; exceptions are listed by name.
        const label = (r: Rule | undefined) => !r ? "Needs a decision" : r.disabled ? "Disabled" : r.allowSource && r.allowDestination ? "Send and receive" : r.allowSource ? "Send only" : r.allowDestination ? "Receive only" : "Not allowed";
        const role = (r: Rule | undefined) => !r ? "warning" : r.disabled ? "error" : r.allowSource || r.allowDestination ? "success" : "neutral";
        const isDefault = (r: Rule | undefined) => !!r && !r.disabled && r.allowSource && r.allowDestination;
        const exceptions = all.filter((n) => !isDefault(rules[n.id]));
        const open = all.length - exceptions.length;
        return (
          <div>
            <p className="type-body-sm text-fg">{open === all.length ? `All ${all.length} supported networks: send and receive.` : open ? `${open} of ${all.length} networks: send and receive. Exceptions:` : "No network allows both sending and receiving."}</p>
            {!!exceptions.length && (
              <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
                {exceptions.map((n) => <li key={n.id} data-network={n.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5"><span className="type-body-sm text-fg">{n.name}</span><StatusDot role={role(rules[n.id])}>{label(rules[n.id])}</StatusDot></li>)}
              </ul>
            )}
          </div>
        );
      })()}
      edit={(close) => <NetworksForm view={view} run={run} close={close} />}
    />
  );
}

type Rule = { allowSource: boolean; allowDestination: boolean; disabled: boolean };
function NetworksForm({ view, run, close }: { view: GuardView; run: Run; close: () => void }) {
  const all = listNetworks();
  const [start] = useState(() => Object.fromEntries(all.map((n) => [n.id, view.policy.networks[n.id] ?? null])) as Record<string, Rule | null>);
  const [draft, setDraft] = useState<Record<string, Rule>>(() => Object.fromEntries(all.map((n) => [n.id, start[n.id] ?? { allowSource: false, allowDestination: false, disabled: false }])));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GuardMessage | null>(null);
  // Networks with no rule yet are sent only once the user touches them, so saving never decides them silently.
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const set = (id: string, k: keyof Rule, v: boolean) => { setDraft((d) => ({ ...d, [id]: { ...d[id], [k]: v } })); setTouched((t) => new Set(t).add(id)); };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = start;
    const networks = all.filter((n) => { const a = s[n.id], b = draft[n.id]; return !a ? touched.has(n.id) : a.allowSource !== b.allowSource || a.allowDestination !== b.allowDestination || a.disabled !== b.disabled; })
      .map((n) => ({ network: n.id, ...draft[n.id] }));
    if (!networks.length) { close(); return; }
    setBusy(true); setResult(null);
    const r = await run((v) => guardApi.update(v, { networks }), "Network permissions saved.");
    setBusy(false);
    if (r) setResult(r); else close();
  }
  const box = "h-5 w-5 accent-primary";
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Edit network permissions">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead><tr className="type-label text-fg-2"><th className="py-2 pr-3 font-medium">Network</th><th className="px-1 py-2 text-center font-medium">Send</th><th className="px-1 py-2 text-center font-medium">Receive</th><th className="px-1 py-2 text-center font-medium">Disable</th></tr></thead>
          <tbody>
            {all.map((n) => (
              <tr key={n.id} className="border-t border-line">
                <td className="type-body-sm py-2 pr-3 text-fg">{n.name}{!start[n.id] && <span className="type-caption block text-fg-2">Needs a decision</span>}</td>
                {(["allowSource", "allowDestination", "disabled"] as const).map((k) => (
                  <td key={k} className="px-1 py-2 text-center"><input type="checkbox" className={box} aria-label={`${n.name}: ${k === "allowSource" ? "send from" : k === "allowDestination" ? "deliver to" : "disabled"}`} checked={draft[n.id][k]} onChange={(e) => set(n.id, k, e.target.checked)} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SaveResult result={result} />
      <FormActions busy={busy} onCancel={close} />
    </form>
  );
}

/* ------------------------------------------------------------------ assets ------------------------------------------------------------------ */

function AssetLabel({ id }: { id: string }) {
  const a = getAsset(id);
  return (
    <span className="flex min-w-0 flex-col">
      <span className="type-body-sm text-fg">{a ? `${a.symbol} on ${netName(a.network)}` : "Unknown token"}</span>
      <Mono value={id} full />
    </span>
  );
}

export function Assets({ view, run }: { view: GuardView; run: Run }) {
  const rules = Object.entries(view.policy.assets);
  const allowed = rules.filter(([, r]) => r === "ALLOW"), blocked = rules.filter(([, r]) => r === "BLOCK");
  return (
    <Editable id="assets" title="Tokens" editLabel="Edit tokens"
      sub="Tokens are identified by network and contract address, never by symbol alone. A blocked token is always refused."
      read={
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="type-label text-fg">Allowed{view.policy.assetMode === "ANY" ? " (any token is allowed)" : ""}</p>
            {allowed.length ? <ul className="mt-2 flex flex-col gap-2">{allowed.map(([id]) => <li key={id}><AssetLabel id={id} /></li>)}</ul>
              : <p className="type-body-sm mt-2 text-fg-2">{view.policy.assetMode === "ALLOWLIST" ? "Your allowlist is empty, so no token can be used until you add one." : "No allowlist. Any token is allowed unless blocked."}</p>}
          </div>
          <div>
            <p className="type-label text-fg">Blocked</p>
            {blocked.length ? <ul className="mt-2 flex flex-col gap-2">{blocked.map(([id]) => <li key={id}><AssetLabel id={id} /></li>)}</ul> : <p className="type-body-sm mt-2 text-fg-2">No blocked tokens.</p>}
          </div>
        </div>
      }
      edit={(close) => <AssetsForm view={view} run={run} close={close} />}
    />
  );
}

function AssetsForm({ view, run, close }: { view: GuardView; run: Run; close: () => void }) {
  const [base] = useState(() => ({ ...view.policy.assets }));
  const [draft, setDraft] = useState<Record<string, "ALLOW" | "BLOCK">>(base);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GuardMessage | null>(null);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return listAssets().filter((a) => a.symbol.toLowerCase().includes(s) || a.id.toLowerCase().includes(s) || netName(a.network).toLowerCase().includes(s)).slice(0, 12);
  }, [q]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // The token list is replaced as a whole, so apply only the user's own edits (against the list as it was when the
    // form opened) on top of the latest list from the server. A token rule changed elsewhere is kept.
    const keys = new Set([...Object.keys(base), ...Object.keys(draft)]);
    const edits = [...keys].filter((k) => base[k] !== draft[k]);
    if (!edits.length) { close(); return; }
    const next = { ...view.policy.assets };
    for (const k of edits) { if (draft[k]) next[k] = draft[k]; else delete next[k]; }
    setBusy(true); setResult(null);
    const r = await run((v) => guardApi.update(v, { assets: Object.entries(next).map(([assetId, rule]) => ({ assetId, rule })) }), "Token permissions saved.");
    setBusy(false);
    if (r) setResult(r); else close();
  }
  const entries = Object.entries(draft);
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Edit token permissions">
      <Field label="Find a token" hint="Search by symbol, network or address. Each result is one token on one network.">
        <SearchInput name="asset-search" placeholder="USDC, Base, 0x8335…" value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
      {!!matches.length && (
        <ul aria-label="Search results" className="flex flex-col">
          {matches.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2">
              <AssetLabel id={a.id} />
              <span className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={draft[a.id] === "ALLOW"} onClick={() => setDraft((d) => ({ ...d, [a.id]: "ALLOW" }))}>Allow</Button>
                <Button type="button" size="sm" variant="danger" disabled={draft[a.id] === "BLOCK"} onClick={() => setDraft((d) => ({ ...d, [a.id]: "BLOCK" }))}>Block</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !matches.length && <p className="type-body-sm text-fg-2">No supported token matches.</p>}
      <div>
        <p className="type-label text-fg">Your token rules</p>
        {entries.length ? (
          <ul className="mt-2 flex flex-col">
            {entries.map(([id, rule]) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2">
                <AssetLabel id={id} />
                <span className="flex items-center gap-3"><StatusDot role={rule === "ALLOW" ? "success" : "error"}>{rule === "ALLOW" ? "Allowed" : "Blocked"}</StatusDot>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDraft((d) => { const n = { ...d }; delete n[id]; return n; })}>Remove</Button></span>
              </li>
            ))}
          </ul>
        ) : <p className="type-body-sm mt-2 text-fg-2">No token rules yet.</p>}
      </div>
      <SaveResult result={result} />
      <FormActions busy={busy} onCancel={close} />
    </form>
  );
}
