/** SPak typography tokens (src/design/typography.json): structure, hierarchy, readability and font-loading rules. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type from "@/design/typography.json";

type Role = { group: string; family: string; weight: number; size: Record<"desktop" | "tablet" | "mobile", number | string | null>; lineHeight: number | null; letterSpacing: number; fluid?: string; fontVariantNumeric?: string; overflowWrap?: string; truncate?: string };
const roles = type.roles as Record<string, Role>;
const fams = type.families as Record<string, { family: string; stack: string; cssVar: string }>;
const BPS = ["desktop", "tablet", "mobile"] as const;
const num = (v: unknown) => (typeof v === "number" ? v : NaN);

describe("structure", () => {
  it("every role uses one of the four approved families, and stacks end in generic fallbacks", () => {
    expect(Object.values(fams).map((f) => f.family).sort()).toEqual(["Instrument Serif", "Inter", "JetBrains Mono", "Sora"]);
    for (const [n, r] of Object.entries(roles)) expect(fams[r.family], n).toBeDefined();
    for (const f of Object.values(fams)) expect(f.stack).toMatch(/(sans-serif|monospace|serif)$/);
  });
  it("the font loader matches the tokens (variables, Sora weight, Instrument Serif italic only)", () => {
    const src = readFileSync("src/design/fonts.ts", "utf8");
    for (const f of Object.values(fams)) expect(src).toContain(`variable: "${f.cssVar}"`);
    expect(src).toMatch(/Sora\(\{[^}]*weight: \["600"\]/);
    expect(src).toMatch(/Instrument_Serif\(\{[^}]*style: \["italic"\]/);
    expect(src.match(/preload: false/g)?.length).toBe(3); // only Inter is preloaded
  });
  it("the font loader is not wired into the app yet", () => {
    expect(readFileSync("src/app/layout.tsx", "utf8")).not.toContain("design/fonts");
  });
  it("all font-file validations passed when the tokens were generated", () => {
    for (const c of type.validation) expect(c.pass, `${c.check}: ${c.detail}`).toBe(true);
  });
});

describe("hierarchy and responsiveness", () => {
  const order = ["display-xl", "display-lg", "heading-section", "heading-feature"];
  it("display hierarchy strictly decreases at every breakpoint", () => {
    for (const bp of BPS) for (let i = 1; i < order.length; i++) expect(num(roles[order[i - 1]].size[bp])).toBeGreaterThan(num(roles[order[i]].size[bp]));
  });
  it("sizes never grow from desktop to mobile", () => {
    for (const [n, r] of Object.entries(roles)) {
      const [d, t, m] = BPS.map((b) => r.size[b]);
      if ([d, t, m].every((v) => typeof v === "number")) {
        // buttons and nav grow to 16px on mobile for touch; everything else shrinks or stays
        if (["button", "button-sm", "nav"].includes(n)) expect(num(m), n).toBeLessThanOrEqual(16);
        else { expect(num(d), n).toBeGreaterThanOrEqual(num(t)); expect(num(t), n).toBeGreaterThanOrEqual(num(m)); }
      }
    }
  });
  it("fluid clamp() values hit the mobile size at 360px and the desktop size at 1280px", () => {
    for (const [n, r] of Object.entries(roles)) {
      if (!r.fluid?.startsWith("clamp")) continue;
      const [, minR, icpt, vw, maxR] = r.fluid.match(/clamp\(([\d.]+)rem, ([\d.-]+)rem \+ ([\d.]+)vw, ([\d.]+)rem\)/)!.map(Number);
      const at = (w: number) => Math.min(maxR * 16, Math.max(minR * 16, icpt * 16 + (vw / 100) * w));
      expect(at(360), n).toBeCloseTo(num(r.size.mobile), 1);
      expect(at(1280), n).toBeCloseTo(num(r.size.desktop), 1);
    }
  });
  it("roles that grow on mobile are stepped, never an inverted clamp()", () => {
    for (const [n, r] of Object.entries(roles)) {
      if (num(r.size.mobile) > num(r.size.desktop)) { expect(r.fluid, n).toBeUndefined(); expect((r as Record<string, unknown>).responsive, n).toBe("stepped"); }
      if (r.fluid?.startsWith("clamp")) expect(r.fluid, n).not.toMatch(/\+ -/);
    }
  });
  it("display headings tighten tracking; body and labels do not", () => {
    for (const n of order) expect(roles[n].letterSpacing).toBeLessThan(0);
    for (const n of ["body", "body-sm", "label", "caption"]) expect(roles[n].letterSpacing).toBeGreaterThanOrEqual(0);
  });
});

describe("readability", () => {
  it("body is 16px everywhere; no text role is below 12px", () => {
    for (const bp of BPS) expect(roles.body.size[bp]).toBe(16);
    for (const r of Object.values(roles)) for (const v of Object.values(r.size)) if (typeof v === "number") expect(v).toBeGreaterThanOrEqual(12);
  });
  it("paragraph roles have line height of at least 1.5; display roles stay tight", () => {
    for (const n of ["body", "body-sm", "lead", "body-marketing", "error-body"]) expect(roles[n].lineHeight).toBeGreaterThanOrEqual(1.5);
    for (const n of ["display-xl", "display-lg"]) expect(roles[n].lineHeight).toBeLessThanOrEqual(1.1);
  });
});

describe("financial and technical rules", () => {
  it("every amount role uses Inter with tabular numerals", () => {
    for (const n of ["amount-display", "amount-total", "amount", "amount-fee"]) {
      expect(roles[n].family).toBe("sans");
      expect(roles[n].fontVariantNumeric).toBe("tabular-nums");
    }
  });
  it("hashes, addresses and identifiers use JetBrains Mono and can break anywhere; hashes and addresses truncate in the middle", () => {
    for (const n of ["hash", "address", "identifier"]) { expect(roles[n].family).toBe("mono"); expect(roles[n].overflowWrap).toBe("anywhere"); }
    for (const n of ["hash", "address"]) expect(roles[n].truncate).toBe("middle 6+4");
  });
  it("code blocks scroll instead of wrapping", () => {
    expect(roles["code-block"]).toMatchObject({ family: "mono", whiteSpace: "pre", overflowX: "auto" });
  });
  it("Sora is marketing-only; Instrument Serif is never used for numbers or application text", () => {
    for (const [n, r] of Object.entries(roles)) {
      if (r.family === "display") expect(r.group, n).toBe("marketing");
      if (r.family === "editorial") { expect(r.group, n).toBe("marketing"); expect(r.fontVariantNumeric, n).toBeUndefined(); }
    }
  });
  it("status labels are never uppercase (status words must stay readable)", () => {
    expect((roles.status as Record<string, unknown>).textTransform).toBeUndefined();
  });
});
