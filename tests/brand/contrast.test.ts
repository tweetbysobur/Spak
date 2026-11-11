/** SPak colour system: independent WCAG contrast recomputation and state-mapping rules for src/design/colors.json. */
import { describe, expect, it } from "vitest";
import colors from "@/design/colors.json";
import { EXECUTION_STATES } from "@/execution/state";
import { DEPOSIT_STATES } from "@/deposits/types";
import { REFUND_STATES } from "@/failures/records";

const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const MIN = { text: 4.5, large: 3, ui: 3 } as const;
type Theme = keyof typeof colors.themes;
const themes = Object.keys(colors.themes) as Theme[];
const roles = colors.semantic as Record<string, { light: Record<string, string>; dark: Record<string, string> }>;

describe("validation report", () => {
  it("every recorded ratio matches an independent recomputation", () => {
    for (const v of colors.validation) expect(Math.abs(ratio(v.foreground, v.background) - v.ratio), v.label).toBeLessThan(0.01);
  });
  it("every approved pairing passes; every documented restriction fails", () => {
    for (const v of colors.validation) {
      const r = ratio(v.foreground, v.background), min = MIN[v.requirement as keyof typeof MIN];
      if (v.expect === "pass") expect(r, v.label).toBeGreaterThanOrEqual(min);
      if (v.expect === "fail") expect(r, v.label).toBeLessThan(min);
    }
  });
  it("brand restrictions hold: Muted Sage never passes on light surfaces; Forest Green fails on Graphite", () => {
    for (const bg of [colors.brand.warmWhite, colors.brand.softGreen]) expect(ratio(colors.brand.mutedSage, bg)).toBeLessThan(3);
    expect(ratio(colors.brand.forestGreen, colors.brand.graphite)).toBeLessThan(3);
  });
});

describe("theme tokens", () => {
  for (const t of themes) {
    const th = colors.themes[t];
    const surfaces = [th.background, th.surface, th.surfaceElevated];
    it(`${t}: text, controls and focus ring meet WCAG on every surface`, () => {
      for (const s of surfaces) {
        expect(ratio(th.textPrimary, s)).toBeGreaterThanOrEqual(7);
        expect(ratio(th.textSecondary, s)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(th.textMuted, s)).toBeGreaterThanOrEqual(3);
        expect(ratio(th.borderStrong, s)).toBeGreaterThanOrEqual(3);
        expect(ratio(th.focusRing, s)).toBeGreaterThanOrEqual(3);
        expect(ratio(th.primary, s)).toBeGreaterThanOrEqual(3);
      }
    });
    it(`${t}: labels on primary and secondary buttons meet 4.5:1 in rest, hover and active`, () => {
      for (const k of ["primary", "primaryHover", "primaryActive"] as const) expect(ratio(th.onPrimary, th[k])).toBeGreaterThanOrEqual(4.5);
      for (const k of ["secondary", "secondaryHover", "secondaryActive"] as const) expect(ratio(th.onSecondary, th[k])).toBeGreaterThanOrEqual(4.5);
    });
    it(`${t}: disabled text is visibly weaker than secondary text (exempt from 1.4.3, but not invisible)`, () => {
      const d = ratio(th.disabledText, th.disabledBackground);
      expect(d).toBeLessThan(ratio(th.textSecondary, th.background));
      expect(d).toBeGreaterThanOrEqual(2);
    });
  }
});

describe("semantic status colours", () => {
  for (const t of themes) {
    const th = colors.themes[t];
    for (const [name, r] of Object.entries(roles)) {
      it(`${t} ${name}: label 4.5:1 on its tint and every surface; icon/border 3:1`, () => {
        const s = r[t];
        for (const bg of [s.background, th.background, th.surface, th.surfaceElevated]) {
          expect(ratio(s.foreground, bg)).toBeGreaterThanOrEqual(4.5);
          expect(ratio(s.icon, bg)).toBeGreaterThanOrEqual(3);
          expect(ratio(s.border, bg)).toBeGreaterThanOrEqual(3);
        }
      });
    }
    it(`${t}: every role has its own colours (no two states share a foreground or tint)`, () => {
      const fg = Object.values(roles).map((r) => r[t].foreground), bg = Object.values(roles).map((r) => r[t].background);
      expect(new Set(fg).size).toBe(fg.length);
      expect(new Set(bg).size).toBe(bg.length);
    });
  }
});

describe("state mapping covers SPak's real states", () => {
  const map = colors.stateRoles as Record<string, Record<string, string>>;
  it("every execution, deposit and refund state has a role that exists", () => {
    for (const s of EXECUTION_STATES) expect(roles[map.execution[s]], `execution ${s}`).toBeDefined();
    for (const s of DEPOSIT_STATES) expect(roles[map.deposit[s]], `deposit ${s}`).toBeDefined();
    for (const s of REFUND_STATES) expect(roles[map.refund[s]], `refund ${s}`).toBeDefined();
  });
  it("unknown, delayed and partial never look successful; refunded is distinct from completed", () => {
    expect(map.execution.UNKNOWN).not.toBe("success");
    expect(map.refund.DELAYED).not.toBe("success");
    expect(map.refund.UNKNOWN).not.toBe("success");
    expect(map.refund.PARTIAL).not.toBe("success");
    expect(map.refund.ASSOCIATION_PENDING).not.toBe("refunded");
    expect(map.execution.REFUNDED).not.toBe(map.execution.COMPLETED);
    expect(map.execution.FAILED).toBe("error");
    expect(map.execution.PROCESSING).not.toBe(map.execution.AWAITING_DEPOSIT); // processing vs pending
  });
  it("success is reserved for independently verified outcomes", () => {
    const succ = Object.entries(map).flatMap(([k, m]) => Object.entries(m).filter(([, r]) => r === "success").map(([s]) => `${k}.${s}`));
    expect(succ.sort()).toEqual(["deposit.CONFIRMED", "execution.COMPLETED"]);
  });
});
