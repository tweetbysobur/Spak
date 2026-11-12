import type { Metadata } from "next";
import { CtaLink } from "@/components/marketing/site";
import { OG_IMAGE, SITE } from "@/marketing/content";

export const metadata: Metadata = {
  title: "Developers",
  description: "How SPak is built: a deterministic intent engine, an execution service on NEAR Intents, and on-chain verification. What exists today and what is planned for integrations.",
  alternates: { canonical: "/developers" },
  openGraph: { type: "website", siteName: SITE.name, images: [OG_IMAGE], url: "/developers", title: "SPak for developers", description: "The architecture behind SPak, and the direction for its API and SDK." },
};

/** The modules that exist in the codebase today, in the order a transfer passes through them. */
const MODULES = [
  { name: "SPak-in", role: "Intent engine", text: "Reads an instruction and produces a validated plan with a hash. It follows fixed rules and uses no language model. It holds no keys and calls no provider." },
  { name: "SPak Execution", role: "Execution service", text: "Accepts only plans SPak-in issued to the signed-in user. Resolves assets, requests quotes, records approvals and owns the execution states." },
  { name: "NEAR Intents", role: "Settlement", text: "The 1Click API quotes and settles each transfer. It is the only provider-specific code in SPak." },
  { name: "Deposits", role: "Source verification", text: "Builds the deposit from the approved quote and verifies the sent transaction on the source chain." },
  { name: "Tracking", role: "Monitor and destination verification", text: "A background monitor checks provider status and reads the destination chain. It is the only path to Completed." },
  { name: "Failures", role: "Classification and refunds", text: "Classifies failures, follows refunds and opens manual reviews when the evidence is not enough." },
] as const;

const STATUS = [
  { area: "API infrastructure", now: "An HTTP API with wallet-session authentication serves the SPak app. It covers interpreting an instruction, quotes, approval, deposits, tracking and refunds.", next: "It is internal. Routes can change without notice and there are no API keys. A stable public API is planned and has no date." },
  { area: "SDK", now: "None.", next: "The direction is a typed client for the same flow the app uses: interpret, quote, approve, track. Nothing is published." },
  { area: "Integrations", now: "None outside the SPak app.", next: "The design allows a wallet, a payment app or a DeFi front end to hand SPak an intent and get back a plan, a quote and a tracked execution. The user's approval and wallet signature stay required." },
] as const;

export default function DevelopersPage() {
  return (
    <>
      <section className="mkt-wrap pb-16 pt-14 md:pt-20">
        <h1 className="type-display-xl max-w-4xl text-fg">Developer infrastructure</h1>
        <p className="type-lead mt-6 max-w-2xl text-fg-2">SPak is built as separate services behind an API. Today that API has one client, the SPak app. This page shows what exists and what does not.</p>
        <p role="note" className="type-body mt-8 max-w-2xl border-l-2 border-[var(--spak-status-info-border)] pl-4 text-fg">There is no public API and no SDK yet. Nothing on this page is an endpoint you can call today.</p>
        <div className="mt-9 flex flex-wrap gap-3">
          <CtaLink href="/docs">Read the documentation</CtaLink>
          <CtaLink href={SITE.appPath} variant="ghost">Launch SPak</CtaLink>
        </div>
      </section>

      <section className="mkt-section border-t border-line" aria-labelledby="arch">
        <div className="mkt-wrap grid gap-12 lg:grid-cols-[1fr_1.6fr] lg:gap-20">
          <div data-reveal>
            <h2 id="arch" className="type-display-lg text-fg">Six modules, one record per transfer.</h2>
            <p className="type-body-marketing mt-6 text-fg-2">A transfer passes through these in order. Each one writes to the same execution record, so there is one place that knows the state of a transfer.</p>
          </div>
          <ol data-reveal className="flex flex-col">
            {MODULES.map((m) => (
              <li key={m.name} className="grid gap-1 border-t border-line-strong py-5 sm:grid-cols-[12rem_1fr] sm:gap-6">
                <div>
                  <h3 className="type-heading-feature text-fg">{m.name}</h3>
                  <p className="type-demo-label mt-1 text-fg-2">{m.role}</p>
                </div>
                <p className="type-body text-fg-2">{m.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mkt-section bg-surface" aria-labelledby="status">
        <div className="mkt-wrap">
          <h2 id="status" data-reveal className="type-display-lg max-w-3xl text-fg">Where the developer platform stands.</h2>
          <div data-reveal className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-line-strong">
                  <th scope="col" className="type-label w-48 py-3 pr-6 text-fg-2">Area</th>
                  <th scope="col" className="type-label py-3 pr-6 text-fg-2">Exists today</th>
                  <th scope="col" className="type-label py-3 text-fg-2">Not available yet</th>
                </tr>
              </thead>
              <tbody>
                {STATUS.map((s) => (
                  <tr key={s.area} className="border-b border-line-strong align-top">
                    <th scope="row" className="type-heading-feature py-5 pr-6 text-fg">{s.area}</th>
                    <td className="type-body py-5 pr-6 text-fg">{s.now}</td>
                    <td className="type-body py-5 text-fg-2">{s.next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="rules">
        <div className="mkt-wrap grid gap-12 lg:grid-cols-[1fr_1.6fr] lg:gap-20">
          <h2 id="rules" data-reveal className="type-display-lg text-fg">Rules any integration will inherit.</h2>
          <ul data-reveal className="flex flex-col">
            {[
              "SPak never signs and never holds keys. The user's wallet sends every deposit.",
              "A deposit address is created only after an approval bound to the exact plan hash.",
              "Changed plans, stale approvals, mismatched quotes and duplicates are refused.",
              "Ambiguous instructions stop with a question. No address, amount or network is guessed.",
              "Completed is set only by destination verification. Refunded is set only by refund verification.",
            ].map((t) => <li key={t} className="type-body-marketing border-t border-line-strong py-5 text-fg">{t}</li>)}
          </ul>
        </div>
      </section>

      <section className="mkt-wrap pb-24">
        <div data-reveal className="flex flex-col items-start gap-6 border-t border-line-strong pt-12 md:flex-row md:items-center md:justify-between">
          <p className="type-heading-section max-w-xl text-fg">The documentation covers states, verification and refunds in detail.</p>
          <CtaLink href="/docs">Read the documentation</CtaLink>
        </div>
      </section>
    </>
  );
}
