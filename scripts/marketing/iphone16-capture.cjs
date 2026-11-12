/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * iPhone 16 captures of the SPak site, ready for Figma.
 *
 *   node scripts/marketing/iphone16-capture.cjs <baseUrl> <outDir>
 *   e.g. node scripts/marketing/iphone16-capture.cjs https://usespak.vercel.app ./iphone16
 *
 * iPhone 16: 393 x 852 points at 3x, so every screen PNG is 1179 x 2556, the device's native resolution.
 * In Figma: create an "iPhone 16" frame (393 x 852) and drop a screen PNG in; it fits exactly.
 * Output per page and theme: one PNG per screen height (scrolled, as a person would see it) and one full-page PNG.
 * Emulated in Chromium with the iPhone user agent and touch; this is not Apple's iOS Simulator.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const [,, BASE = 'http://localhost:3100', OUT = 'iphone16'] = process.argv;
const PAGES = [['home', '/'], ['docs', '/docs'], ['developers', '/developers'], ['app', '/app']];
const IPHONE16 = {
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ ...IPHONE16, colorScheme: theme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    for (const [name, path] of PAGES) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      // Scroll once through the page so lazy images and reveal animations are in their final state.
      for (let y = 0; y < h; y += 600) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(60); }
      await page.waitForLoadState('networkidle');
      const screens = Math.ceil(h / 852);
      for (let i = 0; i < screens; i++) {
        await page.evaluate((v) => window.scrollTo(0, v), Math.min(i * 852, h - 852));
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${OUT}/iPhone16-${name}-${theme}-${String(i + 1).padStart(2, '0')}.png` });
      }
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150);
      await page.screenshot({ path: `${OUT}/iPhone16-${name}-${theme}-full.png`, fullPage: true });
      console.log(`${theme} ${name}: ${screens} screens, page ${h}pt tall`);
    }
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error('CAPTURE FAILED:', e.message); process.exit(1); });
