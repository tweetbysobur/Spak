import type { Metadata } from "next";
import { EvidenceField, ExecutionLanes, RouteDiagram } from "@/components/marketing/art";
import { CoverageLists, JourneyBand, PlanSteps } from "@/components/marketing/internal";
import { CtaLink, Screen } from "@/components/marketing/site";
import { ASSET_COUNT, NETWORK_COUNT, NETWORKS_REVIEWED, NETWORKS_VERIFIED, OG_IMAGE, SECURITY, SITE, VERIFICATION_ROWS } from "@/marketing/content";

export const metadata: Metadata = {
  title: "How it works",
  description: "From a sentence to a verified transfer: intent, plan, quote, your approval, deposit, destination verification, and what happens when a transfer fails.",
  alternates: { canonical: "/how-it-works" },
  openGraph: { type: "website", siteName: SITE.name, images: [OG_IMAGE], url: "/how-it-works", title: "How SPak works", description: "Intent, plan, quote, approval, deposit, verification and refunds." },
};

/** Plan step actions and actors for an executable cross-chain plan (src/spak-in/planner/execution-planner.ts). */
const PLAN_STEPS = [
  ["QUOTE", "PROVIDER"], ["REVIEW", "SPAK"], ["USER_APPROVAL", "USER_WALLET"], ["DEPOSIT", "USER_WALLET"], ["SETTLE", "PROVIDER"], ["VERIFY", "SPAK"],
] as const;

const CROSS_CHAIN = [
  { term: "Asset movement", text: "Swap, bridge or send in one transfer. You name the asset you hold and the asset the recipient should get." },
  { term: "Quotes", text: "An estimate first, then a firm quote from NEAR Intents with the minimum output, every fee and a deadline." },
  { term: "Deposit instructions", text: "After you approve, SPak shows the exact amount, network and deposit address. Your wallet signs and sends it." },
  { term: "Tracking", text: "Seven recorded steps from approval to completion. SPak keeps checking in the background, so you can close the page." },
  { term: "Destination verification", text: "On the networks SPak can read, it checks the delivery on chain against the minimum you approved." },
] as const;

/**
 * The journey. `moves` is false until the user has approved and signed: the spine is dotted before approval and
 * solid after, the same rule as every SPak diagram.
 */
const STAGES = [
  { id: "intent", title: "Understand intent", actor: "You and SPak", moves: false,
    body: "You write the outcome in plain words. SPak reads the amount, assets, networks and recipient with fixed rules. If something is missing or could mean two things, it asks." },
  { id: "plan", title: "Build the plan", actor: "SPak", moves: false,
    body: "The instruction becomes a fixed plan with a hash. Each step names who acts. SPak can prepare; only your wallet can send." },
  { id: "quote", title: "Get a quote", actor: "NEAR Intents", moves: false,
    body: "NEAR Intents quotes the route: an estimate first, then a firm quote with the minimum you receive, every fee and a deadline." },
  { id: "approval", title: "Your approval", actor: "You", moves: false,
    body: "You tick the box and approve that exact quote. A new quote or a changed plan cancels it. Approval alone moves nothing." },
  { id: "deposit", title: "Deposit and execution", actor: "Your wallet, then NEAR Intents", moves: true,
    body: "Your wallet signs and sends the deposit. SPak checks it on the source chain, then NEAR Intents settles the transfer." },
  { id: "verification", title: "Destination verification", actor: "SPak", moves: true,
    body: "SPak reads the destination chain and compares the delivery with the minimum you approved. Only then does it say Completed." },
  { id: "refunds", title: "Failure and refunds", actor: "NEAR Intents, then SPak", moves: true,
    body: "If a transfer fails, NEAR Intents returns the funds to the wallet that sent them. SPak marks it Refunded only when it can verify that on chain." },
] as const;

function StageVisual({ id }: { id: (typeof STAGES)[number]["id"] }) {
  switch (id) {
    case "intent": return <Screen name="chat" alt="The SPak chat. An instruction to swap 50 USDC on Base to SOL on Solana, followed by SPak confirming it understood and that a quote is ready." caption="Captured from the app with a test wallet. The quote is real." />;
    case "plan": return (
      <figure>
        <PlanSteps steps={PLAN_STEPS} />
        <figcaption className="type-demo-label mt-4 text-fg-2">The steps of a cross-chain plan, as the engine emits them. Your wallet acts twice; SPak never signs.</figcaption>
      </figure>
    );
    case "quote": return <Screen name="plan" crop="top" alt="The review screen for a 50 USDC transfer from Base to SOL on Solana, listing the amount sent, the minimum received, slippage and each fee." caption="The estimate, top of the screen. Real quote from NEAR Intents." />;
    case "approval": return <Screen name="approval" crop="bottom" alt="The approval screen. A firm quote with recipient, refund address, deposit address and deadline, and a checkbox the user must tick before the Approve button works." caption="The button stays disabled until you tick the box." />;
    case "deposit": return <Screen name="tracking" crop="top" alt="The tracking screen after approval. It shows the exact deposit to send and a seven-step timeline with only the first step done." caption="Approved with a test wallet. No deposit was sent, so the timeline stops at step one." />;
    case "verification": return <CoverageLists verified={NETWORKS_VERIFIED} reviewed={NETWORKS_REVIEWED} />;
    case "refunds": return <Screen name="refund" alt="The recovery panel for a failed transfer. Refund status reads waiting for NEAR Intents to send the refund. Reported, seen on chain, and verified amounts are listed separately, all empty." caption="Demonstration. This state was produced with simulated tracking data. No transfer failed and no refund took place." />;
  }
}

export default function HowItWorksPage() {
  return (
    <>
      {/* Opening: Graphite, with the transfer drawn across the landscape. */}
      <section data-theme="dark" className="overflow-hidden bg-bg text-fg">
        <div className="mkt-wrap grid items-center gap-10 py-16 md:py-24 lg:grid-cols-[1fr_1.1fr] lg:gap-8">
          <div>
            <h1 className="type-display-xl text-fg">From a sentence to a verified transfer.</h1>
            <p className="type-lead mt-6 max-w-xl text-fg-2">SPak understands and plans. You approve and sign. NEAR Intents settles. SPak checks the result on chain where it can.</p>
          </div>
          <JourneyBand className="h-auto w-full" />
        </div>
      </section>

      {/* The journey: a numbered spine, dotted before your approval and solid after. Visuals alternate sides. */}
      <section className="mkt-section" aria-labelledby="journey-title">
        <div className="mkt-wrap">
          <h2 id="journey-title" className="type-display-lg max-w-3xl text-fg">Seven stages. Nothing moves until the fifth.</h2>
          <nav aria-label="Stages" className="mt-8">
            <ol className="flex flex-wrap gap-x-5 gap-y-1">
              {STAGES.map((s, i) => <li key={s.id}><a href={`#${s.id}`} className="type-body-sm inline-flex min-h-11 items-center gap-2 text-fg-2 transition-colors hover:text-fg"><span className="type-demo-label">{i + 1}</span>{s.title}</a></li>)}
            </ol>
          </nav>
          <ol className="mt-16">
            {STAGES.map((s, i) => (
              <li key={s.id} id={s.id} className="grid grid-cols-[3rem_1fr] gap-x-5 md:grid-cols-[5rem_1fr] md:gap-x-8">
                {/* Spine: number, then a line down to the next stage. */}
                <div className="flex flex-col items-center">
                  <span className={`type-display-lg leading-none ${s.id === "approval" ? "text-primary" : "text-fg"}`}>{i + 1}</span>
                  {i < STAGES.length - 1 && <span aria-hidden="true" className={`mt-4 w-0 flex-1 border-l-2 ${STAGES[i + 1].moves ? "border-primary" : "border-dotted border-line-strong"}`} />}
                </div>
                <div data-reveal className={`grid items-center gap-8 pb-20 md:pb-28 lg:grid-cols-2 lg:gap-16 ${i % 2 ? "lg:[&>*:first-child]:order-2" : ""}`}>
                  <div>
                    <p className="type-demo-label text-fg-2">{s.actor}</p>
                    <h3 className={`type-heading-section mt-2 ${s.id === "approval" ? "text-primary" : "text-fg"}`}>{s.title}</h3>
                    <p className="type-body-marketing mt-4 max-w-md text-fg-2">{s.body}</p>
                  </div>
                  <div className={s.id === "verification" ? "lg:pl-4" : ""}><StageVisual id={s.id} /></div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Details: who acts, the route, coverage, verification and refund limits. */}
      <section id="details" className="mkt-section bg-surface">
        <div className="mkt-wrap">
          <h2 className="type-display-lg max-w-3xl text-fg">The details.</h2>
          <div className="mt-12 hidden lg:block" data-reveal>
            <h3 className="type-heading-feature text-fg">Who acts at each step</h3>
            <ExecutionLanes className="mt-6 h-auto w-full" />
          </div>
          <div className="mt-16 grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-20">
            <div data-reveal>
              <h3 className="type-heading-section text-fg">One transfer, on record from start to finish.</h3>
              <RouteDiagram className="mt-10 h-auto w-full max-w-md" />
            </div>
            <dl data-reveal className="flex flex-col">
              {CROSS_CHAIN.map((c) => (
                <div key={c.term} className="grid gap-1 border-t border-line-strong py-5 sm:grid-cols-[11rem_1fr] sm:gap-6">
                  <dt className="type-heading-feature text-fg">{c.term}</dt>
                  <dd className="type-body text-fg-2">{c.text}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div data-reveal className="mt-20">
            <h3 className="type-heading-section text-fg">{NETWORK_COUNT} networks, {ASSET_COUNT} assets.</h3>
            <p className="type-body-marketing mkt-prose mt-4 text-fg-2">The list comes from the NEAR Intents token registry. SPak can read {NETWORKS_VERIFIED.length} of these chains itself. A transfer to one of the others is never marked Completed automatically. It goes to manual review.</p>
          </div>
        </div>
      </section>

      <section id="verification" className="mkt-section">
        <div className="mkt-wrap">
          <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr] lg:gap-20">
            <div data-reveal>
              <h2 className="type-display-lg text-fg">What SPak verifies, and what it does not.</h2>
              <p className="type-lead mkt-prose mt-6 text-fg-2">SPak does not verify every stage of a transfer on chain. It verifies the two that involve your funds arriving somewhere: the deposit and the delivery. For the rest it relies on NEAR Intents, and it says so.</p>
            </div>
            <div data-reveal className="hidden justify-self-end lg:block"><EvidenceField className="h-auto w-72" /></div>
          </div>
          <ul className="mt-16 grid gap-x-20 lg:grid-cols-2">
            {SECURITY.map((s) => (
              <li key={s.title} data-reveal className="border-t border-line-strong py-6">
                <h3 className="type-heading-feature text-fg">{s.title}</h3>
                <p className="type-body mt-2 text-fg-2">{s.body}</p>
              </li>
            ))}
            <li data-reveal className="border-t border-line-strong py-6">
              <h3 className="type-heading-feature text-fg">Refund verification has limits</h3>
              <p className="type-body mt-2 text-fg-2">NEAR Intents refunds failed transfers automatically, to the wallet that sent the deposit. It reports an amount and does not name the refund transaction. SPak therefore cannot always prove which transfer is your refund. Until it can, the refund stays open and a person reviews it.</p>
            </li>
          </ul>
          <div data-reveal className="mt-20 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left">
              <caption className="type-heading-feature pb-5 text-left text-fg">Who verifies each stage</caption>
              <thead>
                <tr className="border-b border-line-strong">
                  <th scope="col" className="type-label w-40 py-3 pr-6 text-fg-2">Stage</th>
                  <th scope="col" className="type-label w-52 py-3 pr-6 text-fg-2">Checked by</th>
                  <th scope="col" className="type-label py-3 text-fg-2">How</th>
                </tr>
              </thead>
              <tbody>
                {VERIFICATION_ROWS.map((r) => (
                  <tr key={r.stage} className="border-b border-line align-top">
                    <th scope="row" className="type-app-subheading py-4 pr-6 text-fg">{r.stage}</th>
                    <td className="type-body py-4 pr-6 text-fg">{r.source}</td>
                    <td className="type-body py-4 text-fg-2">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mkt-wrap pb-24">
        <div data-reveal className="flex flex-col items-start gap-6 border-t border-line-strong pt-12 md:flex-row md:items-center md:justify-between">
          <p className="type-heading-section max-w-xl text-fg">Try it with your own wallet.</p>
          <div className="flex flex-wrap gap-3">
            <CtaLink href={SITE.appPath}>Launch SPak</CtaLink>
            <CtaLink href="/product" variant="ghost">See the product</CtaLink>
          </div>
        </div>
      </section>
    </>
  );
}
