import { getImageProps } from "next/image";
import { Icon } from "@/components/icons";
import { WhatIsComposition } from "@/components/marketing/art";
import { StatusMark } from "@/components/marketing/internal";
import { InView } from "@/components/marketing/InView";
import { BuiltOnNear, CtaLink } from "@/components/marketing/site";
import { JOURNEY, PILLARS, SITE, TRUST } from "@/marketing/content";

/** Homepage hero background, supplied by the brand owner (public/brand/images, listed in the brand asset inventory). */
/** JPEG export (quality 90) of the brand owner's PNG master, so the image optimizer starts from 0.4 MB instead of 2 MB. */
const HERO_IMAGE = "/brand/images/spak-hero-landscape.jpg";
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
          {/* Phones: two fixed lines, sized to fit the screen width. From 640 px up, unchanged. */}
          <h1 className="type-display-lg mt-7 max-w-2xl text-fg max-sm:text-[clamp(1.45rem,7.3vw,1.85rem)]!"><span className="max-sm:whitespace-nowrap">Intelligent execution</span> <span className="max-sm:block max-sm:whitespace-nowrap">across chains.</span></h1>
          <p className="type-lead mt-6 max-w-xl text-fg max-sm:mt-4 max-sm:max-w-[22rem] max-sm:text-[clamp(0.85rem,3.9vw,0.95rem)]! max-sm:[text-wrap:balance]">{SITE.description}</p>
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

      {/* D. Core capabilities: six modules, one line each, availability in words and shape. */}
      <section id="capabilities" className="mkt-section border-t border-line">
        <div className="mkt-wrap">
          <div data-reveal className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end lg:gap-20">
            <h2 className="type-display-lg text-fg">Core capabilities</h2>
            <p className="type-lead text-fg-2">Some of SPak works today and some is still being built. Each part says which.</p>
          </div>
          <ul data-reveal className="mt-12 grid gap-x-12 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <li key={p.id} id={p.id} className="border-t border-line-strong py-6">
                <h3 className="type-heading-feature text-fg">{p.name}</h3>
                <StatusMark status={p.status} className="mt-2" />
                <p className="type-body mt-3 text-fg-2">{p.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* E. How SPak works: one visual. A single path, dotted until you approve, solid after. The page's Forest Green block. */}
      <section id="how-it-works" className="bg-[var(--spak-brand-forest-green)] py-20 md:py-28">
        <div className="mkt-wrap">
          <h2 className="type-display-lg text-[var(--spak-brand-warm-white)]">How SPak works</h2>
          <ol data-reveal className="mt-14 grid md:grid-cols-5">
            {JOURNEY.map((j) => (
              <li key={j.id} className={`relative border-l-2 pb-10 pl-7 last:pb-0 md:border-l-0 md:border-t-2 md:pb-0 md:pl-0 md:pr-6 md:pt-8 ${j.moves ? "border-[var(--spak-brand-warm-white)]" : "border-dotted border-[var(--spak-brand-muted-sage)]"}`}>
                <span aria-hidden="true" className={`absolute -left-[9px] top-0 flex h-4 w-4 items-center justify-center rounded-full md:-top-[9px] md:left-0 ${j.id === "approve" || j.moves ? "bg-[var(--spak-brand-warm-white)]" : "border-2 border-[var(--spak-brand-muted-sage)] bg-[var(--spak-brand-forest-green)]"}`} />
                <h3 className="type-heading-feature text-[var(--spak-brand-warm-white)]">{j.title}</h3>
                <p className="type-body mt-2 text-[var(--spak-brand-muted-sage)]">{j.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* F. Trust and control: three points and the way in. */}
      <section id="trust" className="mkt-section">
        <div className="mkt-wrap">
          <h2 data-reveal className="type-display-lg text-fg">Nothing moves without you.</h2>
          <ul data-reveal className="mt-12 grid gap-x-12 md:grid-cols-3">
            {TRUST.map((t) => (
              <li key={t.title} className="border-t border-line-strong py-6">
                <h3 className="type-heading-feature text-fg">{t.title}</h3>
                <p className="type-body mt-2 text-fg-2">{t.body}</p>
              </li>
            ))}
          </ul>
          <div data-reveal className="mt-10 flex flex-wrap gap-3">
            <CtaLink href={SITE.appPath}>Launch SPak</CtaLink>
            <CtaLink href="/docs" variant="ghost">Read the documentation</CtaLink>
          </div>
        </div>
      </section>
    </>
  );
}
