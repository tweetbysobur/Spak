/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for the recurring payments: create, prepare, review, pause, resume, cancel (not part of `npm test`).
 *   node tests/browser/recurring.check.cjs <baseUrl> <outDir>
 * REAL: production build, real sign-in, real NEAR Intents quote for the prepared payment. SIMULATED: the wallet (throwaway key, no funds). Stops before any signature: nothing is sent.
 */
const { chromium, devices } = require('playwright');
const { privateKeyToAccount, generatePrivateKey } = require(require.resolve('viem/accounts', { paths: [process.cwd()] }));
const fs = require('fs');
const [,, BASE = 'http://localhost:3100', OUT = '/tmp/spak-recurring'] = process.argv;
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

async function nav(page, label, name) {
  if (label === 'desktop') return page.getByRole('navigation').getByRole('button', { name }).first().click();
  await page.locator('[data-tour="account"]').first().click();
  return page.getByRole('menuitem', { name }).click();
}

(async () => {
  const browser = await chromium.launch();
  for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]]) {
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
    await nav(page, label, 'Payments');
    await page.locator('[data-payments]').waitFor({ timeout: 15000 });
    ok(`${label}: Payments opens with an empty state`, await page.getByText('No recurring payments yet').waitFor({ timeout: 15000 }).then(() => true, () => false));
    await page.getByRole('button', { name: 'New recurring payment' }).click();
    await page.locator('input[name="name"]').fill('Hosting');
    await page.locator('input[name="amount"]').fill('5');
    await page.locator('input[name="recipient"]').fill(PAYEE);
    await page.getByLabel("Recipient's network").selectOption('arbitrum');
    await page.getByLabel('How often').selectOption('MONTHLY');
    await page.getByLabel('Ends').selectOption('count');
    await page.locator('input[name="count"]').fill('3');
    await page.getByRole('button', { name: 'Review schedule' }).click();
    const summary = page.locator('[data-schedule-summary]');
    await summary.waitFor({ timeout: 10000 }).catch(async (e) => { console.log('FORM STATE: ' + (await page.locator('[data-payments]').innerText()).replace(/\s+/g, ' ').slice(0, 900)); throw e; });
    const st = (await summary.innerText()).replace(/\s+/g, ' ');
    ok(`${label}: summary shows amount, payee, recurrence and first dates before anything is created`, /5 USDC/.test(st) && st.includes(PAYEE) && /Every month on day \d+/.test(st) && /3 payments/.test(st) && /First payments: \d{1,2} \w{3} \d{4}, \d{1,2} \w{3}/.test(st), st.slice(0, 160));
    await page.getByRole('button', { name: 'Create schedule' }).click();
    const card = page.locator('[data-schedule]').first();
    await card.waitFor({ timeout: 30000 });
    // Today's payment is prepared when the list loads: a real quote, waiting for review and signature.
    await page.reload(); await page.getByRole('dialog').waitFor({ timeout: 3000 }).then(() => page.keyboard.press('Escape')).catch(() => undefined);
    await nav(page, label, 'Payments');
    await page.locator('[data-occurrence="PREPARED"]').first().waitFor({ timeout: 60000 });
    ok(`${label}: today's payment is prepared and shown as ready to review and sign, once`, /Ready to review and sign/.test(await page.locator('[data-occurrence]').first().innerText()) && (await page.getByRole('button', { name: 'Review and sign' }).count()) === 1);
    ok(`${label}: schedule shows active status and the next date`, /Active/.test(await card.innerText()) && await card.locator('[data-next-date]').isVisible());
    await page.screenshot({ path: `${OUT}/${label}-list.png`, fullPage: true });
    await page.getByRole('button', { name: 'Review and sign' }).first().click();
    await page.getByText('Check the payment, then confirm').waitFor({ timeout: 60000 });
    ok(`${label}: Review and sign opens the normal payment review with a fresh quote`, await page.getByRole('button', { name: 'Confirm and pay 5 USDC' }).isVisible() && (await page.locator('[data-payment-recipient]').innerText()).includes(PAYEE));
    await nav(page, label, 'Payments');
    await page.locator('[data-schedule]').first().waitFor();
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('button', { name: 'Resume' }).waitFor({ timeout: 10000 });
    ok(`${label}: pause shows Paused and hides the next date`, /Paused/.test(await page.locator('[data-schedule]').first().innerText()) && !(await page.locator('[data-next-date]').count()));
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.getByRole('button', { name: 'Pause' }).waitFor({ timeout: 10000 });
    ok(`${label}: resume restores the same schedule`, /Hosting/.test(await page.locator('[data-schedule]').first().innerText()) && await page.locator('[data-next-date]').isVisible());
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Cancel schedule' }).click();
    await page.locator('[data-schedule="CANCELLED"]').waitFor({ timeout: 10000 });
    ok(`${label}: cancel is final: no pause, resume or next date`, !(await page.getByRole('button', { name: 'Pause' }).count()) && !(await page.getByRole('button', { name: 'Resume' }).count()) && !(await page.locator('[data-next-date]').count()));
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
