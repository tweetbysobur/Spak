# SPak Brand Guidelines

Version 1.0 · Authoritative. If this document and another one disagree, this document wins; then fix the other one.

| Topic | Detailed source | Tokens and assets |
|---|---|---|
| Logo | `docs/SPAK-LOGO-GUIDELINES.md` | `public/brand/logo/`, `public/brand/icons/` |
| Colour | `docs/SPAK-COLOUR-SYSTEM.md` | `src/design/colors.json` |
| Typography | `docs/SPAK-TYPOGRAPHY.md` | `src/design/typography.json`, `src/design/fonts.ts` |
| Asset inventory | `docs/SPAK-BRAND-ASSETS.md` | `public/brand/manifest.json` |
| Visual reference | This document, section 9 | `public/brand/board/spak-brand-board.html`, `public/brand/previews/spak-brand-board.png` |

Status: the identity is defined and its assets are produced. It is **not yet applied** to the application. The app still uses its earlier dark UI and system fonts.

---

## 1. Brand foundation

### Positioning

SPak is intelligent execution infrastructure. It translates what people intend into controlled, verifiable blockchain actions across supported networks, built on NEAR and executed through NEAR Intents.

Infrastructure first; intelligence is its defining capability.

### Vision

Make interacting with multiple blockchain networks as simple as stating an intention.

### Mission

Remove unnecessary complexity in cross-chain interactions, through intent interpretation, unified execution and accessible infrastructure.

### Audiences

| Audience | Who | What they need from the brand |
|---|---|---|
| Individual users | Multi-chain wallet users, DeFi participants, traders, people who want simple transfers | Calm confidence. Exact amounts. Honest status. No hype |
| Developers and projects | Wallet providers, DeFi protocols, payment apps, Web3 startups | Technical clarity: precise docs, stable references, readable code |
| Partners and ecosystem | NEAR ecosystem, liquidity and infrastructure partners | Credibility: a considered, consistent, professional identity |

### Personality

| Trait | Means | Does not mean |
|---|---|---|
| Intelligent | Understands intent, explains plainly | Clever wordplay, jargon |
| Precise | Exact numbers, exact states, exact references | Cold or bureaucratic |
| Trustworthy | Says what is verified and what is not | Overpromising, "guaranteed" |
| Connected | Moves value across ecosystems | Network logos as decoration |
| Forward-thinking | Built for evolving financial infrastructure | Futuristic clichés: glow, neon, chrome |

Overall: premium, intelligent, confident, technical and approachable.

### Value proposition

You state what you want. SPak understands it, plans it, gets a firm quote for you to approve, and verifies the deposit and the delivery on chain.

### Messaging

- **Tagline:** Intelligent execution across chains.
- **Supporting statement:** Turn intentions into verified actions across blockchain networks.
- **Proof points** (true of the product today):
  - Natural-language intents become validated plans.
  - You approve the firm quote before anything moves.
  - Deposits and deliveries are verified on chain.
  - Refunds are never reported as complete unless verified.
- **Voice:** plain, short sentences. Active voice. Say what happened, then what to do.

Honesty rules, which apply to every channel:

- Do not claim autonomous or unattended execution. Autonomous execution is not enabled; SPak always needs the user's approval.
- Do not say "instant", "guaranteed", "risk-free" or "zero fees". Quotes have deadlines, slippage and fees.
- Call a transfer complete only when it is: delivery verified on the destination chain.
- Never show a refund as returned until it is verified and associated (see `docs/SPAK-FAILURE-REFUNDS.md`).
- Name NEAR Intents as the execution layer where relevant. Do not imply SPak runs its own bridge.

---

## 2. Logo system

The symbol is an abstract S: two interlocking directional forms with a concave leaf between them, whose tip meets the lower form. Movement in two directions, coordinated through one precise point.

The vector was rebuilt from the approved reference (`public/brand/references/spak-symbol-reference.png`) at 99.58% overlap. Details: `docs/SPAK-LOGO-GUIDELINES.md`.

### Versions

| Version | File | Use |
|---|---|---|
| Primary (horizontal) | `public/brand/logo/spak-logo-horizontal.svg` | Default on light surfaces |
| Primary, dark | `public/brand/logo/spak-logo-horizontal-dark.svg` | Graphite and other dark surfaces |
| Stacked | `public/brand/logo/spak-logo-stacked.svg`, `public/brand/logo/spak-logo-stacked-dark.svg` | Square or tall spaces |
| Symbol | `public/brand/logo/spak-symbol.svg` | Where the brand is already named, avatars, small spaces |
| Symbol, small sizes | `public/brand/logo/spak-symbol-small.svg` | 16–24 px only (no leaf) |
| Wordmark | `public/brand/logo/spak-wordmark.svg` (+ `-green`, `-dark`, `-mono-black`) | Text-led placements, co-branding lists |
| Mono | `public/brand/logo/spak-logo-horizontal-mono-graphite.svg`, `-mono-black.svg`, `-mono-white.svg` | Single-colour reproduction, photos |
| App icon | `public/brand/icons/spak-app-icon.svg`, `public/brand/icons/spak-app-icon-square.svg` | App stores, home screens, avatars |
| Favicon | `public/brand/icons/favicon.svg`, `public/brand/icons/favicon.ico`, `public/brand/icons/favicon-full.svg` | Browsers |

### Construction

- Symbol aspect ratio: 1.136 : 1 (width : height).
- Wordmark: Sora SemiBold outlined. Cap height = 0.45 × symbol height, centred on the symbol's vertical centre.
- Gap between symbol and wordmark: 0.30 × symbol height.
- Tracking -20/1000 em. Kerning S–P -6, P–a -38, a–k -4.
- Always "SPak", with capital S and P.

### Colour versions

| Surface | Symbol | Wordmark |
|---|---|---|
| Warm White #F7F6F0 or Soft Green #E8EFE9 | Forest Green #174734 | Graphite #222724 |
| Graphite #222724 | Muted Sage #A7B7A9 | Warm White #F7F6F0 |
| Forest Green #174734 | Warm White | Warm White |
| Photography | Mono white or mono graphite on a calm area, or on a solid tile | Same |

### Clear space and minimum size

- Clear space on all sides: 0.25 × symbol height.
- Minimum sizes:
  - Horizontal logo: 96 px wide on screen, 25 mm in print.
  - Symbol with the leaf: 24 px tall. Below that, use `spak-symbol-small.svg`.
  - Wordmark: 64 px wide.

### Incorrect use

Never:

- Stretch, skew, rotate or mirror the logo.
- Recolour it outside the table above, or apply gradients, glows, shadows, outlines or 3D effects.
- Place it on low-contrast or busy backgrounds. Never Forest Green on Graphite (1.44:1).
- Rearrange the lockup, change the wordmark's font, spacing or case, or retype it as live text.
- Separate the leaf from the symbol, except in the official small-size version.
- Trace or rebuild it from the PNG reference. Always use the SVG files.
- Surround it with nodes, globes, chains or other generic Web3 motifs.

The board (section 9) shows six of these.

---

## 3. Colour system

### Brand palette

| Name | Hex | Role |
|---|---|---|
| Forest Green | #174734 | Primary brand colour. Light-theme primary actions. The logo |
| Warm White | #F7F6F0 | Main background. Text on dark |
| Graphite | #222724 | Primary text. Dark-theme background |
| Muted Sage | #A7B7A9 | Decoration on light surfaces. Accent on dark surfaces |
| Soft Green | #E8EFE9 | Secondary surfaces, secondary buttons |

Proportion on marketing pages: about 70% Warm White, 15% Graphite text, 10% Forest Green, 5% sage and soft green. Green earns attention because it is scarce.

### Secondary (derived) colours

| Name | Hex | Use | Contrast |
|---|---|---|---|
| Deep Sage | #5A6D5C | Secondary text on light | 5.14:1 on Warm White, 4.75:1 on Soft Green |
| Mid Sage | #708974 | Large text, secondary icons, control borders on light | 3.51:1 on Warm White |
| Light Forest | #9CD7BF | Dark-theme primary actions and focus ring | 9.31:1 with a Graphite label |
| Dark Sage | #99AC9B | Secondary text on dark | 6.31:1 on Graphite |

### Semantic status colours

Values are text / tint / border and icon, for the light and dark themes.

| Role | Used for | Light | Dark |
|---|---|---|---|
| success | Completed, verified delivery, confirmed deposit | #227647 / #E9F9F0 / #2B9459 | #37BD71 / #1E3E2C / #2D9B5C |
| refunded | Refund verified on chain: funds returned, the transfer did not complete | #24727B / #E9F7F9 / #2D8F9A | #39B7C5 / #1E3B3E / #2F96A1 |
| error | Failed, rejected, invalid, verification failed | #C33025 / #F9EAE9 / #DD564D | #E88F88 / #3E201E / #DF6057 |
| warning | Expiring, limits, delayed, unknown outcome, needs attention | #925C0C / #F9F3E9 / #B7740F | #EA9413 / #3E311E / #BF790F |
| pending | Awaiting approval, deposit, external confirmation, manual review | #7F52B1 / #F1ECF6 / #9672C0 | #B69CD3 / #2D1E3E / #9C7AC3 |
| processing | Submitting, cross-chain execution, destination verification, refunding | #2168BA / #E9F0F9 / #3884DC | #76ABE7 / #1E2D3E / #428BDE |
| info | Notices, network information, explanations | #59688B / #EEF0F4 / #7382A6 | #9CA7C0 / #242A38 / #7A89AA |
| neutral | Cancelled, expired before deposit, draft | #5F6B63 / #F0F2F1 / #77867C | #9FAAA2 / #2B312D / #7D8C82 |

State mapping: every execution, deposit and refund state in the code has a role (`stateRoles` in `src/design/colors.json`). The rules are tested:

- Success is reserved for verified outcomes: COMPLETED, and a deposit CONFIRMED on chain.
- Refunded is never shown as success.
- UNKNOWN, delayed and partial are warning. They never look successful.

### Themes

- **Light theme:**
  - Surfaces: Warm White page, Soft Green secondary, white elevated cards.
  - Text: Graphite primary, Deep Sage secondary.
  - Primary action: Forest Green with a Warm White label. Hover #133A2B, active #0F2F22.
- **Dark theme:** not an inversion.
  - Surfaces: Graphite page, #2B312D and #343B37 for elevation.
  - Text: Warm White primary, Dark Sage secondary.
  - Primary action: Light Forest with a Graphite label.

Every token is in `src/design/colors.json`.

### Accessibility requirements

- WCAG 2.x: text at least 4.5:1, large text at least 3:1, meaningful graphics and control boundaries at least 3:1.
- All 192 intended pairings are checked; see `docs/SPAK-COLOUR-SYSTEM.md`.
- Every status shows a word, plus an icon wherever space allows. Never colour alone.
- Focus ring: 2 px wide, with a 2 px gap in the page background colour (light 9.03:1 or better, dark 7.05:1 or better).

### Approved and prohibited combinations

| Approved | Prohibited |
|---|---|
| Graphite on Warm White (14.02:1), on Soft Green (12.98:1) | Muted Sage text or icons on Warm White (1.94:1) or Soft Green (1.80:1) |
| Forest Green on Warm White (9.76:1) | Forest Green on Graphite (1.44:1) |
| Warm White on Forest Green (9.76:1) | A focus ring touching the primary button with no gap (1.00:1) |
| Muted Sage on Graphite (7.22:1) or Forest Green (5.03:1) | Status shown by colour alone |
| Deep Sage on any light surface | The hairline `border` token for inputs or anything users must perceive |

---

## 4. Typography

| Family | Job | Weights |
|---|---|---|
| **Sora** | Marketing display and section headings only | 600 |
| **Inter** | Application, navigation, body, every number | Variable |
| **JetBrains Mono** | Hashes, addresses, identifiers, code, product-demo labels | Variable |
| **Instrument Serif** | Optional: one italic phrase in a marketing headline | 400 italic |

No other typefaces without a decision under section 8.

### Hierarchy

Sizes in px, for desktop / tablet / mobile. Full table in `docs/SPAK-TYPOGRAPHY.md`.

| Role | Font | Size | Line height | Tracking |
|---|---|---|---|---|
| display-xl (hero) | Sora 600 | 72 / 56 / 40 | 1.05 | -0.03em |
| display-lg | Sora 600 | 56 / 44 / 34 | 1.08 | -0.025em |
| heading-section | Sora 600 | 40 / 34 / 28 | 1.12 | -0.02em |
| heading-feature | Sora 600 | 24 / 22 / 20 | 1.25 | -0.01em |
| lead | Inter 400 | 20 / 19 / 18 | 1.55 | -0.005em |
| app-title | Inter 600 | 28 / 26 / 24 | 1.25 | -0.015em |
| app-heading | Inter 600 | 20 / 20 / 18 | 1.35 | -0.01em |
| body | Inter 400 | 16 / 16 / 16 | 1.55 | 0 |
| body-sm | Inter 400 | 14 / 14 / 14 | 1.5 | 0 |
| label | Inter 500 | 13 / 13 / 13 | 1.35 | 0.005em |
| caption | Inter 400 | 12 / 12 / 12 | 1.45 | 0.005em |
| button | Inter 600 | 15 / 15 / 16 | 1.2 | 0 |
| nav | Inter 500 | 14 / 14 / 16 | 1.3 | 0 |
| status | Inter 600 | 13 / 13 / 13 | 1.2 | 0.01em |
| hash / address | JetBrains Mono 400 | 13 / 13 / 13 | 1.5 | 0 |
| code-block | JetBrains Mono 400 | 14 / 14 / 13 | 1.6 | 0 |

### Responsive rules

- Headings scale fluidly between 360 and 1280 px screens (`clamp()` values in the tokens). Buttons and navigation step up to 16 px on mobile.
- Body text is 16 px on every device, and nothing is below 12 px.
- Headlines use `text-wrap: balance`. The longest word, "infrastructure", fits a 320 px screen at the hero size.

### Financial typography

- Every amount, balance, fee and total uses Inter with tabular numerals.
- Amounts are right-aligned in columns. The token symbol follows the amount, in secondary colour at the same size, never forced to uppercase.
- Hierarchy: balance (`amount-display` 36 / 34 / 30) above total (`amount-total` 18) above row amount (`amount` 16) above fee (`amount-fee` 14, secondary colour, always labelled).
- Never abbreviate amounts in review or approval screens. Typography never rounds a value.

### Technical typography

- Hashes and addresses use JetBrains Mono. In lists, truncate in the middle, 6 + 4 characters (`0x1a2b3c…9f8e`), with the full value on hover and a copy button.
- Where the user must verify a value, show it in full with `overflow-wrap: anywhere`.
- Code blocks scroll and never wrap; ligatures are off. The copy button sits outside the scrolling area, at least 32 px, with an accessible label.

### Loading and fallbacks

- `src/design/fonts.ts` uses `next/font/google`, which self-hosts the files with `font-display: swap`.
- Only Inter is preloaded (48 KB). Sora, JetBrains Mono and Instrument Serif load when a page uses them.
- Size-adjusted fallback fonts prevent layout shift. Font stacks end in system fonts.

---

## 5. Imagery and art direction

The quality standard is editorial: clean layouts, strong type, and imagery made for SPak, never picked from a stock style. Every image explains something about execution, movement or verification.

### Visual language

1. **Geometry from the mark.**
   - Compositions reuse the symbol's own construction: diagonals at 51.8° (dx/dy 0.786), flat-topped bands, and the concave leaf curve.
   - Bands in Forest Green with a slightly lighter green (#1E5640) for depth. Never more than two greens in one composition.
2. **Cross-chain movement.**
   - One clear path between two named points, drawn as a single 2 px line with circular end nodes.
   - A second, dotted path may show an alternative (for example the refund route). At most two paths.
3. **Transaction pathways.**
   - Step diagrams (Intent → Plan → Quote → Deposit → Deliver) using real state names.
   - Labels in JetBrains Mono, connectors in Forest Green, boxes outlined with Mid Sage.
   - The diagram must match how SPak actually behaves.
4. **Abstract infrastructure.**
   - Architectural, orthogonal forms: stacked planes, shafts and grids, built from the diagonal bands.
   - Light Warm White and Soft Green planes, Graphite shadows drawn as flat shapes, not blur.
5. **Halftone.**
   - Graphite dot fields on Soft Green or Warm White, with dot size varying smoothly to suggest depth or direction.
   - Texture comes from dots, never from glow or gradients.
6. **Editorial imagery.**
   - Photography only where it shows real people or real places of use: desks, devices, cities, at natural light.
   - Muted colour grading toward the palette.
   - No people pointing at holograms, and no "crypto" stock imagery.
7. **3D elements.**
   - Allowed when art-directed: matte materials in palette colours, soft single-source light, geometry derived from the symbol (extruded bands, the leaf as a solid).
   - No chrome, glass, neon, floating coins or particle storms.
8. **Technical illustration.**
   - Precise line drawings of SPak's real flows and states for docs and the developer platform.
   - 1.5–2 px strokes, the palette only, JetBrains Mono labels.

### Avoid

Generic AI artwork, random glowing objects, excessive gradients, unnecessary glassmorphism, repetitive card grids, generic Web3 illustrations (nodes, globes, chain links, rockets, coins), network logos used as decoration, and fake dashboards with invented numbers.

### Process for new imagery

1. Write one sentence on what the image explains.
2. Sketch it from the symbol geometry.
3. Use palette colours only.
4. Check the text contrast inside it.
5. Get approval under section 8.

---

## 6. Graphic elements

- **Shapes:**
  - The diagonal band (parallelogram at 51.8°) and the leaf curve are the brand shapes.
  - Corner radii: 6 px for controls and badges' inner elements, 12 px for cards and media, pill (999 px) for status badges, 22.5% for the app icon tile.
  - Do not mix rounded and sharp cards on one screen.
- **Patterns:**
  - Halftone dot fields: a 12 px grid with dot radius 0.4–4.6 px.
  - Diagonal band fields: band width 55% of the period, at 51.8°.
  - Patterns sit behind content at full opacity in two close tones. They are never placed behind body text.
- **Borders:**
  - 1 px. `border` (light #D9DED8, dark #3E4641) is decorative only, for dividers and card edges.
  - `borderStrong` (light #708974, dark #768F79) is for inputs and anything that must be perceived (3:1).
  - Status badges use their semantic border.
- **Dividers:** 1 px `border` colour, full width inside a section, with 24 px or more of space either side. Sections on marketing pages are separated by space or a single hairline, never by heavy rules.
- **Iconography:**
  - 24 px grid, 1.75 px stroke, round caps and joins, no fills.
  - Diagonals follow the 51.8° family where a diagonal is needed.
  - One icon per status: check (success), return arrow (refunded), circled × (error), triangle (warning), clock (pending), circular arrow (processing), circled i (info), circled minus (neutral).
  - Icons inherit the semantic icon colour and are always paired with a label. Shown on the board.
- **Background treatments:**
  - Warm White is the default. Soft Green for alternate sections. Forest Green blocks for emphasis, at most once per page.
  - Graphite for dark sections and the dark theme.
  - No gradients behind text, and no blur or glass effects.
- **Decorative elements:** Muted Sage shapes, halftone and diagonal bands, used decoratively on light surfaces only. Never as text, never as meaningful borders.

---

## 7. Digital applications

| Surface | Character | Specifics |
|---|---|---|
| **Marketing website** | Expressive, editorial | Sora headlines with fluid sizes; Warm White pages; one Forest Green block per page; art-directed compositions from section 5; varied layouts with no repeated card grid; real product screens with real states |
| **Consumer application** | Precise, calm, usable | Inter only (no Sora); light and dark themes from the tokens; one status badge per transaction (word + icon + colour); amounts with tabular numerals and clear hierarchy; full addresses wherever users approve; no decorative imagery inside transaction flows |
| **Developer platform** | Technical clarity | Inter for prose, JetBrains Mono for code, endpoints and identifiers; code blocks scroll with a copy button; light theme by default, dark available; the diagrams are technical illustrations |
| **Documentation** | Readable, structured | Body 16 px, line height 1.55 or more, max width 40rem; headings in Inter (Sora only on landing pages); consistent callouts using the info, warning and error tokens |
| **Social media** | Recognisable at a glance | Square or 4:5 frames; Warm White or Forest Green background; one statement in Sora; symbol or horizontal logo bottom-left with clear space; compositions from section 5; avatar = app icon |
| **Product announcements** | Factual | Headline in Sora stating the change; Inter body explaining what users can now do; real screenshots; honesty rules from section 1 (no "instant", "guaranteed" or "autonomous") |

---

## 8. Design governance

- **Owner:** the brand owner (project owner) approves changes. Tokens and assets live in the repository; the files there are the source of truth.
- **Consistency:**
  - Use tokens, never raw hex values in code.
  - Use the SVG assets, never re-exports.
  - Check new screens against this document and the board.
- **New colours:**
  - Only with a written reason (what job no existing token covers).
  - Generated with `scripts/brand/build_colors.py`.
  - Every new pairing must pass the contrast tests. Never added by eye.
- **New typography:**
  - A new typeface, or a weight outside those loaded, needs a written case: what Sora, Inter or JetBrains Mono cannot do, and the performance cost in kilobytes.
  - Then update `src/design/typography.json`, `src/design/fonts.ts` and the tests.
- **New illustrations:** follow the process in section 5; review them with the board side by side; keep the source files (SVG preferred) under `public/brand/` and add them to the inventory.
- **Logo changes:**
  - None to the symbol or wordmark without a versioned decision (v1.0 → v2.0).
  - Regenerate from `scripts/brand/symbol-geometry.json` with `scripts/brand/build_logo.py`. Never edit SVG files by hand.
  - The reference PNG is never altered.
- **Naming:**
  - `spak-<item>-<variant>[-<colour>].<ext>`, all lowercase with hyphens (for example `spak-logo-horizontal-dark.svg`, `spak-symbol-mono-black.svg`).
  - Sizes as a suffix for rasters (`-512.png`).
  - Platform files keep their platform names (`favicon.ico`, `apple-touch-icon.png`).
- **Organisation:**
  - `public/brand/logo/` for logos, symbols and wordmarks; `public/brand/icons/` for app and favicon assets.
  - `public/brand/references/` for approved references; `public/brand/previews/` for previews (never used in products).
  - `public/brand/board/` for the board.
- **Change procedure:**
  1. Edit the source data or script.
  2. Regenerate.
  3. Run `scripts/brand/build_inventory.py`.
  4. Run `npm test`. The brand tests fail if files and inventory disagree, a documented path is missing, or a colour in this document is not a token.
  5. Update this document.

---

## 9. Reference board

- **Board:** `public/brand/board/spak-brand-board.html`, generated by `scripts/brand/build_board.py` from the approved logo files and the token files. Open it in a browser.
- **Render:** `public/brand/previews/spak-brand-board.png` (2880 × 8880 px).

Contents:

1. **Cover:** primary logo, tagline in Sora with the optional Instrument Serif accent, symbol on Forest Green.
2. **Logo system:** primary on light, dark and Forest Green surfaces; symbol, wordmark, stacked, mono, app icon and favicons at 16, 32 and 48 px; six incorrect uses.
3. **Colour:** brand palette and derived colours with their contrast ratios; all eight status badges in light and dark themes, with icons.
4. **Typography:** Sora and Instrument Serif specimen; an approval summary in Inter with tabular amounts and JetBrains Mono references.
5. **Art direction:** cross-chain movement on diagonal bands, a halftone field around the symbol, a technical transaction pathway.
6. **In product:** transaction cards in light ("Verifying delivery") and dark ("Refunded").

The board uses only approved assets and token values. The art direction panels are examples of the visual language, not additional logos.
