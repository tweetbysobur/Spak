/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for SPak Intelligence (not part of `npm test`).
 *
 *   node tests/browser/intelligence.check.cjs <baseUrl> <outDir> [snapshot.json]
 *
 * Part 1, REAL: production build, real sign-in (simulated wallet: a fresh empty address), real balance reads on
 * mainnet RPCs, real SPak-in, real portfolio answer and balance check.
 * Part 2, SUBSTITUTED DATA: when a snapshot file is given, /api/intelligence/portfolio is answered in the browser with
 * that file (a live read of public wallets) so the screen can be reviewed with holdings. Labelled in the output.
 */
const { chromium, devices } = require('playwright');
const { privateKeyToAccount, generatePrivateKey } = require(require.resolve('viem/accounts', { paths: [process.cwd()] }));
const fs = require('fs');
const [,, BASE = 'http://localhost:3100', OUT = '/tmp/spak-intel', SNAP] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const account = privateKeyToAccount(generatePrivateKey());
const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); };
const PROVIDER = (address) => `(() => {
  const addr = ${JSON.stringify(address)};
  const provider = { request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [addr];
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'personal_sign') return await window.__spakSign(params[0]);
    throw Object.assign(new Error('Unsupported in test wallet: ' + method), { code: 4200 });
  }, on() {}, removeListener() {} };
  const info = { uuid: 'spak-test-wallet', name: 'Test Wallet (simulated)', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'dev.spak.test' };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce); announce();
})();`;

(async () => {
  const browser = await chromium.launch();
  const run = async (label, opts, substitute) => {
    const ctx = await browser.newContext(opts);
    await ctx.exposeFunction('__spakSign', async (hex) => account.signMessage({ message: { raw: hex } }));
    await ctx.addInitScript(PROVIDER(account.address));
    if (substitute) await ctx.route('**/api/intelligence/portfolio*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(substitute) }));
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('button', { name: /Test Wallet \(simulated\)/ }).click();
    await page.locator('nav[aria-label=App]:visible').first().waitFor({ timeout: 20000 });
    const navItem = page.locator('nav[aria-label=App] button:visible', { hasText: 'Intelligence' });
    if (await navItem.count()) await navItem.first().click();
    else { await page.locator('button[aria-haspopup=menu]:visible').first().click(); await page.getByRole('menuitem', { name: 'Intelligence' }).click(); } // phone: account menu
    await page.getByText('SPak Intelligence').first().waitFor({ timeout: 15000 });
    await page.getByText(/Read at|Cached, read at/).first().waitFor({ timeout: 90000 });
    return { ctx, page, errs };
  };

  // Part 1: REAL, empty wallet
  {
    const { ctx, page, errs } = await run('real', { viewport: { width: 1280, height: 900 } });
    ok('REAL: Intelligence screen loads with a read time', true);
    ok('REAL: empty wallet shows the empty state, no invented balances', await page.getByText('No balances found').isVisible());
    ok('REAL: total shows $0.00 for an empty wallet', await page.getByText('$0.00').first().isVisible());
    await page.getByRole('button', { name: 'How much USDC do I have?' }).click();
    await page.getByText('SPak found no USDC in your connected wallets.').waitFor({ timeout: 60000 });
    ok('REAL: portfolio question answered from real balances (none)', true);
    await page.screenshot({ path: `${OUT}/intel-real-empty.png`, fullPage: true });
    await page.locator('nav[aria-label=App] button:visible', { hasText: 'Execute' }).first().click();
    await page.getByLabel('Instruction').fill('Move 20 USDC from Base to Arbitrum');
    await page.getByRole('button', { name: 'Send' }).click();
    try { await page.getByText('Not enough USDC on Base yet.').waitFor({ timeout: 60000 }); } catch (e) { console.log('CHAT:', (await page.locator('[aria-live=polite]').first().innerText()).replace(/\s+/g, ' ').slice(0, 600)); throw e; }
    ok('REAL: an unfunded transfer is flagged with the real balance before the quote', await page.getByText('You have 0 USDC on Base in this wallet; this transfer needs 20.').isVisible());
    await page.getByText('Review the estimate').waitFor({ timeout: 60000 });
    ok('REAL: the quote still loads, so the user can fund the wallet after seeing it', true);
    await page.screenshot({ path: `${OUT}/intel-real-insufficient.png`, fullPage: true });
    ok('REAL: no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  // Part 2: SUBSTITUTED DATA (live read of public wallets), desktop and phone
  if (SNAP) {
    for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]]) {
      const { ctx, page, errs } = await run(name, opts, SNAP);
      ok(`SUBSTITUTED (${name}): holdings, distribution and insights render`, await page.getByText('By network').isVisible() && await page.getByText('Insights').first().isVisible());
      ok(`SUBSTITUTED (${name}): no horizontal overflow`, (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
      await page.screenshot({ path: `${OUT}/intel-substituted-${name}.png`, fullPage: true });
      ok(`SUBSTITUTED (${name}): no page errors`, errs.length === 0, errs.join(' | '));
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('CHECK CRASHED:', e.message); process.exit(2); });
