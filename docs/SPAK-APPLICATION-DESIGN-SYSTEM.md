# SPak Application Design System

Since Phase 6.7 the application is served at `/app`. The marketing site is at `/` (see SPAK-MARKETING-WEBSITE.md).

Phase 6.6. How the approved brand reaches the running app. The brand itself is defined in SPAK-BRAND-GUIDELINES.md, SPAK-COLOUR-SYSTEM.md, SPAK-TYPOGRAPHY.md and SPAK-LOGO-GUIDELINES.md. This file covers the code.

No colour, font or logo was added in this phase. Every value comes from the approved source files.

## 1. Token integration

One pipeline, no competing systems.

| Source | Holds |
| --- | --- |
| src/design/colors.json | Brand palette, light and dark theme tokens, state roles, contrast data |
| src/design/typography.json | Font families, type roles, fluid and stepped sizes |
| src/design/ui.json | Spacing, radius, layout widths, elevation, motion, focus ring |
| src/design/fonts.ts | next/font loaders for the approved families |

src/design/css.ts turns the JSON into CSS:

- `colorVars(theme)`: `--spak-<theme token>`, `--spak-status-<role>-<part>`, `--spak-brand-*`, shadows.
- `staticVars()`: radius, space, layout, motion, focus and `--spak-font-*` stacks.
- `typeCss()`: one `.type-<role>` class per typography role.
- `tokenCss()`: light on `:root`, dark on `[data-theme=dark]`, and system dark through `prefers-color-scheme` when no theme is set.

src/app/layout.tsx injects `tokenCss()` in `<style id="spak-tokens">`. src/app/globals.css only maps Tailwind names to `var(--spak-*)`. It holds no hex values. A test enforces this.

Tailwind names available to components:

- Colours: bg, surface, elevated, line, line-strong, fg, fg-2, fg-3, primary (hover, active), on-primary, secondary (hover, active), on-secondary, focus, disabled, disabled-fg, disabled-line.
- Fonts: sans, mono, display, editorial.
- Radius: rounded-control (6), rounded-card (12), rounded-panel (14), pill.
- Shadow: shadow-card, shadow-overlay. Dark theme uses no shadows; surfaces separate by tone.

To change a value, edit the JSON. Do not add hex values or new Tailwind colours in components.

## 2. Component architecture

| File | Contents |
| --- | --- |
| src/components/ui.tsx | Card, Panel, SectionTitle, Divider, Button, Field, inputCls, Select, SearchInput, Tabs, Spinner, EmptyState, Tooltip, Modal, Toast, Row, Amount, Mono, ErrorText |
| src/components/status.tsx | StatusBadge, Notice, failureRole, execution, deposit and refund labels |
| src/components/icons.tsx | One 24 px stroke icon set, 1.75 stroke |
| src/components/Logo.tsx | Approved light and dark logo files, symbol option |
| src/components/ThemeToggle.tsx | System, light, dark |

Rules:

- Button: primary, secondary, ghost, danger. Minimum height 44 px. Disabled uses the disabled tokens, never opacity alone.
- Focus: every interactive element shows the focus token outline, 2 px width, 2 px offset.
- Row: label left, value right, wraps on narrow screens.
- Amount: renders the formatted string from `formatUnits` exactly. It only splits number and symbol for styling. No rounding, no abbreviation.
- Mono: addresses, hashes and references. Approval and deposit screens show the full value. Elsewhere a 6+4 middle truncation shows, with the full value in the title and the copy button.
- Modal, Toast, Tooltip and SearchInput are built and token styled. The current flows do not use them yet.

## 3. Theme implementation

- Attribute: `data-theme` on `<html>`, values `light` or `dark`. No attribute means the system setting applies.
- Storage: `localStorage["spak-theme"]`. An inline script in the head applies it before first paint, so there is no flash.
- Toggle order: system, light, dark.
- Tailwind `dark:` variant targets `[data-theme=dark]` and its children.
- Logos: `.logo-light` and `.logo-dark` swap the approved files. No CSS filters recolour the logo.
- Browser chrome: `theme-color` meta for light (#F7F6F0) and dark (#222724), from the tokens.
- Identity: favicon.svg, favicon.ico (16, 32, 48), apple-touch-icon, and a web manifest with 192, 512 and maskable icons. All are the approved files.

## 4. Typography integration

- Fonts load through next/font from fonts.ts and attach as CSS variables on `<html>`.
- Components use `.type-<role>` classes, not ad hoc sizes. Examples: type-app-heading, type-body-sm, type-label, type-nav, type-caption.
- Financial roles (type-amount-display, type-amount-total, type-amount) use tabular numerals and lining figures.
- type-address uses the mono family and breaks long values anywhere, so a full address never overflows.

## 5. Status rules

The mapping comes from `stateRoles` in colors.json. `statusRole(kind, state)` reads it and falls back to warning for an unknown state.

| Role | Meaning | Icon |
| --- | --- | --- |
| success (green) | Destination verified on chain | check |
| refunded (teal) | Refund verified on chain and linked to this transfer | return arrow |
| processing (blue) | Work in progress on the provider or chain | rotating arrow |
| pending (violet) | Waiting, often on the user | clock |
| warning (amber) | Delay, unknown outcome, review | triangle |
| error (red) | Failure | crossed circle |
| neutral | Cancelled, expired, draft | dash |

Hard rules:

- Never colour alone. Every badge and notice carries a text label and an icon.
- Completed shows only for the COMPLETED state, which requires destination verification.
- Refunded shows only for REFUNDED, or a refund record with REFUND_COMPLETED codes. `failureRole` never returns success, and returns refunded only for REFUND_COMPLETED*.
- A pending refund shows violet or blue, never teal.
- The timeline marks finished steps with the brand primary, not the success colour. The current step takes the execution's own role. While SPak waits for the user's deposit, it shows pending (clock), not processing, so nothing suggests funds are moving.
- The REFUNDED notice shows the amount verified and linked to this transfer (`associatedAmount`).

## 6. Responsive behaviour

- Content width: 760 px (layout.contentMax). Shell width: 1120 px.
- Header: 64 px, solid, sticky. No blur.
- Below 768 px: navigation moves to a row under the header. Tabs share the row equally and wrap their label, so all four stay visible.
- Rows wrap label above value on narrow screens. Full addresses break across lines.
- Touch targets: 44 px minimum.
- Checked at 390 x 844, 820 x 1180 and 1280 x 900. No horizontal page scroll at any size.

## 7. Testing

- tests/brand/app-design-system.test.ts: token emission, no hex in CSS or components, dark theme structure, type classes, status mapping against stateRoles, failureRole limits, component rendering, layout and manifest wiring.
- tests/browser/app-branding.check.cjs: Playwright check against a running production build. Run it with `node tests/browser/app-branding.check.cjs http://localhost:3100 <outDir>` (it opens `/app`). It uses a simulated EIP-6963 wallet with a throwaway key, real sign-in, and real NEAR Intents quotes. Failure, refund, unknown and completed screens use browser-only mocked API responses, marked "[mocked]" in the output. No funds move.

## 8. Remaining inconsistencies

- Modal, Toast, Tooltip and SearchInput have no live use yet.
- On phones, "SPak Chat" and "Manual Swap" wrap to two lines in the tab row.
- The chat reply "Understood in N ms" comes from SPak-in. It was left unchanged because this phase must not modify intent interpretation.
- Browser checks cover EVM sign-in only. Solana and NEAR wallet sign-in were not exercised in the browser.
- The wallet signing prompt for a real deposit was not exercised, since that would move funds.
- There is no pixel baseline for visual regression.
