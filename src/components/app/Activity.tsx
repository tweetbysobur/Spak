"use client";
import { useMemo, useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import type { ExecutionView } from "@/lib/client";
import { Card, EmptyState, ErrorText, Select, Spinner } from "@/components/ui";
import { EXECUTION_LABEL } from "@/components/status";
import { ATTENTION, IN_FLIGHT, TxRow, useHistory } from "./Overview";

const GROUPS: { id: string; label: string; states: string[] | null }[] = [
  { id: "all", label: "All statuses", states: null },
  { id: "flight", label: "In progress", states: IN_FLIGHT },
  { id: "done", label: "Completed", states: ["COMPLETED"] },
  { id: "refunded", label: "Refunded", states: ["REFUNDED"] },
  { id: "attention", label: "Needs attention", states: ATTENTION },
  { id: "closed", label: "Cancelled or expired", states: ["CANCELLED", "EXPIRED"] },
];

/** Transaction history with network and status filters. Every row opens the real tracking view. */
export function Activity({ onOpen }: { onOpen: (x: ExecutionView) => void }) {
  const { items, error } = useHistory(100);
  const [network, setNetwork] = useState("all");
  const [group, setGroup] = useState("all");
  const [kind, setKind] = useState<"all" | "EXTERNAL" | "SELF">("all");
  const networks = useMemo(() => [...new Set((items ?? []).flatMap((x) => [x.source.network, x.destination.network]))], [items]);
  const shown = (items ?? []).filter((x) => {
    const g = GROUPS.find((y) => y.id === group)!;
    return (kind === "all" || x.recipient.kind === kind) && (network === "all" || x.source.network === network || x.destination.network === network) && (!g.states || g.states.includes(x.state));
  });

  return (
    <Card className="p-0 sm:p-0">
      <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-end sm:px-6 sm:pt-6">
        <p className="type-body-sm flex-1 text-fg-2">Every transfer and payment you started, newest first. Open one to see its full tracking and receipt.</p>
        <label className="flex flex-col gap-1"><span className="type-caption text-fg-2">Type</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Filter by type">
            <option value="all">All types</option>
            <option value="EXTERNAL">Payments to others</option>
            <option value="SELF">Transfers to your wallets</option>
          </Select></label>
        <label className="flex flex-col gap-1"><span className="type-caption text-fg-2">Network</span>
          <Select value={network} onChange={(e) => setNetwork(e.target.value)} aria-label="Filter by network">
            <option value="all">All networks</option>
            {networks.map((n) => <option key={n} value={n}>{getNetwork(n)?.name ?? n}</option>)}
          </Select></label>
        <label className="flex flex-col gap-1"><span className="type-caption text-fg-2">Status</span>
          <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Filter by status">
            {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </Select></label>
      </div>
      <div className="mt-5 border-t border-line">
        {error ? <div className="p-6"><ErrorText>{error}</ErrorText></div>
          : !items ? <div className="p-6"><Spinner label="Loading activity" /></div>
          : !shown.length ? <div className="px-6 py-2"><EmptyState title={items.length ? "No transfers match these filters" : "No transfers yet"}>{items.length ? "Try another network or status." : "Transfers you start appear here with their verified status."}</EmptyState></div>
          : <ul className="divide-y divide-line">{shown.map((x) => <li key={x.id} title={EXECUTION_LABEL[x.state]}><TxRow x={x} onOpen={onOpen} /></li>)}</ul>}
      </div>
    </Card>
  );
}
