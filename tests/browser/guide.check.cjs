/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for the in-app Guide (not part of `npm test`).
 *   node tests/browser/guide.check.cjs <baseUrl> <outDir>
 * REAL: production build, real sign-in (simulated wallet). Opens Guide from the nav (desktop) and account menu (phone).
 */
const { chromium, devices } = require('playwright');
const { privateKeyToAccount, generatePrivateKey } = require(require.resolve('viem/accounts', { paths: [process.cwd()] }));
const fs = require('fs');
const [,, BASE = 'http://localhost:3100', OUT = '/tmp/spak-guide'] = process.argv;
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
const TOPICS = ['Getting started', 'Make a transfer', 'Review and confirm', 'Pay someone', 'Recurring payments', 'Tracking and Activity', 'Failures and refunds', 'Intelligence', 'SPak Guard', 'SPak Agent', 'Wallets and networks'];

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
    await page.getByRole('dialog').waitFor({ timeout: 20000 });
    await page.keyboard.press('Escape');
    if (label === 'desktop') await page.getByRole('navigation').getByRole('button', { name: 'Guide' }).first().click();
    else { await page.locator('[data-tour="account"]').first().click(); await page.getByRole('menuitem', { name: 'Guide' }).click(); }
    await page.locator('[data-guide]').waitFor({ timeout: 10000 });
    ok(`${label}: Guide opens from ${label === 'desktop' ? 'the sidebar' : 'the account menu'}`, true);
    const options = label === 'desktop'
      ? await page.getByRole('navigation', { name: 'Guide topics' }).locator('ul button').allInnerTexts()
      : await page.locator('#guide-topic option').allInnerTexts();
    ok(`${label}: all ${TOPICS.length} topics listed in order`, JSON.stringify(options) === JSON.stringify(TOPICS), options.join(' | '));
    // Pick the Agent topic
    if (label === 'desktop') await page.getByRole('navigation', { name: 'Guide topics' }).getByRole('button', { name: 'SPak Agent' }).click();
    else await page.locator('#guide-topic').selectOption('agent');
    ok(`${label}: picking a topic shows it`, (await page.locator('#guide-title').innerText()) === 'SPak Agent');
    ok(`${label}: topic has numbered steps and what SPak checks`, (await page.locator('[data-guide-topic] ol li').count()) >= 5 && await page.getByText('What SPak checks').isVisible());
    await page.getByRole('button', { name: /^Next: / }).click();
    ok(`${label}: Next moves to the following topic`, (await page.locator('#guide-title').innerText()) === 'Wallets and networks');
    await page.screenshot({ path: `${OUT}/${label}-topic.png`, fullPage: true });
    await page.fill('#guide-search', 'refund');
    const filtered = label === 'desktop' ? await page.getByRole('navigation', { name: 'Guide topics' }).locator('ul button').allInnerTexts() : await page.locator('#guide-topic option').allInnerTexts();
    ok(`${label}: search narrows the topics`, filtered.length > 0 && filtered.length < TOPICS.length && filtered.includes('Failures and refunds'), filtered.join(' | '));
    await page.fill('#guide-search', '');
    if (label === 'desktop') await page.getByRole('navigation', { name: 'Guide topics' }).getByRole('button', { name: 'SPak Guard' }).click();
    else await page.locator('#guide-topic').selectOption('guard');
    await page.getByRole('button', { name: 'Open SPak Guard' }).click();
    await page.waitForTimeout(500);
    ok(`${label}: the open button goes to the feature`, !(await page.locator('[data-guide]').count()));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`${label}: no horizontal overflow`, over <= 0, String(over));
    ok(`${label}: no page errors`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await browser.close();
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.log('CHECK CRASHED: ' + e.message); process.exit(1); });
