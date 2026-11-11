"use client";
import { useEffect, useState } from "react";
import { api, formatUnits, type ExecutionView } from "@/lib/client";
import { Amount, Card, EmptyState, ErrorText, SectionTitle, Spinner } from "./ui";
import { StatusBadge } from "./status";
import { getNetwork } from "@/spak-in/registries/networks";

/** Execution history from the server (GET /api/executions). */
export function History({ onOpen }: { onOpen: (e: ExecutionView) => void }) {
  const [items, setItems] = useState<ExecutionView[] | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => { api<{ items: ExecutionView[] }>("/api/executions?limit=50").then((r) => setItems(r.items)).catch((e) => setError((e as Error).message)); }, []);
  if (error) return <Card><SectionTitle>History</SectionTitle><ErrorText>{error}</ErrorText></Card>;
  if (!items) return <Card><SectionTitle>History</SectionTitle><Spinner label="Loading history" /></Card>;
  if (!items.length) return <Card><SectionTitle>History</SectionTitle><EmptyState title="No transfers yet">Transfers you start appear here with their verified status.</EmptyState></Card>;
  const net = (id: string) => getNetwork(id)?.name ?? id;
  return (
    <Card className="p-0 sm:p-0">
      <div className="px-5 pt-5 sm:px-6 sm:pt-6"><SectionTitle>History</SectionTitle></div>
      <ul className="divide-y divide-line border-t border-line">
        {items.map((x) => (
          <li key={x.id}>
            <button onClick={() => onOpen(x)} className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 text-left hover:bg-surface sm:px-6 dark:hover:bg-elevated">
              <span className="min-w-0">
                <Amount value={formatUnits(x.source.amountIn, x.source.assetId)} />
                <span className="type-body-sm block text-fg-2">{net(x.source.network)} to {net(x.destination.network)} · {new Date(x.createdAt).toLocaleString()}</span>
              </span>
              <StatusBadge state={x.state} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
