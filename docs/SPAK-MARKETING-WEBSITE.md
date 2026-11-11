# SPak Marketing Website

Phase 6.7. The public site for SPak. It uses the approved brand (SPAK-BRAND-GUIDELINES.md) and the token pipeline from SPAK-APPLICATION-DESIGN-SYSTEM.md. No colour, font or logo was added.

Rule for every word on the site: describe what the code does today. Anything else is listed as not live.

## 1. Architecture

The site lives in the same Next.js app as the product. It shares the root layout, so tokens, fonts and themes are identical.

| Part | Location |
| --- | --- |
| Pages | `src/app/(marketing)/` (route group, own layout) |
| Components | `src/components/marketing/` |
| Copy that makes product claims | `src/marketing/content.ts` |
| Styles | `src/app/(marketing)/marketing.css` (token variables only) |
| Product screens | `public/marketing/screens/`, sizes in `src/marketing/screens.json` |
| Share image | `public/marketing/spak-og.png` |
| Scripts | `scripts/marketing/capture.cjs`, `scripts/marketing/build_og.cjs` |

All marketing pages are server components and prerender as static pages. Two small client components exist: the phone menu and the scroll reveal.

Network names, network counts and asset counts are read from the registries at build time. Execution states on the docs page come from `stateRoles` in `src/design/colors.json`. Nothing is typed in by hand.

## 2. Routes

| Route | Content | Change |
| --- | --- | --- |
| `/` | Marketing homepage | New. The app used to be here |
| `/developers` | Developer infrastructure | New |
| `/docs` | Public documentation | New |
| `/app` | The SPak application | Moved from `/`. Code unchanged |
| `/sitemap.xml`, `/robots.txt` | SEO files | New |
| `/api/*` | API | Unchanged |

The move to `/app` changed three things only: the file location, `start_url` in the web manifest, and the app logo now returns to the homepage. Sign-in messages use the origin, not the path, so authentication is unaffected.

## 3. Homepage sections

| Section | Anchor | Notes |
| --- | --- | --- |
| Navigation | | Logo, Product, Developers, Documentation, theme toggle, Launch App |
| Hero | | Approved tagline, two CTAs, hero composition |
| Product introduction | `#product` | What SPak is, the problem, the coordination argument, the NEAR Intents relationship |
| How SPak works | `#how-it-works` | Five steps as a lane diagram. Dotted line before approval, solid after |
| Cross-chain execution | `#cross-chain` | Route diagram, five capabilities, the two network groups, three product screens |
| Agent, Intelligence, Guard, Payments | `#agent` `#intelligence` `#guard` `#payments` | Each lists "Live today" and "Not live yet" |
| Developer infrastructure | `#developers` | Graphite section. Real plan steps from the planner |
| Security and verification | `#security` | Five controls, refund limits, a table of who verifies each stage, the recovery screen |
| Final CTA | | The page's one Forest Green block. Users and developers |
| Footer | | Product, Platform, Developers |

## 4. Components

| Component | File | Job |
| --- | --- | --- |
| SiteNav, SiteFooter | site.tsx | Header with skip link, footer |
| MobileMenu | MobileMenu.tsx | Disclosure menu under 768 px. Closes on Escape and on navigation |
| CtaLink | site.tsx | Link styled as a button. Four variants |
| Screen | site.tsx | Product screenshot with caption. Switches by theme and by width |
| LivePlanned | site.tsx | Two lists: live and not live. Labelled in words, not only by colour |
| Reveal | Reveal.tsx | Scroll reveal for `data-reveal` elements |
| HeroComposition, ExecutionLanes, RouteDiagram, EvidenceField, BandField | art.tsx | Artwork (section 5) |

## 5. Art direction

All artwork is SVG drawn in code from the approved symbol geometry: the 51.8 degree diagonal (dx/dy 0.786), flat-topped bands, and the leaf. Colours are token variables, so every piece follows the theme. No raster or generated imagery is used. The logo itself appears only through the approved files.

| Composition | Explains |
| --- | --- |
| Hero | One path from intent to verified delivery. It stops at the leaf, the point where the user approves, then crosses onto the destination band |
| Execution lanes | Who acts at each of the five steps: you, SPak, NEAR Intents. Dotted until approval, solid after |
| Route diagram | Wallet to deposit address to recipient. A dotted refund route returns to the wallet that sent the deposit |
| Evidence field | A halftone field (12 px grid, radius 0.4 to 4.6) around the leaf. Dense where SPak has read the chain, sparse where it has not |
| Band field | Two close greens in the Forest Green block. Kept away from the text |

The lane and route diagrams are structured diagrams of real behaviour. Step order, actors and the "moves funds" flag come from `STEPS` in `content.ts`.

Motion: the hero bands settle, the path draws once, and a small marker travels the path and pauses inside the leaf. Sections fade up on scroll. Hover feedback is colour only. With `prefers-reduced-motion`, nothing animates and the marker is removed. Without JavaScript, all content is visible.

## 6. Product screens

`scripts/marketing/capture.cjs` captures the screens from the running application.

| Screen | Real | Simulated |
| --- | --- | --- |
| chat, plan, approval | The app, sign-in, the NEAR Intents quote | The wallet (a throwaway key) |
| tracking | The approved execution. No deposit was sent | The wallet |
| refund | The recovery panel component | The tracking data. The caption says so |

Each screen exists in light and dark, at desktop width and at phone width (`-m`). To refresh them, start a production build with an embedded database and run the script. No funds move.

## 7. SEO

- Title template, description and canonical URL per page.
- Open Graph and Twitter card with a 1200 x 630 image built from the live homepage (`scripts/marketing/build_og.cjs`).
- `sitemap.xml` lists the three public pages. `robots.txt` allows them and disallows `/api/` and `/app`.
- The public origin comes from `SPAK_APP_ORIGIN`, the same variable the app uses.
- Semantic HTML: one `h1` per page, ordered headings, landmarks, real tables and lists.

## 8. Responsive behaviour

- Content width 76rem. Gutters 20 px on phones, 40 px from 768 px.
- Under 768 px the navigation becomes a menu button. Launch App stays in the menu.
- Under 1024 px the lane diagram is replaced by a vertical list with the same dotted and solid rule.
- Under 640 px the screens swap to phone-width captures, and the hero labels are hidden because they would be too small to read.
- Tables scroll sideways inside their own box. The page never scrolls sideways.
- Checked at 1280, 820 and 390 px in both themes.

## 9. Testing

- `tests/marketing/site.test.ts` (18 tests): network groups match the registry, "verified on chain" is claimed only where verifiers exist, approval is step three and nothing moves before it, plan steps exist in the planner, every state is documented, banned phrases, no autonomy claims, no hex colours, no external links, links and anchors resolve, screens exist, metadata is wired.
- `tests/browser/marketing.check.cjs`: 47 browser checks. Layout and images at three widths in two themes, accessibility structure, SEO tags, every link, navigation and CTAs, keyboard access, the phone menu, reduced motion, console errors.
- `tests/browser/app-branding.check.cjs` now targets `/app` and confirms the application still works.

## 10. Remaining limitations

- No social links. No SPak social accounts are recorded in the repository, so none were invented.
- No legal pages. Terms and a privacy policy need text from the owner. The footer has no legal links until they exist.
- The documentation is one page. The detailed engineering documents stay in the repository, which is private.
- There is no public API or SDK. The developer page says so.
- Product screens are static captures. They must be recaptured when the app UI changes.
- The screens total 4.9 MB as PNG sources. Next.js serves them resized and compressed. They are not hand-optimised.
- Artwork is two-dimensional SVG. No 3D or raster compositions were produced.
- Contrast was not re-measured for the marketing pages. They use only pairings already validated in the colour system.
- No automated accessibility audit tool was run. The checks cover structure, names, focus and keyboard use.
- Indexing: old links to `/` now show the marketing page. Signed-in users reach the app at `/app`.
