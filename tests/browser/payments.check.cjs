/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for the one-time payment flow up to the wallet signature (not part of `npm test`).
 *   node tests/browser/payments.check.cjs <baseUrl> <outDir>
 * REAL: production build, real sign-in, real NEAR Intents quote. SIMULATED: the wallet (throwaway key, no funds). Stops before any signature: nothing is sent.
 */
const { chromium, devices } = require('playwright');
const { privateKeyToAccount, generatePrivateKey } = require(require.resolve('viem/accounts', { paths: [process.cwd()] }));
const fs = require('fs');
const [,, BASE = 'http://localhost:3100', OUT = '/tmp/spak-payments'] = process.argv;
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
const PAYEE = '0x1111111111111111111111111111111111111111';

(async () => {
  const browser = await chromium.launch();
  for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]]) {
    const account = privateKeyToAccount(generatePrivateKey());
    const ctx = await browser.newContext(opts);
    await ctx.exposeFunction('__spakSign', async (hex) => account.signMessage({ message: { raw: hex } }));
    await ctx.addInitScript(PROVIDER(account.address));
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const creates = []; page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/executions$/.test(r.url())) creates.push(r.url()); });
    await page.goto(`${BASE}/app`);
    await page.getByRole('button', { name: /Test Wallet \(simulated\)/ }).click();
    await page.getByRole('dialog').waitFor({ timeout: 20000 });
    await page.keyboard.press('Escape');
    if (label === 'desktop') await page.getByRole('navigation').getByRole('button', { name: 'Execute' }).first().click();
    else await page.getByRole('button', { name: 'Execute' }).last().click();
    await page.getByRole('tab', { name: 'Instruction' }).click();
    await page.getByLabel('Instruction').fill(`Pay 5 USDC from Base to ${PAYEE} on Arbitrum`);
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText('Check the payment, then confirm').waitFor({ timeout: 60000 });
    ok(`${label}: a payment instruction reaches the payment review with a real quote`, creates.length === 1);
    const payee = await page.locator('[data-payment-recipient]').innerText();
    ok(`${label}: the review leads with the payee address and network`, payee.includes(PAYEE) && /Arbitrum/.test(payee), payee.replace(/\s+/g, ' '));
    ok(`${label}: minimum is labelled as what the recipient receives`, await page.getByText('Minimum the recipient receives').isVisible());
    ok(`${label}: one action names the payment and amount`, await page.getByRole('button', { name: 'Confirm and pay 5 USDC' }).isVisible());
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`${label}: no horizontal overflow`, over <= 0, String(over));
    await page.screenshot({ path: `${OUT}/${label}-review.png`, fullPage: true });
    // Activity: the payment is listed with its payee and can be filtered as a payment
    if (label === 'desktop') await page.getByRole('navigation').getByRole('button', { name: 'Activity' }).first().click();
    else await page.getByRole('button', { name: 'Activity' }).last().click();
    await page.getByLabel('Filter by type').selectOption('EXTERNAL');
    const row = await page.locator('ul li button').first().innerText();
    ok(`${label}: Activity lists it under payments with the payee`, /Paid to 0x1111…1111/.test(row), row.replace(/\s+/g, ' '));
    await page.getByLabel('Filter by type').selectOption('SELF');
    ok(`${label}: the transfers-to-your-wallets filter excludes it`, (await page.locator('ul li button').count()) === 0);
    ok(`${label}: no page errors`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await browser.close();
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.log('CHECK CRASHED: ' + e.message); process.exit(1); });
