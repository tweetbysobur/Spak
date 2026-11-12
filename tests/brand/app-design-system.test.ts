/** Application design system (Phase 6.6): token integration, status mapping and component rendering. */
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import colors from "@/design/colors.json";
import typography from "@/design/typography.json";
import { colorVars, statusRole, tokenCss, typeCss } from "@/design/css";
import { StatusBadge, failureRole, EXECUTION_LABEL, DEPOSIT_LABEL, REFUND_LABEL, Notice } from "@/components/status";
import { Amount, Mono, middle } from "@/components/ui";
import { EXECUTION_STATES } from "@/execution/state";
import { DEPOSIT_STATES } from "@/deposits/types";
import { REFUND_STATES } from "@/failures/records";

const css = tokenCss();
const globals = readFileSync("src/app/globals.css", "utf8");

describe("tokens come from the approved files only", () => {
  it("every light and dark theme token and every status colour is emitted, unchanged", () => {
    for (const t of ["light", "dark"] as const) {
      const vars = colorVars(t);
      for (const v of Object.values(colors.themes[t])) expect(Object.values(vars)).toContain(v);
      for (const r of Object.values(colors.semantic)) for (const v of Object.values(r[t])) expect(css).toContain(v);
      expect(vars["--spak-background"]).toBe(colors.themes[t].background);
    }
  });
  it("globals.css defines no colour values; every variable it references is generated", () => {
    expect(globals).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    const used = [...globals.matchAll(/var\((--spak-[a-z0-9-]+)\)/g)].map((m) => m[1]);
    for (const v of new Set(used)) expect(css, v).toContain(`${v}:`);
  });
  it("components use no hard-coded colours or old palette classes", () => {
    for (const f of ["ui", "status", "Review", "DepositPanel", "Tracker", "RecoveryPanel", "Chat", "Manual", "History", "WalletsPanel", "WalletPicker", "ThemeToggle", "Logo", "icons"]) {
      const src = readFileSync(`src/components/${f}.tsx`, "utf8");
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{6}\b|(?:emerald|sky|amber|violet|red)-\d00|white\/\d|black\/\d/);
    }
  });
  it("dark theme follows the system when no choice is saved, and an explicit choice wins", () => {
    expect(css).toContain("[data-theme=dark]{");
    expect(css).toMatch(/@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme\]\)\{/);
  });
  it("one .type-<role> class per typography role; financial roles keep tabular numerals", () => {
    const t = typeCss();
    for (const r of Object.keys(typography.roles)) expect(t).toContain(`.type-${r}{`);
    for (const r of ["amount", "amount-total", "amount-display", "amount-fee"]) expect(t).toMatch(new RegExp(`\\.type-${r}\\{[^}]*font-variant-numeric:tabular-nums`));
    expect(t).toMatch(/\.type-hash\{[^}]*overflow-wrap:anywhere/);
  });
});

describe("status mapping", () => {
  it("matches the approved stateRoles for every real state, with a label for each", () => {
    for (const s of EXECUTION_STATES) { expect(statusRole("execution", s)).toBe((colors.stateRoles.execution as Record<string, string>)[s]); expect(EXECUTION_LABEL[s]).toBeTruthy(); }
    for (const s of DEPOSIT_STATES) { expect(statusRole("deposit", s)).toBe((colors.stateRoles.deposit as Record<string, string>)[s]); expect(DEPOSIT_LABEL[s]).toBeTruthy(); }
    for (const s of REFUND_STATES) { expect(statusRole("refund", s)).toBe((colors.stateRoles.refund as Record<string, string>)[s]); expect(REFUND_LABEL[s]).toBeTruthy(); }
    expect(statusRole("execution", "SOMETHING_NEW")).toBe("warning"); // unknown states never look successful
  });
  it("the core colour meanings hold", () => {
    expect(statusRole("execution", "COMPLETED")).toBe("success");
    expect(statusRole("execution", "REFUNDED")).toBe("refunded");
    expect(statusRole("execution", "VERIFYING_DESTINATION")).toBe("processing");
    expect(statusRole("execution", "AWAITING_DEPOSIT")).toBe("pending");
    expect(statusRole("execution", "UNKNOWN")).toBe("warning");
    expect(statusRole("execution", "FAILED")).toBe("error");
    expect(statusRole("execution", "CANCELLED")).toBe("neutral");
  });
  it("failure classifications: refunded only for completed refunds, never success, unknown codes are warnings", () => {
    const codes = [...readFileSync("src/failures/classify.ts", "utf8").matchAll(/c\("[A-Z_]+", "([A-Z_]+)"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(30);
    for (const code of codes) for (const temp of [true, false]) {
      const r = failureRole(code, temp);
      expect(r, code).not.toBe("success");
      if (r === "refunded") expect(code).toMatch(/^REFUND_COMPLETED/);
    }
    expect(failureRole("REFUND_RECONCILIATION_DISCREPANCY", false)).toBe("warning");
    expect(failureRole("NEW_CODE", true)).toBe("warning");
    expect(failureRole("NEW_CODE", false)).toBe("error");
  });
});

describe("components", () => {
  it("a status badge always carries words, an icon and its role; never colour alone", () => {
    const html = renderToStaticMarkup(h(StatusBadge, { state: "REFUNDED" }));
    expect(html).toContain("Refunded");
    expect(html).toContain("<svg");
    expect(html).toContain('data-status-role="refunded"');
    expect(html).toContain("var(--spak-status-refunded-foreground)");
    expect(renderToStaticMarkup(h(StatusBadge, { kind: "refund", state: "ASSOCIATION_PENDING" }))).toContain('data-status-role="pending"');
  });
  it("amounts render exactly as formatted, with the symbol separate and tabular numerals", () => {
    const html = renderToStaticMarkup(h(Amount, { value: "1234567.000001 USDC", size: "amount-total" }));
    expect(html).toContain("1234567.000001");
    expect(html).toContain(">USDC<");
    expect(html).toContain("type-amount-total");
    expect(renderToStaticMarkup(h(Amount, { value: "?" }))).toContain("?");
  });
  it("addresses and hashes: middle truncation 6+4 by default, full on review, full value always in the title", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect(middle(hash)).toBe(`${hash.slice(0, 6)}…${hash.slice(-4)}`);
    const short = renderToStaticMarkup(h(Mono, { value: hash }));
    expect(short).toContain(`title="${hash}"`);
    expect(short).toContain("…");
    const full = renderToStaticMarkup(h(Mono, { value: hash, full: true }));
    expect(full).toContain(`>${hash}<`);
    expect(full).toContain("type-address");
  });
  it("notices announce errors as alerts and other states as status", () => {
    expect(renderToStaticMarkup(h(Notice, { role: "error", title: "Failed" }))).toContain('role="alert"');
    expect(renderToStaticMarkup(h(Notice, { role: "processing", title: "Working" }))).toContain('role="status"');
  });
  it("layout wires the brand: fonts, tokens, favicon, apple icon, theme colour, manifest", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    for (const s of ["fontVariables", "tokenCss()", "/brand/icons/favicon.svg", "/brand/icons/apple-touch-icon.png", "themeColor"]) expect(layout).toContain(s);
    expect(readFileSync("src/app/favicon.ico")).toEqual(readFileSync("public/brand/icons/favicon.ico"));
    expect(readFileSync("src/app/manifest.ts", "utf8")).toContain("/brand/icons/icon-512.png");
  });
});
