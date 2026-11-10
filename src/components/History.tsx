"use client";
import { useEffect, useState } from "react";
import { api, formatUnits, type ExecutionView } from "@/lib/client";
import { Card } from "./ui";
import { StateBadge } from "./Tracker";

/** Execution history from the server (GET /api/executions). */
export function History({ onOpen }: { onOpen: (e: ExecutionView) => void }) {
  const [items, setItems] = useState<ExecutionView[] | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => { api<{ items: ExecutionView[] }>("/api/executions?limit=50").then((r) => setItems(r.items)).catch((e) => setError((e as Error).message)); }, []);
  if (error) return <Card><p className="text-sm text-red-400">{error}</p></Card>;
  if (!items) return <Card><p className="text-sm text-white/50">Loading…</p></Card>;
  if (!items.length) return <Card><p className="text-sm text-white/50">No executions yet.</p></Card>;
  return (
    <Card className="divide-y divide-white/5 p-0">
      {items.map((x) => (
        <button key={x.id} onClick={() => onOpen(x)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm hover:bg-white/5">
          <span>
            {formatUnits(x.source.amountIn, x.source.assetId)} → {x.destination.assetId.split(":")[0]}
            <span className="block text-xs text-white/40">{new Date(x.createdAt).toLocaleString()}</span>
          </span>
          <StateBadge state={x.state} />
        </button>
      ))}
    </Card>
  );
}
