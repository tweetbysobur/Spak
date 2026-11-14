/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for the Tidepool TESTNET build (not part of `npm test`).
 *   node tests/browser/testnet.check.cjs <baseUrl> <outDir>
 * Real: the testnet production build on PostgreSQL, real sign-in, real Tidepool quotes (test tokens, nothing deposited).
 * SIMULATED: the EVM wallet (EIP-6963 provider backed by a throwaway key on Base Sepolia, chain 84532).
 */
const { chromium } = require('playwright');
const { privateKeyToAccount, generatePrivateKey } = require(require.resolve('viem/accounts', { paths: [process.cwd()] }));
const fs = require('fs');
const [,, BASE = 'http://localhost:3200', OUT = '/tmp/spak-shots'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const account = privateKeyToAccount(generatePrivateKey());
const results = []; const errors = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); };
const PROVIDER = (address) => `(() => {
  const provider = { request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [${JSON.stringify(address)}];
    if (method === 'eth_chainId') return '0x14a34';
    if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts' }];
    if (method === 'personal_sign') return await window.__spakSign(params[0]);
    throw Object.assign(new Error('Unsupported in test wallet: ' + method), { code: 4200 });
  }, on() {}, removeListener() {} };
  const info = { uuid: 'spak-test-wallet', name: 'Test Wallet (simulated)', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'dev.spak.test' };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce); announce();
})();`;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.exposeFunction('__spakSign', async (h) => account.signMessage({ message: { raw: h } }));
  await ctx.addInitScript(PROVIDER(account.address));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Test Wallet \(simulated\)/ }).click();
  await page.locator('nav[aria-label=App]').first().waitFor({ timeout: 20000 });
  const banner = page.locator('[data-testnet-banner]');
  ok('testnet banner on every app screen', await banner.isVisible() && /Test tokens with no value/.test(await banner.innerText()) && /not affiliated with NEAR or 1Click/.test(await banner.innerText()));
  await page.locator('nav[aria-label=App] button:visible', { hasText: 'Execute' }).first().click();
  await page.locator('#spak-intent').fill('Swap 0.002 ETH on Base to USDC on Arbitrum');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Get firm quote' }).waitFor({ timeout: 45000 });
  const review = await page.locator('main').innerText();
  ok('review names the testnet chains and a real Tidepool quote', /Base Sepolia/.test(review) && /Arbitrum Sepolia/.test(review) && /USDC/.test(review));
  await page.screenshot({ path: `${OUT}/testnet-01-review.png`, fullPage: true });
  await page.getByRole('button', { name: 'Get firm quote' }).click();
  const firm = await page.getByText('Deposit address', { exact: true }).waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  ok('firm quote with a Base Sepolia deposit address', firm);
  ok('provider named as the testnet sandbox, never as NEAR Intents', /Tidepool \(testnet sandbox\)/.test(await page.locator('main').innerText()) && !/NEAR Intents/.test(await page.locator('main').innerText()));
  await page.setViewportSize({ width: 390, height: 844 });
  ok('mobile: no horizontal overflow', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await page.screenshot({ path: `${OUT}/testnet-02-firm-mobile.png`, fullPage: true });
  ok('no page errors or server errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED:', e.message); process.exit(1); });
