/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for the branded application (not part of `npm test`).
 *
 *   node tests/browser/app-branding.check.cjs <baseUrl> <outDir>
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/deposits')) errors.push(`${r.status()} ${r.url()}`); });

  // 1. Signed out, light
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family))]);
  ok('fonts loaded (Inter at least)', fonts.some((f) => /Inter/.test(f)), fonts.join(', '));
  ok('light logo visible, dark hidden', await page.locator('img.logo-light').first().isVisible() && !(await page.locator('img.logo-dark').first().isVisible()));
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('light background is Warm White', bg === 'rgb(247, 246, 240)', bg);
  await shot(page, '01-signed-out-light-desktop');

  // 2. Sign in with the simulated wallet (real challenge, real server-side signature verification)
  await page.getByRole('button', { name: /Test Wallet \(simulated\)/ }).click();
  await page.locator('nav[aria-label=App]').first().waitFor({ timeout: 20000 });
  await go(page, 'Execute');
  await page.getByLabel('Instruction').waitFor({ timeout: 20000 });
  ok('signed in: navigation shown', true);
  await shot(page, '02-chat-light-desktop');

  // 3. Intent -> real NEAR Intents indicative quote -> review
  await page.getByLabel('Instruction').fill('Swap 50 USDC on Base to SOL on Solana to 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
  await page.getByRole('button', { name: 'Send' }).click();
  try { await page.getByText('Review the estimate').waitFor({ timeout: 45000 }); } catch (e) { await shot(page, 'fail-chat'); console.log(await page.locator('main').innerText()); throw e; }
  ok('indicative quote review rendered', true);
  const tnum = await page.locator('.type-amount-display').first().evaluate((e) => getComputedStyle(e).fontVariantNumeric);
  ok('amounts use tabular numerals', tnum.includes('tabular-nums'), tnum);
  await shot(page, '03-review-indicative-light');

  // 4. Firm quote (real deposit address; nothing sent) -> approval
  await page.getByRole('button', { name: 'Get firm quote' }).click();
  await page.getByText('Approve the firm quote').waitFor({ timeout: 45000 });
  const approveDisabled = await page.getByRole('button', { name: 'Approve', exact: true }).isDisabled();
  ok('Approve stays disabled until the user ticks the approval', approveDisabled);
  const fullAddr = await page.getByText('Deposit address', { exact: true }).locator('xpath=..').locator('.type-address').first().innerText();
  ok('deposit address shown in full on approval', /^0x[0-9a-fA-F]{40}/.test(fullAddr.trim()), fullAddr.trim().slice(0, 14) + '…');
  await shot(page, '04-review-firm-light');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByText('Step 3 of 7: send the deposit').waitFor({ timeout: 30000 });
  ok('approval leads to deposit instructions (no funds moved)', true);
  const badge = await page.locator('[data-status-role]').first().getAttribute('data-status-role');
  ok('awaiting deposit uses the pending role', badge === 'pending', badge);
  const spinning = await page.locator('ol[aria-label=Progress] .spak-spin').count();
  ok('timeline does not show processing while waiting for the deposit', spinning === 0, `${spinning} spinning`);
  await shot(page, '05-deposit-light');

  // 5. Prepare deposit: real balance read on Base; the test wallet has nothing, so SPak must refuse before any wallet prompt
  await page.getByRole('button', { name: 'Prepare deposit' }).click();
  // main only: Next.js adds its own empty role="alert" route announcer outside <main>.
  const alert = page.locator('main [role="alert"]').filter({ hasText: /\S/ }).first();
  await alert.waitFor({ timeout: 45000 });
  const alertText = await alert.innerText();
  ok('insufficient balance shown as an error, before any wallet request', /enough|balance|holds/i.test(alertText), alertText.slice(0, 80));
  await shot(page, '06-deposit-insufficient-light');

  // 6. Dark theme (explicit choice persists)
  await page.evaluate(() => { localStorage.setItem('spak-theme', 'dark'); });
  await page.reload({ waitUntil: 'networkidle' });
  const dbg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('dark background is Graphite', dbg === 'rgb(34, 39, 36)', dbg);
  ok('dark logo visible, light hidden', await page.locator('img.logo-dark').first().isVisible() && !(await page.locator('img.logo-light').first().isVisible()));
  await go(page, 'Activity');
  await page.locator('[data-status-role]').first().waitFor({ timeout: 15000 });
  await shot(page, '07-history-dark-desktop');

  // 7. Tracking states. MOCKED API responses (browser only) built from the real tracking view of the approved execution.
  await page.locator('ul li button').first().click();
  const execId = await page.evaluate(() => [...document.querySelectorAll('.type-address')].map((e) => e.textContent || '').find((t) => t.startsWith('exe_')));
  const real = await page.evaluate(async (id) => (await fetch(`/api/executions/${id}/tracking`)).json(), execId);
  const realEx = await page.evaluate(async (id) => (await fetch(`/api/executions/${id}`)).json(), execId);
  const scenarios = {
    'failed-refund-pending': { state: 'FAILED', failure: { category: 'REFUND', code: 'REFUND_EXPECTED', temporary: true, title: 'Waiting for refund', message: 'The swap did not complete. NEAR Intents returns funds automatically to your refund address. No action is needed yet.', funds: 'IN_TRANSIT', actions: ['WAIT', 'CHECK_AGAIN'] },
      refund: { eligibility: {}, instructions: { refundTo: real.refundAddress }, record: { state: 'PENDING_PROVIDER', depositedAmount: real.source.amountIn, expectedAmount: null, verifiedAmount: '0', associatedAmount: '0', outstandingAmount: null, partial: false, evidenceCapability: 'UNCONFIRMED' }, transactions: [] } },
    'refunded': { state: 'REFUNDED', failure: { category: 'REFUND', code: 'REFUND_COMPLETED', temporary: false, title: 'Refund completed', message: 'SPak verified on chain that the funds are back at your refund address.', funds: 'REFUND_ADDRESS', actions: ['NONE'] },
      refund: { eligibility: {}, instructions: { refundTo: real.refundAddress }, record: { state: 'COMPLETED', depositedAmount: real.source.amountIn, expectedAmount: real.source.amountIn, verifiedAmount: real.source.amountIn, associatedAmount: real.source.amountIn, outstandingAmount: '0', partial: false, evidenceCapability: 'CONFIRMED', reconciliation: 'CONSISTENT' },
        transactions: [{ txHash: '0x' + 'ab'.repeat(32), submitted: false, outcome: 'CONFIRMED', chainVerified: true, receivedAmount: real.source.amountIn, association: 'PROVIDER_LISTED', associationExplanation: "NEAR Intents listed this transaction for this transfer's deposit address.", timing: 'EXPECTED_WINDOW', explorerUrl: 'https://basescan.org/tx/0x' + 'ab'.repeat(32) }] } },
    'unknown-review': { state: 'UNKNOWN', needsReconciliation: true, note: 'Destination transactions show no delivery of the approved asset to the recipient.', review: { status: 'OPEN', openedAt: new Date().toISOString(), reason: 'x' },
      failure: { category: 'EXECUTION', code: 'MANUAL_REVIEW_REQUIRED', temporary: false, title: 'Needs manual review', message: 'SPak could not confirm the outcome. SPak\'s team is reviewing it.', funds: 'UNKNOWN', actions: ['MANUAL_REVIEW', 'CONTACT_SUPPORT'] }, refund: null },
    'completed': { state: 'COMPLETED', destination: { ...real.destination, verifiedAmountOut: real.destination.minAmountOut, verifiedAt: new Date().toISOString() }, failure: { category: 'NONE', code: 'NONE', temporary: false, title: '', message: '', funds: 'DESTINATION', actions: ['NONE'] }, refund: null,
      steps: real.steps.map((s) => ({ ...s, status: 'done', at: s.at ?? new Date().toISOString() })), destinationTxs: [{ network: 'solana', txHash: '5'.repeat(88), explorerUrl: 'https://solscan.io/tx/' + '5'.repeat(88), outcome: 'CONFIRMED' }] },
  };
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => localStorage.setItem('spak-theme', t), theme);
    for (const [name, patch] of Object.entries(scenarios)) {
      const view = { ...real, ...patch, review: patch.review ?? null };
      await page.unroute('**/api/executions/**');
      await page.route(`**/api/executions/${execId}/tracking`, (r) => r.fulfill({ json: view }));
      await page.route(`**/api/executions/${execId}/refresh`, (r) => r.fulfill({ json: view }));
      await page.route(`**/api/executions/${execId}`, (r) => r.fulfill({ json: { ...realEx, state: view.state } }));
      await page.reload({ waitUntil: 'networkidle' });
      await go(page, 'Activity');
      await page.locator('ul li button').first().click();
      await page.locator(`[data-status-role]`).first().waitFor();
      await page.waitForTimeout(400);
      const roles = await page.evaluate(() => [...document.querySelectorAll('[data-status-role]')].map((e) => e.getAttribute('data-status-role')));
      // The transfer's phase: a failed swap whose refund is still pending reads as a refund in progress, not a bare failure.
      const want = { 'failed-refund-pending': 'processing', refunded: 'refunded', 'unknown-review': 'warning', completed: 'success' }[name];
      const wantPhase = { 'failed-refund-pending': 'REFUND_PENDING', refunded: 'REFUNDED', 'unknown-review': 'UNKNOWN', completed: 'COMPLETED' }[name];
      const phase = await page.locator('[data-phase]').first().getAttribute('data-phase');
      ok(`[mocked] ${name} (${theme}): phase ${wantPhase}`, phase === wantPhase, phase);
      const receipt = await page.getByRole('heading', { name: 'Receipt' }).count();
      ok(`[mocked] ${name} (${theme}): receipt ${name === 'completed' ? 'shown' : 'absent'}`, (receipt > 0) === (name === 'completed'));
      const verified = await page.locator('[data-stage="VERIFIED"]').getAttribute('data-status');
      ok(`[mocked] ${name} (${theme}): delivery stage ${name === 'completed' ? 'done' : 'not done'}`, (verified === 'done') === (name === 'completed'), verified);
      const headerBadge = await page.locator('h2:has-text("Transfer") ~ [data-status-role], h2:has-text("Transfer") + span[data-status-role]').first().getAttribute('data-status-role').catch(() => roles[0]);
      ok(`[mocked] ${name} (${theme}): status role ${want}`, roles.includes(want), roles.join(','));
      if (name === 'unknown-review') ok(`[mocked] unknown never shows success (${theme})`, !roles.includes('success'));
      if (name === 'failed-refund-pending') ok(`[mocked] pending refund never shows refunded (${theme})`, !roles.includes('refunded') && !(await page.getByText('Refund verified', { exact: true }).count()));
      await shot(page, `08-${name}-${theme}`);
      void headerBadge;
    }
  }
  await page.unroute('**/api/executions/**');

  // 8. Mobile (390 x 844), both themes: no horizontal overflow, nothing important hidden
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  await mob.exposeFunction('__spakSign', async (hex) => account.signMessage({ message: { raw: hex } }));
  await mob.addInitScript(PROVIDER(account.address));
  const m = await mob.newPage();
  m.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`));
  for (const theme of ['light', 'dark']) {
    await m.goto(APP, { waitUntil: 'networkidle' });
    await m.evaluate((t) => localStorage.setItem('spak-theme', t), theme);
    await m.reload({ waitUntil: 'networkidle' });
    const clipped = await m.locator('[role=tablist] [role=tab]:visible').evaluateAll((els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.right > window.innerWidth || r.left < 0 || e.scrollWidth > e.clientWidth; }).map((e) => e.textContent));
    ok(`mobile ${theme}: every tab fully visible`, clipped.length === 0, clipped.join(','));
    ok(`mobile ${theme}: no horizontal overflow on chat`, (await overflow(m)) <= 0, `${await overflow(m)}px`);
    await shot(m, `09-mobile-chat-${theme}`);
    await go(m, 'Activity');
    await m.locator('ul li button').first().click();
    await m.getByText('Step 3 of 7: send the deposit').waitFor({ timeout: 20000 });
    ok(`mobile ${theme}: no horizontal overflow on deposit`, (await overflow(m)) <= 0, `${await overflow(m)}px`);
    const depVisible = await m.getByText('To deposit address', { exact: true }).locator('xpath=..').locator('.type-address').first().isVisible();
    ok(`mobile ${theme}: full deposit address visible`, depVisible);
    await shot(m, `10-mobile-deposit-${theme}`);
    await go(m, 'Settings');
    await m.getByText('Connected wallets').waitFor();
    ok(`mobile ${theme}: no horizontal overflow on wallets`, (await overflow(m)) <= 0);
    await shot(m, `11-mobile-wallets-${theme}`);
  }
  // Tablet
  const tab = await browser.newContext({ viewport: { width: 820, height: 1180 }, storageState: await ctx.storageState() });
  const tp = await tab.newPage(); await tp.goto(APP, { waitUntil: 'networkidle' });
  ok('tablet: no horizontal overflow', (await overflow(tp)) <= 0); await shot(tp, '12-tablet-chat');

  const real4xx = errors.filter((e) => !/INSUFFICIENT_BALANCE|status of 422|status of 4\d\d \(\)/.test(e));
  ok('no page errors or broken assets', real4xx.length === 0, real4xx.slice(0, 5).join(' || '));
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2));
  await browser.close();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
})().catch((e) => { console.error('CHECK CRASHED:', e.message); process.exit(2); });
