import { Card, SectionTitle } from "@/components/ui";

/** Features that are not part of V1. Shown as information only: no control here starts anything. */
export const COMING_SOON = [
  { id: "agent-accounts", area: "agent", name: "Dedicated Agent NEAR accounts", body: "A separate NEAR account for your SPak Agent, with your key as its only key." },
  { id: "autonomous", area: "agent", name: "Autonomous execution", body: "The Agent acting inside limits you set. Today you approve every transfer." },
  { id: "conditional", area: "agent", name: "Conditional and scheduled transactions", body: "Transfers that run on a date or when a price is reached." },
  { id: "chain-signatures", area: "agent", name: "Chain Signatures", body: "NEAR-based signing for Agent-owned addresses on other chains." },
  { id: "agent-permissions", area: "agent", name: "Advanced Agent permissions", body: "Signed, expiring grants that narrow what the Agent may prepare." },
  { id: "portfolio", area: "portfolio", name: "Portfolio Intelligence", body: "Balances and insights across networks. SPak shows no estimated or sample balances." },
  { id: "sdk", area: "developers", name: "Developer SDK", body: "Programmatic access to SPak execution for other apps." },
  { id: "connect", area: "developers", name: "SPak Connect", body: "Connecting SPak to other products and agents." },
] as const;

export function SoonTag() {
  return <span className="type-caption shrink-0 rounded-full border border-dashed border-line-strong px-2 text-fg-2">Coming soon</span>;
}

/** A plain list. Deliberately has no buttons, links or inputs. */
export function ComingSoon({ area, title = "Coming soon" }: { area?: (typeof COMING_SOON)[number]["area"]; title?: string }) {
  const items = COMING_SOON.filter((f) => !area || f.area === area);
  return (
    <Card>
      <div data-coming-soon>
        <SectionTitle sub="Not available in this version. Nothing here can be started yet.">{title}</SectionTitle>
        <ul className="flex flex-col">
          {items.map((f) => (
            <li key={f.id} data-feature={f.id} className="flex items-start justify-between gap-3 border-t border-line py-3 first:border-0 first:pt-0">
              <div className="min-w-0"><p className="type-app-subheading text-fg-2">{f.name}</p><p className="type-body-sm mt-0.5 text-fg-2">{f.body}</p></div>
              <SoonTag />
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
