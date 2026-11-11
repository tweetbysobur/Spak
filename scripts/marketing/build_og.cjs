/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Builds the Open Graph image (1200 x 630) from the live homepage, so it uses the real fonts, the approved logo
 * file and the hero composition exactly as the site renders them.
 *
 *   node scripts/marketing/build_og.cjs <baseUrl>      (default http://localhost:3100)
 * Output: public/marketing/spak-og.png
 */
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:3100';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' })).newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const art = document.querySelector('svg.mkt-art-lg').cloneNode(true);
    art.removeAttribute('class'); art.setAttribute('class', 'mkt-art mkt-art-lg');
    art.style.cssText = 'position:absolute;right:56px;top:96px;width:520px;height:auto';
    const o = document.createElement('div');
    o.className = 'mkt';
    o.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--spak-background);';
    o.innerHTML = `
      <img src="/brand/logo/spak-logo-horizontal.svg" alt="" style="position:absolute;left:72px;top:64px;height:44px">
      <div class="type-display-xl" style="position:absolute;left:72px;top:208px;width:600px;font-size:72px;color:var(--spak-text-primary)">Intelligent execution <em class="type-editorial-accent">across chains.</em></div>
      <div class="type-lead" style="position:absolute;left:72px;bottom:64px;width:560px;color:var(--spak-text-secondary)">Turn intentions into controlled, verifiable actions across blockchain networks.</div>`;
    o.appendChild(art);
    document.body.appendChild(o);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'public/marketing/spak-og.png' });
  await browser.close();
  console.log('saved public/marketing/spak-og.png');
})().catch((e) => { console.error('OG BUILD FAILED:', e.message); process.exit(1); });
