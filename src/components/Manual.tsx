"use client";
import { useEffect, useMemo, useState } from "react";
import { api, startExecution, type ExecutionView, type IntentResult, type QuoteView } from "@/lib/client";
import { Button, Card, Field, SectionTitle, Select, inputCls } from "./ui";
import { Notice } from "./status";
import { guardMessage, planBlock, type GuardMessage } from "@/lib/guard";

interface Net { id: string; name: string; source: boolean; destination: boolean }
interface Asset { id: string; network: string; symbol: string; destination: boolean }

/** ownAddress: the signed-in user's verified address on a network, for display only. The server decides. */
export function Manual({ ownAddress, onReady }: { ownAddress: (network: string) => string | undefined; onReady: (i: IntentResult, e: ExecutionView, q: QuoteView) => void }) {
  const [nets, setNets] = useState<Net[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [f, setF] = useState({ sourceNetwork: "base", sourceAsset: "", amount: "", destinationNetwork: "solana", destinationAsset: "", recipient: "", slippageBps: 100 });
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [guardBlock, setGuardBlock] = useState<GuardMessage | null>(null);

  useEffect(() => {
    api<{ networks: Net[]; assets: Asset[] }>("/api/spak-in/registry").then((r) => { setNets(r.networks); setAssets(r.assets); }).catch((e) => setProblems([String(e)]));
  }, []);

  // Only what the server allows in V1 is offered: sources with a validated deposit flow, destinations SPak can verify.
  const on = (n: string, p: "source" | "destination" = "source") => assets.filter((a) => a.network === n && (p === "source" || a.destination)).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const usable = useMemo(() => ({
    source: nets.filter((n) => n.source && assets.some((a) => a.network === n.id)),
    destination: nets.filter((n) => n.destination && assets.some((a) => a.network === n.id && a.destination)),
  }), [nets, assets]);
  const pick = (n: string, sym: string, p: "source" | "destination" = "source") => on(n, p).find((a) => a.symbol === sym)?.id ?? on(n, p)[0]?.id ?? "";
  useEffect(() => {
    if (!assets.length) return;
    setF((p) => ({ ...p, sourceAsset: p.sourceAsset || pick(p.sourceNetwork, "USDC"), destinationAsset: p.destinationAsset || pick(p.destinationNetwork, "SOL", "destination") }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);
  const set = (k: keyof typeof f, v: string | number) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setProblems([]); setGuardBlock(null);
    const src = assets.find((a) => a.id === f.sourceAsset), dst = assets.find((a) => a.id === f.destinationAsset);
    const type = f.recipient ? "PAYMENT" : f.sourceNetwork === f.destinationNetwork ? "SWAP" : src?.symbol === dst?.symbol ? "BRIDGE" : "CROSS_CHAIN_SWAP";
    try {
      const r = await api<IntentResult>("/api/spak-in/manual", { intent: { type, ...f, recipient: f.recipient || undefined } });
      if (r.status !== "VALIDATED" || !r.plan) {
        setProblems([...r.errors.map((x) => x.message), ...(r.policy?.violations.map((x) => x.message) ?? []), ...r.clarifications.map((c) => c.question)]);
        return;
      }
      // The server's Guard decision on this plan. When it blocks, stop before any execution is created.
      if (r.route) { setProblems([r.route.message]); return; }
      const block = planBlock(r.guard);
      if (block) { setGuardBlock(block); return; }
      const { execution, quote } = await startExecution(r.plan.hash);
      onReady(r, execution, quote);
    } catch (err) { const g = guardMessage(err); if (g) setGuardBlock(g); else setProblems([(err as Error).message]); } finally { setBusy(false); }
  }

  const side = (p: "source" | "destination") => {
    const nk = `${p}Network` as const, ak = `${p}Asset` as const;
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={p === "source" ? "From network" : "To network"}>
          <Select value={f[nk]} onChange={(e) => { set(nk, e.target.value); set(ak, pick(e.target.value, assets.find((a) => a.id === f[ak])?.symbol ?? "USDC", p)); }}>
            {usable[p].map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </Select>
        </Field>
        <Field label={p === "source" ? "Send asset" : "Receive asset"}>
          <Select value={f[ak]} onChange={(e) => set(ak, e.target.value)}>
            {on(f[nk], p).map((a) => <option key={a.id} value={a.id}>{a.symbol}</option>)}
          </Select>
        </Field>
      </div>
    );
  };

  return (
    <Card>
      <SectionTitle sub="Choose exactly what to send and receive. You review a quote before anything can be sent.">Manual swap</SectionTitle>
      <p className="type-caption -mt-2 mb-3 text-fg-2" data-v1-scope>Send from EVM networks or Solana. Receive on EVM networks (tokens) or Solana. NEAR, receiving native coins on EVM networks, and other networks are not available yet: SPak only offers routes where it can verify delivery itself.</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {side("source")}
        <Field label="Amount"><input className={`${inputCls} type-amount`} inputMode="decimal" placeholder="0.0" value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} /></Field>
        {side("destination")}
        <Field label="Recipient (leave empty to receive in your own wallet)">
          <input className={`${inputCls} type-address`} placeholder={ownAddress(f.destinationNetwork) ?? "Address (no verified wallet on this network)"} value={f.recipient} onChange={(e) => set("recipient", e.target.value.trim())} />
        </Field>
        <Field label="Max slippage">
          <Select value={f.slippageBps} onChange={(e) => set("slippageBps", Number(e.target.value))}>
            {[30, 50, 100].map((b) => <option key={b} value={b}>{b / 100}%</option>)}
          </Select>
        </Field>
        {guardBlock && <div data-guard-block><Notice role="error" title={guardBlock.title}><ul className="list-disc pl-4">{guardBlock.reasons.map((p) => <li key={p}>{p}</li>)}</ul><p className="mt-1">Nothing was quoted or created. <a href="#guard" className="text-primary underline underline-offset-2">Open SPak Guard</a></p></Notice></div>}
        {!!problems.length && <Notice role="error" title="SPak cannot quote this yet"><ul className="list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Notice>}
        <Button type="submit" disabled={busy || !f.amount || !f.sourceAsset || !f.destinationAsset}>{busy ? "Checking" : "Get quote"}</Button>
      </form>
    </Card>
  );
}
