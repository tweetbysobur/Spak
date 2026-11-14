/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for Agent permissions (Stage 10) and Agent approval in the transfer flow (not part of `npm test`).
 *
 *   node tests/browser/permissions.check.cjs <baseUrl> <outDir>
 *
 * Real: production build, real sign-in (signature verified by the server), real NEP-413 signatures verified by the
 * server, real NEAR Intents (1Click mainnet) quotes. No funds: nothing is deposited and no transaction is signed.
 * SIMULATED: the wallets. The EVM wallet is an EIP-6963 provider backed by a throwaway key; the NEAR "wallet" is this
 * script signing the server's exact challenge with a throwaway implicit-account key (no browser NEAR wallet exists here).
 */
const { chromium } = require('playwright');
const { privateKeyToAccount, generatePrivateKey } = require(require.resolve('viem/accounts', { paths: [process.cwd()] }));
const { ed25519 } = require(require.resolve('@noble/curves/ed25519.js', { paths: [process.cwd()] }));
const { base58, base64, hex } = require(require.resolve('@scure/base', { paths: [process.cwd()] }));
const { createHash } = require('crypto');
const fs = require('fs');
const [,, BASE = 'http://localhost:3100', OUT = '/tmp/spak-shots'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const APP = `${BASE}/app`;
const account = privateKeyToAccount(generatePrivateKey());
const results = []; const errors = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); };
const go = (pg, label) => pg.locator('nav[aria-label=App] button:visible', { hasText: label }).first().click();
const sk = ed25519.utils.randomSecretKey(); const pk = ed25519.getPublicKey(sk); const implicitId = hex.encode(pk); const publicKey = `ed25519:${base58.encode(pk)}`;
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const str = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([u32(b.length), b]); };
const nep413 = (m, nonce, r) => createHash('sha256').update(Buffer.concat([u32(2147484061), str(m), Buffer.from(nonce), str(r), Buffer.from([0])])).digest();
const signNear = (c) => base64.encode(ed25519.sign(nep413(c.message, base64.decode(c.nonce), c.recipient), sk));
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
const post = (page, url, body) => page.evaluate(async ({ url, body }) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; }, { url, body });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.exposeFunction('__spakSign', async (h) => account.signMessage({ message: { raw: h } }));
  await ctx.addInitScript(PROVIDER(account.address));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Test Wallet \(simulated\)/ }).click();
  await page.locator('nav[aria-label=App]').first().waitFor({ timeout: 20000 });

  // Agent with a verified owner (implicit NEAR account: verified without RPC).
  const a = (await post(page, '/api/agents', { displayName: 'Permissions check' })).body.agent;
  const c = (await post(page, `/api/agents/${a.id}/challenge`, { accountId: implicitId })).body;
  const v = await post(page, `/api/agents/${a.id}/verify`, { challengeId: c.challengeId, method: c.method, accountId: implicitId, publicKey, signature: signNear(c) });
  ok('Agent ownership verified by the server', v.status === 200, String(v.status));

  await go(page, 'Agent');
  await page.locator('[data-agent-mode]').waitFor({ timeout: 15000 });
  ok('default is manual: you approve every transfer', (await page.locator('[data-agent-mode]').getAttribute('data-agent-mode')) === 'MANUAL' && /You approve every transfer/.test(await page.locator('[data-agent-mode]').innerText()));
  await page.getByRole('button', { name: 'Set limits' }).click();
  ok('the form says the wallet signs exact limits and it is not a transaction', /signs a message listing these exact limits/.test(await page.getByLabel('Agent permission').innerText()));
  ok('token symbols resolve to named tokens before signing', /USDC on Base/.test(await page.getByLabel('Agent permission').innerText()));
  await page.screenshot({ path: `${OUT}/permissions-01-form.png`, fullPage: true });

  // The permission is signed with the owner key over the server's exact message (the browser has no NEAR wallet here).
  const scope = { maxTransactionUsd: '60', dailyLimitUsd: '120', maxTransactions: 3, durationHours: 24, sourceNetworks: ['base'], destinationNetworks: ['arbitrum'], assets: ['base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831'], recipients: { self: true, addresses: [] } };
  const pc = (await post(page, `/api/agents/${a.id}/permissions/prepare`, scope));
  ok('the server issues a challenge naming the exact limits', pc.status === 200 && /Per transfer: up to \$60/.test(pc.body.message), String(pc.status));
  const tampered = await post(page, `/api/agents/${a.id}/permissions/confirm`, { challengeId: pc.body.challengeId, accountId: implicitId, publicKey, signature: signNear({ ...pc.body, message: pc.body.message.replace('$60', '$600') }) });
  ok('a signature over different limits is refused', tampered.status === 401, String(tampered.status));
  const pc2 = (await post(page, `/api/agents/${a.id}/permissions/prepare`, scope)).body;
  const g = await post(page, `/api/agents/${a.id}/permissions/confirm`, { challengeId: pc2.challengeId, accountId: implicitId, publicKey, signature: signNear(pc2) });
  ok('a signature over the exact limits creates version 1', g.status === 200 && g.body.grant.version === 1 && g.body.grant.status === 'ACTIVE', String(g.status));

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-agent-mode="PREAUTHORIZED"]').waitFor({ timeout: 15000 });
  const t = await page.locator('[data-agent-mode]').innerText();
  ok('active permission shows limits, usage, routes and signer', /up to \$60/.test(t) && /0 of 3 transfers/.test(t) && /Base to Arbitrum/.test(t) && /Version 1/.test(t));
  await page.screenshot({ path: `${OUT}/permissions-02-active.png`, fullPage: true });

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.locator('[data-agent-mode="MANUAL"][data-agent-mode]').waitFor();
  ok('pause: back to manual at once', /Paused/.test(await page.locator('[data-agent-mode]').innerText()));
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.locator('[data-agent-mode="PREAUTHORIZED"]').waitFor();
  ok('resume: same version active again', /Version 1/.test(await page.locator('[data-agent-mode]').innerText()));

  // Transfer flow: the Agent option appears only with an active permission. Real 1Click quotes, nothing deposited.
  await go(page, 'Execute');
  const via = page.locator('[data-via-agent]');
  await via.waitFor({ timeout: 15000 });
  ok('chat offers "Start through my Agent", off by default', !(await via.locator('input').isChecked()));
  await via.locator('input').check();
  await page.locator('#spak-intent').fill('Swap 5 USDC on Base to USDC on Arbitrum');
  await page.getByRole('button', { name: 'Send' }).click();
  const firmBtn = page.getByRole('button', { name: 'Get firm quote' });
  try {
    await firmBtn.waitFor({ timeout: 45000 });
    await firmBtn.click();
    // This release: the user approves every transfer in their own wallet. Agent approval is not offered on Review.
    await page.getByRole('button', { name: 'Approve', exact: true }).waitFor({ timeout: 45000 });
    ok('firm quote offers only the user\'s own Approve (no Agent approval in this release)', (await page.locator('[data-agent-approve]').count()) === 0 && (await page.getByText('Let my Agent approve').count()) === 0);
    await page.screenshot({ path: `${OUT}/permissions-03-review.png`, fullPage: true });
    await page.screenshot({ path: `${OUT}/permissions-04-after-agent.png`, fullPage: true });
  } catch {
    const said = (await page.locator('[aria-live=polite]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(-300);
    ok('live quote available for the Agent transfer', false, `no firm-quote step. Chat said: ${said}`);
  }

  await go(page, 'Agent');
  await page.locator('[data-agent-mode]').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Revoke', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke permission' }).click();
  await page.locator('[data-agent-mode="MANUAL"]').waitFor();
  ok('revoke: manual, history kept', /Permission history/.test(await page.locator('[data-agent-mode]').innerText()));

  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((th) => localStorage.setItem('spak-theme', th), theme);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-agent-mode]').waitFor({ timeout: 15000 });
    ok(`mobile ${theme}: no horizontal overflow`, (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
    await page.screenshot({ path: `${OUT}/permissions-05-mobile-${theme}.png`, fullPage: true });
  }
  ok('no page errors or server errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED:', e.message); process.exit(1); });
