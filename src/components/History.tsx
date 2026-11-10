"use client";
import type { TxRecord } from "@/lib/client";
import { Card } from "./ui";
import { StateBadge } from "./Tracker";

export function History({ items, onOpen }: { items: TxRecord[]; onOpen: (t: TxRecord) => void }) {
  if (!items.length) return <Card><p className="text-sm text-white/50">No transactions yet. Approved transactions show up here.</p></Card>;
  return (
    <Card className="divide-y divide-white/5 p-0">
      {items.map((t) => (
        <button key={t.submission.id} onClick={() => onOpen(t)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm hover:bg-white/5">
          <span>
            {t.quote.amountIn} {t.intent.source.asset?.symbol} → {t.quote.amountOut} {t.intent.destination.asset?.symbol}
            <span className="block text-xs text-white/40">{new Date(t.submission.createdAt).toLocaleString()}</span>
          </span>
          <StateBadge state={t.submission.state} />
        </button>
      ))}
    </Card>
  );
}
