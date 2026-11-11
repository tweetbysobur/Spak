# SPak Typography

Version 1.0. Tokens: `src/design/typography.json`, generated and checked against the real font files by `scripts/brand/build_typography.py`. Font loading: `src/design/fonts.ts`. Tests: `tests/brand/typography.test.ts`.

**Not applied yet.** The app still uses the system font stack. This document and the tokens are the foundation; applying them is a separate task.

## 1. Typefaces

| Family | Role | Loaded | Why |
|---|---|---|---|
| **Sora** | Marketing display and section headings | 600 only | Geometric and confident, and the logo wordmark is drawn from it. One weight keeps the voice consistent |
| **Inter** | Application, navigation, body, every number | Variable (one file, all weights) | Built for screens, with tabular numerals for financial values |
| **JetBrains Mono** | Hashes, addresses, identifiers, code | Variable | Every character the same width; the zero is dotted (3 contours against 2 for O), so hashes are unambiguous |
| **Instrument Serif** | Optional editorial accent | 400 italic only, not preloaded | One emphasised phrase in a marketing headline, at most |

No other typefaces. Sora is never used in the application. Instrument Serif is never used in the application or for numbers (it has no tabular numerals).

## 2. Loading and fallbacks

- `next/font/google` self-hosts the files at build time: no request goes to Google at runtime, and `font-display: swap` is set.
- **Verified in a test build** (in a throwaway copy of the repo; the app itself is unchanged):
  - Only one file is preloaded: Inter Latin, 48 KB.
  - Sora, JetBrains Mono and Instrument Serif are not preloaded. They download when a page uses them.
  - The other-language files (Cyrillic, Greek, Vietnamese) download only if such characters appear.
- **No duplicate downloads:** Inter and JetBrains Mono are variable fonts, so one file covers all weights.
- **Fallbacks:** Next generates size-adjusted local fallback fonts: Inter 107.12%, Sora 113.73%, JetBrains Mono 134.59%, Instrument Serif 83.94%. Layout does not jump when the web font arrives.
- **Font stacks** (in `typography.json`) each end in a generic family:
  - Inter: system UI, then sans-serif.
  - Sora: Inter, then sans-serif.
  - JetBrains Mono: system monospace.
  - Instrument Serif: Georgia, then serif.
- **To apply later:** put `fontVariables` from `src/design/fonts.ts` on `<html>`, and use the CSS variables.

## 3. Responsive approach

- Breakpoints: mobile 0–767 px, tablet 768–1199 px, desktop 1200 px and up. The narrowest supported screen is 320 px.
- Roles that shrink toward mobile also have a `fluid` value: a `clamp()` that equals the mobile size at 360 px and the desktop size at 1280 px. It scales smoothly with no jumps.
- Buttons and navigation get *larger* on mobile (16 px touch targets), so they are `stepped`: they change size at the tablet breakpoint. A `clamp()` cannot express growth toward mobile. The tests caught this: the first version produced an inverted clamp that would have locked desktop buttons at 16 px.
- Headlines use `text-wrap: balance` and paragraphs `text-wrap: pretty`, which avoids orphans and awkward breaks.
- Paragraph widths are capped (`lead` 38rem, `body-marketing` 40rem) at about 65 to 75 characters per line.

## 4. Marketing typography

| Role | Font | Size px (desktop / tablet / mobile) | Line height | Tracking | Notes | Use |
|---|---|---|---|---|---|---|
| `display-xl` | Sora 600 | 72 / 56 / 40 | 1.05 | -0.03em |  | Hero headline, one per page |
| `display-lg` | Sora 600 | 56 / 44 / 34 | 1.08 | -0.025em |  | Large statements, closing CTA band |
| `heading-section` | Sora 600 | 40 / 34 / 28 | 1.12 | -0.02em |  | Marketing section headings |
| `heading-feature` | Sora 600 | 24 / 22 / 20 | 1.25 | -0.01em |  | Feature titles, card titles |
| `lead` | Inter 400 | 20 / 19 / 18 | 1.55 | -0.005em |  | Hero and section supporting paragraphs |
| `body-marketing` | Inter 400 | 18 / 17 / 16 | 1.6 | +0em |  | Feature descriptions, long-form marketing copy |
| `cta` | Inter 600 | 17 / 16 / 16 | 1.2 | +0em |  | Primary marketing buttons |
| `eyebrow` | Inter 600 | 13 / 13 / 12 | 1.3 | +0.08em | uppercase | Short kicker above a section heading; max 4 words |
| `demo-label` | JetBrains Mono 500 | 13 / 13 / 12 | 1.4 | +0em |  | Labels inside product demonstrations (state names, network names) |
| `editorial-accent` | Instrument Serif 400 | — / — / — | inherit | -0.01em | italic | One emphasised phrase inside a display headline; inherits the headline size x sizeAdjust (x-height match) |

How Sora and Inter work together:
- Sora carries the statement: hero, section and feature headings, always weight 600 with tightened tracking.
- Inter carries the explanation: lead text, body, CTAs, eyebrows.
- A heading is never followed by another Sora line. The next line is always Inter.
- **Hero:** `eyebrow` (optional, at most 4 words), then `display-xl`, then `lead`, then CTA buttons (`cta`). The tagline "Intelligent execution across chains." balances to 2 lines on desktop and tablet and 3 on mobile.
- **Section:** `heading-section`, then `body-marketing`. Feature cards use `heading-feature`, then `body-marketing`.
- **Product demonstrations:** state names, network names and labels inside screenshots or animated diagrams use `demo-label` (JetBrains Mono 500), which reads as the product speaking.
- **Instrument Serif (optional):** at most one italic phrase inside a `display-xl` or `display-lg` headline, never a whole line. It is set at the headline size × 1.047 so its x-height matches Sora's (Sora 0.534, Instrument Serif 0.510). Example: "Turn intentions into *verified* actions." Never in the app, in body text, or on numbers.

## 5. Application typography

| Role | Font | Size px (desktop / tablet / mobile) | Line height | Tracking | Notes | Use |
|---|---|---|---|---|---|---|
| `app-title` | Inter 600 | 28 / 26 / 24 | 1.25 | -0.015em |  | Page title |
| `app-heading` | Inter 600 | 20 / 20 / 18 | 1.35 | -0.01em |  | Card and panel headings |
| `app-subheading` | Inter 600 | 16 / 16 / 16 | 1.4 | +0em |  | Group headings inside cards |
| `body` | Inter 400 | 16 / 16 / 16 | 1.55 | +0em |  | Default application text; 16 px everywhere (no iOS input zoom) |
| `body-sm` | Inter 400 | 14 / 14 / 14 | 1.5 | +0em |  | Secondary text, descriptions (textSecondary colour) |
| `caption` | Inter 400 | 12 / 12 / 12 | 1.45 | +0.005em |  | Timestamps, footnotes; never for essential information alone |
| `label` | Inter 500 | 13 / 13 / 13 | 1.35 | +0.005em |  | Form labels, key in key/value rows |
| `button` | Inter 600 | 15 / 15 / 16 | 1.2 | +0em | stepped | Buttons (16 px on mobile) |
| `button-sm` | Inter 600 | 13 / 13 / 14 | 1.2 | +0.005em | stepped | Compact buttons |
| `nav` | Inter 500 | 14 / 14 / 16 | 1.3 | +0em | stepped | Navigation items (16 px on mobile menus) |
| `status` | Inter 600 | 13 / 13 / 13 | 1.2 | +0.01em |  | Execution, deposit and refund status labels; colour from colors.json semanticRoles; never uppercase |
| `error-title` | Inter 600 | 15 / 15 / 15 | 1.4 | +0em |  | First line of an error: what happened |
| `error-body` | Inter 400 | 14 / 14 / 14 | 1.5 | +0em |  | What to do next |

### Financial values

| Role | Font | Size px (desktop / tablet / mobile) | Line height | Tracking | Notes | Use |
|---|---|---|---|---|---|---|
| `amount-display` | Inter 600 | 36 / 34 / 30 | 1.1 | -0.02em | tabular | Wallet balance, hero amount on review screen |
| `amount-total` | Inter 600 | 18 / 18 / 18 | 1.3 | -0.005em | tabular | Total cost, amount to receive (approval summary) |
| `amount` | Inter 500 | 16 / 16 / 16 | 1.4 | +0em | tabular | Transaction amounts in rows and tables; right-aligned in columns |
| `amount-fee` | Inter 400 | 14 / 14 / 14 | 1.4 | +0em | tabular | Network and protocol fees; textSecondary colour |
| `token-symbol` | Inter 500 | inherit / inherit / inherit | inherit | +0.02em |  | Ticker after an amount (USDC, SOL): same size as the amount, textSecondary colour, never uppercase-transformed |

Rules:
- **Tabular numerals** (`font-variant-numeric: tabular-nums`) on every amount, balance, fee and total, so digits line up in columns and values don't shift while they update.
- **Alignment:** amounts are right-aligned in lists and tables, and the token symbol follows the amount: `1,250.00 USDC`. The amount uses its role colour, the symbol `textSecondary` at the same size.
- **Wallet balance:** `amount-display`, with the token symbol on the same line.
- **Transaction amounts:** `amount` (Inter 500 16). In a review, the "You send" and "You receive" values use `amount-total`.
- **Network fees:** `amount-fee`, in `textSecondary` colour, always labelled ("Network fee"), never in a status colour.
- **Total:** `amount-total`, separated from the line items by a rule. It is the heaviest value in the summary.
- **Token symbols:** shown exactly as provided (USDC, SOL, wNEAR). Never CSS-uppercased, because some symbols are mixed case.
- **Never** shorten amounts in approval or review screens (no "1.2K"). Show the precision the quote gives.
- **Formatting** stays where it is (`formatUnits` and friends). Typography never rounds or changes a value.

### Identifiers

| Role | Font | Size px (desktop / tablet / mobile) | Line height | Tracking | Notes | Use |
|---|---|---|---|---|---|---|
| `address` | JetBrains Mono 400 | 13 / 13 / 13 | 1.5 | +0em | truncate middle 6+4 | Recipient and wallet addresses |
| `hash` | JetBrains Mono 400 | 13 / 13 / 13 | 1.5 | +0em | truncate middle 6+4 | Transaction hashes and explorer references |
| `identifier` | JetBrains Mono 400 | 12 / 12 / 12 | 1.45 | +0em |  | Execution, quote and deposit IDs, plan hashes |

- **Recipient addresses and transaction hashes:**
  - In rows, lists and status lines: middle truncation, first 6 and last 4 characters (`0x1a2b3c…9f8e`, 101 px at 13 px), with the full value in a tooltip or `title` and a copy button.
  - Where the user must verify the value (approval summary, recipient confirmation): show it in full with `overflow-wrap: anywhere`, so it wraps inside its box and never overflows.
  - Full EVM hash: 515 px. Solana signature: 686 px. EVM address: 328 px. All wider than a 288 px mobile column, so they must wrap or truncate.
- **IDs** (execution, quote, deposit): `identifier`, full length, selectable.

### Status, errors and approval summaries

- **Status labels:** `status` (Inter 600 13), in the semantic colours from `colors.json`. Always the word itself ("Verifying delivery"), never uppercase, never colour alone.
- **Errors:** `error-title` says what happened ("Deposit not found on Base"), then `error-body` says what to do. Never raw error codes or stack text. Codes may appear in an `identifier` line for support.
- **Approval summary:** key/value rows.
  - Keys use `label` in `textSecondary`. Values use `amount` (numbers) or `body` (text), right-aligned.
  - Addresses are shown in full.
  - The total uses `amount-total`.
  - The "minimum you receive" row is never smaller than the expected amount row.

## 6. Developer typography

{H}
| `code-inline` | JetBrains Mono 400 | 0.9em / 0.9em / 0.9em | inherit | +0em |  | Inline code in prose |
| `code-block` | JetBrains Mono 400 | 14 / 14 / 13 | 1.6 | +0em |  | Code samples and API examples; scroll, do not wrap |
| `api-endpoint` | JetBrains Mono 500 | 14 / 14 / 13 | 1.5 | +0em |  | HTTP method + path in API references |

- **Code blocks:**
  - Never wrap (`white-space: pre`). They scroll horizontally.
  - Tab size 2, ligatures off, so `!=` and `=>` show as typed.
  - Line height 1.6, 14 px on desktop and 13 px on mobile.
- **Copy button:**
  - Top-right corner of the block, outside the scrolling area, so it never covers code.
  - At least 32 × 32 px, with the label "Copy" (or an icon with an accessible name), changing to "Copied" for 2 seconds.
  - It copies the raw text, with no line numbers or prompt characters.
- **Inline code:** `code-inline`, 0.9em of the surrounding text, on the surface colour.
- **Contract addresses, hashes and IDs in documentation:** shown in full with `overflow-wrap: anywhere`, plus a copy button.
- **API endpoints:** `api-endpoint`. The method and path stay on one line where possible, and break only inside the path.

## 7. Examples

**Correct**
- An amount row: `Inter 500 16 tabular` `1,250.00` + `USDC` in `textSecondary`, right-aligned.
- A hash in a list: `0x1a2b3c…9f8e` in JetBrains Mono 13 with a copy button; the full value on hover.
- A marketing hero: Sora 600 72 px "Intelligent execution across chains.", with Inter 20 px lead text below.
- A status: "Refund in progress" in Inter 600 13, in the processing colour, with an icon.

**Incorrect**
- Proportional numerals in a balance list: the digits jitter and columns don't line up.
- A transaction hash in Inter: 0 and O, and l and 1, become ambiguous.
- Sora in application forms or tables.
- Instrument Serif for a whole headline, or for any number.
- Uppercase status labels ("VERIFYING DELIVERY").
- Wrapping code blocks, or a copy button floating over the code.

## 8. Validation (generated from the real font files)

| Check | Result | Detail |
|---|---|---|
| display-xl: longest word fits a 320px screen | PASS | "infrastructure" 269px at 40px vs 288px available |
| display-lg: longest word fits a 320px screen | PASS | "infrastructure" 231px at 34px vs 288px available |
| heading-section: longest word fits a 320px screen | PASS | "infrastructure" 192px at 28px vs 288px available |
| display-xl tagline on desktop | PASS | 1233px in 1200px: about 2 line(s); text-wrap: balance evens them |
| display-xl tagline on tablet | PASS | 959px in 720px: about 2 line(s); text-wrap: balance evens them |
| display-xl tagline on mobile | PASS | 685px in 328px: about 3 line(s); text-wrap: balance evens them |
| Inter has tnum (financial roles) | PASS | features: calt ccmp dnom frac locl numr pnum tnum |
| Sora has tnum (numbers in display copy) | PASS | features: ccmp dnom frac liga locl numr tnum |
| Instrument Serif has no tnum, so it is never used for numbers | PASS | rule enforced in tokens |
| Inter tabular digits share one width | PASS | 51 tabular glyphs |
| JetBrains Mono: every character the same width | PASS | hashes and addresses align in columns |
| JetBrains Mono zero is marked (distinct from O) | PASS | 0: 3 contours, O: 2 |
| EVM tx hash at 13px | PASS | 66 chars = 515px full; wraps (overflow-wrap:anywhere) or truncates on mobile |
| Solana signature at 13px | PASS | 88 chars = 686px full; wraps (overflow-wrap:anywhere) or truncates on mobile |
| EVM address at 13px | PASS | 42 chars = 328px full; wraps (overflow-wrap:anywhere) or truncates on mobile |
| NEAR account at 13px | PASS | 14 chars = 109px full; fits on one line on mobile |
| Truncated hash (6+4) fits a mobile row | PASS | 101px |
| Body text is at least 16px on every breakpoint | PASS | prevents iOS input zoom; WCAG 1.4.4 resize friendly |
| No text role below 12px | PASS | caption floor 12px |
| Paragraph roles have line height >= 1.5 | PASS | WCAG 1.4.8 recommendation for blocks of text |
| Mono x-height vs Inter (optical size match) | PASS | JetBrains Mono 0.550 vs Inter 0.546: 13px mono next to 14px Inter sit close (7.2 vs 7.6px x-height) |
| Editorial accent x-height match | PASS | Sora 0.534, Instrument Serif 0.510 x 1.047 |

Automated tests (`tests/brand/typography.test.ts`, 16 tests) check:
- the approved families, fallback stacks, and that the loader matches the tokens;
- that the loader is not wired into the app yet;
- a strictly decreasing display hierarchy, and that no size grows toward mobile except touch targets, which are stepped;
- that each `clamp()` hits the right size at 360 px and 1280 px;
- the 16 px body, the 12 px floor and paragraph line heights of at least 1.5;
- tabular numerals on every amount, mono with wrapping and truncation on identifiers, and non-wrapping code blocks;
- that Sora and Instrument Serif are marketing-only, and that status labels are never uppercase.

## 9. Limitations

- Not applied to the app. The current UI still uses the system stack and Tailwind's default mono.
- Google's Inter build lacks the slashed-zero and alternate-character features, so zeros in Inter text are plain. That is why identifiers use JetBrains Mono.
- Text widths were measured from glyph advances without kerning, accurate to about ±2%. "infrastructure" at the mobile hero size uses 269 of 288 px, the tightest fit.
- Line counts in the real browser depend on the final container widths, which are not designed yet.
- Readers using browser text spacing overrides (WCAG 1.4.12) were not tested in a browser.
