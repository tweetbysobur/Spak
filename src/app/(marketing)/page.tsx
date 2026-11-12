import { getImageProps } from "next/image";
import { Icon } from "@/components/icons";
import { BandField, EvidenceField, ExecutionLanes, RouteDiagram, WhatIsComposition } from "@/components/marketing/art";
import { InView } from "@/components/marketing/InView";
import { BuiltOnNear, CtaLink, LivePlanned, Screen } from "@/components/marketing/site";
import { ASSET_COUNT, NETWORK_COUNT, NETWORKS_REVIEWED, NETWORKS_VERIFIED, PILLARS, SECURITY, SITE, STEPS, VERIFICATION_ROWS } from "@/marketing/content";

const CROSS_CHAIN = [
  { term: "Asset movement", text: "Swap, bridge or send in one transfer. You name the asset you hold and the asset the recipient should get." },
  { term: "Quotes", text: "An estimate first, then a firm quote from NEAR Intents with the minimum output, every fee and a deadline." },
  { term: "Deposit instructions", text: "After you approve, SPak shows the exact amount, network and deposit address. Your wallet signs and sends it." },
  { term: "Tracking", text: "Seven recorded steps from approval to completion. SPak keeps checking in the background, so you can close the page." },
  { term: "Destination verification", text: "On the networks SPak can read, it checks the delivery on chain against the minimum you approved." },
] as const;

/** Homepage hero background, supplied by the brand owner (public/brand/images, listed in the brand asset inventory). */
const HERO_IMAGE = "/brand/images/spak-hero-landscape.png";
/** Portrait version for phones, built from the same landscape by scripts/brand/build_hero_mobile.py. */
const HERO_IMAGE_MOBILE = "/brand/images/spak-hero-landscape-mobile.jpg";
/** Phones get the portrait image; tablets and desktops keep the landscape. Matches Tailwind's sm breakpoint. */
const MOBILE_MEDIA = "(max-width: 639px)";

/**
 * Art direction: one <picture>, so the browser downloads only the image for the current width. Both are served
 * through the Next.js image optimizer at sizes matched to the screen. No preload: a preload would fetch the
 * landscape on phones too. The hero is the first thing on the page, so the image still loads early.
 */
function heroImageProps() {
  const common = { alt: "", fill: true, priority: true, quality: 85, sizes: "100vw" } as const;
  const mobile = getImageProps({ ...common, src: HERO_IMAGE_MOBILE }).props;
  const desktop = getImageProps({ ...common, src: HERO_IMAGE }).props;
  return { mobileSrcSet: mobile.srcSet, desktop };
}

export default function HomePage() {
  const hero = heroImageProps();
  return (
    <>
      {/* B. Hero */}
      {/* The landscape is dark in both themes, so the hero always uses the dark theme tokens (white text, reversed marks). */}
      <section data-theme="dark" className="relative isolate overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[var(--spak-brand-forest-green)]">
          <picture>
            <source media={MOBILE_MEDIA} srcSet={hero.mobileSrcSet} sizes="100vw" />
            <img {...hero.desktop} alt="" className="object-cover max-sm:object-[75%_100%] sm:object-[30%_50%] md:object-[50%_50%] lg:object-center" />
          </picture>
          <div className="mkt-hero-tint absolute inset-0" />
        </div>
        <div data-hero-content className="mkt-wrap flex min-h-[clamp(34rem,165vw,50rem)] flex-col sm:min-h-[clamp(34rem,50vw,50rem)] items-center justify-center pb-20 pt-14 text-center max-sm:pb-32 md:pb-28 md:pt-16">
          <BuiltOnNear className="mkt-hero-chip" />
          <h1 className="type-display-lg mt-7 max-w-2xl text-fg">Intelligent execution across chains.</h1>
          <p className="type-lead mt-6 max-w-xl text-fg">{SITE.description}</p>
          <div className="mt-9 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
            <CtaLink href={SITE.appPath} variant="on-forest">Launch SPak<Icon name="arrow" size={18} aria-hidden="true" className="ml-2 -rotate-45" /></CtaLink>
            <CtaLink href="/developers" variant="on-forest-ghost" className="mkt-hero-chip">Explore Developers</CtaLink>
          </div>
        </div>
      </section>

      {/* C. What is SPak? */}
      <section id="product" className="py-20 md:py-28">
        <div className="mkt-wrap grid items-center gap-14 md:grid-cols-[48fr_42fr] md:justify-between md:gap-10">
          <div data-reveal>
            <h2 className="type-display-lg text-fg">What is SPak?</h2>
            <p className="mt-6 max-w-[26rem] text-[1.25rem] leading-[1.6] text-fg md:text-[1.5rem]">An intent-based execution layer that coordinates cross-chain actions, approvals and verification in one interface.</p>
            <a href="#how-it-works" className="type-cta mt-8 inline-flex min-h-11 items-center gap-2 text-primary underline-offset-4 transition-colors hover:text-primary-hover hover:underline">
              See how it works<Icon name="arrow" size={18} aria-hidden="true" />
            </a>
          </div>
          {/* A framed rectangle: the forms assemble on scroll-in, then the photograph drifts inside the upper form. */}
          <InView className="what-frame flex aspect-[4/3] items-center justify-center overflow-hidden rounded-card border border-line bg-elevated dark:bg-surface">
            <WhatIsComposition className="h-[74%]" />
          </InView>
        </div>
      </section>

      {/* D. How SPak works */}
      <section id="how-it-works" className="mkt-section border-t border-line">
        <div className="mkt-wrap">
          <div data-reveal className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end lg:gap-20">
            <h2 className="type-display-lg text-fg">Five steps. One of them is always yours.</h2>
            <p className="type-lead text-fg-2">SPak cannot move funds. It prepares a transfer and stops. The transfer continues only when you approve the quote and sign in your wallet.</p>
          </div>
          <ExecutionLanes className="mt-16 hidden h-auto w-full lg:block" />
          <ol className="mt-12 grid gap-0 lg:mt-6 lg:grid-cols-5 lg:gap-8">
            {STEPS.map((s) => (
              <li key={s.id} data-reveal className={`relative border-l-2 py-5 pl-6 lg:border-l-0 lg:py-0 lg:pl-0 ${s.moves ? "border-primary" : "border-dotted border-line-strong"}`}>
                <p className="type-demo-label text-fg-2 lg:hidden">{s.lane}</p>
                <h3 className={`type-heading-feature mt-1 lg:mt-0 ${s.id === "approval" ? "text-primary" : "text-fg"}`}>{s.title}</h3>
                <p className="type-body mt-2 text-fg-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* E. Cross-chain execution */}
      <section id="cross-chain" className="mkt-section bg-surface">
        <div className="mkt-wrap">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-20">
            <div data-reveal>
              <h2 className="type-display-lg text-fg">One transfer, on record from start to finish.</h2>
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

          <div data-reveal className="mt-24">
            <h3 className="type-heading-section text-fg">{NETWORK_COUNT} networks, {ASSET_COUNT} assets.</h3>
            <p className="type-body-marketing mkt-prose mt-4 text-fg-2">The list comes from the NEAR Intents token registry. SPak can read {NETWORKS_VERIFIED.length} of these chains itself. The difference matters, so the two groups are shown apart.</p>
            <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-20">
              <div>
                <h4 className="type-label text-fg">Deposit and delivery verified on chain by SPak</h4>
                <p className="type-heading-feature mt-3 text-fg">{NETWORKS_VERIFIED.join(", ")}.</p>
              </div>
              <div>
                <h4 className="type-label text-fg-2">Routed by NEAR Intents. SPak cannot read these chains yet</h4>
                <p className="type-heading-feature mt-3 text-fg-2">{NETWORKS_REVIEWED.join(", ")}.</p>
                <p className="type-body-sm mt-3 text-fg-2">A transfer to one of these is never marked Completed automatically. It goes to manual review.</p>
              </div>
            </div>
          </div>

          <div className="mt-24 grid gap-10 lg:grid-cols-12 lg:gap-8">
            <Screen name="plan" crop="top" className="lg:col-span-6"
              alt="The review screen for a 50 USDC transfer from Base to SOL on Solana, listing the amount sent, the minimum received, slippage and each fee."
              caption="Plan and estimate, top of the screen. Real quote from NEAR Intents." />
            <Screen name="approval" crop="bottom" className="lg:col-span-6 lg:mt-28"
              alt="The approval screen. A firm quote with recipient, refund address, deposit address and deadline, and a checkbox the user must tick before the Approve button works."
              caption="Approval, bottom of the screen. The button stays disabled until you tick the box." />
            <Screen name="tracking" crop="top" className="lg:col-span-7 lg:col-start-4"
              alt="The tracking screen after approval. It shows the exact deposit to send and a seven-step timeline with only the first step done."
              caption="Deposit and tracking. Approved with a test wallet. No deposit was sent, so the timeline stops at step one." />
          </div>
        </div>
      </section>

      {/* F to I. Agent, Intelligence, Guard, Payments */}
      <section className="mkt-section">
        <div className="mkt-wrap">
          <div data-reveal className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end lg:gap-20">
            <h2 className="type-display-lg text-fg">Four parts, at different stages.</h2>
            <p className="type-lead text-fg-2">Some of this works today. Some is designed and not built. Each part says which is which.</p>
          </div>
          <div className="mt-16">
            {PILLARS.map((p) => (
              <article key={p.id} id={p.id} data-reveal className="grid gap-8 border-t border-line-strong py-12 lg:grid-cols-[1fr_1.7fr] lg:gap-20">
                <div>
                  <h3 className="type-heading-section text-fg">{p.name}</h3>
                  <p className="type-body-marketing mt-4 text-fg-2">{p.summary}</p>
                </div>
                <LivePlanned live={p.live} planned={p.planned} />
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* J. Developer infrastructure. A Graphite section: the dark theme tokens apply inside it. */}
      <section id="developers" data-theme="dark" className="mkt-section bg-bg text-fg">
        <div className="mkt-wrap grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
          <div data-reveal>
            <h2 className="type-display-lg text-fg">Built as infrastructure, starting with our own app.</h2>
            <div className="mkt-prose mt-8 flex flex-col gap-5">
              <p className="type-body-marketing text-fg-2">The intent engine, the execution service and the tracking monitor are separate modules behind an HTTP API. The SPak app is the first client of that API.</p>
              <p className="type-body-marketing text-fg-2">There is no public API or SDK yet. The developer page describes the architecture that exists and where it is going.</p>
            </div>
            <div className="mt-9 flex flex-wrap gap-3">
              <CtaLink href="/developers">Explore Developers</CtaLink>
              <CtaLink href="/docs" variant="ghost">Read the documentation</CtaLink>
            </div>
          </div>
          <figure data-reveal>
            <ol className="type-code-block overflow-x-auto rounded-card border border-line bg-surface p-6 text-fg">
              {PLAN_STEPS.map(([action, actor], i) => (
                <li key={action} className="grid grid-cols-[2ch_16ch_1fr] gap-4 whitespace-nowrap py-1">
                  <span className="text-fg-2">{i + 1}</span><span>{action}</span><span className="text-fg-2">{actor}</span>
                </li>
              ))}
            </ol>
            <figcaption className="type-demo-label mt-3 text-fg-2">The steps of a cross-chain plan, with the actor for each, as the engine emits them.</figcaption>
          </figure>
        </div>
      </section>

      {/* K. Security and verification */}
      <section id="security" className="mkt-section">
        <div className="mkt-wrap">
          <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr] lg:gap-20">
            <div data-reveal>
              <h2 className="type-display-lg text-fg">What SPak verifies, and what it does not.</h2>
              <p className="type-lead mkt-prose mt-6 text-fg-2">SPak does not verify every stage of a transfer on chain. It verifies the two that involve your funds arriving somewhere: the deposit and the delivery. For the rest it relies on NEAR Intents, and it says so.</p>
            </div>
            <div data-reveal className="hidden justify-self-end lg:block"><EvidenceField className="h-auto w-72" /></div>
          </div>

          <ul className="mt-16 grid gap-x-20 gap-y-0 lg:grid-cols-2">
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

          <div className="mt-20 grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center lg:gap-20">
            <div data-reveal>
              <h3 className="type-heading-section text-fg">A refund in progress looks like one.</h3>
              <p className="type-body-marketing mt-4 text-fg-2">The recovery screen separates three numbers: what NEAR Intents reports, what SPak sees arriving on chain, and what is verified and linked to your transfer. Only the third one can close a refund.</p>
            </div>
            <Screen name="refund"
              alt="The recovery panel for a failed transfer. Refund status reads waiting for NEAR Intents to send the refund. Reported, seen on chain, and verified amounts are listed separately, all empty."
              caption="Demonstration. This state was produced with simulated tracking data. No transfer failed and no refund took place." />
          </div>
        </div>
      </section>

      {/* L. Final CTA. The page's one Forest Green block. */}
      <section className="mkt-wrap pb-24">
        <div data-reveal className="relative overflow-hidden rounded-card bg-[var(--spak-brand-forest-green)]">
          <BandField className="absolute inset-y-0 right-0 hidden h-full w-1/4 lg:block" />
          <div className="relative grid gap-12 px-6 py-14 md:grid-cols-2 md:px-14 md:py-20 lg:max-w-[75%]">
            <div>
              <h2 className="type-heading-section text-[var(--spak-brand-warm-white)]">For users</h2>
              <p className="type-body-marketing mt-3 max-w-sm text-[var(--spak-brand-muted-sage)]">Connect a wallet and write your first transfer. You see the full quote before anything is approved.</p>
              <CtaLink href={SITE.appPath} variant="on-forest" className="mt-7">Launch SPak</CtaLink>
            </div>
            <div>
              <h2 className="type-heading-section text-[var(--spak-brand-warm-white)]">For developers</h2>
              <p className="type-body-marketing mt-3 max-w-sm text-[var(--spak-brand-muted-sage)]">See how the engine, execution and verification fit together, and what is planned for integrations.</p>
              <CtaLink href="/developers" variant="on-forest-ghost" className="mt-7">Explore Developer Infrastructure</CtaLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** Plan step actions and actors for an executable cross-chain plan (src/spak-in/planner/execution-planner.ts). */
const PLAN_STEPS = [
  ["QUOTE", "PROVIDER"], ["REVIEW", "SPAK"], ["USER_APPROVAL", "USER_WALLET"], ["DEPOSIT", "USER_WALLET"], ["SETTLE", "PROVIDER"], ["VERIFY", "SPAK"],
] as const;
