import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NETWORKS } from "@/spak-in/registries/networks";
import { listAssets } from "@/spak-in/registries/assets";
import colors from "@/design/colors.json";
import screens from "@/marketing/screens.json";
import { ASSET_COUNT, BANNED_PHRASES, NAV, NETWORK_COUNT, NETWORKS_REVIEWED, NETWORKS_VERIFIED, PILLARS, SECURITY, SITE, STEPS, VERIFICATION_ROWS, VERIFIED_FAMILIES } from "@/marketing/content";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import manifest from "@/app/manifest";

const ROOT = process.cwd();
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const SOURCES = [...walk("src/app/(marketing)"), ...walk("src/components/marketing"), ...walk("src/marketing")].filter((f) => /\.(tsx?|css)$/.test(f));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const ALL = SOURCES.map((f) => ({ f, text: read(f) }));
const HOME = read("src/app/(marketing)/page.tsx");

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
    expect(PILLARS.map((p) => p.id)).toEqual(["agent", "intelligence", "guard", "payments"]);
    for (const p of PILLARS) { expect(p.live.length).toBeGreaterThan(0); expect(p.planned.length).toBeGreaterThan(0); }
  });

  it("plan steps shown on the homepage exist in the planner", () => {
    const planner = read("src/spak-in/planner/execution-planner.ts");
    for (const [, action, actor] of HOME.matchAll(/\["([A-Z_]+)", "([A-Z_]+)"\]/g)) {
      expect(planner, action).toContain(`add("${action}", "${actor}"`);
    }
    expect([...HOME.matchAll(/\["([A-Z_]+)", "([A-Z_]+)"\]/g)].length).toBe(6);
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
    expect(HOME).toMatch(/does not verify every stage of a transfer on chain/);
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

  it("labels simulated product screens", () => {
    expect(HOME).toMatch(/caption="Demonstration\. This state was produced with simulated tracking data\./);
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
