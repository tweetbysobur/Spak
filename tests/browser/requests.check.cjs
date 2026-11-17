/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for the payment requests: payee creates and shares a link; payer opens it, signs in and reaches the payment review (not part of `npm test`).
 *   node tests/browser/requests.check.cjs <baseUrl> <outDir>
 * REAL: production build, real sign-in, real NEAR Intents quotes. SIMULATED: both wallets (throwaway keys, no funds). Stops before any signature: nothing is sent.
 */
const { chromium, devices } = require('playwright');
const { privateKeyToAccount, generatePrivateKey } = require(require.resolve('viem/accounts', { paths: [process.cwd()] }));
const fs = require('fs');
const [,, BASE = 'http://localhost:3100', OUT = '/tmp/spak-requests'] = process.argv;
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

async function signIn(browser, opts) {
  const account = privateKeyToAccount(generatePrivateKey());
  const ctx = await browser.newContext(opts);
  await ctx.exposeFunction('__spakSign', async (hex) => account.signMessage({ message: { raw: hex } }));
  await ctx.addInitScript(PROVIDER(account.address));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  return { ctx, page, errs, address: account.address };
}

(async () => {
  const browser = await chromium.launch();
  for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]]) {
    // Payee
    const a = await signIn(browser, opts);
    await a.page.goto(`${BASE}/app`);
    await a.page.getByRole('button', { name: /Test Wallet \(simulated\)/ }).click();
    await a.page.getByRole('dialog').waitFor({ timeout: 20000 }); await a.page.keyboard.press('Escape');
    if (label === 'desktop') await a.page.getByRole('navigation').getByRole('button', { name: 'Payments' }).first().click();
    else { await a.page.locator('[data-tour="account"]').first().click(); await a.page.getByRole('menuitem', { name: 'Payments' }).click(); }
    await a.page.locator('[data-requests]').waitFor({ timeout: 15000 });
    await a.page.getByRole('button', { name: 'New request' }).click();
    await a.page.locator('input[name="requestAmount"]').fill('5');
    await a.page.locator('[data-create-request]').getByLabel('Network').selectOption('arbitrum');
    await a.page.locator('input[name="requestNote"]').fill('Design review');
    const paidTo = await a.page.locator('[data-create-request]').getByLabel('Paid to your wallet').inputValue();
    ok(`${label}: the request is paid to the payee's own wallet`, paidTo.toLowerCase() === a.address.toLowerCase(), paidTo);
    await a.page.getByRole('button', { name: 'Create request' }).click();
    await a.page.locator('[data-request="OPEN"]').first().waitFor({ timeout: 15000 });
    const link = (await a.page.locator('[data-request-link]').first().innerText()).trim();
    ok(`${label}: the open request shows its amount, note and a shareable link`, /\/app\?pay=[A-Za-z0-9_-]{32}$/.test(link) && /5\s*USDC/.test(await a.page.locator('[data-request="OPEN"]').first().innerText()), link);
    let over = await a.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`${label}: payee screen has no horizontal overflow`, over <= 0, String(over));
    await a.page.screenshot({ path: `${OUT}/${label}-payee.png`, fullPage: true });

    // Payer
    const b = await signIn(browser, opts);
    await b.page.goto(link);
    await b.page.locator('[data-request-preview]').getByText('Paid to').waitFor({ timeout: 15000 });
    const preview = await b.page.locator('[data-request-preview]').innerText();
    ok(`${label}: signed out, the link shows the request above sign-in`, /5\s*USDC/.test(preview) && /Arbitrum/.test(preview) && /Design review/.test(preview) && preview.toLowerCase().includes(a.address.toLowerCase()), preview.replace(/\s+/g, ' ').slice(0, 120));
    await b.page.screenshot({ path: `${OUT}/${label}-link.png`, fullPage: true });
    await b.page.getByRole('button', { name: /Test Wallet \(simulated\)/ }).click();
    await b.page.locator('[data-pay-request]').waitFor({ timeout: 20000 });
    ok(`${label}: after sign-in the payer sees the pay card, with no tour in the way`, !(await b.page.getByRole('dialog').count()));
    await b.page.locator('[data-pay-request]').getByLabel('Network').selectOption('base');
    await b.page.getByRole('button', { name: 'Continue to review' }).click();
    await b.page.getByText('Check the payment, then confirm').waitFor({ timeout: 60000 });
    const payee = await b.page.locator('[data-payment-recipient]').innerText();
    ok(`${label}: the review pays the payee's address on Arbitrum`, payee.toLowerCase().includes(a.address.toLowerCase()) && /Arbitrum/.test(payee));
    const minText = await b.page.getByText('Minimum the recipient receives').locator('xpath=..').innerText();
    const min = Number((minText.match(/([\d.]+)\s*USDC/) || [])[1]);
    ok(`${label}: the minimum the payee receives is at least the requested 5 USDC`, min >= 5, String(min));
    ok(`${label}: one action, confirm and pay`, await b.page.getByRole('button', { name: /^Confirm and pay / }).isVisible());
    ok(`${label}: the link is cleared from the address bar`, !b.page.url().includes('pay='));
    over = await b.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`${label}: payer screen has no horizontal overflow`, over <= 0, String(over));
    await b.page.screenshot({ path: `${OUT}/${label}-review.png`, fullPage: true });

    ok(`${label}: no page errors`, a.errs.length === 0 && b.errs.length === 0, [...a.errs, ...b.errs].join(' | '));
    await a.ctx.close(); await b.ctx.close();
  }
  await browser.close();
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.log('CHECK CRASHED: ' + e.message); process.exit(1); });
