"use client";
import { useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { Manual } from "@/components/Manual";
import { Review } from "@/components/Review";
import { Tracker } from "@/components/Tracker";
import { History } from "@/components/History";
import { Addresses } from "@/components/Addresses";
import { Icon, type IconName } from "@/components/Icon";
import { store, type IntentResult, type ProviderQuote, type TxRecord } from "@/lib/client";

type Tab = "chat" | "manual" | "history" | "addresses";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "chat", label: "SPak Chat", icon: "chat" }, { id: "manual", label: "Manual Swap", icon: "swap" },
  { id: "history", label: "History", icon: "history" }, { id: "addresses", label: "Your addresses", icon: "addresses" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("chat");
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<TxRecord[]>([]);
  const [pending, setPending] = useState<{ intent: IntentResult; quote: ProviderQuote }>();
  const [active, setActive] = useState<TxRecord>();
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    setAddresses(store.addresses());
    setHistory(store.history());
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  const onReady = (intent: IntentResult, quote: ProviderQuote) => { setActive(undefined); setPending({ intent, quote }); };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex items-center gap-3" data-icon-hover>
        <Icon name="crosschain" size={40} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SPak</h1>
          <p className="text-sm text-white/50">Cross-chain execution on NEAR Intents</p>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-white/10 p-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); if (t.id === "history") setHistory(store.history()); }}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm ${tab === t.id ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}>
            <Icon name={t.icon} size={20} active={tab === t.id} />
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "chat" && <Chat addresses={addresses} timezone={timezone} onReady={onReady} />}
      {tab === "manual" && <Manual addresses={addresses} onReady={onReady} />}
      {tab === "history" && <History items={history} onOpen={(t) => { setPending(undefined); setActive(t); }} />}
      {tab === "addresses" && <Addresses value={addresses} onSave={(a) => { store.setAddresses(a); setAddresses(a); setTab("chat"); }} />}

      {pending && !active && (
        <Review intent={pending.intent} quote={pending.quote} onCancel={() => setPending(undefined)}
          onApproved={(tx) => { setPending(undefined); setActive(tx); setHistory(store.history()); }} />
      )}
      {active && <Tracker key={active.submission.id} initial={active} />}
    </main>
  );
}
