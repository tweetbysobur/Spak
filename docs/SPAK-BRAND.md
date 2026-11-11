# SPak Brand Identity Board V1.0

## 1. Brand overview

- Brand name: SPak
- Category: Intelligent cross-chain execution infrastructure.
- Positioning: SPak is an intelligent execution infrastructure that translates user intentions into controlled, verifiable blockchain actions across supported networks.
- Primary tagline: Intelligent execution across chains.
- Supporting statement: Turn intentions into verified actions across blockchain networks.

## 2. Brand personality

- Intelligent. Understands user intentions.
- Precise. Coordinates transactions accurately.
- Trustworthy. Communicates transaction states transparently.
- Connected. Operates across blockchain ecosystems.
- Forward-thinking. Built for evolving financial infrastructure.

Overall: premium, intelligent, confident, technical and approachable.

## 3. Colour identity

Direction: Forest Green, Warm White and Graphite.

| Colour | Hex | Application |
|---|---|---|
| Forest Green | #174734 | Primary brand colour |
| Warm White | #F7F6F0 | Main background |
| Graphite | #222724 | Text and dark surfaces |
| Muted Sage | #A7B7A9 | Secondary accents |
| Soft Green | #E8EFE9 | Subtle backgrounds |

Philosophy:

- Warm white dominates the marketing website.
- Forest green establishes brand recognition.
- Graphite provides strong contrast.
- Sage and soft green support secondary elements.

### Completed colour system (Phase 6.3)

The full system is in `docs/SPAK-COLOUR-SYSTEM.md`. The tokens are in `src/design/colors.json` and tested by `tests/brand/contrast.test.ts`.

- The brand palette is unchanged.
- Added:
  - Deep Sage #5A6D5C for secondary text: 5.14:1 on Warm White, 4.75:1 on Soft Green.
  - Mid Sage #708974 for large text, secondary icons and control borders: 3:1 or better.
  - Light Forest #9CD7BF as the dark-theme primary.
- Eight semantic roles: success, refunded, error, warning, pending, processing, info, neutral. Each has foreground, background, border and icon values for light and dark themes.
- Every approved pairing passes WCAG 2.x. The only failing pairs are documented restrictions:
  - Muted Sage on Warm White or Soft Green, for text or icons.
  - Forest Green on Graphite.
  - A focus ring touching the primary button directly, which needs a 2 px offset.
- Status is never shown by colour alone. Every status has a label, plus an icon wherever space allows.

## 4. Typography

Full system in `docs/SPAK-TYPOGRAPHY.md`. Tokens are in `src/design/typography.json`, font loading in `src/design/fonts.ts` (not applied to the app yet).

- **Sora 600:** marketing display and section headings only. The wordmark is drawn from it.
- **Inter (variable):** application, navigation, body text and every number. Amounts always use tabular numerals.
- **JetBrains Mono (variable):** hashes, addresses, identifiers and code. Identifiers truncate in the middle (6 + 4 characters) in lists, and show in full with wrapping where users must verify them.
- **Instrument Serif 400 italic:** optional, at most one phrase in a marketing headline, x-height matched to Sora. Never in the app, never for numbers.
- **Sizes:** body 16 px on every device, nothing below 12 px. Marketing headings scale fluidly from 320 px screens to desktop (hero 40 to 72 px); buttons and navigation step up to 16 px on mobile.

## 5. Logo direction

Selected direction: original abstract symbol.

Requirements:

- Distinctive geometric construction.
- Original silhouette.
- Subtle inspiration from execution, coordination and intelligent systems.
- Minimal detailing.
- Recognisable at small sizes.
- Works independently of the wordmark.

Variations: primary combination mark, standalone symbol, horizontal wordmark, light and dark versions, monochrome version.

Avoid: generic blockchain nodes, predictable network globes, excessive gradients, forced letter combinations.

Status: symbol selected and reconstructed as vector. Files, usage rules and small-size handling are in `docs/SPAK-LOGO-GUIDELINES.md`. Assets live in `public/brand/logo` and `public/brand/icons`.

## 6. Imagery and illustration

Themes: cross-chain movement, connected ecosystems, transaction pathways, intelligent coordination, digital infrastructure, execution and verification.

Treatments: custom geometric illustrations, editorial compositions, art-directed 3D elements, halftone textures, abstract architectural forms, custom diagrams and technical visualisations.

Every visual communicates an idea or supports the product story. Avoid random decorative objects and generic AI-generated artwork.

## 7. Digital design principles

Marketing website: editorial layouts, strong typography, spacious sections, creative visual compositions, clear product demonstrations, distinctive section transitions.

Application: clear information hierarchy, precise transaction details, consistent components, accessible contrast, honest execution states, minimal visual distractions.

Developer platform: technical clarity, readable documentation, consistent code presentation, structured navigation, professional API references.

## 8. Positioning principle

SPak is infrastructure first, with intelligence as its defining capability.

- Intelligence through interaction.
- Trust through transparency.
- Precision through execution.
- Connectivity through its visual language.

## 9. Design quality standard

SPak must not look like a generic Web3 template. Every major design decision has a clear purpose. Prioritise originality, consistency, usability and professional art direction. The identity must work across the marketing website, application, developer platform, documentation and promotional materials.

## Current state of the app

The app does not follow this board yet. It uses a dark theme with white, sky, amber and emerald accents and the default font stack. Applying the brand is separate work.
