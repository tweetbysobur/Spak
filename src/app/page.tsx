"use client";
import { useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { Manual } from "@/components/Manual";
import { Review } from "@/components/Review";
import { Tracker } from "@/components/Tracker";
import { History } from "@/components/History";
import { Addresses } from "@/components/Addresses";
import { store, type QuoteRequest, type QuoteView, type TxRecord } from "@/lib/client";

type Tab = "chat" | "manual" | "history" | "addresses";
const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "SPak Chat" }, { id: "manual", label: "Manual Swap" },
  { id: "history", label: "History" }, { id: "addresses", label: "Your addresses" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("chat");
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<TxRecord[]>([]);
  const [pending, setPending] = useState<{ req: QuoteRequest; quote: QuoteView }>();
  const [active, setActive] = useState<TxRecord>();

  useEffect(() => { setAddresses(store.addresses()); setHistory(store.history()); }, []);
  const onQuote = (req: QuoteRequest, quote: QuoteView) => { setActive(undefined); setPending({ req, quote }); };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SPak</h1>
          <p className="text-sm text-white/50">Cross-chain execution on NEAR Intents</p>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-white/10 p-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); if (t.id === "history") setHistory(store.history()); }}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${tab === t.id ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "chat" && <Chat addresses={addresses} onQuote={onQuote} />}
      {tab === "manual" && <Manual addresses={addresses} onQuote={onQuote} />}
      {tab === "history" && <History items={history} onOpen={(t) => { setPending(undefined); setActive(t); }} />}
      {tab === "addresses" && <Addresses value={addresses} onSave={(a) => { store.setAddresses(a); setAddresses(a); setTab("chat"); }} />}

      {pending && !active && (
        <Review request={pending.req} quote={pending.quote} onCancel={() => setPending(undefined)}
          onApproved={(tx) => { setPending(undefined); setActive(tx); setHistory(store.history()); }} />
      )}
      {active && <Tracker key={active.id} initial={active} />}
    </main>
  );
}
