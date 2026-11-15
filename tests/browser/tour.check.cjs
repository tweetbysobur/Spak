/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for the first-run guided tour (not part of `npm test`).
 *   node tests/browser/tour.check.cjs <baseUrl> <outDir>
 * REAL: production build, real sign-in (simulated wallet), real screens behind each step.
 */
const { chromium, devices } = require('playwright');
const { privateKeyToAccount, generatePrivateKey } = require(require.resolve('viem/accounts', { paths: [process.cwd()] }));
const fs = require('fs');
const [,, BASE = 'http://localhost:3100', OUT = '/tmp/spak-tour'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); };
const PROVIDER = (address) => `(() => {
  const addr = ${JSON.stringify(address)};
  const provider = { request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [addr];
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'personal_sign') return await window.__spakSign(params[0]);
    throw Object.assign(new Error('Unsupported: ' + method), { code: 4200 });
  }, on() {}, removeListener() {} };
  const info = { uuid: 'spak-test-wallet', name: 'Test Wallet (simulated)', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'dev.spak.test' };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce); announce();
})();`;
const TITLES = ['Welcome to SPak', 'Overview', 'Execute', 'Activity', 'Intelligence', 'SPak Guard', 'Agent', 'Settings and wallets', 'Your account', 'You are ready'];

(async () => {
  const browser = await chromium.launch();
  for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 860 } }], ['phone', { ...devices['iPhone 13'] }]]) {
    const account = privateKeyToAccount(generatePrivateKey());
    const ctx = await browser.newContext(opts);
    await ctx.exposeFunction('__spakSign', async (hex) => account.signMessage({ message: { raw: hex } }));
    await ctx.addInitScript(PROVIDER(account.address));
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('button', { name: /Test Wallet \(simulated\)/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 20000 });
    ok(`${label}: tour opens after first sign-in`, (await dialog.getAttribute('aria-modal')) === 'true');
    await page.waitForTimeout(350); await page.screenshot({ path: `${OUT}/${label}-00.png` });
    let allAnchored = true;
    for (let i = 0; i < TITLES.length; i++) {
      const title = await page.locator('#tour-title').innerText();
      if (title !== TITLES[i]) { ok(`${label}: step ${i + 1} title`, false, title); break; }
      await page.waitForTimeout(350); // let the outline and card settle (200 ms transitions)
      const needs = i !== 0 && i !== TITLES.length - 1;
      if (needs) {
        // The outline must surround the visible anchor for this step (its nav item, or the account menu on phones).
        const ring = await page.locator('div.ring-2.ring-primary').boundingBox();
        const anchorId = ['overview', 'execute', 'activity', 'portfolio', 'guard', 'agent', 'settings', 'account'][i - 1];
        const box = await page.evaluate((id) => { const el = [...document.querySelectorAll(`[data-tour="${id}"]`)].find((e) => e.offsetParent !== null) ?? [...document.querySelectorAll('[data-tour="account"]')].find((e) => e.offsetParent !== null); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, anchorId);
        const fits = ring && Math.abs(ring.x - (box.x - 4)) <= 2 && Math.abs(ring.y - (box.y - 4)) <= 2 && Math.abs(ring.width - (box.w + 8)) <= 2;
        if (!fits) { allAnchored = false; console.log(`  step ${i + 1} outline ${JSON.stringify(ring)} vs anchor ${JSON.stringify(box)}`); }
      }
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 0) ok(`${label}: step ${i + 1} no horizontal overflow`, false, String(over));
      if (i === 3) await page.screenshot({ path: `${OUT}/${label}-03-activity.png` });
      if (i === 4) await page.screenshot({ path: `${OUT}/${label}-04-intelligence.png` });
      if (i < TITLES.length - 1) await page.getByRole('dialog').getByRole('button', { name: i === 0 ? 'Start' : 'Next', exact: true }).click();
    }
    ok(`${label}: all ${TITLES.length} steps in order`, (await page.locator('#tour-title').innerText()) === 'You are ready');
    ok(`${label}: every feature step outlines a visible anchor`, allAnchored);
    await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
    ok(`${label}: Back returns to the previous step`, (await page.locator('#tour-title').innerText()) === 'Your account');
    await page.keyboard.press('ArrowRight');
    await page.screenshot({ path: `${OUT}/${label}-09-ready.png` });
    await page.getByRole('dialog').getByRole('button', { name: 'Make your first transfer' }).click();
    await page.getByLabel('Instruction').waitFor({ timeout: 10000 });
    ok(`${label}: finishing opens Execute`, (await dialog.count()) === 0);
    await page.reload();
    await page.locator('nav[aria-label=App]:visible').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    ok(`${label}: not shown again after reload`, (await page.getByRole('dialog').count()) === 0);
    await page.locator('button[aria-haspopup=menu]:visible').first().click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();
    await page.getByRole('dialog').waitFor({ timeout: 5000 });
    ok(`${label}: replay from the account menu`, (await page.locator('#tour-title').innerText()) === 'Welcome to SPak');
    await page.keyboard.press('Escape');
    ok(`${label}: Esc closes the tour`, (await page.getByRole('dialog').count()) === 0);
    ok(`${label}: no page errors`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('CHECK CRASHED:', e.message); process.exit(2); });
