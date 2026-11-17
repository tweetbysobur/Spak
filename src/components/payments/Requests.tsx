"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ExecutionView, type IntentResult, type QuoteView } from "@/lib/client";
import type { Session } from "@/components/session";
import { Amount, Button, Card, Field, Mono, Select, Spinner, inputCls } from "@/components/ui";
import { Notice } from "@/components/status";

/**
 * SPak Payments: payment requests. The payee asks for an amount on a network, paid to one of their own wallets, and
 * shares the link. The payer opens it, picks what to pay with, and gets the normal payment review. A request shows
 * Paid only after SPak verifies delivery of at least the requested amount on the destination chain.
 */
interface Net { id: string; name: string }
interface Asset { id: string; network: string; symbol: string }
type PublicRequest = { status: "OPEN" | "PAID" | "CANCELLED" | "EXPIRED"; amount: string; symbol: string | null; destinationNetwork: string; networkName: string; destinationAssetId: string; recipient: string; note: string | null; expiresAt: string; paidAt: string | null; createdAt: string };
type OwnRequest = PublicRequest & { id: string; token: string; paidExecutionId: string | null };

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const STATUS: Record<PublicRequest["status"], { text: string; role: string }> = {
  OPEN: { text: "Open", role: "pending" }, PAID: { text: "Paid, delivery verified", role: "success" }, CANCELLED: { text: "Cancelled", role: "neutral" }, EXPIRED: { text: "Expired", role: "neutral" },
};
function Dot({ role, children }: { role: string; children: React.ReactNode }) {
  return <span className="type-status inline-flex items-center gap-2" style={{ color: `var(--spak-status-${role}-foreground)` }}><span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--spak-status-${role}-icon)` }} />{children}</span>;
}
export const requestLink = (token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/app?pay=${token}`;

/** The request as anyone with the link sees it (amount first, then who receives it, then the note). */
function RequestBody({ r }: { r: PublicRequest }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-[8rem_1fr]">
      <dt className="type-label text-fg-2">Amount</dt>
      <dd><Amount value={`${r.amount} ${r.symbol ?? ""}`} size="amount-display" /><span className="type-caption block text-fg-2">on {r.networkName}. The recipient receives at least this.</span></dd>
      <dt className="type-label text-fg-2">Paid to</dt>
      <dd className="min-w-0"><Mono value={r.recipient} full /></dd>
      {r.note && <><dt className="type-label text-fg-2">Note</dt><dd className="type-body text-fg [overflow-wrap:anywhere]">{r.note}</dd></>}
      <dt className="type-label text-fg-2">Status</dt>
      <dd><Dot role={STATUS[r.status].role}>{STATUS[r.status].text}</Dot>{r.status === "OPEN" && <span className="type-caption block text-fg-2">Open until {when(r.expiresAt)}</span>}</dd>
    </dl>
  );
}

/** Signed out: the request above sign-in, so the payer knows what they are signing in to pay. */
export function RequestPreview({ token }: { token: string }) {
  const [r, setR] = useState<PublicRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<PublicRequest>(`/api/payments/requests/link/${encodeURIComponent(token)}`).then(setR, (e) => setError((e as Error).message)); }, [token]);
  return (
    <div data-request-preview><Card>
      <p className="type-label text-fg-2">Payment request</p>
      <div className="mt-3">{error ? <Notice role="error" title="This link does not work">{error}</Notice> : !r ? <Spinner label="Loading the request" /> : <RequestBody r={r} />}</div>
      {r?.status === "OPEN" && <p className="type-body-sm mt-4 text-fg-2">Sign in with your wallet to pay it. You review every amount before your wallet signs.</p>}
    </Card></div>
  );
}

/** Signed in, from a link: choose what to pay with, then the normal payment review. */
export function PayRequest({ token, session, onReview, onClose }: { token: string; session: Session; onReview: (i: IntentResult, x: ExecutionView, q: QuoteView) => void; onClose: () => void }) {
  const [r, setR] = useState<PublicRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nets, setNets] = useState<Net[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [src, setSrc] = useState({ network: "", asset: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<PublicRequest>(`/api/payments/requests/link/${encodeURIComponent(token)}`).then(setR, (e) => setError((e as Error).message));
    api<{ networks: Net[]; assets: Asset[] }>("/api/spak-in/registry").then((x) => { setNets(x.networks); setAssets(x.assets); }).catch(() => undefined);
  }, [token]);
  // Networks the payer can send from: those with one of their wallets enabled.
  const mine = useMemo(() => nets.filter((n) => session.wallets.some((w) => w.networks.some((x) => x.id === n.id && x.enabled)) && assets.some((a) => a.network === n.id)), [nets, assets, session]);
  const on = (n: string) => assets.filter((a) => a.network === n).sort((a, b) => a.symbol.localeCompare(b.symbol));
  useEffect(() => {
    if (!r || !mine.length || src.network) return;
    const same = mine.find((n) => n.id === r.destinationNetwork) ?? mine[0];
    const asset = on(same.id).find((a) => a.symbol === r.symbol)?.id ?? on(same.id)[0]?.id ?? "";
    setSrc({ network: same.id, asset });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, mine]);

  async function go() {
    setBusy(true); setError(null);
    try {
      const x = await api<{ intent: IntentResult; execution: ExecutionView; quote: QuoteView }>(`/api/payments/requests/link/${encodeURIComponent(token)}/pay`, { sourceNetwork: src.network, sourceAssetId: src.asset });
      onReview(x.intent, x.execution, x.quote);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto w-full max-w-[44rem]" data-pay-request><Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="type-label text-fg-2">Payment request</p>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <div className="mt-3">{!r && !error ? <Spinner label="Loading the request" /> : r ? <RequestBody r={r} /> : null}</div>
      {r?.status === "OPEN" && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="type-label text-fg">Pay with</p>
          {mine.length === 0 ? <p className="type-body-sm mt-2 text-fg-2">Link a wallet in Settings to pay from it.</p> : (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Network"><Select value={src.network} onChange={(e) => setSrc({ network: e.target.value, asset: on(e.target.value).find((a) => a.symbol === r.symbol)?.id ?? on(e.target.value)[0]?.id ?? "" })}>{mine.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</Select></Field>
              <Field label="Token"><Select value={src.asset} onChange={(e) => setSrc({ ...src, asset: e.target.value })}>{on(src.network).map((a) => <option key={a.id} value={a.id}>{a.symbol}</option>)}</Select></Field>
            </div>
          )}
          <p className="type-caption mt-3 text-fg-2">SPak works out how much to send so the recipient receives at least {r.amount} {r.symbol}. The review shows every amount and fee before your wallet signs.</p>
          <div className="mt-4"><Button onClick={go} disabled={busy || !src.asset}>{busy ? "Getting a quote" : "Continue to review"}</Button></div>
        </div>
      )}
      {error && <Notice role="error" title="Not ready" className="mt-4">{error}</Notice>}
    </Card></div>
  );
}

/** The payee's requests: create, copy the link, see status, cancel. */
export function Requests({ session }: { session: Session }) {
  const [list, setList] = useState<OwnRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [nets, setNets] = useState<Net[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const load = useCallback(async () => { try { setList((await api<{ requests: OwnRequest[] }>("/api/payments/requests")).requests); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); api<{ networks: Net[]; assets: Asset[] }>("/api/spak-in/registry").then((x) => { setNets(x.networks); setAssets(x.assets); }).catch(() => undefined); }, [load]);

  async function copy(token: string) {
    try { await navigator.clipboard.writeText(requestLink(token)); setCopied(token); setTimeout(() => setCopied(null), 2000); } catch { setError("Copy the link from the address shown."); }
  }
  async function cancel(id: string) {
    if (!window.confirm("Cancel this request? The link will stop working for payment.")) return;
    setBusy(id); setError(null);
    try { await api(`/api/payments/requests/${id}/cancel`, {}); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <section aria-labelledby="requests-title" className="flex flex-col gap-4" data-requests>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="requests-title" className="type-app-subheading text-fg">Payment requests</h2>
          <p className="type-body-sm mt-0.5 text-fg-2">Ask someone to pay you. Share the link; they pay from any network SPak supports.</p>
        </div>
        {!creating && <Button variant="secondary" onClick={() => setCreating(true)}>New request</Button>}
      </div>
      {error && <Notice role="error" title="Not done">{error}</Notice>}
      {creating && <CreateRequest session={session} nets={nets} assets={assets} onCancel={() => setCreating(false)} onDone={async () => { setCreating(false); await load(); }} />}
      {!list ? <Spinner label="Loading requests" /> : list.length === 0 && !creating ? (
        <Card className="border-dashed"><p className="type-body-sm text-fg-2">No requests yet. For example, ask for 25 USDC on Arbitrum to your own wallet and send the link to whoever owes you.</p></Card>
      ) : list.map((r) => (
        <div key={r.id} data-request={r.status}><Card>
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <p className="mt-0.5"><Amount value={`${r.amount} ${r.symbol ?? ""}`} size="amount-display" /></p>
              <p className="type-body-sm text-fg-2">on {r.networkName}{r.note ? ` · ${r.note}` : ""}</p>
            </div>
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <Dot role={STATUS[r.status].role}>{STATUS[r.status].text}</Dot>
              <span className="type-caption text-fg-2">{r.status === "OPEN" ? `Open until ${when(r.expiresAt)}` : r.paidAt ? `Paid ${when(r.paidAt)}` : `Created ${when(r.createdAt)}`}</span>
            </div>
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-[8rem_1fr]">
            <dt className="type-label text-fg-2">Paid to</dt><dd className="min-w-0"><Mono value={r.recipient} full /></dd>
            {r.status === "OPEN" && <><dt className="type-label text-fg-2">Link</dt><dd className="min-w-0"><span className="type-address block break-all text-fg" data-request-link>{requestLink(r.token)}</span></dd></>}
          </dl>
          {r.status === "OPEN" && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => copy(r.token)}>{copied === r.token ? "Link copied" : "Copy link"}</Button>
              <Button variant="ghost" size="sm" disabled={busy === r.id} onClick={() => cancel(r.id)}>Cancel request</Button>
            </div>
          )}
        </Card></div>
      ))}
    </section>
  );
}

function CreateRequest({ session, nets, assets, onDone, onCancel }: { session: Session; nets: Net[]; assets: Asset[]; onDone: () => void; onCancel: () => void }) {
  // Only networks where the payee has a wallet: the request is always paid to their own wallet.
  const mine = useMemo(() => nets.filter((n) => session.wallets.some((w) => w.networks.some((x) => x.id === n.id && x.enabled)) && assets.some((a) => a.network === n.id)), [nets, assets, session]);
  const on = (n: string) => assets.filter((a) => a.network === n).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const walletsOn = (n: string) => session.wallets.filter((w) => w.networks.some((x) => x.id === n && x.enabled));
  const [f, setF] = useState({ network: "", asset: "", amount: "", recipient: "", note: "", days: "7" });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!mine.length || f.network) return;
    const n = mine[0].id;
    setF((p) => ({ ...p, network: n, asset: on(n).find((a) => a.symbol === "USDC")?.id ?? on(n)[0]?.id ?? "", recipient: walletsOn(n)[0]?.address ?? "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);
  const pickNetwork = (n: string) => setF((p) => ({ ...p, network: n, asset: on(n).find((a) => a.symbol === assets.find((x) => x.id === p.asset)?.symbol)?.id ?? on(n).find((a) => a.symbol === "USDC")?.id ?? on(n)[0]?.id ?? "", recipient: walletsOn(n)[0]?.address ?? "" }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setProblem(null);
    if (!f.amount.trim()) return setProblem("Enter the amount you are asking for.");
    setBusy(true);
    try { await api("/api/payments/requests", { destinationNetwork: f.network, destinationAssetId: f.asset, amount: f.amount.trim(), recipient: f.recipient, ...(f.note.trim() ? { note: f.note.trim() } : {}), expiresInDays: Number(f.days) }); onDone(); }
    catch (err) { setProblem((err as Error).message); } finally { setBusy(false); }
  }
  if (!mine.length) return <Card><p className="type-body-sm text-fg-2">Link a wallet in Settings to receive payments to it.</p></Card>;
  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4" data-create-request>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Amount you receive"><input className={`${inputCls} type-amount`} name="requestAmount" inputMode="decimal" placeholder="0.0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
          <Field label="Token"><Select value={f.asset} onChange={(e) => setF({ ...f, asset: e.target.value })}>{on(f.network).map((a) => <option key={a.id} value={a.id}>{a.symbol}</option>)}</Select></Field>
          <Field label="Network"><Select value={f.network} onChange={(e) => pickNetwork(e.target.value)}>{mine.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</Select></Field>
        </div>
        <Field label="Paid to your wallet">
          <Select value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })}>{walletsOn(f.network).map((w) => <option key={w.id} value={w.address}>{w.address}</option>)}</Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Field label="Note (optional)" hint="Shown to the payer. Up to 140 characters."><input className={inputCls} name="requestNote" maxLength={140} placeholder="What it is for" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          <Field label="Link works for"><Select value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })}>{[["1", "1 day"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        </div>
        {problem && <Notice role="error" title="Not created">{problem}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !f.asset}>{busy ? "Creating" : "Create request"}</Button>
          <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
