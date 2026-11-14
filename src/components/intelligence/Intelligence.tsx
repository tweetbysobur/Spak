"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type IntentResult } from "@/lib/client";
import { getNetwork } from "@/spak-in/registries/networks";
import { Button, Card, EmptyState, ErrorText, Mono, SectionTitle, Spinner, inputCls } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { Snapshot } from "@/intelligence/analysis";
import type { RouteOption } from "@/intelligence/service";

type Portfolio = Snapshot & { cached: boolean; ageSec: number };
const money = (usd: string | null) => (usd === null ? "—" : `$${Number(usd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const amt = (a: string) => { const [i, f = ""] = a.split("."); const t = f.slice(0, 6).replace(/0+$/, ""); return `${Number(i).toLocaleString("en-US")}${t ? `.${t}` : ""}`; };
const net = (id: string) => getNetwork(id)?.name ?? id;

/** SPak Intelligence: the user's real portfolio, factual insights, questions through SPak-in and route comparisons. */
export function Intelligence({ onExecute }: { onExecute: (instruction: string) => void }) {
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [routesFor, setRoutesFor] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError(undefined);
    try { setData(await api<Portfolio>(`/api/intelligence/portfolio${refresh ? "?refresh=1" : ""}`)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const updated = data ? new Date(data.readAt).toLocaleTimeString() : null;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle sub="Read-only. Balances from your verified wallets on the 10 networks SPak can execute on, valued with SPak's independent prices."
          aside={<div className="flex items-center gap-3">{updated && <span className="type-caption text-fg-2">{data!.cached ? `Cached, read at ${updated}` : `Read at ${updated}`}</span>}<Button variant="secondary" size="sm" onClick={() => load(true)} disabled={loading}>{loading ? "Reading" : "Refresh"}</Button></div>}>
          SPak Intelligence
        </SectionTitle>
        {error && <ErrorText>{error}</ErrorText>}
        {!data && loading && <Spinner label="Reading your wallets on every network" />}
        {data && (
          <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
            <div>
              <p className="type-label text-fg-2">Total priced value</p>
              <p className="type-amount-display mt-1 text-fg">{money(data.totals.usd)}</p>
            </div>
            <p className="type-body-sm pb-1 text-fg-2">
              {data.totals.priced} holding{data.totals.priced === 1 ? "" : "s"} priced{data.totals.unpriced ? ` · ${data.totals.unpriced} without a verified price, not counted` : ""} · {data.wallets.length} wallet{data.wallets.length === 1 ? "" : "s"}
            </p>
          </div>
        )}
      </Card>

      <Ask onExecute={onExecute} />

      {data && data.insights.length > 0 && (
        <Card>
          <SectionTitle sub="Facts from your balances and live prices. Nothing here runs on its own.">Insights</SectionTitle>
          <ul className="flex flex-col gap-3">
            {data.insights.map((i) => (
              <li key={i.kind + i.text} className="type-body flex gap-3 text-fg">
                <Icon name={/UNAVAILABLE|PARTIAL|NO_GAS|UNPRICED|NOT_ROUTABLE/.test(i.kind) ? "warning" : "info"} size={18} className="mt-0.5 shrink-0 text-fg-2" />
                <span>{i.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data && data.holdings.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Distribution title="By network" rows={data.byNetwork.map((n) => ({ key: n.network, label: n.name, usd: n.usd, share: n.share }))} />
          <Distribution title="By asset" rows={data.byAsset.filter((a) => a.share > 0).map((a) => ({ key: a.symbol, label: a.symbol, usd: a.usd, share: a.share }))} />
        </div>
      )}

      {data && (
        <Card>
          <SectionTitle sub="Shown balance is not all transferable: deposits also need the network's own token for fees.">Holdings</SectionTitle>
          {data.holdings.length === 0 ? (
            <EmptyState title="No balances found">SPak read your verified wallets and found no supported assets. Link another wallet in Settings, or fund one of these wallets.</EmptyState>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {data.wallets.filter((w) => data.holdings.some((h) => h.walletId === w.id)).map((w) => (
                <section key={w.id} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="type-label text-fg-2">{w.label ?? `${w.family.toUpperCase()} wallet`} <Mono value={w.address} copy={false} /></p>
                    <span className="type-amount-fee text-fg-2">{money(w.usd)}</span>
                  </div>
                  <ul className="mt-2 flex flex-col">
                    {data.holdings.filter((h) => h.walletId === w.id).sort((a, b) => Number(b.usd ?? 0) - Number(a.usd ?? 0)).map((h) => {
                      const key = `${h.walletId}|${h.assetId}`;
                      return (
                        <li key={key} className="py-2">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                            <span className="type-token-symbol min-w-16 text-fg">{h.symbol}</span>
                            <span className="type-body-sm min-w-28 text-fg-2">{h.networkName}</span>
                            <span className="type-amount flex-1 text-right text-fg">{amt(h.amount)}</span>
                            <span className="type-amount-fee w-28 text-right text-fg-2" title={h.priceNote ?? (h.priceSource ? `Price: ${h.priceSource}` : undefined)}>{h.usd === null ? "No verified price" : money(h.usd)}</span>
                            {h.routable
                              ? <Button size="sm" variant={routesFor === key ? "primary" : "ghost"} onClick={() => setRoutesFor(routesFor === key ? null : key)}>Routes</Button>
                              : <span className="type-caption w-[4.5rem] text-fg-2">{h.assetId === "near:native" ? "Wrap first" : "No route"}</span>}
                          </div>
                          {routesFor === key && <Routes holding={h} onExecute={onExecute} />}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
          {data.reads.some((r) => r.status !== "OK") && (
            <p className="type-caption mt-4 text-fg-2">Not fully read: {[...new Set(data.reads.filter((r) => r.status !== "OK").map((r) => net(r.network)))].join(", ")}. Those balances are unknown, not zero.</p>
          )}
        </Card>
      )}
    </div>
  );
}

function Distribution({ title, rows }: { title: string; rows: { key: string; label: string; usd: string; share: number }[] }) {
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      {rows.length === 0 ? <p className="type-body-sm text-fg-2">No priced holdings yet.</p> : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-3"><span className="type-body text-fg">{r.label}</span><span className="type-amount-fee text-fg-2">{money(r.usd)} · {r.share}%</span></div>
              <div className="mt-1.5 h-1.5 rounded-full bg-surface dark:bg-bg" aria-hidden><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(r.share, 1)}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Questions go through SPak-in like every instruction; transfers continue in Execute for review and approval. */
function Ask({ onExecute }: { onExecute: (instruction: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ q: string; r: IntentResult } | null>(null);
  const [error, setError] = useState<string>();
  async function ask(q: string) {
    if (!q.trim()) return;
    setBusy(true); setError(undefined);
    try { setAnswer({ q, r: await api<IntentResult>("/api/spak-in/interpret", { text: q, sessionId: `intel_${Date.now()}` }) }); setText(""); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const i = answer?.r.intelligence;
  const isTransfer = answer && answer.r.intentType !== "PORTFOLIO_QUERY";
  return (
    <Card>
      <SectionTitle sub="Ask in plain words. Questions are answered from your real balances; transfers open in Execute for review.">Ask about your portfolio</SectionTitle>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <label className="sr-only" htmlFor="intel-ask">Question</label>
        <input id="intel-ask" className={`${inputCls} flex-1`} value={text} onChange={(e) => setText(e.target.value)} placeholder="How much USDC do I have?" />
        <Button type="submit" disabled={busy || !text.trim()}>{busy ? "Checking" : "Ask"}</Button>
      </form>
      {!answer && <div className="mt-3 flex flex-wrap gap-2">{["How much USDC do I have?", "What is my balance on Base?", "Can I move 100 USDC to Arbitrum?"].map((x) => <button key={x} onClick={() => ask(x)} className="type-button-sm min-h-9 rounded-full border border-line-strong px-3 text-fg hover:border-primary">{x}</button>)}</div>}
      {error && <ErrorText>{error}</ErrorText>}
      {answer && (
        <div className="mt-4 rounded-card border border-line p-4">
          <p className="type-caption text-fg-2">{answer.q}</p>
          {i?.kind === "PORTFOLIO_ANSWER" && <><p className="type-body mt-1 text-fg">{i.text}</p><ul className="type-body-sm mt-2 list-disc pl-4 text-fg-2">{i.lines.map((l) => <li key={l}>{l}</li>)}</ul>{i.incomplete && <p className="type-caption mt-2 text-fg-2">{i.incomplete}</p>}</>}
          {i?.kind === "FEASIBILITY" && <><p className="type-body mt-1 text-fg">{i.status === "OK" ? `Yes. You have ${amt(i.available!)} ${i.symbol} on ${net(i.network)}.` : i.status === "INSUFFICIENT" ? `Not from ${net(i.network)}: you have ${amt(i.available ?? "0")} ${i.symbol} there.` : "SPak could not read that balance."}</p><ul className="type-body-sm mt-2 list-disc pl-4 text-fg-2">{i.notes.map((n) => <li key={n}>{n}</li>)}</ul></>}
          {i?.kind === "SOURCE_OPTIONS" && <><p className="type-body mt-1 text-fg">{i.text}</p><ul className="mt-2 flex flex-col gap-2">{i.options.map((o) => <li key={o.text} className="type-body-sm flex flex-wrap items-center justify-between gap-2 text-fg-2"><span>{o.text}</span>{o.instruction && <Button size="sm" variant="secondary" onClick={() => onExecute(o.instruction!)}>Prepare this transfer</Button>}</li>)}</ul></>}
          {i?.kind === "UNAVAILABLE" && <p className="type-body mt-1 text-fg">{i.text}</p>}
          {!i && answer.r.status !== "VALIDATED" && <p className="type-body mt-1 text-fg">{answer.r.clarifications[0]?.question ?? answer.r.errors[0]?.message ?? "SPak could not answer that."}</p>}
          {isTransfer && answer.r.plan?.executable && <Button className="mt-3" onClick={() => onExecute(answer.q)}>Continue in Execute</Button>}
        </div>
      )}
    </Card>
  );
}

/** Live dry quotes to the same asset on other networks. Choosing one hands a complete instruction to Execute. */
function Routes({ holding, onExecute }: { holding: Snapshot["holdings"][number]; onExecute: (instruction: string) => void }) {
  const [amount, setAmount] = useState(holding.native ? "" : holding.amount);
  const [routes, setRoutes] = useState<RouteOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function check() {
    setBusy(true); setError(undefined);
    try { setRoutes((await api<{ routes: RouteOption[] }>("/api/intelligence/routes", { assetId: holding.assetId, amount, walletAddress: holding.address })).routes); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-3 rounded-card border border-line bg-surface p-4 dark:bg-elevated">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); check(); }}>
        <label className="flex flex-col gap-1"><span className="type-label text-fg-2">Amount of {holding.symbol}</span>
          <input className={`${inputCls} w-40`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={holding.native ? "Leave some for fees" : undefined} /></label>
        <Button type="submit" size="sm" disabled={busy || !amount}>{busy ? "Quoting" : "Compare routes"}</Button>
      </form>
      <p className="type-caption mt-2 text-fg-2">Live NEAR Intents quotes, signature checked. No deposit address is created and nothing moves.</p>
      {error && <ErrorText>{error}</ErrorText>}
      {routes && (
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {routes.length === 0 && <li className="type-body-sm py-2 text-fg-2">No other network lists {holding.symbol}.</li>}
          {routes.map((r) => (
            <li key={r.destinationAssetId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className="type-body min-w-28 text-fg">{net(r.destinationNetwork)}</span>
              {r.status === "QUOTED" ? (
                <>
                  <span className="type-body-sm flex-1 text-fg-2">Receive about <span className="type-amount text-fg">{amt(r.amountOut!)}</span>, at least {amt(r.minAmountOut!)}{r.feePct !== null ? ` · cost ${r.feePct}%` : ""}{r.timeEstimateSec ? ` · ~${Math.max(1, Math.round(r.timeEstimateSec / 60))} min` : ""}</span>
                  <span className="type-caption text-fg-2">{r.delivery === "AUTOMATIC" ? "Delivery checked automatically" : "Delivery reviewed manually"}</span>
                  <Button size="sm" variant="secondary" onClick={() => onExecute(`Move ${amount} ${holding.symbol} from ${holding.networkName} to ${net(r.destinationNetwork)}`)}>Move here</Button>
                </>
              ) : <span className="type-body-sm flex-1 text-fg-2">{r.status === "TOO_SMALL" ? `Amount too small: ${r.detail}` : r.detail ?? "Unavailable"}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
