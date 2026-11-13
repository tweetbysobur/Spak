"use client";
import { getNetwork } from "@/spak-in/registries/networks";
import type { IntentResult } from "@/lib/client";
import { Card, Mono, SectionTitle } from "@/components/ui";
import { Icon } from "@/components/icons";

const net = (id: string | null | undefined) => (id ? getNetwork(id)?.name ?? id : null);
const STATUS: Record<string, { label: string; role: string }> = {
  VALIDATED: { label: "Understood", role: "success" },
  NEEDS_CLARIFICATION: { label: "Needs more information", role: "pending" },
  POLICY_REJECTED: { label: "Blocked by Guard", role: "error" },
  UNSUPPORTED: { label: "Not supported yet", role: "neutral" },
  INVALID: { label: "Cannot be used", role: "error" },
};
const ACTOR: Record<string, string> = { SPAK: "SPak", PROVIDER: "NEAR Intents", USER_WALLET: "Your wallet" };

function amountText(r: IntentResult) {
  const a = r.source.amount;
  if (!a) return null;
  if (a.kind === "EXACT") return `${a.value} ${r.source.asset?.symbol ?? ""}`.trim();
  if (a.kind === "PERCENT_OF_BALANCE") return `${a.percent}% of balance`;
  return `$${a.value} worth`;
}

function Field({ k, v, missing }: { k: string; v: React.ReactNode; missing?: boolean }) {
  return (
    <div className="rounded-control border border-line p-3">
      <p className="type-caption text-fg-2">{k}</p>
      <div className={`type-body mt-0.5 ${missing ? "text-[var(--spak-status-pending-foreground)]" : "text-fg"}`}>{v}</div>
    </div>
  );
}

/**
 * What SPak-in understood, field by field, exactly as returned by POST /api/spak-in/interpret. Nothing is inferred
 * here: missing values show as missing, and the plan steps are the engine's own.
 */
export function Interpretation({ r }: { r: IntentResult }) {
  const s = STATUS[r.status] ?? { label: r.status, role: "info" };
  const miss = new Set(r.missingFields);
  const show = (field: string, v: string | null) => (v ? v : miss.has(field) ? "Missing" : "Not given");
  const style = { color: `var(--spak-status-${s.role}-foreground)`, background: `var(--spak-status-${s.role}-background)`, borderColor: `var(--spak-status-${s.role}-border)` };

  return (
    <Card>
      <SectionTitle aside={<span className="type-status inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1" style={style}>{s.label}</span>}
        sub={<span className="type-caption">Read by SPak-in in {r.meta.processingMs} ms with fixed rules, no language model.</span>}>
        Interpretation
      </SectionTitle>
      <p className="type-body rounded-control bg-surface px-4 py-3 text-fg [overflow-wrap:anywhere] dark:bg-elevated">“{r.input}”</p>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
        <Field k="Intent" v={r.intentType.replaceAll("_", " ").toLowerCase()} />
        <Field k="Amount" v={show("amount", amountText(r))} missing={!amountText(r)} />
        <Field k="From asset" v={show("sourceAsset", r.source.asset?.symbol ?? null)} missing={!r.source.asset} />
        <Field k="From network" v={show("sourceNetwork", net(r.source.network))} missing={!r.source.network} />
        <Field k="To asset" v={show("destinationAsset", r.destination.asset?.symbol ?? null)} missing={!r.destination.asset} />
        <Field k="To network" v={show("destinationNetwork", net(r.destination.network))} missing={!r.destination.network} />
      </div>
      {r.recipient && <div className="mt-2"><Field k={r.recipient.kind === "SELF" ? "Recipient (your wallet)" : "Recipient"} v={<Mono value={r.recipient.address} full />} /></div>}

      {(r.clarifications.length > 0 || r.errors.length > 0) && (
        <div className="mt-4 rounded-control border p-4" style={{ borderColor: "var(--spak-status-pending-border)", background: "var(--spak-status-pending-background)" }}>
          <p className="type-label" style={{ color: "var(--spak-status-pending-foreground)" }}>SPak needs</p>
          <ul className="type-body-sm mt-2 flex list-disc flex-col gap-1 pl-5 text-fg">
            {r.errors.map((e) => <li key={e.code + e.message}>{e.message}</li>)}
            {r.clarifications.map((c) => <li key={c.field + c.question}>{c.question}</li>)}
          </ul>
        </div>
      )}
      {r.assumptions.length > 0 && <p className="type-caption mt-3 text-fg-2 [overflow-wrap:anywhere]">Assumed: {r.assumptions.join(" ")}</p>}

      {r.plan && (
        <div className="mt-5">
          <p className="type-label text-fg">Execution plan {!r.plan.executable && <span className="type-caption ml-2 rounded-full border border-dashed border-line-strong px-2 text-fg-2">needs {r.plan.requires.join(", ").toLowerCase()}, not live yet</span>}</p>
          <ol className="mt-3 flex flex-col">
            {r.plan.steps.map((st) => (
              <li key={st.order} className="grid grid-cols-[1.5rem_1fr] gap-3 border-t border-line py-2.5">
                <span className="type-identifier pt-0.5 text-fg-2">{st.order}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]"><span className="type-body-sm text-fg">{st.description}</span><span className={`type-caption block ${st.actor === "USER_WALLET" ? "text-primary" : "text-fg-2"}`}>{ACTOR[st.actor] ?? st.actor}</span></span>
              </li>
            ))}
          </ol>
          {r.plan.executable && <p className="type-caption mt-2 flex items-center gap-1.5 text-fg-2"><Icon name="guard" size={14} />Plan {r.plan.planId} is fixed. A changed plan needs a new approval.</p>}
        </div>
      )}
    </Card>
  );
}
