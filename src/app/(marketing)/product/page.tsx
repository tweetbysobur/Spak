import type { Metadata } from "next";
import { CtaLink, LivePlanned } from "@/components/marketing/site";
import { OG_IMAGE, PILLARS, SITE } from "@/marketing/content";

export const metadata: Metadata = {
  title: "Product",
  description: "The SPak modules: Agent, Intelligence, Guard, Payments, Conditional Execution and Connect. What is live today and what is planned.",
  alternates: { canonical: "/product" },
  openGraph: { type: "website", siteName: SITE.name, images: [OG_IMAGE], url: "/product", title: "SPak product", description: "Six modules, each marked live or planned." },
};

export default function ProductPage() {
  return (
    <>
      <section className="mkt-wrap pb-12 pt-14 md:pt-20">
        <h1 className="type-display-xl max-w-4xl text-fg">Product</h1>
        <p className="type-lead mt-6 max-w-2xl text-fg-2">Six modules, at different stages. Each one lists what works today and what is designed but not built.</p>
        <nav aria-label="Modules" className="mt-10">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {PILLARS.map((p) => <li key={p.id}><a href={`#${p.id}`} className="type-body-sm inline-flex min-h-11 items-center text-fg-2 transition-colors hover:text-fg">{p.name}</a></li>)}
          </ul>
        </nav>
      </section>

      <section className="mkt-wrap pb-20">
        {PILLARS.map((p) => (
          <article key={p.id} id={p.id} data-reveal className="grid gap-8 border-t border-line-strong py-12 lg:grid-cols-[1fr_1.7fr] lg:gap-20">
            <div>
              <h2 className="type-heading-section text-fg">{p.name}</h2>
              <p className="type-label mt-2 text-fg-2">{p.status === "Planned" ? "Planned: not available yet" : p.status}</p>
              <p className="type-body-marketing mt-4 text-fg-2">{p.summary}</p>
            </div>
            <LivePlanned live={p.live} planned={p.planned} />
          </article>
        ))}
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

    </>
  );
}

/** Plan step actions and actors for an executable cross-chain plan (src/spak-in/planner/execution-planner.ts). */
const PLAN_STEPS = [
  ["QUOTE", "PROVIDER"], ["REVIEW", "SPAK"], ["USER_APPROVAL", "USER_WALLET"], ["DEPOSIT", "USER_WALLET"], ["SETTLE", "PROVIDER"], ["VERIFY", "SPAK"],
] as const;
