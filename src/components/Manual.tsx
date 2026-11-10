"use client";
import { useEffect, useMemo, useState } from "react";
import { NETWORKS } from "@/lib/spak-in/catalog";
import { postJSON, type QuoteRequest, type QuoteView } from "@/lib/client";
import { Button, Card, Field, inputCls } from "./ui";

interface Tok { symbol: string; blockchain: string; decimals: number }

export function Manual({ addresses, onQuote }: { addresses: Record<string, string>; onQuote: (r: QuoteRequest, q: QuoteView) => void }) {
  const [tokens, setTokens] = useState<Tok[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [f, setF] = useState({ sourceNetwork: "base", sourceToken: "USDC", amount: "", destNetwork: "sol", destToken: "SOL", recipient: "", refundTo: "", slippageBps: 100 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetch("/api/tokens").then((r) => r.json()).then((d) => (Array.isArray(d) ? setTokens(d) : setLoadError(d.error))).catch((e) => setLoadError(String(e)));
  }, []);

  const networks = useMemo(() => [...new Set(tokens.map((t) => t.blockchain))].sort((a, b) => (NETWORKS[a]?.name ?? a).localeCompare(NETWORKS[b]?.name ?? b)), [tokens]);
  const symbolsOn = (n: string) => [...new Set(tokens.filter((t) => t.blockchain === n).map((t) => t.symbol))].sort();
  const set = (k: keyof typeof f, v: string | number) => setF((p) => ({ ...p, [k]: v }));
  const recipient = f.recipient || addresses[f.destNetwork] || "";
  const refundTo = f.refundTo || addresses[f.sourceNetwork] || "";

  async function quote(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(undefined);
    try {
      const req: QuoteRequest = { ...f, recipient, refundTo };
      onQuote(req, await postJSON<QuoteView>("/api/quote", req));
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const side = (prefix: "source" | "dest") => {
    const nk = `${prefix}Network` as const, tk = `${prefix}Token` as const;
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label={prefix === "source" ? "From network" : "To network"}>
          <select className={inputCls} value={f[nk]} onChange={(e) => { set(nk, e.target.value); set(tk, symbolsOn(e.target.value)[0] ?? ""); }}>
            {networks.map((n) => <option key={n} value={n}>{NETWORKS[n]?.name ?? n}</option>)}
          </select>
        </Field>
        <Field label={prefix === "source" ? "Send asset" : "Receive asset"}>
          <select className={inputCls} value={f[tk]} onChange={(e) => set(tk, e.target.value)}>
            {symbolsOn(f[nk]).map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
    );
  };

  return (
    <Card>
      {loadError && <p className="mb-3 text-sm text-red-400">Could not load NEAR Intents assets: {loadError}</p>}
      <form onSubmit={quote} className="flex flex-col gap-4">
        {side("source")}
        <Field label="Amount"><input className={inputCls} inputMode="decimal" placeholder="0.0" value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} /></Field>
        {side("dest")}
        <Field label={`Recipient on ${NETWORKS[f.destNetwork]?.name ?? f.destNetwork}`}><input className={`${inputCls} font-mono`} placeholder={addresses[f.destNetwork] ?? "Address"} value={f.recipient} onChange={(e) => set("recipient", e.target.value.trim())} /></Field>
        <Field label={`Refund address on ${NETWORKS[f.sourceNetwork]?.name ?? f.sourceNetwork}`}><input className={`${inputCls} font-mono`} placeholder={addresses[f.sourceNetwork] ?? "Your source address"} value={f.refundTo} onChange={(e) => set("refundTo", e.target.value.trim())} /></Field>
        <Field label="Max slippage">
          <select className={inputCls} value={f.slippageBps} onChange={(e) => set("slippageBps", Number(e.target.value))}>
            {[50, 100, 200, 300].map((b) => <option key={b} value={b}>{b / 100}%</option>)}
          </select>
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={busy || !f.amount || !recipient || !refundTo}>{busy ? "Getting quote" : "Get quote"}</Button>
      </form>
    </Card>
  );
}
