/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Captures the product screens used on the marketing site from the running application.
 *
 *   node scripts/marketing/capture.cjs <baseUrl>      (default http://localhost:3100)
 *
 * Real: the app, sign-in (server-verified signature), the NEAR Intents quotes. No funds move: no deposit is sent.
 * Simulated: the wallet (a throwaway key held by this script) and the "refund" screen, whose tracking responses
 * are replaced in the browser. The site captions say so.
 * Output: public/marketing/screens/<name>[-m]-<theme>.png and src/marketing/screens.json (sizes).
 */
const { chromium } = require('playwright');
const { privateKeyToAccount, generatePrivateKey } = require(require.resolve('viem/accounts', { paths: [process.cwd()] }));
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:3100';
const OUT = 'public/marketing/screens';
const sizes = {};

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

async function snap(page, name, theme, locator, suffix) {
  // The app header is sticky. Element captures scroll the page, so it is made static to keep it out of the shot.
  await page.addStyleTag({ content: 'header{position:static!important}' });
  await page.waitForTimeout(300);
  const file = `${OUT}/${name}${suffix}-${theme}.png`;
  await locator.screenshot({ path: file });
  const box = await locator.boundingBox();
  sizes[name + suffix] = { width: Math.round(box.width * 2), height: Math.round(box.height * 2) };
  console.log('saved', file);
}

async function run(theme, width, suffix) {
  // A new throwaway account per theme: the app refuses a second identical transfer from the same account.
  const account = privateKeyToAccount(generatePrivateKey());
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
  await ctx.exposeFunction('__spakSign', async (hex) => account.signMessage({ message: { raw: hex } }));
  await ctx.addInitScript(PROVIDER(account.address));
  const page = await ctx.newPage();
  const card = (text) => page.locator('main > *').filter({ has: page.getByRole('heading', { name: text, exact: true }) }).first();
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: /Test Wallet \(simulated\)/ }).click();
  await page.getByLabel('Instruction').waitFor({ timeout: 20000 });

  await page.getByLabel('Instruction').fill('Swap 50 USDC on Base to SOL on Solana to 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Review the estimate').waitFor({ timeout: 45000 });
  await snap(page, 'chat', theme, card('Ask SPak'), suffix);
  await snap(page, 'plan', theme, card('Review the estimate'), suffix);

  await page.getByRole('button', { name: 'Get firm quote' }).click();
  await page.getByText('Approve the firm quote').waitFor({ timeout: 45000 });
  await snap(page, 'approval', theme, card('Approve the firm quote'), suffix);

  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByText('Step 3 of 7: send the deposit').waitFor({ timeout: 30000 });
  await page.locator('ol[aria-label=Progress]').waitFor({ timeout: 20000 });
  await snap(page, 'tracking', theme, card('Transfer'), suffix);

  // Refund screen: SIMULATED tracking data, built on the real execution just approved. Browser only.
  const execId = await page.evaluate(() => [...document.querySelectorAll('.type-address')].map((e) => e.textContent || '').find((t) => t.startsWith('exe_')));
  const real = await page.evaluate(async (id) => (await fetch(`/api/executions/${id}/tracking`)).json(), execId);
  const realEx = await page.evaluate(async (id) => (await fetch(`/api/executions/${id}`)).json(), execId);
  const view = { ...real, state: 'FAILED', review: null,
    failure: { category: 'REFUND', code: 'REFUND_EXPECTED', temporary: true, title: 'Waiting for refund', message: 'The swap did not complete. NEAR Intents returns funds automatically to your refund address. No action is needed yet.', funds: 'IN_TRANSIT', actions: ['WAIT', 'CHECK_AGAIN'] },
    refund: { eligibility: {}, instructions: { refundTo: real.refundAddress }, record: { state: 'PENDING_PROVIDER', depositedAmount: real.source.amountIn, expectedAmount: null, verifiedAmount: '0', associatedAmount: '0', outstandingAmount: null, partial: false, evidenceCapability: 'UNCONFIRMED' }, transactions: [] } };
  await page.route(`**/api/executions/${execId}/tracking`, (r) => r.fulfill({ json: view }));
  await page.route(`**/api/executions/${execId}/refresh`, (r) => r.fulfill({ json: view }));
  await page.route(`**/api/executions/${execId}`, (r) => r.fulfill({ json: { ...realEx, state: 'FAILED' } }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'History' }).first().click();
  await page.locator('ul li button').first().click();
  await page.getByText('Waiting for refund').first().waitFor({ timeout: 20000 });
  const panel = page.locator('section[aria-label="What happened and what to do"]');
  await snap(page, 'refund', theme, panel, suffix);
  await browser.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // Desktop-width captures, and phone-width captures (suffix -m) so the screens stay readable on small displays.
  for (const [width, suffix] of [[760, ''], [400, '-m']]) for (const theme of ['light', 'dark']) await run(theme, width, suffix);
  fs.writeFileSync('src/marketing/screens.json', JSON.stringify(sizes, null, 2) + '\n');
  console.log(sizes);
})().catch((e) => { console.error('CAPTURE FAILED:', e.message); process.exit(1); });
