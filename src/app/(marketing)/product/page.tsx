import type { Metadata } from "next";
import Image from "next/image";
import { AccountDiagram, ArchitectureFlow, ConditionalDiagram, ParseDiagram, PaymentDiagram, StatusMark } from "@/components/marketing/internal";
import { CtaLink, LivePlanned, Screen } from "@/components/marketing/site";
import { OG_IMAGE, PILLARS, SITE, type Pillar } from "@/marketing/content";

export const metadata: Metadata = {
  title: "Product",
  description: "The SPak modules: Agent, Intelligence, Guard, Payments, Conditional Execution and Connect. What is live today and what is planned.",
  alternates: { canonical: "/product" },
  openGraph: { type: "website", siteName: SITE.name, images: [OG_IMAGE], url: "/product", title: "SPak product", description: "Six modules, each marked live or planned." },
};

/** Plan step actions and actors for an executable cross-chain plan (src/spak-in/planner/execution-planner.ts). */
const PLAN_STEPS = [
  ["QUOTE", "PROVIDER"], ["REVIEW", "SPAK"], ["USER_APPROVAL", "USER_WALLET"], ["DEPOSIT", "USER_WALLET"], ["SETTLE", "PROVIDER"], ["VERIFY", "SPAK"],
] as const;

const P = (id: string) => PILLARS.find((p) => p.id === id) as Pillar;

/** Module heading block: name, status in words and shape, one-line summary. */
function ModuleHead({ p, onDark = false }: { p: Pillar; onDark?: boolean }) {
  return (
    <div>
      {/* The module's illustration: one family, same style for all six. Decorative, the heading names it. */}
      <Image src={`/marketing/images/spak-module-${p.id}.jpg`} alt="" width={112} height={112} sizes="112px" className="mb-6 h-28 w-28 rounded-card" />
      <StatusMark status={p.status} />
      <h2 className={`type-display-lg mt-4 ${onDark ? "text-fg" : "text-fg"}`}>{p.name}</h2>
      <p className="type-lead mt-5 max-w-xl text-fg-2">{p.summary}</p>
    </div>
  );
}

export default function ProductPage() {
  const intelligence = P("intelligence"), guard = P("guard"), payments = P("payments"), agent = P("agent"), connect = P("connect"), conditional = P("conditional");
  return (
    <>
      {/* Opening: the architecture as one path. */}
      <section className="mkt-wrap pb-20 pt-14 md:pb-28 md:pt-20">
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-end lg:gap-16">
          <h1 className="type-display-xl text-fg">Cross-chain execution, built as infrastructure.</h1>
          <p className="type-lead text-fg-2">Six modules along one path, from your wallet to a verified delivery. Each says what works today and what is still being built.</p>
        </div>
      </section>
      {/* Full-bleed on phones and tablets, inset on desktop. The structure stays in frame at every width. */}
      <figure className="lg:mx-auto lg:max-w-[76rem] lg:px-10">
        <div className="relative aspect-[4/3] overflow-hidden sm:aspect-[16/9] lg:rounded-card">
          <Image src="/marketing/images/spak-product-infrastructure.jpg" alt="Illustration: a slanted stone structure on a forested hilltop, joined by thin paths of light to four separate plateaus across a misty valley." fill priority sizes="(min-width: 1280px) 1200px, 100vw" quality={80} className="object-cover object-[50%_45%]" />
        </div>
        <figcaption className="type-demo-label mkt-wrap mt-3 text-fg-2 lg:px-0">Illustration. SPak coordinates; each network keeps its own ground.</figcaption>
      </figure>
      <section className="mkt-wrap pb-20 pt-16 md:pb-28">
        <ArchitectureFlow />
      </section>

      {/* Intelligence: an instruction taken apart. Typographic, no frame. */}
      <section id="intelligence" className="mkt-section border-t border-line">
        <div className="mkt-wrap grid gap-14 lg:grid-cols-[1fr_1.25fr] lg:gap-20">
          <div data-reveal><ModuleHead p={intelligence} /><div className="mt-10"><LivePlanned live={intelligence.live} planned={intelligence.planned} /></div></div>
          <div data-reveal className="lg:pt-24"><ParseDiagram /></div>
        </div>
      </section>

      {/* Guard: the one dark, photographic module. The approval screen sits on the landscape. */}
      <section id="guard" data-theme="dark" className="relative isolate overflow-hidden text-fg">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[var(--spak-brand-forest-green)]">
          <Image src="/brand/images/spak-hero-landscape.png" alt="" fill sizes="100vw" quality={75} className="object-cover object-[70%_50%]" />
          <div className="mkt-hero-tint absolute inset-0" />
          <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--spak-brand-graphite)_55%,transparent)]" />
        </div>
        <div className="mkt-wrap grid items-center gap-14 py-20 md:py-28 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <div data-reveal>
            <ModuleHead p={guard} onDark />
            <p className="type-heading-feature mt-8 text-fg">Nothing moves without you.</p>
            <div className="mt-10"><LivePlanned live={guard.live} planned={guard.planned} /></div>
          </div>
          <div data-reveal className="mx-auto w-full max-w-md lg:max-w-none">
            <Screen name="approval" crop="bottom" alt="The approval screen. A firm quote with recipient, refund address, deposit address and deadline, and a checkbox the user must tick before the Approve button works." caption="The approval step in the app. The button stays disabled until you tick the box." />
          </div>
        </div>
      </section>

      {/* Payments: diagram first, text second, to change the rhythm. */}
      <section id="payments" className="mkt-section">
        <div className="mkt-wrap grid items-center gap-14 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
          <div data-reveal className="order-2 lg:order-1"><PaymentDiagram className="h-auto w-full" /></div>
          <div data-reveal className="order-1 lg:order-2"><ModuleHead p={payments} /><div className="mt-10"><LivePlanned live={payments.live} planned={payments.planned} /></div></div>
        </div>
      </section>

      {/* Agent and Connect: one diagram, two modules, because they share the account. */}
      <section className="mkt-section bg-surface" aria-label="SPak Connect and SPak Agent">
        <div className="mkt-wrap">
          <div data-reveal className="mx-auto max-w-3xl"><AccountDiagram className="h-auto w-full" /></div>
          <div className="mt-16 grid gap-16 lg:grid-cols-2 lg:gap-20">
            <article id="connect" data-reveal><ModuleHead p={connect} /><div className="mt-10"><LivePlanned live={connect.live} planned={connect.planned} /></div></article>
            <article id="agent" data-reveal><ModuleHead p={agent} /><div className="mt-10"><LivePlanned live={agent.live} planned={agent.planned} /></div></article>
          </div>
        </div>
      </section>

      {/* Conditional Execution: planned, so it is quieter: dashed frame, muted type, no product imagery. */}
      <section id="conditional" className="mkt-section">
        <div className="mkt-wrap">
          <div data-reveal className="grid items-center gap-12 border-2 border-dashed border-line-strong px-6 py-12 md:px-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <div><ModuleHead p={conditional} /><div className="mt-10"><LivePlanned live={conditional.live} planned={conditional.planned} /></div></div>
            <ConditionalDiagram className="h-auto w-full" />
          </div>
        </div>
      </section>

      {/* Developer infrastructure. A Graphite section: the dark theme tokens apply inside it. */}
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

      <section className="mkt-wrap py-24">
        <div data-reveal className="flex flex-col items-start gap-6 border-t border-line-strong pt-12 md:flex-row md:items-center md:justify-between">
          <p className="type-heading-section max-w-xl text-fg">See the whole journey, stage by stage.</p>
          <div className="flex flex-wrap gap-3">
            <CtaLink href="/how-it-works">How it works</CtaLink>
            <CtaLink href={SITE.appPath} variant="ghost">Launch SPak</CtaLink>
          </div>
        </div>
      </section>
    </>
  );
}
