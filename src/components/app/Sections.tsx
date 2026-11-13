"use client";
import type { ReactNode } from "react";
import { PILLARS } from "@/marketing/content";
import type { Session } from "@/components/session";
import { WalletsPanel } from "@/components/WalletsPanel";
import { Card, SectionTitle } from "@/components/ui";
import { Icon } from "@/components/icons";

function Lists({ live, planned }: { live: readonly string[]; planned: readonly string[] }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div><p className="type-label text-fg">Live today</p><ul className="mt-2 flex flex-col gap-2">{live.map((t) => <li key={t} className="type-body-sm flex gap-2 text-fg"><Icon name="success" size={16} className="mt-0.5 shrink-0 text-primary" />{t}</li>)}</ul></div>
      <div><p className="type-label text-fg-2">Planned, not available yet</p><ul className="mt-2 flex flex-col gap-2">{planned.map((t) => <li key={t} className="type-body-sm flex gap-2 text-fg-2"><Icon name="neutral" size={16} className="mt-0.5 shrink-0" />{t}</li>)}</ul></div>
    </div>
  );
}
const pillar = (id: string) => PILLARS.find((p) => p.id === id)!;

function Module({ id, children }: { id: string; children?: ReactNode }) {
  const p = pillar(id);
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle sub={p.summary} aside={<span className="type-status rounded-full border border-line-strong px-2.5 py-1 text-fg-2">{p.status}</span>}>{p.name}</SectionTitle>
        <Lists live={p.live} planned={p.planned} />
      </Card>
      {children}
    </div>
  );
}

export function Portfolio() {
  return (
    <Module id="intelligence">
      <Card>
        <SectionTitle>Portfolio</SectionTitle>
        <p className="type-body text-fg-2">Balances and cross-chain portfolio views need a balance reader and a price feed, which are not built yet. SPak will not show estimated or sample balances in their place.</p>
        <p className="type-body-sm mt-3 text-fg-2">Today SPak reads your balance only for the exact asset of a deposit, when you prepare it.</p>
      </Card>
    </Module>
  );
}

export function Guard() {
  return (
    <Module id="guard">
      <Card>
        <SectionTitle>Active protections</SectionTitle>
        <ul className="flex flex-col">
          {[["Approval on every transfer", "Bound to the exact plan and firm quote. A new quote cancels it."], ["Value cap", "Each transfer is capped. A transfer SPak cannot price is refused."], ["Slippage limit", "Sets the minimum you receive, shown before you approve."], ["Recipient checks", "Addresses are checked against the destination network before any quote."]].map(([t, d]) => (
            <li key={t} className="flex items-start gap-3 border-t border-line py-3 first:border-0"><Icon name="guard" className="mt-0.5 text-primary" /><div><p className="type-app-subheading text-fg">{t}</p><p className="type-body-sm text-fg-2">{d}</p></div><span className="type-status ml-auto text-primary">On</span></li>
          ))}
        </ul>
      </Card>
    </Module>
  );
}

export function Agent({ session, refresh, signedOut }: { session: Session; refresh: () => Promise<void>; signedOut: () => void }) {
  return (
    <Module id="agent">
      <Card>
        <SectionTitle>Manual Access and SPak Agent</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-card border border-primary p-4"><p className="type-app-subheading text-fg">Manual Access <span className="type-status ml-1 text-primary">· in use</span></p><p className="type-body-sm mt-1 text-fg-2">You approve each transfer and your wallet signs it. This is how SPak works today.</p></div>
          <div className="rounded-card border border-dashed border-line-strong p-4"><p className="type-app-subheading text-fg">SPak Agent <span className="type-status ml-1 text-fg-2">· {session.agent.status === "LINKED" ? "identity linked" : "not linked"}</span></p><p className="type-body-sm mt-1 text-fg-2">A NEAR identity linked to your account. Acting within your limits is planned; today it cannot sign or move funds.</p></div>
        </div>
      </Card>
      <WalletsPanel session={session} refresh={refresh} signedOut={signedOut} />
    </Module>
  );
}

export function Settings({ session, refresh, signedOut }: { session: Session; refresh: () => Promise<void>; signedOut: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <WalletsPanel session={session} refresh={refresh} signedOut={signedOut} />
      <Card>
        <SectionTitle>Appearance</SectionTitle>
        <p className="type-body-sm text-fg-2">Use the theme button in the top bar to switch between system, light and dark.</p>
      </Card>
    </div>
  );
}
