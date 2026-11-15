"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Chat } from "@/components/Chat";
import { Manual } from "@/components/Manual";
import { Review } from "@/components/Review";
import { Tracker } from "@/components/Tracker";
import { WalletPicker } from "@/components/WalletPicker";
import { loadSession, type Session } from "@/components/session";
import { Button, Card, Spinner, Tabs, Toast } from "@/components/ui";
import { Notice } from "@/components/status";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NAV, Shell, type View } from "@/components/app/Shell";
import { Intelligence } from "@/components/intelligence/Intelligence";
import { Tour } from "@/components/app/Tour";
import { PROVIDER_LABEL } from "@/environment";
import { Overview } from "@/components/app/Overview";
import { Interpretation } from "@/components/app/Interpretation";
import { Activity } from "@/components/app/Activity";
import { Agent, Guard, Settings } from "@/components/app/Sections";
import { api, type ExecutionView, type IntentResult, type QuoteView } from "@/lib/client";
import { takeNearRedirectResult } from "@/wallets/near";
import { notificationFor } from "@/components/tracking/model";
import { IN_FLIGHT } from "@/components/app/Overview";
import { classifyWalletError } from "@/wallets/errors";

const VIEWS = NAV.map((n) => n.id);
const readView = (): View => { const h = typeof window === "undefined" ? "" : window.location.hash.slice(1); return (VIEWS as string[]).includes(h) ? (h as View) : "overview"; };

export default function AppPage() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [view, setViewState] = useState<View>("overview");
  const [mode, setMode] = useState<"chat" | "manual">("chat");
  const [handoff, setHandoff] = useState<string>();
  const [interp, setInterp] = useState<IntentResult>();
  const [pending, setPending] = useState<{ intent: IntentResult; execution: ExecutionView; quote: QuoteView }>();
  const [active, setActive] = useState<ExecutionView>();
  const [timezone, setTimezone] = useState("UTC");
  const [notice, setNotice] = useState<string>();
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => { setSession(await loadSession().catch(() => null)); }, []);

  // Notifications: one per transfer and event, however many sources report it.
  const notified = useRef(new Set<string>());
  const notify = useCallback((id: string, key: string, message: string) => {
    const k = `${id}:${key}`;
    if (notified.current.has(k)) return;
    notified.current.add(k);
    setToast(message);
  }, []);

  // Background check of transfers still in flight, using the existing history endpoint. The open transfer reports
  // its own changes, so it is skipped here. Polling stops when nothing is in flight.
  const lastStates = useRef(new Map<string, string>());
  const activeId = active?.id;
  useEffect(() => {
    if (!session) return;
    let stop = false;
    const tick = async () => {
      const r = await api<{ items: ExecutionView[] }>("/api/executions?limit=20").catch(() => null);
      if (!r || stop) return;
      for (const x of r.items) {
        const prev = lastStates.current.get(x.id);
        lastStates.current.set(x.id, x.state);
        if (prev && x.id !== activeId) { const msg = notificationFor(prev, x.state); if (msg) notify(x.id, x.state, msg); }
      }
    };
    tick();
    const i = setInterval(() => { if ([...lastStates.current.values()].some((v) => IN_FLIGHT.includes(v) || v === "FAILED")) tick(); }, 30_000);
    return () => { stop = true; clearInterval(i); };
  }, [session, activeId, notify]);
  const setView = useCallback((v: View) => { setViewState(v); setActive(undefined); if (window.location.hash.slice(1) !== v) history.replaceState(null, "", `#${v}`); window.scrollTo(0, 0); }, []);

  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setViewState(readView());
    const onHash = () => setViewState(readView());
    window.addEventListener("hashchange", onHash);
    // Back from a NEAR browser wallet: finish the pending signature check.
    // The callback is untrusted: the server verifies the signature, the one-time challenge and the account key.
    const near = takeNearRedirectResult();
    const finish = near?.kind === "signed"
      ? api("/api/auth/verify", { challengeId: near.challengeId, signature: near.signature, publicKey: near.publicKey, accountId: near.accountId })
          .catch((e) => setNotice(classifyWalletError(e).message))
      : Promise.resolve(near && near.kind !== "none" ? setNotice(near.message) : undefined);
    finish.then(refresh);
    return () => window.removeEventListener("hashchange", onHash);
  }, [refresh]);

  const signedOut = () => { setSession(null); setPending(undefined); setActive(undefined); setInterp(undefined); };
  const onReady = (intent: IntentResult, execution: ExecutionView, quote: QuoteView) => { setActive(undefined); setPending({ intent, execution, quote }); };
  const open = (x: ExecutionView) => { setPending(undefined); setActive(x); window.scrollTo(0, 0); };
  const ownAddress = (net: string) => {
    if (!session) return undefined;
    const order = [...session.wallets.filter((w) => w.active), ...session.wallets.filter((w) => !w.active)];
    return order.find((w) => w.networks.some((n) => n.id === net && n.enabled))?.address;
  };
  const failed = notice && <Notice role="error" title="Wallet sign-in did not finish" className="mb-6">{notice}</Notice>;

  // Signed out: one focused screen with Manual Access sign-in.
  if (!session) {
    return (
      <div className="flex min-h-dvh flex-col">
        <header className="border-b border-line"><div className="mx-auto flex h-16 max-w-[72rem] items-center gap-3 px-4 sm:px-8"><Link href="/" aria-label="SPak home"><Logo className="h-7" /></Link><span className="flex-1" /><ThemeToggle /></div></header>
        <main className="mx-auto grid w-full max-w-[72rem] flex-1 content-start gap-x-16 gap-y-10 px-4 py-10 sm:px-8 lg:grid-cols-[1fr_minmax(0,28rem)] lg:py-20">
          <div className="lg:col-start-1 lg:row-start-1">
            <h1 className="type-app-title max-w-[22ch] text-fg">Your wallet is your account.</h1>
            <p className="type-body mt-4 max-w-[46ch] text-fg-2">Sign one message to prove the wallet is yours. It is not a transaction and costs no gas. SPak never asks for a seed phrase or private key.</p>
          </div>
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">{failed}{session === undefined ? <Card><Spinner label="Loading your session" /></Card> : <WalletPicker purpose="SIGN_IN" onDone={refresh} />}</div>
          <section aria-labelledby="next-steps" className="lg:col-start-1 lg:row-start-2">
            <h2 id="next-steps" className="type-label text-fg-2">After you sign in</h2>
            <ol className="mt-4 border-l border-line">
              {[
                ["Describe a transfer", "In plain words, for example: Swap 25 USDC on Base to USDC on NEAR."],
                ["Review the firm quote", "Exact amount, minimum you receive, fees and deposit address, before anything moves."],
                ["Sign the deposit yourself", "Your wallet signs. SPak holds no keys and cannot move your funds."],
                ["See it delivered", `SPak tracks the route through ${PROVIDER_LABEL} and checks delivery on the destination chain.`],
              ].map(([t, d]) => (
                <li key={t} className="relative pb-5 pl-6 last:pb-0">
                  <span aria-hidden className="absolute -left-[5px] top-1.5 h-[9px] w-[9px] rounded-full border-2 border-primary bg-bg" />
                  <p className="type-body text-fg">{t}</p>
                  <p className="type-body-sm mt-0.5 text-fg-2">{d}</p>
                </li>
              ))}
            </ol>
          </section>
        </main>
      </div>
    );
  }

  const title = active ? "Transfer" : NAV.find((n) => n.id === view)!.label;
  return (
    <Shell session={session} view={view} onSelect={setView} signedOut={signedOut} title={title} notice={failed}>
      <Tour userId={session.userId} onSelect={setView} />
      {active ? (
        <div className="mx-auto flex max-w-[48rem] flex-col gap-4">
          <div><Button variant="ghost" size="sm" onClick={() => setActive(undefined)}>← Back</Button></div>
          <Tracker key={active.id} initial={active} onNotify={notify} />
        </div>
      ) : (
        <>
          {view === "overview" && <Overview session={session} onSelect={setView} onOpen={open} onExecute={(t) => { setHandoff(t); setMode("chat"); setInterp(undefined); setView("execute"); }} />}
          {view === "execute" && (
            <div className="flex flex-col gap-6">
              <div className="grid items-start gap-6 xl:grid-cols-[1fr_1fr]">
                <div className="flex flex-col gap-3">
                  <Tabs label="Input" items={[{ id: "chat", label: "Instruction" }, { id: "manual", label: "Manual form" }]} value={mode} onChange={setMode} />
                  {mode === "chat"
                    ? <Chat key={handoff ?? "chat"} timezone={timezone} onReady={onReady} onInterpret={setInterp} initial={handoff} />
                    : <Manual ownAddress={ownAddress} onReady={onReady} />}
                  {/* The review sits right under the conversation that produced it, on every screen size. */}
                  {pending && (
                    <Review intent={pending.intent} execution={pending.execution} quote={pending.quote} onCancel={() => setPending(undefined)}
                      onApproved={(x, message) => { setPending(undefined); setActive(x); setToast(message ?? "Approved. Send the deposit from your wallet to continue."); }} />
                  )}
                </div>
                {interp ? <Interpretation r={interp} /> : (
                  <Card className="border-dashed">
                    <p className="type-app-subheading text-fg">How SPak reads your instruction</p>
                    <p className="type-body-sm mt-1 text-fg-2">Send an instruction and the interpretation appears here: the assets, networks and amount SPak extracted, anything missing, and the execution plan.</p>
                  </Card>
                )}
              </div>
            </div>
          )}
          {view === "activity" && <Activity onOpen={open} />}
          {view === "portfolio" && <Intelligence onExecute={(t) => { setHandoff(t); setMode("chat"); setInterp(undefined); setView("execute"); }} />}
          {view === "guard" && <Guard />}
          {view === "agent" && <Agent session={session} refresh={refresh} signedOut={signedOut} />}
          {view === "settings" && <Settings session={session} refresh={refresh} signedOut={signedOut} />}
        </>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </Shell>
  );
}
