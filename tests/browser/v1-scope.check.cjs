/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for the Mainnet V1 scope (routes and Coming Soon) (not part of `npm test`).
 *
 *   node tests/browser/v1-scope.check.cjs <baseUrl> <outDir>
 *
 * Real: production build, real sign-in flow (signature verified by the server), real NEAR Intents quotes (no funds).
 * SIMULATED: the wallet (an EIP-6963 provider whose signatures come from a throwaway key held by this script), and
 * the failure/refund/completed tracking screens (API responses replaced in the browser only, marked "mocked").
 */
const { chromium } = require('playwright');
const { privateKeyToAccount, generatePrivateKey } = require(require.resolve('viem/accounts', { paths: [process.cwd()] }));
const fs = require('fs');
const [,, BASE = 'http://localhost:3100', OUT = '/tmp/spak-shots'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const APP = `${BASE}/app`; // the application route; the marketing site is at "/"
const account = privateKeyToAccount(generatePrivateKey());
const results = []; const errors = [];
const go = (pg, label) => pg.locator('nav[aria-label=App] button:visible', { hasText: label }).first().click();
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); };

const PROVIDER = (address) => `(() => {
  const addr = ${JSON.stringify(address)};
  const provider = { request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [addr];
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts' }];
    if (method === 'personal_sign') return await window.__spakSign(params[0]);
    throw Object.assign(new Error('Unsupported in test wallet: ' + method), { code: 4200 });
  }, on() {}, removeListener() {} };
  const info = { uuid: 'spak-test-wallet', name: 'Test Wallet (simulated)', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'dev.spak.test' };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce); announce();
})();`;

async function overflow(page) { return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); }
async function shot(page, name) { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); }



(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.exposeFunction('__spakSign', async (hex) => account.signMessage({ message: { raw: hex } }));
  await ctx.addInitScript(PROVIDER(account.address));
  const page = await ctx.newPage();
  const creates = [];
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/executions') creates.push(1); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Test Wallet \(simulated\)/ }).click();
  await page.locator('nav[aria-label=App]').first().waitFor({ timeout: 20000 });

  await go(page, 'Execute');
  await page.getByRole('tab', { name: 'Manual form' }).click();
  await page.locator('[data-v1-scope]').waitFor();
  const opts = async (label) => page.getByLabel(label).locator('option').allInnerTexts();
  const from = await opts('From network'), to = await opts('To network');
  ok('From network: EVM and Solana only, no NEAR', from.includes('Base') && from.includes('Solana') && !from.includes('NEAR') && !from.includes('Bitcoin'), from.join(','));
  ok('To network: EVM and Solana only; no NEAR, no unverifiable networks', to.includes('Arbitrum') && to.includes('Solana') && !to.includes('NEAR') && !['Bitcoin', 'Tron', 'Sui', 'XRP Ledger', 'Dogecoin', 'Litecoin', 'TON', 'Stellar', 'Aptos'].some((n) => to.includes(n)), to.join(','));
  await page.getByLabel('To network').selectOption('arbitrum');
  const recv = await opts('Receive asset');
  ok('Receive asset on Arbitrum: tokens only, no native ETH', recv.includes('USDC') && !recv.includes('ETH'), recv.join(','));
  ok('the restriction is explained in the form', /NEAR.*not available yet/.test(await page.locator('[data-v1-scope]').innerText()));
  await shot(page, 'v1-01-manual-form');

  await page.getByRole('tab', { name: 'Instruction' }).click();
  await page.getByLabel('Instruction').fill('Swap 100 USDC on Base to ETH on Arbitrum');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('This route is not available yet.').waitFor({ timeout: 20000 });
  ok('typed unsupported route is explained and stopped before any execution is created', creates.length === 0 && /native coin/.test(await page.locator('main').innerText()));
  await shot(page, 'v1-02-instruction-blocked');

  for (const [nav, n] of [['Agent', 5], ['Portfolio', 1], ['Settings', 2]]) {
    await go(page, nav);
    const box = page.locator('[data-coming-soon]');
    await box.waitFor();
    ok(`${nav}: ${n} Coming soon item(s), no controls`, (await box.locator('[data-feature]').count()) === n && (await box.locator('button, a, input, select').count()) === 0);
  }
  await go(page, 'Agent');
  await shot(page, 'v1-03-agent-coming-soon');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-coming-soon]').waitFor();
  ok('mobile: no horizontal overflow', (await overflow(page)) <= 0);
  ok('no page errors or server errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED:', e.message); process.exit(1); });
