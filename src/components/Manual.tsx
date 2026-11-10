"use client";
import { useEffect, useMemo, useState } from "react";
import { api, startExecution, type ExecutionView, type IntentResult, type QuoteView } from "@/lib/client";
import { Button, Card, Field, inputCls } from "./ui";

interface Net { id: string; name: string }
interface Asset { id: string; network: string; symbol: string }

/** ownAddress: the signed-in user's verified address on a network, for display only. The server decides. */
export function Manual({ ownAddress, onReady }: { ownAddress: (network: string) => string | undefined; onReady: (i: IntentResult, e: ExecutionView, q: QuoteView) => void }) {
  const [nets, setNets] = useState<Net[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [f, setF] = useState({ sourceNetwork: "base", sourceAsset: "", amount: "", destinationNetwork: "solana", destinationAsset: "", recipient: "", slippageBps: 100 });
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    api<{ networks: Net[]; assets: Asset[] }>("/api/spak-in/registry").then((r) => { setNets(r.networks); setAssets(r.assets); }).catch((e) => setProblems([String(e)]));
  }, []);

  const on = (n: string) => assets.filter((a) => a.network === n).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const usable = useMemo(() => nets.filter((n) => assets.some((a) => a.network === n.id)), [nets, assets]);
  const pick = (n: string, sym: string) => on(n).find((a) => a.symbol === sym)?.id ?? on(n)[0]?.id ?? "";
  useEffect(() => {
    if (!assets.length) return;
    setF((p) => ({ ...p, sourceAsset: p.sourceAsset || pick(p.sourceNetwork, "USDC"), destinationAsset: p.destinationAsset || pick(p.destinationNetwork, "SOL") }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);
  const set = (k: keyof typeof f, v: string | number) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setProblems([]);
    const src = assets.find((a) => a.id === f.sourceAsset), dst = assets.find((a) => a.id === f.destinationAsset);
    const type = f.recipient ? "PAYMENT" : f.sourceNetwork === f.destinationNetwork ? "SWAP" : src?.symbol === dst?.symbol ? "BRIDGE" : "CROSS_CHAIN_SWAP";
    try {
      const r = await api<IntentResult>("/api/spak-in/manual", { intent: { type, ...f, recipient: f.recipient || undefined } });
      if (r.status !== "VALIDATED" || !r.plan) {
        setProblems([...r.errors.map((x) => x.message), ...(r.policy?.violations.map((x) => x.message) ?? []), ...r.clarifications.map((c) => c.question)]);
        return;
      }
      const { execution, quote } = await startExecution(r.plan.hash);
      onReady(r, execution, quote);
    } catch (err) { setProblems([(err as Error).message]); } finally { setBusy(false); }
  }

  const side = (p: "source" | "destination") => {
    const nk = `${p}Network` as const, ak = `${p}Asset` as const;
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label={p === "source" ? "From network" : "To network"}>
          <select className={inputCls} value={f[nk]} onChange={(e) => { set(nk, e.target.value); set(ak, pick(e.target.value, assets.find((a) => a.id === f[ak])?.symbol ?? "USDC")); }}>
            {usable.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </Field>
        <Field label={p === "source" ? "Send asset" : "Receive asset"}>
          <select className={inputCls} value={f[ak]} onChange={(e) => set(ak, e.target.value)}>
            {on(f[nk]).map((a) => <option key={a.id} value={a.id}>{a.symbol}</option>)}
          </select>
        </Field>
      </div>
    );
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {side("source")}
        <Field label="Amount"><input className={inputCls} inputMode="decimal" placeholder="0.0" value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} /></Field>
        {side("destination")}
        <Field label="Recipient (leave empty to receive in your own wallet)">
          <input className={`${inputCls} font-mono`} placeholder={ownAddress(f.destinationNetwork) ?? "Address (no verified wallet on this network)"} value={f.recipient} onChange={(e) => set("recipient", e.target.value.trim())} />
        </Field>
        <Field label="Max slippage">
          <select className={inputCls} value={f.slippageBps} onChange={(e) => set("slippageBps", Number(e.target.value))}>
            {[30, 50, 100].map((b) => <option key={b} value={b}>{b / 100}%</option>)}
          </select>
        </Field>
        {!!problems.length && <ul className="list-disc pl-4 text-sm text-red-400">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <Button type="submit" disabled={busy || !f.amount || !f.sourceAsset || !f.destinationAsset}>{busy ? "Checking" : "Get quote"}</Button>
      </form>
    </Card>
  );
}
