/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for the marketing site (not part of `npm test`).
 *
 *   node tests/browser/marketing.check.cjs <baseUrl> <outDir>
 *
 * Checks every marketing route at desktop, tablet and phone widths in both themes: no horizontal overflow, images
 * load, internal links and anchors resolve, navigation and CTAs work, basic accessibility structure, keyboard
 * access, reduced motion, console errors.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const [,, BASE = 'http://localhost:3100', OUT = '/tmp/spak-marketing'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const results = []; const errors = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); };
const ROUTES = ['/', '/product', '/how-it-works', '/developers', '/docs'];
const SIZES = { desktop: [1280, 900], tablet: [820, 1180], phone: [390, 844] };

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 500) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(80); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForLoadState('networkidle');
}

(async () => {
  const browser = await chromium.launch();
  const watch = (page, tag) => {
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`${tag} ${r.status()} ${r.url()}`); });
  };

  // 1. Layout, images and structure, per route, size and theme
  for (const [size, [width, height]] of Object.entries(SIZES)) for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 1 });
    const page = await ctx.newPage(); watch(page, `${size}/${theme}`);
    for (const route of ROUTES) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' }); await settle(page);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const imgs = await page.evaluate(() => [...document.images].filter((i) => i.offsetParent !== null).map((i) => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 })));
      const broken = imgs.filter((i) => !i.ok).map((i) => i.src.split('/').pop());
      ok(`${route} ${size} ${theme}: no horizontal overflow, ${imgs.length} visible images loaded`, over <= 0 && broken.length === 0, `${over}px ${broken.join(',')}`);
      if (theme === 'light' || size === 'desktop') await page.screenshot({ path: `${OUT}/${route === '/' ? 'home' : route.slice(1)}-${size}-${theme}.png`, fullPage: true });
    }
    await ctx.close();
  }

  // 1b. Hero: centred, in the agreed order, at every width and in both themes
  for (const [size, [width, height]] of Object.entries(SIZES)) for (const theme of ['light', 'dark']) {
    const hctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: size === 'tablet' ? 1 : 2 });
    const hp = await hctx.newPage(); watch(hp, `hero ${size}/${theme}`);
    await hp.goto(BASE, { waitUntil: 'networkidle' }); await hp.evaluate(() => document.fonts.ready);
    const h = await hp.evaluate(() => {
      const hero = document.querySelector('main > section'); const sec = hero.querySelector('[data-hero-content]'); const box = (e) => e.getBoundingClientRect();
      const bg = hero.querySelector('picture img');
      // Only one hero background may be downloaded: the portrait one on phones, the landscape one otherwise. Hero
      // requests are the q=85 ones; the What is SPak? symbol requests a small q=80 copy of the landscape further down.
      const heroFiles = [...new Set(performance.getEntriesByType('resource').map((e) => decodeURIComponent(e.name)).filter((n) => n.includes('spak-hero-landscape') && /[?&]q=85\b/.test(n)).map((n) => n.match(/spak-hero-landscape[-a-z]*\.(png|jpg)/)[0]))];
      const kids = [...sec.children]; const centre = (e) => box(e).left + box(e).width / 2;
      const marks = [...sec.querySelectorAll('p img')].filter((i) => i.offsetParent !== null); const logo = marks[0];
      const win = logo ? box(logo.parentElement) : null;
      const links = [...sec.querySelectorAll('a')];
      return {
        order: kids.map((k) => k.tagName + (k.tagName === 'P' ? ':' + k.textContent.trim().slice(0, 8) : '')).join(' > '),
        offCentre: Math.max(...kids.map((k) => Math.abs(centre(k) - window.innerWidth / 2))),
        fits: kids.every((k) => box(k).left >= 0 && box(k).right <= window.innerWidth),
        headline: sec.querySelector('h1').textContent, lines: Math.round(box(sec.querySelector('h1')).height / parseFloat(getComputedStyle(sec.querySelector('h1')).lineHeight)),
        logoOk: !!logo && logo.complete && logo.naturalWidth > 0, logoSrc: logo ? logo.getAttribute('src') : '', visibleLogos: marks.length, badge: kids[0].textContent.trim(),
        // The window is square and shows only the icon: the wordmark part of the file starts beyond its right edge.
        iconOnly: !!win && Math.abs(win.width - win.height) < 0.5 && box(logo).width > win.width * 3 && getComputedStyle(logo.parentElement).overflow === 'hidden',
        para: kids[2].textContent, links: links.map((l) => `${l.textContent.trim()}=${l.getAttribute('href')}`).join('|'),
        stacked: box(links[1]).top > box(links[0]).bottom - 1,
        bgOk: !!bg && bg.complete && bg.naturalWidth > 0 && getComputedStyle(bg).objectFit === 'cover' && box(bg).width >= box(hero).width - 1 && box(bg).height >= box(hero).height - 1,
        bgRatio: bg ? (bg.naturalWidth / bg.naturalHeight).toFixed(2) : '', bgFile: bg ? decodeURIComponent(bg.currentSrc).match(/spak-hero-landscape[-a-z]*\.(png|jpg)/)[0] : '', heroFiles: heroFiles.join(','), heroH: Math.round(box(hero).height), textColor: getComputedStyle(sec.querySelector('h1')).color, svgs: sec.querySelectorAll('svg.mkt-art').length, // Bottom gap minus top gap. The content sits a little above centre, in the open sky above the mist (phones leave
        // more room below the buttons so the valley shows).
        vCentre: (box(sec).bottom - box(kids[kids.length - 1]).bottom) - (box(kids[0]).top - box(sec).top),
      };
    });
    const wantLogo = '/marketing/partners/near-logo-rev.svg'; // the landscape is dark in both themes
    const wantFile = size === 'phone' ? 'spak-hero-landscape-mobile.jpg' : 'spak-hero-landscape.png';
    ok(`hero ${size} ${theme}: ${wantFile} covers the hero (${h.heroH}px tall), undistorted, light text, and is the only hero image downloaded`,
      h.bgOk && h.bgFile === wantFile && h.heroFiles === wantFile && h.bgRatio === (size === 'phone' ? '0.67' : '2.00') && h.textColor === 'rgb(247, 246, 240)', `${h.bgFile} ${h.bgRatio} [${h.heroFiles}] ${h.textColor}`);
    ok(`hero ${size} ${theme}: badge, headline, paragraph, buttons in order; centred; inside the screen`,
      h.order === 'P:Built on > H1 > P:SPak tur > DIV' && h.offCentre <= 1 && h.vCentre >= 0 && h.vCentre <= 80 && h.fits && h.svgs === 0, JSON.stringify({ order: h.order, off: h.offCentre, v: h.vCentre }));
    ok(`hero ${size} ${theme}: exact copy, headline on ${h.lines} lines, official NEAR logo for this theme`,
      h.headline === 'Intelligent execution across chains.' && h.para === 'SPak turns your intentions into controlled, verifiable actions across blockchain networks.' && h.lines >= 2 && h.lines <= 3 && h.logoOk && h.visibleLogos === 1 && h.logoSrc === wantLogo && h.iconOnly && h.badge === 'Built on NEAR', `${h.logoSrc} ${h.lines}`);
    ok(`hero ${size} ${theme}: both buttons keep their destinations${size === 'phone' ? ' and stack' : ''}`, h.links === 'Launch SPak=/app|Explore Developers=/developers' && h.stacked === (size === 'phone'), h.links);
    await hp.screenshot({ path: `${OUT}/hero-${size}-${theme}.png` });
    await hctx.close();
  }

  // 1c. What is SPak?: two columns from tablet up, stacked on phones, the symbol undistorted with the photo loaded
  for (const [size, [width, height]] of Object.entries(SIZES)) for (const theme of ['light', 'dark']) {
    const sctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const sp = await sctx.newPage(); watch(sp, `product ${size}/${theme}`);
    await sp.goto(BASE, { waitUntil: 'networkidle' }); await sp.evaluate(() => document.fonts.ready);
    await sp.locator('#product').scrollIntoViewIfNeeded(); await sp.waitForLoadState('networkidle');
    const w = await sp.evaluate(() => {
      const sec = document.querySelector('#product'); const box = (e) => e.getBoundingClientRect();
      const text = sec.querySelector('h2').parentElement; const sym = sec.querySelector('[role=img]'); const img = sym.querySelector('img');
      return { h2: sec.querySelector('h2').textContent, link: sec.querySelector('a')?.getAttribute('href'), linkText: sec.querySelector('a')?.textContent.trim(),
        ratio: (box(sym).width / box(sym).height).toFixed(3), symW: box(sym).width, img: !!img && img.complete && img.naturalWidth > 0,
        sideBySide: box(sym).left >= box(text).right - 1 && Math.abs((box(sym).top + box(sym).height / 2) - (box(text).top + box(text).height / 2)) < 80,
        stacked: box(sym).top >= box(text).bottom, inside: box(sym).left >= 0 && box(sym).right <= innerWidth && box(text).right <= innerWidth };
    });
    ok(`What is SPak? ${size} ${theme}: ${size === 'phone' ? 'stacked, text first' : 'two columns, centred on each other'}; symbol undistorted with the photo loaded`,
      w.h2 === 'What is SPak?' && w.link === '/how-it-works' && w.linkText === 'See how it works' && w.ratio === '1.117' && w.img && w.inside && (size === 'phone' ? w.stacked : w.sideBySide), JSON.stringify(w));
    if (size === 'desktop' && theme === 'light') {
      await sp.locator('#product a', { hasText: 'See how it works' }).click(); await sp.waitForTimeout(400);
      await sp.waitForURL('**/how-it-works');
      ok('What is SPak?: "See how it works" opens the How it works page', (await sp.locator('h1').innerText()) === 'How it works');
    }
    await sctx.close();
  }

  // 2. Accessibility structure
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); watch(page, 'a11y');
  const hrefs = new Set();
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    const a = await page.evaluate(() => {
      const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => +h.tagName[1]);
      let skips = 0; for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) skips++;
      return {
        h1: document.querySelectorAll('h1').length, skips,
        noAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
        landmarks: ['header', 'main', 'footer', 'nav'].every((t) => document.querySelector(t)),
        lang: document.documentElement.lang,
        unnamed: [...document.querySelectorAll('a,button')].filter((e) => !(e.textContent.trim() || e.getAttribute('aria-label') || e.getAttribute('title'))).length,
        svgs: [...document.querySelectorAll('main svg')].filter((s) => !(s.getAttribute('aria-hidden') === 'true' || s.getAttribute('role') === 'img' && s.querySelector('title'))).length,
        title: document.title, desc: document.querySelector('meta[name=description]')?.content || '',
        og: ['og:title', 'og:description', 'og:image', 'og:url'].every((p) => document.querySelector(`meta[property="${p}"]`)), canonical: document.querySelector('link[rel=canonical]')?.href || '',
        links: [...document.querySelectorAll('a[href]')].map((l) => l.getAttribute('href')),
      };
    });
    ok(`${route} a11y: one h1, no skipped heading levels, landmarks, lang`, a.h1 === 1 && a.skips === 0 && a.landmarks && a.lang === 'en', JSON.stringify({ h1: a.h1, skips: a.skips }));
    ok(`${route} a11y: every image has alt, every control has a name, every illustration is labelled or hidden`, a.noAlt === 0 && a.unnamed === 0 && a.svgs === 0, JSON.stringify({ noAlt: a.noAlt, unnamed: a.unnamed, svgs: a.svgs }));
    ok(`${route} SEO: title, description, canonical, Open Graph`, a.title.includes('SPak') && a.desc.length > 50 && a.og && a.canonical.length > 0, a.title);
    a.links.forEach((l) => hrefs.add(l.startsWith('#') ? route + l : l)); // same-page anchors belong to this route
  }

  // 3. Links: every internal link answers 200 and every anchor exists
  let bad = [];
  for (const href of hrefs) {
    if (!href.startsWith('/') && !href.startsWith('#')) { bad.push(`external: ${href}`); continue; }
    const [path, hash] = href.split('#');
    const res = await page.request.get(BASE + (path || '/'));
    if (res.status() !== 200) { bad.push(`${href} -> ${res.status()}`); continue; }
    if (hash && !(await res.text()).includes(`id="${hash}"`)) bad.push(`${href}: anchor missing`);
  }
  ok(`links: ${hrefs.size} distinct links resolve, anchors exist, none external`, bad.length === 0, bad.join(' | '));
  const og = await page.request.get(BASE + '/marketing/spak-og.png');
  ok('Open Graph image, sitemap and robots are served', og.status() === 200 && (await page.request.get(BASE + '/sitemap.xml')).status() === 200 && (await page.request.get(BASE + '/robots.txt')).status() === 200);

  // 4. Navigation and CTAs
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Developers' }).click(); await page.waitForURL('**/developers');
  ok('nav: Developers opens /developers', true);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Documentation' }).click(); await page.waitForURL('**/docs');
  ok('nav: Documentation opens /docs', true);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Product' }).click(); await page.waitForURL('**/product');
  ok('nav: Product opens /product', true);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'How it works' }).click(); await page.waitForURL('**/how-it-works');
  ok('nav: How it works opens /how-it-works', true);
  await page.getByRole('link', { name: 'SPak home' }).first().click(); await page.waitForURL(BASE + '/');
  await page.getByRole('link', { name: 'Explore Developers' }).first().click(); await page.waitForURL('**/developers');
  ok('CTA: Explore Developers opens /developers', true);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Launch SPak' }).first().click(); await page.waitForURL('**/app');
  await page.getByText('Sign in with a wallet').first().waitFor({ timeout: 20000 });
  ok('CTA: Launch SPak opens the application, which renders its sign-in screen', true);
  await page.getByRole('link', { name: 'SPak home' }).first().click(); await page.waitForURL(BASE + '/');
  ok('app logo returns to the marketing homepage', true);
  await page.getByRole('link', { name: 'Explore Developer Infrastructure' }).click(); await page.waitForURL('**/developers');
  ok('final CTA: Explore Developer Infrastructure opens /developers', true);

  // 5. Keyboard
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement?.textContent);
  ok('keyboard: first Tab reaches the skip link', first === 'Skip to content', String(first));
  await page.keyboard.press('Enter');
  ok('keyboard: skip link moves to main content', (await page.evaluate(() => location.hash)) === '#main');
  let seen = [];
  for (let i = 0; i < 9; i++) { await page.keyboard.press('Tab'); seen.push(await page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return { t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24), ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 }; })); }
  ok('keyboard: focused controls show the 2px focus ring', seen.every((s) => s.ring), seen.filter((s) => !s.ring).map((s) => s.t).join(','));
  await ctx.close();

  // 6. Phone menu
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const m = await mctx.newPage(); watch(m, 'phone-menu');
  await m.goto(BASE, { waitUntil: 'networkidle' });
  const btn = m.getByRole('button', { name: 'Menu' });
  ok('phone menu: closed by default', (await btn.getAttribute('aria-expanded')) === 'false' && !(await m.locator('#site-menu').isVisible()));
  await btn.click();
  ok('phone menu: opens with all destinations', (await m.locator('#site-menu').getByRole('link').allInnerTexts()).join('|') === 'Product|How it works|Developers|Documentation|Launch App');
  await m.keyboard.press('Escape');
  ok('phone menu: Escape closes it', !(await m.locator('#site-menu').isVisible()));
  await m.getByRole('button', { name: 'Menu' }).click();
  await m.locator('#site-menu').getByRole('link', { name: 'Documentation' }).click(); await m.waitForURL('**/docs');
  ok('phone menu: a link navigates and closes the menu', !(await m.locator('#site-menu').isVisible()));
  const small = await m.evaluate(() => [...document.querySelectorAll('a,button')].filter((e) => e.offsetParent && !e.closest('p,li:not(nav li)') && e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height < 24).map((e) => e.textContent.trim()));
  ok('phone: no control is shorter than 24px', small.length === 0, small.join(','));
  await mctx.close();

  // 7. Reduced motion: nothing is hidden waiting for an animation
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const r = await rctx.newPage(); await r.goto(BASE, { waitUntil: 'networkidle' });
  const hidden = await r.evaluate(() => [...document.querySelectorAll('[data-reveal]')].filter((e) => getComputedStyle(e).opacity === '0').length);
  const moving = await r.evaluate(() => document.getAnimations().length);
  ok('reduced motion: all content visible, nothing animating', hidden === 0 && moving === 0, `${hidden} hidden, ${moving} animations`);
  await rctx.close();
  // With motion allowed, everything reveals after scrolling.
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await actx.newPage(); await a.goto(BASE, { waitUntil: 'networkidle' }); await settle(a); await a.waitForTimeout(900);
  const still = await a.evaluate(() => [...document.querySelectorAll('[data-reveal]')].filter((e) => !e.classList.contains('is-in')).length);
  ok('motion: every section reveals after scrolling through the page', still === 0, `${still} not revealed`);
  await actx.close();

  ok('no console errors, page errors or failed requests', errors.length === 0, [...new Set(errors)].slice(0, 6).join(' || '));
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2));
  await browser.close();
  process.exit(results.every((x) => x.pass) ? 0 : 1);
})().catch((e) => { console.error('CHECK CRASHED:', e.message); process.exit(2); });
