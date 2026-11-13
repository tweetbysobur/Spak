/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for SPak Guard in the app (not part of `npm test`).
 *
 *   node tests/browser/guard.check.cjs <baseUrl> <outDir>
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


const SOL_RECIPIENT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const section = (pg, id) => pg.locator(`[data-guard-section="${id}"]`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.exposeFunction('__spakSign', async (hex) => account.signMessage({ message: { raw: hex } }));
  await ctx.addInitScript(PROVIDER(account.address));
  const page = await ctx.newPage();
  const execCreates = [];
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/executions') execCreates.push(r.url()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // 403 and 409 are expected here: blocked transfers and the deliberate version conflict.
  page.on('response', (r) => { if (r.status() >= 400 && ![403, 409].includes(r.status())) errors.push(`${r.status()} ${r.url()}`); });

  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Test Wallet \(simulated\)/ }).click();
  await page.locator('nav[aria-label=App]').first().waitFor({ timeout: 20000 });

  // Overview: real Guard status from the server.
  await page.locator('[data-guard-summary="ACTIVE"]').waitFor({ timeout: 15000 });
  const ov = await page.locator('[data-guard-summary]').innerText();
  ok('overview shows the real Guard status and 24-hour usage', /Active/.test(ov) && /\$0 used in the last 24 hours/.test(ov) && /no limit set/.test(ov), ov.replace(/\s+/g, ' ').slice(0, 120));
  ok('overview no longer says personal limits are planned', !(await page.locator('main').innerText()).includes('Personal limits are planned'));

  // Guard page
  await go(page, 'SPak Guard');
  await page.locator('[data-guard-state="ACTIVE"]').waitFor({ timeout: 15000 });
  ok('guard page loads the policy (status active, version shown)', /Version 1/.test(await page.locator('[data-guard-state]').innerText()));
  ok('unset limits show no percentage', (await section(page, 'limits').locator('[role=progressbar]').count()) === 0);
  await shot(page, 'guard-01-desktop-light');

  // Limits: save, confirmed by the server
  await section(page, 'limits').getByRole('button', { name: 'Edit limits' }).click();
  await page.locator('input[name=dailyLimitUsd]').fill('60');
  await section(page, 'limits').getByRole('button', { name: 'Save' }).click();
  await page.getByText('Spending limits saved.').waitFor();
  const lim = await section(page, 'limits').innerText();
  ok('daily limit saved and shown with usage', /\$0 used in the last 24 hours of \$60/.test(lim) && (await section(page, 'limits').locator('[role=progressbar]').count()) === 1);

  // Version conflict: another tab changes the policy; this tab's save is refused and the latest is loaded
  await section(page, 'limits').getByRole('button', { name: 'Edit limits' }).click();
  await page.locator('input[name=monthlyLimitUsd]').fill('900');
  await page.evaluate(async () => { const g = await (await fetch('/api/guard')).json(); await fetch('/api/guard', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: g.policy.version, weeklyLimitUsd: '300' }) }); });
  await section(page, 'limits').getByRole('button', { name: 'Save' }).click();
  await page.getByText('Your Guard settings changed elsewhere.').waitFor();
  ok('version conflict explained, input kept', (await page.locator('input[name=monthlyLimitUsd]').inputValue()) === '900');
  ok('latest policy reloaded after the conflict', /Version 3/.test(await page.locator('[data-guard-state]').innerText()));
  await shot(page, 'guard-02-conflict-desktop');
  await section(page, 'limits').getByRole('button', { name: 'Save' }).click();
  await page.getByText('Spending limits saved.').waitFor();
  await page.locator('form[aria-label="Edit spending limits"]').waitFor({ state: 'detached' });
  const lim2 = await section(page, 'limits').innerText();
  ok('resubmitting after review saves on the new version, without losing the other change', /of \$900/.test(lim2) && /of \$300/.test(lim2), lim2.replace(/\s+/g, ' ').slice(330, 700));

  // Recipients: client format check, add, remove with confirmation
  await section(page, 'recipients').getByRole('button', { name: 'Add recipient' }).click();
  await page.locator('form[aria-label="Add recipient"] select[name=network]').selectOption('arbitrum');
  await page.locator('input[name=address]').fill('not-an-address');
  await page.getByRole('button', { name: 'Approve recipient' }).click();
  ok('invalid address refused for its network', await page.getByText('That is not a valid Arbitrum address.').isVisible());
  await page.locator('input[name=address]').fill('0x4444444444444444444444444444444444444444');
  await page.locator('input[name=label]').fill('Savings');
  await page.getByRole('button', { name: 'Approve recipient' }).click();
  await page.getByText('Recipient approved on Arbitrum.').waitFor();
  ok('recipient added, approved on Arbitrum only', /Savings · Arbitrum only/.test(await section(page, 'recipients').innerText()));
  await section(page, 'recipients').getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog').waitFor();
  await shot(page, 'guard-03-remove-recipient-confirm');
  await page.getByRole('button', { name: 'Remove recipient' }).click();
  await page.getByText('Recipient removed.').waitFor();
  ok('recipient removed after confirmation', /No approved recipients yet/.test(await section(page, 'recipients').innerText()));

  // Networks: deliver-to Arbitrum off
  await section(page, 'networks').getByRole('button', { name: 'Edit networks' }).click();
  await page.getByLabel('Arbitrum: deliver to').uncheck();
  await section(page, 'networks').getByRole('button', { name: 'Save' }).click();
  await page.getByText('Network permissions saved.').waitFor();
  ok('network permission saved per direction', /Send only/.test(await section(page, 'networks').locator('[data-network=arbitrum]').innerText()));

  // Tokens: search the registry, block one by canonical id
  await section(page, 'assets').getByRole('button', { name: 'Edit tokens' }).click();
  await page.locator('input[name=asset-search]').fill('dai');
  const first = page.locator('ul[aria-label="Search results"] li').first();
  await first.waitFor();
  await first.getByRole('button', { name: 'Block' }).click();
  await section(page, 'assets').getByRole('button', { name: 'Save' }).click();
  await page.getByText('Token permissions saved.').waitFor();
  const assetsText = await section(page, 'assets').innerText();
  ok('token blocked and shown with its canonical address', /DAI on/i.test(assetsText) && /0x|:/.test(assetsText), assetsText.replace(/\s+/g, ' ').slice(0, 400));

  // Blocked instruction: stopped on the server's plan decision, no execution created
  await go(page, 'Execute');
  await page.getByLabel('Instruction').fill('Bridge 10 USDC from Base to Arbitrum');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('[data-guard-block]').first().waitFor({ timeout: 20000 });
  const blockText = await page.locator('[data-guard-block]').first().innerText();
  ok('blocked instruction explained in plain words', /network is not allowed/.test(blockText), blockText);
  ok('blocked instruction never reached execution creation', execCreates.length === 0, `${execCreates.length} create calls`);
  await shot(page, 'guard-04-blocked-instruction');

  // Pause through the UI, then a manual-form transfer is stopped before execution creation
  await go(page, 'SPak Guard');
  await section(page, 'emergency').getByRole('button', { name: 'Pause new transfers' }).click();
  ok('pause confirmation explains that transfers in flight continue', /keeps being tracked, verified/.test(await page.getByRole('dialog').innerText()));
  await page.getByRole('dialog').getByRole('button', { name: 'Pause new transfers' }).click();
  await page.locator('[data-guard-state="PAUSED"]').waitFor();
  ok('paused status shown', true);
  await shot(page, 'guard-05-paused-desktop');
  await go(page, 'Execute');
  await page.getByRole('tab', { name: 'Manual form' }).click();
  await page.getByLabel('To network').selectOption('optimism');
  await page.locator('input[inputmode=decimal]').first().fill('10');
  await page.getByRole('button', { name: 'Get quote' }).click();
  try { await page.locator('[data-guard-block]').waitFor({ timeout: 20000 }); } catch (e) { console.log('MANUAL>>', (await page.locator('section', { hasText: 'Manual swap' }).first().innerText()).slice(-800)); await shot(page, 'fail-manual'); throw e; }
  ok('manual form blocked while paused', /Guard is paused/.test(await page.locator('[data-guard-block]').innerText()));
  ok('blocked manual request never reached execution creation', execCreates.length === 0);

  // Disable all, then resume
  await go(page, 'SPak Guard');
  await page.locator('[data-guard-state="PAUSED"]').waitFor();
  await section(page, 'emergency').getByRole('button', { name: 'Disable all execution' }).click();
  ok('disable-all confirmation explains the difference', /deposit instructions, even for transfers you already approved/.test(await page.getByRole('dialog').innerText()));
  await page.getByRole('dialog').getByRole('button', { name: 'Disable all execution' }).click();
  await page.locator('[data-guard-state="EXECUTION_DISABLED"]').waitFor();
  await shot(page, 'guard-06-execution-disabled');
  await section(page, 'emergency').getByRole('button', { name: 'Resume Guard' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Resume Guard' }).click();
  await page.locator('[data-guard-state="ACTIVE"]').waitFor();
  ok('resume returns Guard to active', true);

  // History: readable, versioned, no internal ids
  await page.locator('[data-history-version]').first().waitFor();
  const hist = await section(page, 'history').innerText();
  ok('history lists versions, actions and before/after values', /Version \d+/.test(hist) && /24-hour limit: not set → \$60/.test(hist) && /New transfers paused/.test(hist), hist.replace(/\s+/g, ' ').slice(0, 120));
  ok('history shows no internal user ids', !/usr_/.test(hist));

  // An allowed transfer still works: real NEAR Intents quote, then its Guard checks on the transfer
  await go(page, 'Execute');
  await page.getByRole('tab', { name: 'Instruction' }).click();
  await page.getByLabel('Instruction').fill(`Swap 50 USDC on Base to SOL on Solana to ${SOL_RECIPIENT}`);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Review the estimate').waitFor({ timeout: 45000 });
  ok('allowed transfer still reaches the review step', execCreates.length === 1);
  await go(page, 'Activity');
  await page.locator('ul li button').first().click();
  await page.locator('[data-guard-checks]').waitFor();
  await page.locator('[data-guard-checks] summary').click();
  await page.locator('[data-decision-stage="QUOTE"]').first().waitFor();
  const checks = await page.locator('[data-guard-checks]').innerText();
  ok('transfer shows its Guard decisions and rules', /Quote/.test(checks) && /Amount limit passed/.test(checks) && /Policy version \d+/.test(checks) && /Spending is reserved only when you approve/.test(checks), checks.replace(/\s+/g, ' ').slice(0, 140));
  await shot(page, 'guard-07-transfer-checks');

  // Dark theme and mobile
  await go(page, 'SPak Guard');
  await page.evaluate(() => localStorage.setItem('spak-theme', 'dark'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-guard-state]').waitFor();
  await shot(page, 'guard-08-desktop-dark');
  for (const [name, vp] of [['mobile', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize(vp);
      await page.evaluate((t) => localStorage.setItem('spak-theme', t), theme);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('[data-guard-state]').waitFor();
      ok(`${name} ${theme}: no horizontal overflow on Guard`, (await overflow(page)) <= 0);
      await section(page, 'networks').getByRole('button', { name: 'Edit networks' }).click();
      ok(`${name} ${theme}: network editor fits`, (await overflow(page)) <= 0);
      if (theme === 'light' || name === 'mobile') await shot(page, `guard-09-${name}-${theme}`);
    }
  }

  ok('no page errors or unexpected failed requests', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED:', e.message); process.exit(1); });
