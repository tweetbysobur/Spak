"use client";
import { useEffect, useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import { getAsset } from "@/spak-in/registries/assets";
import { api, formatUnits, type ExecutionView } from "@/lib/client";
import type { Session } from "@/components/session";
import { Amount, Button, Card, EmptyState, ErrorText, Mono, SectionTitle, Spinner, inputCls } from "@/components/ui";
import { StatusBadge } from "@/components/status";
import { Icon } from "@/components/icons";
import type { View } from "./Shell";

const net = (id: string) => getNetwork(id)?.name ?? id;
const FAMILY: Record<string, string> = { evm: "EVM", solana: "Solana", near: "NEAR" };
export const IN_FLIGHT = ["AWAITING_DEPOSIT", "PROCESSING", "VERIFYING_DESTINATION", "REFUNDING"];
export const ATTENTION = ["FAILED", "UNKNOWN"];

/** Real execution history for the signed-in user. Shared by Overview and Activity. */
export function useHistory(limit = 100) {
  const [items, setItems] = useState<ExecutionView[] | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => { api<{ items: ExecutionView[] }>(`/api/executions?limit=${limit}`).then((r) => setItems(r.items)).catch((e) => setError((e as Error).message)); }, [limit]);
  return { items, error };
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-card border border-line bg-elevated p-5 dark:bg-surface">
      <p className="type-label text-fg-2">{label}</p>
      <p className="type-amount-display mt-2 text-fg">{value}</p>
      <p className="type-caption mt-1 text-fg-2">{sub}</p>
    </div>
  );
}

export function TxRow({ x, onOpen }: { x: ExecutionView; onOpen: (x: ExecutionView) => void }) {
  return (
    <button onClick={() => onOpen(x)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-4 text-left hover:bg-surface sm:grid-cols-[1.2fr_1fr_auto] dark:hover:bg-elevated">
      <span className="min-w-0">
        <Amount value={formatUnits(x.source.amountIn, x.source.assetId)} />
        <span className="type-caption block text-fg-2">{x.destination.amountOutVerified ? `received ${formatUnits(x.destination.amountOutVerified, x.destination.assetId)}` : `to ${getAsset(x.destination.assetId)?.symbol ?? "asset"} on ${net(x.destination.network)}`}</span>
      </span>
      <span className="type-body-sm hidden text-fg-2 sm:block">{net(x.source.network)} → {net(x.destination.network)}<span className="type-caption block">{new Date(x.createdAt).toLocaleString()}</span></span>
      <StatusBadge state={x.state} />
    </button>
  );
}

export function Overview({ session, onSelect, onExecute, onOpen }: {
  session: Session; onSelect: (v: View) => void; onExecute: (text: string) => void; onOpen: (x: ExecutionView) => void;
}) {
  const { items, error } = useHistory(100);
  const [text, setText] = useState("");
  const w = session.wallets.find((x) => x.active) ?? session.wallets[0];
  const nets = w?.networks.filter((n) => n.enabled).map((n) => net(n.id)) ?? [];
  const count = (states: string[]) => (items ? items.filter((x) => states.includes(x.state)).length : 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Quick action: the instruction box */}
      <section className="rounded-panel bg-[var(--spak-brand-forest-green)] p-5 sm:p-7">
        <h2 className="type-app-title text-[var(--spak-brand-warm-white)]">What do you want to move?</h2>
        <p className="type-body-sm mt-1 text-[var(--spak-brand-muted-sage)]">Describe it in plain words. SPak plans it and gets a quote. Nothing moves until you approve and sign.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) onExecute(text.trim()); }} className="mt-5 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="quick-intent" className="sr-only">Instruction</label>
          <input id="quick-intent" value={text} onChange={(e) => setText(e.target.value)} placeholder="Swap 100 USDC on Base to ETH on Arbitrum" className={`${inputCls} flex-1 border-transparent`} />
          <button type="submit" disabled={!text.trim()} className="type-button inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-[var(--spak-brand-warm-white)] px-5 text-[var(--spak-brand-forest-green)] disabled:opacity-70">
            Plan it<Icon name="arrow" size={16} />
          </button>
        </form>
      </section>

      {/* Activity numbers, from real history only */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="In progress" value={items ? String(count(IN_FLIGHT)) : "–"} sub="Waiting for deposit, processing or verifying" />
        <Stat label="Completed" value={items ? String(count(["COMPLETED"])) : "–"} sub="Delivery verified on chain" />
        <Stat label="Needs attention" value={items ? String(count(ATTENTION)) : "–"} sub="Failed or outcome unknown" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-0 sm:p-0">
          <div className="px-5 pt-5 sm:px-6 sm:pt-6"><SectionTitle aside={<Button variant="ghost" size="sm" onClick={() => onSelect("activity")}>View all</Button>}>Recent transfers</SectionTitle></div>
          {error ? <div className="px-6 pb-6"><ErrorText>{error}</ErrorText></div>
            : !items ? <div className="px-6 pb-6"><Spinner label="Loading activity" /></div>
            : !items.length ? <div className="px-6 pb-4"><EmptyState title="No transfers yet" action={<Button size="sm" onClick={() => onSelect("execute")}>Start a transfer</Button>}>Transfers you start appear here with their verified status.</EmptyState></div>
            : <ul className="divide-y divide-line border-t border-line">{items.slice(0, 5).map((x) => <li key={x.id}><TxRow x={x} onOpen={onOpen} /></li>)}</ul>}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <SectionTitle aside={<Button variant="ghost" size="sm" onClick={() => onSelect("settings")}>Manage</Button>}>Wallet</SectionTitle>
            {w && <>
              <p className="type-label text-fg-2">{FAMILY[w.family]} · active</p>
              <div className="mt-1"><Mono value={w.address} /></div>
              <p className="type-caption mt-3 text-fg-2">Used on {nets.length ? nets.slice(0, 4).join(", ") + (nets.length > 4 ? ` and ${nets.length - 4} more` : "") : "no networks"}.</p>
            </>}
          </Card>
          <Card>
            <SectionTitle>Balances</SectionTitle>
            <p className="type-body-sm text-fg-2">Balance reading across networks is not built yet. SPak checks your balance for the exact asset when it prepares a deposit.</p>
            <p className="type-caption mt-2 inline-block rounded-full border border-dashed border-line-strong px-2 text-fg-2">Planned</p>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <Icon name="guard" className="mt-0.5 text-primary" />
              <div><p className="type-app-subheading text-fg">SPak Guard: on</p><p className="type-caption mt-0.5 text-fg-2">Approval on every transfer, a value cap and a slippage limit. Personal limits are planned.</p></div>
            </div>
            <div className="mt-4 flex items-start gap-3 border-t border-line pt-4">
              <Icon name="agent" className="mt-0.5 text-fg-2" />
              <div><p className="type-app-subheading text-fg">Agent: {session.agent.status === "LINKED" ? "identity linked" : "not linked"}</p>
                <p className="type-caption mt-0.5 text-fg-2">{session.agent.status === "LINKED" ? session.agent.nearAccountId : "Link a NEAR wallet as your agent identity."} The agent cannot sign for you.</p></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
