"use client";
import { useCallback, useEffect, useState } from "react";
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
import { Icon } from "@/components/icons";
import { NAV, Shell, type View } from "@/components/app/Shell";
import { Overview } from "@/components/app/Overview";
import { Interpretation } from "@/components/app/Interpretation";
import { Activity } from "@/components/app/Activity";
import { Agent, Guard, Portfolio, Settings } from "@/components/app/Sections";
import { api, type ExecutionView, type IntentResult, type QuoteView } from "@/lib/client";
import { takeNearRedirectResult } from "@/wallets/near";
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
        <main className="mx-auto grid w-full max-w-[72rem] flex-1 items-start gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[1fr_1.1fr] lg:py-16">
          <div>
            <h1 className="type-app-title text-fg">Connect a wallet to start.</h1>
            <p className="type-body mt-3 text-fg-2">You sign a one-time message to prove you own the wallet. It is not a transaction and costs nothing. SPak never asks for a seed phrase or private key.</p>
            <ul className="mt-6 flex flex-col gap-3">
              {["EVM wallets: MetaMask and others", "Solana wallets: Phantom and others", "NEAR wallets: Meteor"].map((t) => <li key={t} className="type-body-sm flex gap-2 text-fg"><Icon name="success" size={16} className="mt-0.5 text-primary" />{t}</li>)}
            </ul>
            <p className="type-caption mt-6 text-fg-2">This is Manual Access: you approve every transfer and your wallet signs it. SPak Agent onboarding comes later, from the Agent page.</p>
          </div>
          <div>{failed}{session === undefined ? <Card><Spinner label="Loading your session" /></Card> : <WalletPicker purpose="SIGN_IN" onDone={refresh} />}</div>
        </main>
      </div>
    );
  }

  const title = active ? "Transfer" : NAV.find((n) => n.id === view)!.label;
  return (
    <Shell session={session} view={view} onSelect={setView} signedOut={signedOut} title={title} notice={failed}>
      {active ? (
        <div className="mx-auto flex max-w-[48rem] flex-col gap-4">
          <div><Button variant="ghost" size="sm" onClick={() => setActive(undefined)}>← Back</Button></div>
          <Tracker key={active.id} initial={active} />
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
                </div>
                {interp ? <Interpretation r={interp} /> : (
                  <Card className="border-dashed">
                    <p className="type-app-subheading text-fg">How SPak reads your instruction</p>
                    <p className="type-body-sm mt-1 text-fg-2">Send an instruction and the interpretation appears here: the assets, networks and amount SPak extracted, anything missing, and the execution plan.</p>
                  </Card>
                )}
              </div>
              {pending && (
                <Review intent={pending.intent} execution={pending.execution} quote={pending.quote} onCancel={() => setPending(undefined)}
                  onApproved={(x) => { setPending(undefined); setActive(x); setToast("Approved. Send the deposit from your wallet to continue."); }} />
              )}
            </div>
          )}
          {view === "activity" && <Activity onOpen={open} />}
          {view === "portfolio" && <Portfolio />}
          {view === "guard" && <Guard />}
          {view === "agent" && <Agent session={session} refresh={refresh} signedOut={signedOut} />}
          {view === "settings" && <Settings session={session} refresh={refresh} signedOut={signedOut} />}
        </>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </Shell>
  );
}
