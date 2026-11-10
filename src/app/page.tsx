"use client";
import { useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { Manual } from "@/components/Manual";
import { Review } from "@/components/Review";
import { Tracker } from "@/components/Tracker";
import { History } from "@/components/History";
import { WalletPicker } from "@/components/WalletPicker";
import { WalletsPanel, short } from "@/components/WalletsPanel";
import { loadSession, type Session } from "@/components/session";
import { Card } from "@/components/ui";
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
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SPak</h1>
          <p className="text-sm text-white/50">Cross-chain execution on NEAR Intents</p>
        </div>
        {activeWallet && (
          <button onClick={() => setTab("wallets")} className="rounded-full border border-white/10 px-3 py-1.5 font-mono text-xs text-white/80 hover:bg-white/5">
            {short(activeWallet.address)}
          </button>
        )}
      </header>

      {notice && <p className="text-sm text-red-400">{notice}</p>}

      {session === undefined && <Card><p className="text-sm text-white/50">Loading…</p></Card>}
      {session === null && <WalletPicker purpose="SIGN_IN" onDone={refresh} />}

      {session && (
        <>
          <nav className="flex gap-1 overflow-x-auto rounded-xl border border-white/10 p-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${tab === t.id ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}>
                {t.label}
              </button>
            ))}
          </nav>

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
  );
}
