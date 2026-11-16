"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ExecutionView, type IntentResult, type QuoteView } from "@/lib/client";
import { Amount, Button, Card, Field, Mono, Select, Spinner, inputCls } from "@/components/ui";
import { Notice } from "@/components/status";
import { describe as describeRecurrence, occurrenceDate, validateRecurrence, type Frequency, type Recurrence } from "@/payments/recurrence";

/**
 * SPak Payments: recurring payment schedules. A schedule prepares each payment with a fresh quote when it is due;
 * the user reviews it and their wallet signs the deposit. Every value shown comes from the server.
 * Layout reads like a document: amount first, the full recipient address, then when. Status is text with a dot,
 * coloured by the SPak status palette (pending = waiting on you, processing = SPak or the network is working).
 */
interface Net { id: string; name: string }
interface Asset { id: string; network: string; symbol: string }
type Occ = { id: string; seq: number; dueDate: string; status: string; executionId: string | null; executionState: string | null; attempt: number; failureCode: string | null; failureMessage: string | null; action: "SIGN" | "TRACK" | "RECOVER" | "NONE" };
type Schedule = {
  id: string; name: string; status: "ACTIVE" | "PAUSED" | "CANCELLED" | "FINISHED"; amount: string; sourceNetwork: string; sourceAssetId: string; destinationNetwork: string; destinationAssetId: string;
  recipient: string; agentId: string | null; recurrence: Recurrence; timezone: string; nextDueDate: string | null; occurrences: Occ[];
};

/** "2026-11-15" -> "15 Nov 2026". Parsed as a calendar date, so no timezone can shift it. */
export function fmtDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day)));
}
const STATUS: Record<Schedule["status"], { text: string; role: string }> = {
  ACTIVE: { text: "Active", role: "success" }, PAUSED: { text: "Paused", role: "warning" }, CANCELLED: { text: "Cancelled", role: "neutral" }, FINISHED: { text: "Finished", role: "neutral" },
};
function occText(o: Occ): { text: string; role: string } {
  if (o.status === "PREPARED") {
    const s = o.executionState;
    if (s === "AWAITING_APPROVAL" || s === "QUOTED") return { text: "Ready to review and sign", role: "pending" };
    if (s === "AWAITING_DEPOSIT") return { text: "Waiting for your wallet signature", role: "pending" };
    if (s === "COMPLETED") return { text: "Paid, delivery verified", role: "success" };
    if (s === "EXPIRED") return { text: "Expired unsigned", role: "neutral" };
    if (s === "CANCELLED") return { text: "Cancelled", role: "neutral" };
    if (s === "REFUNDED") return { text: "Refunded", role: "refunded" };
    if (s === "FAILED" || s === "UNKNOWN") return { text: "Needs attention", role: "warning" };
    return { text: "In progress", role: "processing" };
  }
  return ({ PREPARING: { text: "Preparing", role: "processing" }, FAILED: { text: "Could not prepare", role: "error" }, MISSED: { text: "Missed", role: "warning" },
    SKIPPED: { text: "Skipped", role: "neutral" }, CANCELLED: { text: "Cancelled", role: "neutral" } } as Record<string, { text: string; role: string }>)[o.status] ?? { text: o.status, role: "neutral" };
}
function Dot({ role, children }: { role: string; children: React.ReactNode }) {
  return <span className="type-status inline-flex items-center gap-2" style={{ color: `var(--spak-status-${role}-foreground)` }}><span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--spak-status-${role}-icon)` }} />{children}</span>;
}
const tzNow = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function Payments({ onReview, onOpen }: { onReview: (i: IntentResult, x: ExecutionView, q: QuoteView) => void; onOpen: (x: ExecutionView) => void }) {
  const [list, setList] = useState<Schedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [nets, setNets] = useState<Net[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);

  const load = useCallback(async () => {
    try { setList((await api<{ schedules: Schedule[] }>("/api/payments/schedules")).schedules); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); api<{ networks: Net[]; assets: Asset[] }>("/api/spak-in/registry").then((r) => { setNets(r.networks); setAssets(r.assets); }).catch(() => undefined); }, [load]);
  const net = (id: string) => nets.find((n) => n.id === id)?.name ?? id;
  const sym = (id: string) => assets.find((a) => a.id === id)?.symbol ?? id.split(":").pop();

  async function act(key: string, url: string) {
    setBusy(key); setError(null);
    try { await api(url, {}); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  /** Fresh quote first (never an old one), then the normal review. */
  async function review(o: Occ) {
    if (!o.executionId) return;
    setBusy(o.id); setError(null);
    try {
      if (o.executionState === "AWAITING_APPROVAL" || o.executionState === "QUOTED") {
        const r = await api<{ execution: ExecutionView; quote: QuoteView }>(`/api/executions/${o.executionId}/quote`, {});
        onReview({ intentType: "PAYMENT" } as IntentResult, r.execution, r.quote);
      } else onOpen(await api<ExecutionView>(`/api/executions/${o.executionId}`));
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  const waiting = (list ?? []).flatMap((s) => s.occurrences.filter((o) => o.action === "SIGN").map((o) => ({ s, o })));

  return (
    <div className="mx-auto flex w-full max-w-[52rem] flex-col gap-6" data-payments>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-body-sm max-w-xl text-fg-2">Pay the same amount to the same address on a schedule. On each date SPak prepares the payment with a fresh quote. You review it and your wallet signs.</p>
        {!creating && <Button onClick={() => setCreating(true)}>New recurring payment</Button>}
      </div>
      {error && <Notice role="error" title="Not done">{error}</Notice>}
      {creating && <CreateSchedule nets={nets} assets={assets} onDone={async () => { setCreating(false); await load(); }} onCancel={() => setCreating(false)} />}

      {/* A summary across schedules; with a single schedule its own list already shows the same action. */}
      {waiting.length > 0 && (list?.length ?? 0) > 1 && (
        <div data-waiting><Card>
          <h2 className="type-app-subheading text-fg">Waiting for you</h2>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {waiting.map(({ s, o }) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="min-w-0"><span className="type-body text-fg">{s.name}</span><span className="type-caption block text-fg-2"><span className="type-amount">{s.amount}</span> {sym(s.sourceAssetId)} · due {fmtDate(o.dueDate)}</span></span>
                <Button size="sm" disabled={busy === o.id} onClick={() => review(o)}>{o.executionState === "AWAITING_DEPOSIT" ? "Sign the deposit" : "Review and sign"}</Button>
              </li>
            ))}
          </ul>
        </Card></div>
      )}

      {!list ? <Spinner label="Loading payments" /> : list.length === 0 && !creating ? (
        <Card className="border-dashed">
          <p className="type-app-subheading text-fg">No recurring payments yet</p>
          <p className="type-body-sm mt-1 max-w-lg text-fg-2">For example, 50 USDC from Base to the same address on Arbitrum on the first of every month. Each payment waits for your review and signature.</p>
          <div className="mt-4"><Button variant="secondary" size="sm" onClick={() => setCreating(true)}>Set one up</Button></div>
        </Card>
      ) : list.map((s) => (
        <div key={s.id} data-schedule={s.status}><Card>
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <p className="type-label text-fg-2">{s.name}</p>
              <p className="mt-1"><Amount value={`${s.amount} ${sym(s.sourceAssetId)}`} size="amount-display" /></p>
              <p className="type-body-sm text-fg-2">{describeRecurrence(s.recurrence, fmtDate)}</p>
            </div>
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <Dot role={STATUS[s.status].role}>{STATUS[s.status].text}</Dot>
              {s.nextDueDate && <span className="type-body-sm text-fg" data-next-date>Next payment <span className="type-amount">{fmtDate(s.nextDueDate)}</span></span>}
            </div>
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-[9rem_1fr]">
            <dt className="type-label text-fg-2">Recipient</dt>
            <dd className="min-w-0"><Mono value={s.recipient} full /><span className="type-caption block text-fg-2">on {net(s.destinationNetwork)}, receives {sym(s.destinationAssetId)}</span></dd>
            <dt className="type-label text-fg-2">Paid from</dt>
            <dd className="type-body-sm text-fg">{sym(s.sourceAssetId)} on {net(s.sourceNetwork)}<span className="type-caption block text-fg-2">Dates in {s.timezone}{s.agentId ? ". Your Agent may approve within its permission; your wallet still signs" : ""}</span></dd>
          </dl>
          {(s.status === "ACTIVE" || s.status === "PAUSED") && (
            <div className="mt-4 flex flex-wrap gap-2">
              {s.status === "ACTIVE" && <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => act(s.id, `/api/payments/schedules/${s.id}/pause`)}>Pause</Button>}
              {s.status === "PAUSED" && <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => act(s.id, `/api/payments/schedules/${s.id}/resume`)}>Resume</Button>}
              <Button variant="ghost" size="sm" disabled={!!busy}
                onClick={() => { if (window.confirm(`Cancel "${s.name}"? It will not prepare any more payments. This cannot be undone.`)) void act(s.id, `/api/payments/schedules/${s.id}/cancel`); }}>Cancel schedule</Button>
            </div>
          )}
          {s.occurrences.length > 0 && (
            <div className="mt-5 border-t border-line pt-3">
              <p className="type-label text-fg-2">Payments</p>
              <ol className="mt-1 flex flex-col divide-y divide-line">
                {s.occurrences.map((o) => {
                  const t = occText(o);
                  return (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-occurrence={o.status}>
                      <span className="min-w-0">
                        <span className="type-body-sm text-fg"><span className="type-amount">{fmtDate(o.dueDate)}</span>{o.attempt > 1 ? <span className="text-fg-2"> · attempt {o.attempt}</span> : null}</span>
                        <span className="mt-0.5 block"><Dot role={t.role}>{t.text}</Dot></span>
                        {o.failureMessage && <span className="type-caption mt-0.5 block max-w-xl text-fg-2">{o.failureMessage}</span>}
                      </span>
                      <span className="flex flex-wrap gap-2">
                        {o.action === "SIGN" && <Button size="sm" disabled={busy === o.id} onClick={() => review(o)}>{o.executionState === "AWAITING_DEPOSIT" ? "Sign the deposit" : "Review and sign"}</Button>}
                        {o.executionId && (o.action === "TRACK" || o.action === "RECOVER") && <Button variant="ghost" size="sm" disabled={busy === o.id} onClick={() => review(o)}>Open</Button>}
                        {o.action === "RECOVER" && <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => act(o.id, `/api/payments/occurrences/${o.id}/retry`)}>Prepare now</Button>}
                        {o.action === "RECOVER" && (o.status === "MISSED" || o.status === "FAILED") && <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => act(o.id, `/api/payments/occurrences/${o.id}/skip`)}>Skip</Button>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </Card></div>
      ))}
    </div>
  );
}

const FREQ: { id: Frequency; label: string }[] = [
  { id: "WEEKLY", label: "Every week" }, { id: "BIWEEKLY", label: "Every two weeks" }, { id: "MONTHLY", label: "Every month" }, { id: "DAILY", label: "Every day" }, { id: "EVERY_N_DAYS", label: "Every N days" },
];
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <legend className="type-label float-left w-full text-fg">{title}</legend>
      {children}
    </fieldset>
  );
}

function CreateSchedule({ nets, assets, onDone, onCancel }: { nets: Net[]; assets: Asset[]; onDone: () => void; onCancel: () => void }) {
  const tz = tzNow();
  const today = todayIn(tz);
  const usable = useMemo(() => nets.filter((n) => assets.some((a) => a.network === n.id)), [nets, assets]);
  const on = (n: string) => assets.filter((a) => a.network === n).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const [f, setF] = useState({ name: "", recipient: "", sourceNetwork: "base", sourceAssetId: "", destinationNetwork: "base", destinationAssetId: "", amount: "", frequency: "MONTHLY" as Frequency, intervalDays: "30", startDate: today, end: "never" as "never" | "date" | "count", endDate: "", count: "12" });
  const [step, setStep] = useState<"form" | "summary">("form");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!assets.length) return;
    setF((p) => {
      const src = p.sourceAssetId || on(p.sourceNetwork).find((a) => a.symbol === "USDC")?.id || on(p.sourceNetwork)[0]?.id || "";
      const symbol = assets.find((a) => a.id === src)?.symbol;
      const dst = on(p.destinationNetwork).find((a) => a.symbol === symbol)?.id ?? on(p.destinationNetwork)[0]?.id ?? "";
      return { ...p, sourceAssetId: src, destinationAssetId: p.destinationAssetId && p.destinationAssetId.startsWith(`${p.destinationNetwork}:`) ? p.destinationAssetId : dst };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, f.sourceNetwork, f.destinationNetwork, f.sourceAssetId]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const body = {
    name: f.name.trim(), recipient: f.recipient.trim(), sourceNetwork: f.sourceNetwork, sourceAssetId: f.sourceAssetId, destinationNetwork: f.destinationNetwork, destinationAssetId: f.destinationAssetId,
    amount: f.amount.trim(), frequency: f.frequency, intervalDays: f.frequency === "EVERY_N_DAYS" ? Number(f.intervalDays) : null, startDate: f.startDate,
    endDate: f.end === "date" ? f.endDate : null, maxOccurrences: f.end === "count" ? Number(f.count) : null, timezone: tz,
  };
  const check = validateRecurrence(body, today);
  const firstDates = check.ok ? [0, 1, 2].map((i) => occurrenceDate(check.value, i)).filter((d): d is string => !!d) : [];
  const symbol = assets.find((a) => a.id === f.sourceAssetId)?.symbol ?? "";
  const dstSymbol = assets.find((a) => a.id === f.destinationAssetId)?.symbol ?? "";
  const netName = (id: string) => nets.find((n) => n.id === id)?.name ?? id;

  function toSummary(e: React.FormEvent) {
    e.preventDefault(); setProblem(null);
    if (!body.name || !body.recipient || !body.amount) return setProblem("Fill in a name, the amount and the recipient address.");
    if (!check.ok) return setProblem(check.error);
    setStep("summary");
  }
  async function create() {
    setBusy(true); setProblem(null);
    try { await api("/api/payments/schedules", body); onDone(); } catch (e) { setProblem((e as Error).message); setStep("form"); } finally { setBusy(false); }
  }

  if (step === "summary" && check.ok) {
    return (
      <div data-schedule-summary><Card>
        <p className="type-label text-fg-2">Check before you create it. Nothing is paid now.</p>
        <h2 className="type-app-heading mt-1 text-fg">{body.name}</h2>
        <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-[9rem_1fr]">
          <dt className="type-label text-fg-2">Each payment</dt>
          <dd><Amount value={`${body.amount} ${symbol}`} size="amount-display" /><span className="type-caption block text-fg-2">from {netName(body.sourceNetwork)}. The recipient receives {dstSymbol} on {netName(body.destinationNetwork)}, less fees shown in each review.</span></dd>
          <dt className="type-label text-fg-2">Recipient</dt>
          <dd className="min-w-0"><Mono value={body.recipient} full /><span className="type-caption block text-fg-2">on {netName(body.destinationNetwork)}. Check every character.</span></dd>
          <dt className="type-label text-fg-2">When</dt>
          <dd className="type-body text-fg">{describeRecurrence(check.value, fmtDate)}<span className="type-caption block text-fg-2">First payments: {firstDates.map(fmtDate).join(", ")}. Dates in {tz}.</span></dd>
          <dt className="type-label text-fg-2">Each date</dt>
          <dd className="type-body-sm text-fg-2">SPak checks the payment with SPak Guard and gets a fresh quote. You review it and your wallet signs the deposit. A missed date waits for you to prepare or skip it.</dd>
        </dl>
        {problem && <Notice role="error" title="Not created" className="mt-4">{problem}</Notice>}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={create} disabled={busy}>{busy ? "Creating" : "Create schedule"}</Button>
          <Button variant="ghost" onClick={() => setStep("form")} disabled={busy}>Edit</Button>
        </div>
      </Card></div>
    );
  }
  return (
    <Card>
      <h2 className="type-app-heading text-fg">New recurring payment</h2>
      <form onSubmit={toSummary} className="mt-5 flex flex-col gap-5">
        <Field label="Name"><input className={inputCls} name="name" maxLength={80} placeholder="What this payment is for" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Group title="Payment">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Amount each time"><input className={`${inputCls} type-amount`} name="amount" inputMode="decimal" placeholder="0.0" value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} /></Field>
            <Field label="Token"><Select value={f.sourceAssetId} onChange={(e) => setF((p) => ({ ...p, sourceAssetId: e.target.value, destinationAssetId: "" }))}>{on(f.sourceNetwork).map((a) => <option key={a.id} value={a.id}>{a.symbol}</option>)}</Select></Field>
            <Field label="Pay from network"><Select value={f.sourceNetwork} onChange={(e) => setF((p) => ({ ...p, sourceNetwork: e.target.value, sourceAssetId: "" }))}>{usable.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</Select></Field>
          </div>
        </Group>
        <Group title="Recipient">
          <Field label="Recipient address"><input className={`${inputCls} type-address`} name="recipient" spellCheck={false} autoComplete="off" placeholder="Their address on the network below" value={f.recipient} onChange={(e) => set("recipient", e.target.value.trim())} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Recipient's network"><Select value={f.destinationNetwork} onChange={(e) => setF((p) => ({ ...p, destinationNetwork: e.target.value, destinationAssetId: "" }))}>{usable.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</Select></Field>
            <Field label="Recipient receives"><Select value={f.destinationAssetId} onChange={(e) => set("destinationAssetId", e.target.value)}>{on(f.destinationNetwork).map((a) => <option key={a.id} value={a.id}>{a.symbol}</option>)}</Select></Field>
          </div>
        </Group>
        <Group title="Schedule">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="How often"><Select value={f.frequency} onChange={(e) => set("frequency", e.target.value as Frequency)}>{FREQ.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
            {f.frequency === "EVERY_N_DAYS" && <Field label="Days between payments" hint="1 to 365"><input className={`${inputCls} type-amount`} name="intervalDays" inputMode="numeric" value={f.intervalDays} onChange={(e) => set("intervalDays", e.target.value.replace(/\D/g, ""))} /></Field>}
            <Field label="First payment" hint={`Dates in ${tz}`}><input className={inputCls} type="date" name="startDate" min={today} value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Ends"><Select value={f.end} onChange={(e) => set("end", e.target.value as typeof f.end)}><option value="never">When I cancel</option><option value="date">On a date</option><option value="count">After a number of payments</option></Select></Field>
            {f.end === "date" && <Field label="Last date"><input className={inputCls} type="date" name="endDate" min={f.startDate} value={f.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field>}
            {f.end === "count" && <Field label="Number of payments" hint="1 to 520"><input className={`${inputCls} type-amount`} name="count" inputMode="numeric" value={f.count} onChange={(e) => set("count", e.target.value.replace(/\D/g, ""))} /></Field>}
          </div>
          {f.frequency === "MONTHLY" && Number(f.startDate.slice(8)) > 28 && <p className="type-caption text-fg-2">Months without day {Number(f.startDate.slice(8))} pay on their last day.</p>}
        </Group>
        {problem && <Notice role="error" title="Check the schedule">{problem}</Notice>}
        <div className="flex flex-wrap gap-2 border-t border-line pt-5">
          <Button type="submit" disabled={!f.sourceAssetId || !f.destinationAssetId}>Review schedule</Button>
          <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
