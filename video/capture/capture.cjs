/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Real-product captures for the SPak film and the GitHub docs.
 *   node capture/capture.cjs <appBase> <outDir> <portfolio.json> <routes.json>
 *
 * - Website: the live production site (https://usespak.vercel.app), read only.
 * - App: a production build of feature/spak-agent-execution served locally (APP base), with real NEAR Intents (1Click)
 *   quotes and real prices. Signed in with a SIMULATED wallet: a fresh, empty address whose signatures come from a
 *   throwaway key held by this script. No funds exist and no transaction is ever signed or sent.
 * - Intelligence: the portfolio and route answers are SUBSTITUTED in the browser with a live mainnet read of public
 *   wallets (portfolio.json, routes.json), because the simulated wallet is empty. Labelled in the film.
 * Frames are 3840x2160 (1920x1080 at 2x) so the film can zoom without blur.
 */
const { chromium } = require('playwright');
const { privateKeyToAccount, generatePrivateKey } = require(require.resolve('viem/accounts', { paths: ['/home/user/spak'] }));
const fs = require('fs');
const [,, APP = 'http://localhost:3100', OUT = 'public/shots', PORTFOLIO, ROUTES] = process.argv;
const SITE = 'https://usespak.vercel.app';
fs.mkdirSync(OUT, { recursive: true });
const manifest = [];
const PROVIDER = (address) => `(() => {
  const addr = ${JSON.stringify(address)};
  const provider = { request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [addr];
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'personal_sign') return await window.__spakSign(params[0]);
    throw Object.assign(new Error('Unsupported in demo wallet: ' + method), { code: 4200 });
  }, on() {}, removeListener() {} };
  const info = { uuid: 'spak-demo-wallet', name: 'Demo Wallet (simulated)', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="%23174734"/><circle cx="16" cy="16" r="6" fill="%23E8EFE9"/></svg>', rdns: 'dev.spak.demo' };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce); announce();
})();`;

(async () => {
  const browser = await chromium.launch();
  const shot = async (page, name, note, opts = {}) => {
    await page.waitForTimeout(opts.settle ?? 450);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!opts.full });
    manifest.push({ name, note, source: opts.source ?? 'app', at: new Date().toISOString() });
    console.log('shot', name);
  };

  // ---------------------------------------------------------------- website (production, live)
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(SITE, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await shot(page, 'site-01-hero', 'Live website, hero', { source: 'production', settle: 1200 });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    let n = 2;
    for (let y = 1000; y < h - 600 && n <= 7; y += 1000) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await shot(page, `site-0${n}-scroll`, `Live website, scrolled to ${y}px`, { source: 'production', settle: 900 });
      n++;
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- application (local production build of the branch)
  const account = privateKeyToAccount(generatePrivateKey());
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await ctx.exposeFunction('__spakSign', async (hex) => account.signMessage({ message: { raw: hex } }));
  await ctx.addInitScript(PROVIDER(account.address));
  const page = await ctx.newPage();
  const go = (label) => page.locator('nav[aria-label=App] button:visible', { hasText: label }).first().click();

  await page.goto(`${APP}/app`, { waitUntil: 'networkidle' });
  await shot(page, 'app-01-signin', 'Sign in: wallets found in this browser (simulated demo wallet)', { settle: 1000 });
  await page.getByRole('button', { name: /Demo Wallet \(simulated\)/ }).hover();
  await shot(page, 'app-02-signin-hover', 'Sign in: choosing the wallet');
  await page.getByRole('button', { name: /Demo Wallet \(simulated\)/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 20000 });
  await shot(page, 'app-03-tour-welcome', 'First-run guided tour: welcome', { settle: 600 });
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await shot(page, 'app-04-tour-execute', 'Guided tour: Execute step', { settle: 600 });
  await page.keyboard.press('Escape');
  await go('Overview');
  await shot(page, 'app-05-overview', 'Overview', { settle: 900 });

  // Intent: typed frame by frame, then interpreted by SPak-in and quoted through NEAR Intents.
  await go('Execute');
  const input = page.getByLabel('Instruction');
  await input.waitFor();
  await shot(page, 'app-06-execute-empty', 'Execute: the instruction box');
  const text = 'Move 25 USDC from Base to Arbitrum';
  for (let i = 1; i <= text.length; i++) {
    await input.fill(text.slice(0, i));
    if (i % 2 === 0 || i === text.length) await page.screenshot({ path: `${OUT}/type-${String(i).padStart(2, '0')}.png` });
  }
  manifest.push({ name: 'type-NN', note: `Typing "${text}" (one frame every two characters)`, source: 'app' });
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Check the details, then confirm').waitFor({ timeout: 60000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'app-07-interpreted', 'SPak-in interpretation, balance check and live quote', { settle: 900 });
  await page.getByText('Check the details, then confirm').scrollIntoViewIfNeeded();
  await shot(page, 'app-08-review', 'Review and send: real NEAR Intents quote', { settle: 700 });
  await page.evaluate(() => window.scrollBy(0, 500));
  await shot(page, 'app-09-review-details', 'Review: fees, recipient, refund address');
  // One click: firm quote -> approval -> deposit preparation. The empty demo wallet stops it before any wallet prompt.
  await page.getByText('Check the details, then confirm').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /^Confirm and send / }).click();
  await page.waitForTimeout(250);
  await shot(page, 'app-10-confirm-progress', 'One click: progress through firm quote, approval and deposit', { settle: 50 });
  await page.getByText('Step 3 of 7: send the deposit').waitFor({ timeout: 60000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'app-11-transfer-tracking', 'Transfer page: approved, waiting for the deposit, live tracking', { settle: 900 });
  await page.getByText('Step 3 of 7: send the deposit').scrollIntoViewIfNeeded();
  await shot(page, 'app-12-deposit', 'Deposit instructions from the firm quote (no funds sent)');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await shot(page, 'app-13-progress-timeline', 'Progress timeline');

  // A manual-review route, to show the delivery-check distinction.
  await page.getByRole('button', { name: '← Back' }).click();
  await go('Execute');
  await page.getByLabel('Instruction').fill('Move 25 USDC from Base to Polygon');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Check the details, then confirm').waitFor({ timeout: 60000 });
  await page.getByText('SPak cannot confirm delivery on this route automatically').scrollIntoViewIfNeeded();
  await shot(page, 'app-14-manual-review-route', 'Route where delivery is reviewed manually (no payout evidence yet)', { settle: 700 });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await go('Activity');
  await shot(page, 'app-15-activity', 'Activity', { settle: 1200 });
  await go('SPak Guard');
  await shot(page, 'app-16-guard', 'SPak Guard', { settle: 1500 });
  await page.evaluate(() => window.scrollBy(0, 800));
  await shot(page, 'app-17-guard-limits', 'SPak Guard: limits and rules', { settle: 500 });

  // Intelligence with SUBSTITUTED data (live read of public wallets), see header.
  if (PORTFOLIO) {
    await ctx.route('**/api/intelligence/portfolio*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(PORTFOLIO) }));
    if (ROUTES) await ctx.route('**/api/intelligence/routes', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(ROUTES) }));
    await go('Intelligence');
    await page.getByText('Total priced value').waitFor({ timeout: 30000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'app-18-intelligence', 'SPak Intelligence (data: live read of public mainnet wallets)', { settle: 900 });
    await page.getByText('Insights', { exact: true }).scrollIntoViewIfNeeded();
    await shot(page, 'app-19-intelligence-insights', 'Intelligence: insights and distribution');
    const routesBtn = page.getByRole('button', { name: 'Routes' }).first();
    await routesBtn.scrollIntoViewIfNeeded();
    await routesBtn.click();
    await page.getByRole('button', { name: 'Compare routes' }).click();
    await page.getByText(/Receive about/).first().waitFor({ timeout: 15000 });
    await shot(page, 'app-20-intelligence-routes', 'Intelligence: live route comparison for a holding', { settle: 600 });
  }

  // Dark theme overview for contrast shots.
  await page.evaluate(() => localStorage.setItem('spak-theme', 'dark'));
  await go('Overview'); await page.reload({ waitUntil: 'networkidle' });
  await shot(page, 'app-21-overview-dark', 'Overview, dark theme', { settle: 1200 });

  fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ capturedAt: new Date().toISOString(), site: SITE, app: `${APP} (production build of feature/spak-agent-execution, served locally)`, wallet: 'simulated, empty', shots: manifest }, null, 1));
  await browser.close();
})().catch((e) => { console.error('CAPTURE FAILED:', e.message); process.exit(1); });
