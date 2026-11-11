# SPak Logo Guidelines

Version 1.0. Builds on `docs/SPAK-BRAND.md`.

## 1. The symbol

An abstract S built from two interlocking directional forms, with a concave "leaf" between them. The leaf's tip touches the lower form, which leaves a star-shaped negative space at the centre. The forms read as movement in two directions, coordinated through one precise point: execution across chains.

### Reconstruction from the reference

The master vector (`public/brand/logo/spak-symbol.svg`) was rebuilt from `public/brand/references/spak-symbol-reference.png`. The reference is unchanged and kept for comparison.

- **Method:**
  - Straight edges: least-squares line fits to the reference's edge pixels.
  - Curves: cubic Béziers fitted to the reference boundary, with tangent continuity into the adjoining straight edges.
  - Leaf tip: placed exactly on the lower form's S-curve, so the two meet at one point as in the reference.
- **Accuracy:** 99.58% intersection-over-union with the reference (667 of 160,027 pixels differ), measured from the shipped SVG. Curve fits deviate 0.5 to 1.6 px RMS on a 1254 px image.
- **Refinements made:**
  - Four diagonal edges in the reference measured 51.5° to 52.1°. They now share one angle, 51.8° (dx/dy = 0.786).
  - The lower form's top edge sloped by about 1° in the reference. It is now horizontal.
  - Straight edges are exact lines, and curves are single smooth Béziers.
- **Kept as in the reference:** the upper form's outer left edge stays at 48.9°. Forcing it to 51.8° stretched the top-left curve about 230 px down the edge and changed the silhouette, so the reference angle is part of the mark. Corners that are sharp in the reference stay sharp.

### Geometry

- Symbol box: 625.93 × 551 in reference pixels. Aspect ratio 1.136 : 1 (width : height).
- Three closed paths: upper form, leaf, lower form. No strokes, filters, gradients or text.
- Source data: `scripts/brand/symbol-geometry.json`.

## 2. Wordmark

- **Typeface:** Sora SemiBold (600), converted to outlines, so no font is needed at runtime. Sora is under the SIL Open Font License 1.1; outlining it for a logo is permitted.
- **Weight:** 600 sits closest to the symbol's mass. 500 looked thin beside the heavy forms; 700 competed with them.
- **Spacing:** tracking −20/1000 em. Optical kerning S–P −6, P–a −38 (Sora's default P–a gap reads as a hole at display sizes), a–k −4.
- **Relationship to the symbol:**
  - Cap height is 0.45 × symbol height.
  - Caps are centred on the symbol's vertical centre, which is where the leaf tip sits.
  - The gap between symbol and wordmark is 0.30 × symbol height.
- **Colour:** Graphite on light backgrounds and Warm White on dark ones. The symbol carries the green, so the wordmark stays neutral and the two never compete.
- **Case:** always "SPak", with capital S and P and lowercase a and k. Never "SPAK" or "Spak" in the logo.
- **Remaining work:** the letterforms are stock Sora with custom spacing and proportions. A bespoke wordmark (for example, a custom k leg cut at the symbol's 51.8° angle) needs a type designer and should be reviewed separately.

## 3. Files

All SVG files use a `viewBox` and scale without loss. Logos have transparent backgrounds; icons carry their own tile.

| File | Use |
|---|---|
| `public/brand/logo/spak-logo-horizontal.svg` | Primary logo. Forest Green symbol and Graphite wordmark, for light surfaces |
| `public/brand/logo/spak-logo-horizontal-dark.svg` | Dark surfaces. Muted Sage symbol and Warm White wordmark |
| `public/brand/logo/spak-logo-horizontal-mono-graphite.svg` | Single colour, Graphite |
| `public/brand/logo/spak-logo-horizontal-mono-black.svg` | Single colour, black (print, fax, engraving) |
| `public/brand/logo/spak-logo-horizontal-mono-white.svg` | Single colour, Warm White on Forest Green, Graphite or photos |
| `public/brand/logo/spak-logo-stacked.svg`, `-stacked-dark.svg` | Symbol over wordmark, for square spaces |
| `public/brand/logo/spak-symbol.svg` | Standalone symbol, Forest Green |
| `public/brand/logo/spak-symbol-dark.svg` | Muted Sage, for Graphite surfaces |
| `public/brand/logo/spak-symbol-white.svg` | Warm White, for Forest Green surfaces |
| `public/brand/logo/spak-symbol-mono-graphite.svg`, `-mono-black.svg` | Single colour |
| `public/brand/logo/spak-symbol-small.svg` | Optical-size symbol without the leaf. Only for 16 to 24 px |
| `public/brand/logo/spak-wordmark.svg` (Graphite), `-green.svg`, `-dark.svg` (Warm White), `-mono-black.svg` | Wordmark only |
| `public/brand/icons/spak-app-icon.svg` | App icon: Warm White symbol on a Forest Green rounded tile |
| `public/brand/icons/spak-app-icon-square.svg` | Full-bleed square for platforms that apply their own mask |
| `public/brand/icons/favicon.svg` | Favicon using the small-size symbol |
| `public/brand/icons/favicon-full.svg` | Favicon with the leaf, for 32 px and up |
| `public/brand/icons/favicon.ico` | 16, 32, 48 px (16 px uses the small-size symbol) |
| `public/brand/icons/apple-touch-icon.png` | 180 px |
| `public/brand/icons/icon-192.png`, `icon-512.png` | Web app manifest |
| `public/brand/icons/spak-app-icon-512.png`, `-1024.png` | Rounded app icon |
| `public/brand/previews/*.png` | Previews only. Use the SVG files in products |

To regenerate the SVG files: `python3 scripts/brand/build_logo.py <path to sora-latin-600-normal.woff2>` (from `@fontsource/sora`). It needs `fonttools` and `brotli`.

## 4. Colour use

| Surface | Symbol | Wordmark | Contrast |
|---|---|---|---|
| Warm White #F7F6F0 | Forest Green #174734 | Graphite #222724 | 9.76 : 1, 14.02 : 1 |
| Soft Green #E8EFE9 | Forest Green | Graphite | 9.03 : 1, 12.98 : 1 |
| Graphite #222724 | Muted Sage #A7B7A9 | Warm White | 7.22 : 1, 14.02 : 1 |
| Forest Green #174734 | Warm White | Warm White | 9.76 : 1 |

- Never place Forest Green on Graphite: 1.44 : 1, so it disappears.
- Never place Muted Sage on Warm White or Soft Green: 1.94 : 1 and 1.80 : 1.
- On photos and illustrations, use the mono white or mono graphite logo on a calm area, or put it on a solid tile.

## 5. Clear space and minimum size

- Clear space on all sides: 0.25 × symbol height. That is about the height of the upper form's top band.
- Minimum sizes:
  - Horizontal logo: 96 px wide (symbol 33 px tall) on screen, 25 mm in print.
  - Symbol with the leaf: 24 px tall. Below 24 px use `spak-symbol-small.svg`.
  - Wordmark only: 64 px wide.

## 6. Do not

- Redraw, re-trace or rebuild the symbol from the PNG. Use the SVG files.
- Stretch, skew, rotate or mirror the symbol. Its direction carries meaning.
- Change the wordmark's typeface, spacing or case, or retype it as live text.
- Add gradients, glows, shadows, outlines or 3D effects.
- Recolour it outside the palette, or use the colour pairs listed as failing above.
- Separate the leaf from the symbol, except in the official small-size version.
- Put the symbol inside generic blockchain motifs such as nodes, globes or chains.

## 7. Quality checks performed

- SVG validity: all 21 files are well-formed XML with a `viewBox`. They contain only `path`, `rect` and `title`: no filters, embedded images, text or fonts.
- Accuracy against the reference: 99.58% IoU.
- Small sizes: rendered at 16, 24, 32, 48 and 64 px. The leaf blurs at 16 px, hence the small-size symbol for favicons.
- Light and dark surfaces: rendered on Warm White, Soft Green, Graphite and Forest Green.

## 8. Not done yet

- The app does not use these assets yet. `src/app/favicon.ico` is still the Next.js default and was left unchanged; wiring the icons into the app and a web manifest is a separate change.
- Print colour values (CMYK and Pantone) are not defined.
- Motion and animated versions of the logo are not defined.
- No outside review for trademark conflicts has been done.
