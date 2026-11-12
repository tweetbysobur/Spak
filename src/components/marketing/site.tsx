import Link from "next/link";
import Image from "next/image";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NAV, SITE } from "@/marketing/content";
import screens from "@/marketing/screens.json";
import { MobileMenu } from "./MobileMenu";

type Variant = "primary" | "ghost" | "on-forest" | "on-forest-ghost";
const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active",
  ghost: "border border-line-strong text-fg hover:bg-secondary active:bg-secondary-hover",
  "on-forest": "bg-[var(--spak-brand-warm-white)] text-[var(--spak-brand-forest-green)] hover:bg-[var(--spak-brand-soft-green)]",
  "on-forest-ghost": "border border-[var(--spak-brand-muted-sage)] text-[var(--spak-brand-warm-white)] hover:bg-[var(--spak-art-band-tone)]",
};
/** A link that looks like the application's buttons. 48 px tall on marketing pages. */
export function CtaLink({ href, children, variant = "primary", className = "" }: { href: string; children: React.ReactNode; variant?: Variant; className?: string }) {
  return <Link href={href} className={`type-cta inline-flex min-h-12 items-center justify-center rounded-control px-6 transition-colors duration-[var(--spak-motion-fast)] ${VARIANT[variant]} ${className}`}>{children}</Link>;
}

/**
 * "Built on NEAR" badge: the NEAR icon, then the words. The icon is the left part of NEAR's own logo file, shown
 * through a square window so the file itself stays unmodified (public/marketing/partners, from NEAR's official
 * documentation site). Black artwork on light surfaces, the reversed file on dark ones. The mark is never
 * redrawn or recoloured.
 */
export function BuiltOnNear({ className = "" }: { className?: string }) {
  const mark = (file: string, show: string) => (
    <span aria-hidden="true" className={`${show} h-4 w-4 shrink-0 overflow-hidden`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/marketing/partners/${file}`} alt="" width={66} height={16} className="h-4 w-auto max-w-none" />
    </span>
  );
  return (
    <p className={`type-label inline-flex items-center gap-2 rounded-full border border-line-strong py-1.5 pl-3 pr-3.5 text-fg ${className}`}>
      {mark("near-logo.svg", "logo-light")}
      {mark("near-logo-rev.svg", "logo-dark")}
      Built on NEAR
    </p>
  );
}

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <a href="#main" className="type-nav sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary">Skip to content</a>
      <div className="mkt-wrap flex h-16 items-center gap-6">
        <Link href="/" aria-label="SPak home" className="shrink-0"><Logo className="h-7" /></Link>
        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="type-nav rounded-control px-3 py-2 text-fg-2 transition-colors hover:text-fg">{n.label}</Link>)}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link href={SITE.appPath} className="type-button hidden min-h-10 items-center rounded-control bg-primary px-4 text-on-primary transition-colors hover:bg-primary-hover sm:inline-flex">Launch App</Link>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}

const FOOTER = [
  { title: "Product", links: [{ label: "What SPak is", href: "/#product" }, { label: "How it works", href: "/#how-it-works" }, { label: "Cross-chain execution", href: "/#cross-chain" }, { label: "Security and verification", href: "/#security" }] },
  { title: "Platform", links: [{ label: "SPak Agent", href: "/#agent" }, { label: "SPak Intelligence", href: "/#intelligence" }, { label: "SPak Guard", href: "/#guard" }, { label: "SPak Payments", href: "/#payments" }] },
  { title: "Developers", links: [{ label: "Developer infrastructure", href: "/developers" }, { label: "Documentation", href: "/docs" }, { label: "Launch App", href: SITE.appPath }] },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mkt-wrap grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Link href="/" aria-label="SPak home" className="inline-block"><Logo className="h-7" /></Link>
          <p className="type-body-sm mt-4 max-w-xs text-fg-2">{SITE.tagline} Built on NEAR. Transfers are executed through NEAR Intents.</p>
        </div>
        {FOOTER.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="type-label text-fg">{col.title}</h2>
            <ul className="mt-3 flex flex-col gap-1">
              {col.links.map((l) => <li key={l.href}><Link href={l.href} className="type-body-sm inline-block py-1 text-fg-2 transition-colors hover:text-fg">{l.label}</Link></li>)}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mkt-wrap border-t border-line py-6">
        <p className="type-caption text-fg-2">© 2026 SPak. Every transfer needs your approval and your wallet signature.</p>
      </div>
    </footer>
  );
}

type ScreenName = "chat" | "plan" | "approval" | "tracking" | "refund";
const SIZES = screens as Record<string, { width: number; height: number }>;
/**
 * A real screen captured from the running application (scripts/marketing/capture.cjs). The caption says what is
 * real and what is simulated. Light and dark captures switch with the theme, and a phone-width capture replaces
 * the desktop one on small displays so the text stays readable.
 */
export function Screen({ name, alt, caption, className = "", priority = false, crop }: { name: ScreenName; alt: string; caption: string; className?: string; priority?: boolean; crop?: "top" | "bottom" }) {
  const fit = crop ? `absolute inset-0 h-full w-full object-cover ${crop === "top" ? "object-top" : "object-bottom"}` : "h-auto w-full";
  const frame = `overflow-hidden rounded-card border border-line bg-elevated shadow-card dark:bg-surface ${crop ? "relative aspect-[5/6]" : ""}`;
  const set = (suffix: "" | "-m", show: string, sizes: string) => (
    <div className={`${frame} ${show}`}>
      {(["light", "dark"] as const).map((t) => (
        <Image key={t} src={`/marketing/screens/${name}${suffix}-${t}.png`} alt={t === "light" ? alt : ""} aria-hidden={t === "dark" ? true : undefined}
          width={SIZES[name + suffix].width} height={SIZES[name + suffix].height} sizes={sizes} priority={priority && t === "light" && suffix === ""}
          className={`${fit} ${t === "light" ? "only-light" : "only-dark"}`} />
      ))}
    </div>
  );
  return (
    <figure data-reveal className={className}>
      {set("-m", "sm:hidden", "92vw")}
      {set("", "hidden sm:block", "(min-width: 1024px) 560px, 92vw")}
      <figcaption className="type-demo-label mt-3 text-fg-2">{caption}</figcaption>
    </figure>
  );
}

/** Live and planned capabilities, side by side, with words (not colour) telling them apart. */
export function LivePlanned({ live, planned }: { live: readonly string[]; planned: readonly string[] }) {
  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <div>
        <h4 className="type-label text-fg">Live today</h4>
        <ul className="mt-3 flex flex-col gap-3">{live.map((t) => <li key={t} className="type-body border-l-2 border-primary pl-4 text-fg">{t}</li>)}</ul>
      </div>
      <div>
        <h4 className="type-label text-fg-2">Not live yet</h4>
        <ul className="mt-3 flex flex-col gap-3">{planned.map((t) => <li key={t} className="type-body border-l-2 border-dashed border-line-strong pl-4 text-fg-2">{t}</li>)}</ul>
      </div>
    </div>
  );
}
