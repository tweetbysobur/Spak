"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Chat } from "@/components/Chat";
import { Manual } from "@/components/Manual";
import { Review } from "@/components/Review";
import { Tracker } from "@/components/Tracker";
import { History } from "@/components/History";
import { WalletPicker } from "@/components/WalletPicker";
import { WalletsPanel, short } from "@/components/WalletsPanel";
import { loadSession, type Session } from "@/components/session";
import { Card, Spinner, Tabs } from "@/components/ui";
import { Notice } from "@/components/status";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon } from "@/components/icons";
import { api, type ExecutionView, type IntentResult, type QuoteView } from "@/lib/client";
import { takeNearRedirectResult } from "@/wallets/near";
import { classifyWalletError } from "@/wallets/errors";

type Tab = "chat" | "manual" | "history" | "wallets";
const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "SPak Chat" }, { id: "manual", label: "Manual Swap" },
  { id: "history", label: "History" }, { id: "wallets", label: "Wallets" },
];

export default function Home() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("chat");
  const [pending, setPending] = useState<{ intent: IntentResult; execution: ExecutionView; quote: QuoteView }>();
  const [active, setActive] = useState<ExecutionView>();
  const [timezone, setTimezone] = useState("UTC");
  const [notice, setNotice] = useState<string>();

  const refresh = useCallback(async () => {
    const s = await loadSession().catch(() => null);
    setSession(s);
  }, []);

  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    // Back from a NEAR browser wallet: finish the pending signature check.
    // The callback is untrusted: the server verifies the signature, the one-time challenge and the account key.
    const near = takeNearRedirectResult();
    const finish = near?.kind === "signed"
      ? api("/api/auth/verify", { challengeId: near.challengeId, signature: near.signature, publicKey: near.publicKey, accountId: near.accountId })
          .catch((e) => setNotice(classifyWalletError(e).message))
      : Promise.resolve(near && near.kind !== "none" ? setNotice(near.message) : undefined);
    finish.then(refresh);
  }, [refresh]);

  const signedOut = () => { setSession(null); setPending(undefined); setActive(undefined); setTab("chat"); };
  const onReady = (intent: IntentResult, execution: ExecutionView, quote: QuoteView) => { setActive(undefined); setPending({ intent, execution, quote }); };
  const activeWallet = session?.wallets.find((w) => w.active);
  const ownAddress = (net: string) => {
    if (!session) return undefined;
    const order = [...session.wallets.filter((w) => w.active), ...session.wallets.filter((w) => !w.active)];
    return order.find((w) => w.networks.some((n) => n.id === net && n.enabled))?.address;
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-bg">
        <div className="mx-auto flex h-16 w-full max-w-[var(--spak-shell-max)] items-center gap-4 px-4 sm:px-8">
          <Link href="/" aria-label="SPak home" className="shrink-0"><Logo className="h-7" /></Link>
          {session && <div className="hidden min-w-0 md:block"><Tabs label="Main" items={TABS} value={tab} onChange={setTab} /></div>}
          <span className="flex-1" />
          {activeWallet && (
            <button onClick={() => setTab("wallets")} title={activeWallet.address}
              className="type-address inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-3 text-fg hover:bg-secondary dark:hover:bg-elevated">
              <Icon name="wallet" size={16} className="text-fg-2" />{short(activeWallet.address)}
            </button>
          )}
          <ThemeToggle />
        </div>
        {session && <div className="mx-auto w-full max-w-[var(--spak-shell-max)] border-t border-line px-4 py-1 md:hidden"><Tabs label="Main" items={TABS} value={tab} onChange={setTab} fill /></div>}
      </header>

      <main className="mx-auto flex w-full max-w-[var(--spak-content-max)] flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
        {!session && (
          <div className="mb-2">
            <h1 className="type-app-title text-fg">Intelligent execution across chains.</h1>
            <p className="type-body mt-2 text-fg-2">Turn intentions into verified actions across blockchain networks, executed through NEAR Intents.</p>
          </div>
        )}
        {notice && <Notice role="error" title="Wallet sign-in did not finish">{notice}</Notice>}

        {session === undefined && <Card><Spinner label="Loading your session" /></Card>}
        {session === null && <WalletPicker purpose="SIGN_IN" onDone={refresh} />}

        {session && (
          <>
            {tab === "chat" && <Chat timezone={timezone} onReady={onReady} />}
            {tab === "manual" && <Manual ownAddress={ownAddress} onReady={onReady} />}
            {tab === "history" && <History onOpen={(x) => { setPending(undefined); setActive(x); }} />}
            {tab === "wallets" && <WalletsPanel session={session} refresh={async () => { setPending(undefined); await refresh(); }} signedOut={signedOut} />}

            {pending && !active && (
              <Review intent={pending.intent} execution={pending.execution} quote={pending.quote} onCancel={() => setPending(undefined)}
                onApproved={(x) => { setPending(undefined); setActive(x); }} />
            )}
            {active && <Tracker key={active.id} initial={active} />}
          </>
        )}
      </main>
      <footer className="border-t border-line">
        <div className="type-caption mx-auto flex w-full max-w-[var(--spak-shell-max)] flex-wrap justify-between gap-2 px-4 py-5 text-fg-2 sm:px-8">
          <span>SPak · executed through NEAR Intents</span><span>Every transfer needs your approval and your wallet signature.</span>
        </div>
      </footer>
    </div>
  );
}
