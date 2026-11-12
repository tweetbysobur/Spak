/**
 * Turns the approved token files into CSS. The token files stay the single source of truth:
 * no colour, font size or radius is written anywhere else. Used by src/app/layout.tsx at render time.
 */
import colors from "./colors.json";
import typography from "./typography.json";
import ui from "./ui.json";

type Theme = "light" | "dark";
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const px = (n: number) => `${n / 16}rem`;

/** Semantic colour variables for one theme: --spak-<token> and --spak-status-<role>-<part>. */
export function colorVars(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(colors.themes[theme])) out[`--spak-${kebab(k)}`] = v;
  for (const [role, r] of Object.entries(colors.semantic)) for (const [part, v] of Object.entries(r[theme])) out[`--spak-status-${role}-${part}`] = v;
  for (const [k, v] of Object.entries(colors.brand)) out[`--spak-brand-${kebab(k)}`] = v;
  out["--spak-art-band-tone"] = colors.art.bandTone.hex;
  const e = ui.elevation[theme];
  out["--spak-shadow-card"] = e.card; out["--spak-shadow-overlay"] = e.overlay;
  return out;
}

export function staticVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ui.radius)) out[`--spak-radius-${k}`] = v >= 999 ? "999px" : px(v);
  for (const [k, v] of Object.entries(ui.space)) out[`--spak-space-${k}`] = px(v);
  for (const [k, v] of Object.entries(ui.layout)) out[`--spak-${kebab(k)}`] = px(v);
  out["--spak-motion-fast"] = ui.motion.fast; out["--spak-motion-base"] = ui.motion.base; out["--spak-ease"] = ui.motion.easing;
  out["--spak-focus-width"] = `${ui.focus.width}px`; out["--spak-focus-offset"] = `${ui.focus.offset}px`;
  for (const [k, f] of Object.entries(typography.families)) out[`--spak-font-${k}`] = f.stack;
  return out;
}

const block = (sel: string, vars: Record<string, string>) => `${sel}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;

type Role = { family: string; weight: number; size: Record<"desktop" | "tablet" | "mobile", number | string | null>; lineHeight: number | null; letterSpacing: number; fluid?: string; responsive?: string } & Record<string, unknown>;
const EXTRA: Record<string, string> = {
  fontVariantNumeric: "font-variant-numeric", fontFeatureSettings: "font-feature-settings", textTransform: "text-transform", fontStyle: "font-style",
  overflowWrap: "overflow-wrap", whiteSpace: "white-space", overflowX: "overflow-x", tabSize: "tab-size", fontVariantLigatures: "font-variant-ligatures", textWrap: "text-wrap", maxWidth: "max-width",
};
const size = (v: number | string | null) => (typeof v === "number" ? px(v) : v === "inherit" ? "inherit" : v);

/** One .type-<role> class per typography role, with mobile-first steps at the tablet and desktop breakpoints. */
export function typeCss(): string {
  const roles = typography.roles as Record<string, Role>;
  const base: string[] = [], tablet: string[] = [], desktop: string[] = [];
  for (const [name, r] of Object.entries(roles)) {
    const decl: string[] = [`font-family:var(--spak-font-${r.family})`, `font-weight:${r.weight}`, `letter-spacing:${r.letterSpacing}em`];
    if (r.lineHeight !== null) decl.push(`line-height:${r.lineHeight}`);
    for (const [k, css] of Object.entries(EXTRA)) if (r[k] !== undefined) decl.push(`${css}:${r[k]}`);
    if (r.sizeAdjust) decl.push(`font-size:${r.sizeAdjust}em`);
    else if (r.fluid?.startsWith("clamp")) decl.push(`font-size:${r.fluid}`);
    else if (r.size.mobile !== null) {
      decl.push(`font-size:${size(r.size.mobile)}`);
      if (r.size.tablet !== r.size.mobile) tablet.push(`.type-${name}{font-size:${size(r.size.tablet)}}`);
      if (r.size.desktop !== r.size.tablet) desktop.push(`.type-${name}{font-size:${size(r.size.desktop)}}`);
    }
    base.push(`.type-${name}{${decl.join(";")}}`);
  }
  return base.join("") + `@media (min-width:768px){${tablet.join("")}}@media (min-width:1200px){${desktop.join("")}}`;
}

/**
 * Complete token stylesheet. Light is the default; dark applies with [data-theme=dark], and follows the system
 * setting when no explicit choice was made (no data-theme, e.g. before the theme script runs or without JavaScript).
 */
export function tokenCss(): string {
  return [
    block(":root", { ...staticVars(), ...colorVars("light") }),
    block("[data-theme=dark]", colorVars("dark")),
    `@media (prefers-color-scheme:dark){${block(":root:not([data-theme])", colorVars("dark"))}}`,
    typeCss(),
  ].join("\n");
}

/** Status role for any execution, deposit or refund state, from the approved mapping. Unknown states are warnings. */
export type StatusRole = keyof typeof colors.semantic;
export function statusRole(kind: "execution" | "deposit" | "refund", state: string): StatusRole {
  const m = (colors.stateRoles as Record<string, Record<string, string>>)[kind];
  return (m[state] as StatusRole) ?? "warning";
}

/** Browser chrome colour per scheme, from the tokens. */
export const themeColor = { light: colors.themes.light.background, dark: colors.themes.dark.background };
