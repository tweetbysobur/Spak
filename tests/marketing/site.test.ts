import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NETWORKS } from "@/spak-in/registries/networks";
import { listAssets } from "@/spak-in/registries/assets";
import colors from "@/design/colors.json";
import screens from "@/marketing/screens.json";
import { ASSET_COUNT, BANNED_PHRASES, NAV, NETWORK_COUNT, NETWORKS_REVIEWED, NETWORKS_VERIFIED, JOURNEY, LIFECYCLE, PILLARS, SECURITY, SITE, STEPS, TRUST, VERIFICATION_ROWS, VERIFIED_FAMILIES } from "@/marketing/content";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import manifest from "@/app/manifest";

const ROOT = process.cwd();
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const SOURCES = [...walk("src/app/(marketing)"), ...walk("src/components/marketing"), ...walk("src/marketing")].filter((f) => /\.(tsx?|css)$/.test(f));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const ALL = SOURCES.map((f) => ({ f, text: read(f) }));
const HOME = read("src/app/(marketing)/page.tsx");
const DOCS = read("src/app/(marketing)/docs/page.tsx");

describe("marketing site: claims match the implementation", () => {
  it("network groups cover the registry exactly, with no invented network", () => {
    expect([...NETWORKS_VERIFIED, ...NETWORKS_REVIEWED].sort()).toEqual(NETWORKS.map((n) => n.name).sort());
    expect(NETWORK_COUNT).toBe(NETWORKS.length);
    expect(ASSET_COUNT).toBe(listAssets().length);
  });

  it("'verified on chain' is claimed only for families that have both a deposit and a destination verifier", () => {
    for (const fam of VERIFIED_FAMILIES) {
      expect(existsSync(join(ROOT, `src/tracking/verifiers/${fam}.ts`)), `destination verifier for ${fam}`).toBe(true);
      expect(existsSync(join(ROOT, `src/deposits/verifiers/${fam}.ts`)), `deposit verifier for ${fam}`).toBe(true);
    }
    const others = new Set(NETWORKS.map((n) => n.family).filter((f) => !(VERIFIED_FAMILIES as readonly string[]).includes(f)));
    for (const fam of others) expect(existsSync(join(ROOT, `src/tracking/verifiers/${fam}.ts`)), `${fam} must not be claimed as unverified if a verifier exists`).toBe(false);
  });

  it("the journey has five steps, approval is the third, and nothing moves before it", () => {
    expect(STEPS.map((s) => s.id)).toEqual(["intent", "plan", "approval", "execute", "verify"]);
    const approval = STEPS.findIndex((s) => s.id === "approval");
    STEPS.forEach((s, i) => expect(s.moves, s.id).toBe(i > approval));
  });

  it("every product part states what is live and what is not", () => {
    expect(PILLARS.map((p) => p.id)).toEqual(["agent", "intelligence", "guard", "payments", "conditional", "connect"]);
    expect(PILLARS.find((p) => p.id === "conditional")?.status).toBe("Planned");
    for (const p of PILLARS) { expect(p.live.length).toBeGreaterThan(0); expect(p.planned.length).toBeGreaterThan(0); }
  });

  it("plan steps shown on the homepage exist in the planner", () => {
    const planner = read("src/spak-in/planner/execution-planner.ts");
    for (const [, action, actor] of DOCS.matchAll(/\["([A-Z_]+)", "([A-Z_]+)"\]/g)) {
      expect(planner, action).toContain(`add("${action}", "${actor}"`);
    }
    expect([...DOCS.matchAll(/\["([A-Z_]+)", "([A-Z_]+)"\]/g)].length).toBe(6);
  });

  it("the docs page describes every execution state in the approved mapping", () => {
    const docs = read("src/app/(marketing)/docs/page.tsx");
    for (const state of Object.keys(colors.stateRoles.execution)) expect(docs, state).toMatch(new RegExp(`\\b${state}: "`));
  });

  it("security copy states the limits: settlement is not verified by SPak, refunds are not always provable", () => {
    const rows = Object.fromEntries(VERIFICATION_ROWS.map((r) => [r.stage, r]));
    expect(rows["Quote and settlement"].source).toBe("NEAR Intents");
    expect(rows["Quote and settlement"].detail).toMatch(/does not verify/);
    expect(rows.Refund.detail).toMatch(/does not name the refund transaction/);
    expect(rows.Refund.detail).toMatch(/only when .* verified on chain and linked/);
    expect(DOCS).toMatch(/does not verify every stage of a transfer on chain/);
    expect(SECURITY.length).toBe(5);
  });
});

describe("marketing site: honesty and brand rules in the source", () => {
  it("has no banned phrases", () => {
    for (const { f, text } of ALL) {
      if (f.endsWith("content.ts")) continue; // defines the list itself
      const lower = text.toLowerCase().replaceAll("not guaranteed", "");
      for (const phrase of BANNED_PHRASES) expect(lower.includes(phrase), `${f}: "${phrase}"`).toBe(false);
    }
    const copy = JSON.stringify([STEPS, PILLARS, SECURITY, VERIFICATION_ROWS, SITE]).toLowerCase();
    for (const phrase of BANNED_PHRASES) expect(copy.includes(phrase), phrase).toBe(false);
  });

  it("never claims autonomous or unattended execution", () => {
    for (const { f, text } of ALL) expect(/autonomous|unattended|automatically executes/i.test(text), f).toBe(false);
  });

  it("uses token colours only, and no em or en dashes in copy", () => {
    for (const { f, text } of ALL) {
      expect(/#[0-9a-fA-F]{6}\b/.test(text), `${f}: hex colour`).toBe(false);
      expect(/[–—]/.test(text), `${f}: dash`).toBe(false);
    }
  });

  it("shows the approved logo files and does not redraw the symbol", () => {
    const art = read("src/components/marketing/art.tsx");
    expect(art).not.toMatch(/M65\.2 0L113\.6 0/); // the full symbol outline is never rebuilt in artwork
    expect(read("src/components/marketing/site.tsx")).toContain('from "@/components/Logo"');
  });

  it("hero: badge, headline, paragraph, buttons, in that order, with the exact copy and destinations", () => {
    const hero = HOME.slice(HOME.indexOf("<section"), HOME.indexOf("</section>"));
    const at = [/<BuiltOnNear\b/, /<h1/, /\{SITE\.description\}/, /href=\{SITE\.appPath\}[^>]*>Launch SPak/, /href="\/developers"[^>]*>Explore Developers/].map((t) => hero.search(t));
    expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The exact headline, as rendered (the phone layout splits it into two line spans).
    const h1 = hero.slice(hero.indexOf("<h1"), hero.indexOf("</h1>")).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    expect(h1.slice(h1.indexOf("Intelligent"))).toBe("Intelligent execution across chains.");
    expect(SITE.description).toBe("SPak turns your intentions into controlled, verifiable actions across blockchain networks.");
    expect(hero).toMatch(/items-center justify-center[^"]*text-center/);
    expect(HOME).not.toContain("HeroComposition");
  });

  it("hero background is the owner-supplied landscape, listed in the brand inventory, shown with a real image element", () => {
    const hero = HOME.slice(HOME.indexOf("<section"), HOME.indexOf("</section>"));
    expect(HOME).toContain('const HERO_IMAGE = "/brand/images/spak-hero-landscape.png"');
    expect(HOME).toContain('const HERO_IMAGE_MOBILE = "/brand/images/spak-hero-landscape-mobile.jpg"');
    expect(HOME).toContain('const MOBILE_MEDIA = "(max-width: 639px)"');
    // One <picture>: a portrait source for phones, the landscape for everything else, both optimized by Next.js.
    expect(hero).toMatch(/<picture>\s*<source media=\{MOBILE_MEDIA\} srcSet=\{hero\.mobileSrcSet\} sizes="100vw" \/>\s*<img \{\.\.\.hero\.desktop\} alt="" className="object-cover/);
    // Tablet and desktop classes are exactly as approved before the phone version was added.
    expect(hero).toContain("sm:object-[30%_50%] md:object-[50%_50%] lg:object-center");
    expect(hero).toContain("sm:min-h-[clamp(34rem,50vw,50rem)]");
    const inventory = JSON.parse(read("public/brand/manifest.json")) as { assets: { path: string; approved: boolean; dimensions: string }[] };
    for (const f of ["spak-hero-landscape.png", "spak-hero-landscape-mobile.jpg"]) {
      expect(existsSync(join(ROOT, "public/brand/images", f)), f).toBe(true);
      expect(inventory.assets.find((a) => a.path === `public/brand/images/${f}`)?.approved, f).toBe(true);
    }
    expect(inventory.assets.find((a) => a.path.endsWith("spak-hero-landscape-mobile.jpg"))?.dimensions).toBe("1080x1620");
    // A flat tint only: no gradient stands in for, or sits over, the photograph.
    expect(read("src/app/(marketing)/marketing.css")).not.toMatch(/gradient/);
    expect(hero).toContain('data-theme="dark"');
  });

  it("the NEAR mark is NEAR's own file, byte for byte, never redrawn in code", () => {
    // Checksums of logo.svg and logo_rev.svg as served by NEAR's official documentation site.
    const official = { "near-logo.svg": "41538b7792a49c4c9826fe022e5672829444c80e0293d22443d81d0639a3335c", "near-logo-rev.svg": "f76009dce4c0d4bbd4bda6c485e50b0376f3814d60ec73feb2a0e46a85873ca6" };
    for (const [file, sha] of Object.entries(official)) {
      expect(createHash("sha256").update(readFileSync(join(ROOT, "public/marketing/partners", file))).digest("hex"), file).toBe(sha);
    }
    const site = read("src/components/marketing/site.tsx");
    for (const file of Object.keys(official)) expect(site).toContain(`"${file}"`);
    expect(site).toContain("Built on NEAR");
    for (const { f, text } of ALL) expect(/m421\.61,108|M13\.9017/.test(text), `${f}: NEAR path data in source`).toBe(false);
  });

  it("What is SPak?: one heading, the exact paragraph, one link to How it works, and the three-shape composition", () => {
    const sec = HOME.slice(HOME.indexOf('<section id="product"'), HOME.indexOf("</section>", HOME.indexOf('<section id="product"')));
    expect(sec).toContain(">What is SPak?</h2>");
    expect(sec).toContain(">An intent-based execution layer that coordinates cross-chain actions, approvals and verification in one interface.</p>");
    expect(sec.match(/<p\b/g)).toHaveLength(1);
    expect(sec.match(/<a\b/g)).toHaveLength(1);
    expect(sec).toMatch(/href="#how-it-works"[^>]*>\s*See how it works/);
    expect(sec).toContain("<WhatIsComposition");
    const art = read("src/components/marketing/art.tsx");
    expect(art).toContain('src="/brand/images/spak-hero-landscape.png"');
    expect(art).toContain('clipPath: "url(#what-upper)"');
    expect(art).toContain('readFileSync(join(process.cwd(), "public/brand/logo/spak-symbol.svg")');
  });

  it("landing page: hero, What is SPak?, capabilities, how it works, trust. Nothing else", () => {
    const ids = [...HOME.matchAll(/<section(?: id="([a-z-]+)")?/g)].map((m) => m[1] ?? "-");
    expect(ids).toEqual(["-", "product", "capabilities", "how-it-works", "trust"]);
    expect(HOME).toContain("PILLARS.map"); // all six modules, each with its availability
    expect(HOME).toContain("<StatusMark status={p.status}");
    expect(JOURNEY.map((j) => j.id)).toEqual(["describe", "plan", "approve", "execute", "verify"]);
    JOURNEY.forEach((j, i) => expect(j.moves, j.id).toBe(i > 2)); // nothing moves before approval
    expect(TRUST).toHaveLength(3);
    expect(TRUST[2].body).toMatch(/where supported/);
    expect(JOURNEY[4].body).toMatch(/where supported/);
  });

  it("detail lives in the documentation: lifecycle, verification, refunds, modules, architecture, every screen", () => {
    for (const id of ["lifecycle", "networks", "verification", "refunds", "modules", "architecture"]) expect(DOCS, id).toContain(`id="${id}"`);
    expect(LIFECYCLE.map((x) => x.id)).toEqual(["intent", "plan", "quote", "approval", "deposit", "verification", "refunds"]);
    for (const n of ["chat", "plan", "approval", "tracking", "refund"]) expect(DOCS, n).toContain(`name: "${n}"`);
    const config = read("next.config.ts");
    expect(config).toContain('source: "/product", destination: "/#capabilities"');
    expect(config).toContain('source: "/how-it-works", destination: "/#how-it-works"');
  });

  it("labels simulated product screens", () => {
    expect(DOCS).toMatch(/caption: "Demonstration\. This state was produced with simulated tracking data\./);
    expect(read("scripts/marketing/capture.cjs")).toMatch(/SIMULATED tracking data/);
  });
});

describe("marketing site: routes, links, assets and SEO", () => {
  const ROUTES = ["/", "/developers", "/docs", "/app"];
  const page = (r: string) => (r === "/" ? "src/app/(marketing)/page.tsx" : r === "/app" ? "src/app/app/page.tsx" : `src/app/(marketing)${r}/page.tsx`);

  it("every route exists, and the application moved to /app intact", () => {
    for (const r of ROUTES) expect(existsSync(join(ROOT, page(r))), r).toBe(true);
    expect(existsSync(join(ROOT, "src/app/page.tsx"))).toBe(false);
    expect(read("src/app/app/page.tsx")).toContain('"use client"');
    expect(manifest().start_url).toBe("/app");
    expect(SITE.appPath).toBe("/app");
  });

  it("every internal link points at a real route and a real anchor", () => {
    const hrefs = new Set<string>(NAV.map((n) => n.href));
    for (const { text } of ALL) for (const m of text.matchAll(/href[:=]\s*\{?"(\/[^"]*)"/g)) hrefs.add(m[1]);
    expect(hrefs.size).toBeGreaterThan(8);
    const pillarIds = PILLARS.map((p) => p.id);
    for (const href of hrefs) {
      const [path, hash] = href.split("#");
      expect(ROUTES, href).toContain(path || "/");
      if (hash) expect(pillarIds.includes(hash) || read(page(path || "/")).includes(`id="${hash}"`), href).toBe(true);
    }
  });

  it("has no external links (no invented social accounts or resources)", () => {
    for (const { f, text } of ALL) {
      if (f.endsWith("content.ts")) continue; // holds the site origin only
      expect(/https?:\/\//.test(text), f).toBe(false);
    }
  });

  it("every product screen exists in both themes and both widths", () => {
    for (const name of ["chat", "plan", "approval", "tracking", "refund"]) for (const suffix of ["", "-m"]) {
      expect((screens as Record<string, { width: number; height: number }>)[name + suffix]?.width, name + suffix).toBeGreaterThan(0);
      for (const theme of ["light", "dark"]) expect(existsSync(join(ROOT, `public/marketing/screens/${name}${suffix}-${theme}.png`)), `${name}${suffix}-${theme}`).toBe(true);
    }
    expect(existsSync(join(ROOT, "public/marketing/spak-og.png"))).toBe(true);
  });

  it("metadata, sitemap and robots are wired", () => {
    const layout = read("src/app/(marketing)/layout.tsx");
    for (const key of ["metadataBase", "openGraph", "twitter", "canonical", "OG_IMAGE"]) expect(layout, key).toContain(key);
    expect(sitemap().map((e) => e.url)).toEqual(["/", "/developers", "/docs"].map((p) => `${SITE.origin}${p}`));
    const rules = robots().rules as { disallow: string[] }[];
    expect(rules[0].disallow).toContain("/api/");
    for (const r of ["developers", "docs"]) expect(read(`src/app/(marketing)/${r}/page.tsx`)).toMatch(/export const metadata[\s\S]*images: \[OG_IMAGE\]/);
  });

  it("motion respects reduced-motion and content is visible without scripts", () => {
    const css = read("src/app/(marketing)/marketing.css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    expect(css).toMatch(/\.js-reveal \[data-reveal\]/); // the hidden start state needs the class the script adds
    expect(read("src/components/marketing/Reveal.tsx")).toMatch(/prefers-reduced-motion: reduce/);
  });
});
