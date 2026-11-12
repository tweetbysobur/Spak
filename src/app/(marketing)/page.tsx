import { getImageProps } from "next/image";
import { Icon } from "@/components/icons";
import { BandField, WhatIsComposition } from "@/components/marketing/art";
import { InView } from "@/components/marketing/InView";
import { BuiltOnNear, CtaLink } from "@/components/marketing/site";
import { PILLARS, SITE, TRUST } from "@/marketing/content";

/** The four modules the homepage introduces. All six are on /product. */
const HOME_PILLARS = PILLARS.filter((p) => ["agent", "intelligence", "guard", "payments"].includes(p.id));

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
            <a href="/how-it-works" className="type-cta mt-8 inline-flex min-h-11 items-center gap-2 text-primary underline-offset-4 transition-colors hover:text-primary-hover hover:underline">
              See how it works<Icon name="arrow" size={18} aria-hidden="true" />
            </a>
          </div>
          {/* A framed rectangle: the forms assemble on scroll-in, then the photograph drifts inside the upper form. */}
          <InView className="what-frame flex aspect-[4/3] items-center justify-center overflow-hidden rounded-card border border-line bg-elevated dark:bg-surface">
            <WhatIsComposition className="h-[74%]" />
          </InView>
        </div>
      </section>

      {/* D. Core capabilities: one line each, with status in words. Detail lives on /product. */}
      <section id="capabilities" className="mkt-section border-t border-line">
        <div className="mkt-wrap grid gap-12 lg:grid-cols-[1fr_1.5fr] lg:gap-20">
          <div data-reveal>
            <h2 className="type-display-lg text-fg">Core capabilities</h2>
            <p className="type-lead mt-6 max-w-md text-fg-2">Some of SPak works today and some is still being built. Each part says which.</p>
            <a href="/product" className="type-cta mt-8 inline-flex min-h-11 items-center gap-2 text-primary underline-offset-4 transition-colors hover:text-primary-hover hover:underline">
              Explore the product<Icon name="arrow" size={18} aria-hidden="true" />
            </a>
          </div>
          <ul data-reveal className="flex flex-col">
            {HOME_PILLARS.map((p) => (
              <li key={p.id} className="grid gap-2 border-t border-line-strong py-6 sm:grid-cols-[13rem_1fr] sm:gap-8">
                <div>
                  <h3 className="type-heading-feature text-fg">{p.name}</h3>
                  <p className="type-label mt-1 text-fg-2">{p.status}</p>
                </div>
                <p className="type-body text-fg-2">{p.summary} <span className="text-fg">Live today: {p.live[0].replace(/\.$/, "").toLowerCase()}.</span></p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* E. Trust and verification: four points. The full explanation is on /how-it-works. */}
      <section id="trust" className="mkt-section bg-surface">
        <div className="mkt-wrap">
          <div data-reveal className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end lg:gap-20">
            <h2 className="type-display-lg text-fg">Nothing moves without you.</h2>
            <a href="/how-it-works" className="type-cta inline-flex min-h-11 items-center gap-2 text-primary underline-offset-4 transition-colors hover:text-primary-hover hover:underline lg:justify-self-end">
              See how it works<Icon name="arrow" size={18} aria-hidden="true" />
            </a>
          </div>
          <ul data-reveal className="mt-12 grid gap-x-12 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((t) => (
              <li key={t.title} className="border-t border-line-strong py-6">
                <h3 className="type-heading-feature text-fg">{t.title}</h3>
                <p className="type-body mt-2 text-fg-2">{t.body}</p>
              </li>
            ))}
          </ul>
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
