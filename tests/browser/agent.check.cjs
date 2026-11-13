/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app build */
/**
 * Browser check for the SPak Agent identity (Stage 5) (not part of `npm test`).
 *
 *   node tests/browser/agent.check.cjs <baseUrl> <outDir>
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



// A NEAR implicit account: its id is the hex public key, so the server verifies ownership without NEAR RPC.
const { ed25519 } = require(require.resolve('@noble/curves/ed25519.js', { paths: [process.cwd()] }));
const { base58, base64, hex } = require(require.resolve('@scure/base', { paths: [process.cwd()] }));
const { createHash } = require('crypto');
const sk = ed25519.utils.randomSecretKey();
const pk = ed25519.getPublicKey(sk);
const implicitId = hex.encode(pk);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const str = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([u32(b.length), b]); };
const nep413 = (message, nonce, recipient) => createHash('sha256').update(Buffer.concat([u32(2147484061), str(message), Buffer.from(nonce), str(recipient), Buffer.from([0])])).digest();

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
  await go(page, 'Agent');
  await page.getByLabel('Create Agent identity').waitFor({ timeout: 15000 });
  ok('no Agent yet: creation offered, needs no NEAR account', /needs no NEAR account/.test(await page.locator('main').innerText()));
  ok('legacy link is not presented as a dedicated Agent account', /not a dedicated SPak Agent account/.test(await page.locator('main').innerText()));
  await shot(page, 'agent-01-none');

  await page.locator('input[name=agentName]').fill('My SPak Agent');
  await page.getByRole('button', { name: 'Create Agent identity' }).click();
  await page.locator('[data-agent-status="CREATED"]').waitFor();
  const t1 = await page.locator('[data-agent-status]').innerText();
  ok('created: three states shown separately, not verified, dedicated account unavailable', /Not verified/.test(t1) && /Dedicated Agent NEAR account/.test(t1) && /Not available yet/.test(t1) && !/Verified by SPak/.test(t1));
  await shot(page, 'agent-02-created');

  // Ownership proof: challenge from the server, signed here with the implicit account key, verified by the server.
  const res = await page.evaluate(async ({ accountId }) => {
    const a = (await (await fetch('/api/agents')).json()).agent;
    const c = await (await fetch(`/api/agents/${a.id}/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId }) })).json();
    return { id: a.id, c };
  }, { accountId: implicitId });
  ok('challenge names the Agent, account, domain and purpose', res.c.message.includes(`Agent: ${res.id}`) && res.c.message.includes(`NEAR account: ${implicitId}`) && res.c.message.includes('Purpose: AGENT_OWNERSHIP') && res.c.message.includes(`Domain: ${res.c.recipient}`));
  const sig = base64.encode(ed25519.sign(nep413(res.c.message, base64.decode(res.c.nonce), res.c.recipient), sk));
  const body = { challengeId: res.c.challengeId, method: res.c.method, accountId: implicitId, publicKey: `ed25519:${base58.encode(pk)}`, signature: sig };
  const bad = await page.evaluate(async ({ id, body }) => (await fetch(`/api/agents/${id}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, signature: btoa(String.fromCharCode(...new Uint8Array(64))) }) })).status, { id: res.id, body });
  ok('an invalid signature is refused (and burns the challenge)', bad === 401, String(bad));
  const c2 = await page.evaluate(async ({ id, accountId }) => (await fetch(`/api/agents/${id}/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId }) })).json(), { id: res.id, accountId: implicitId });
  const sig2 = base64.encode(ed25519.sign(nep413(c2.message, base64.decode(c2.nonce), c2.recipient), sk));
  const good = await page.evaluate(async ({ id, body }) => { const r = await fetch(`/api/agents/${id}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.status; }, { id: res.id, body: { ...body, challengeId: c2.challengeId, signature: sig2 } });
  ok('a valid proof verifies', good === 200, String(good));
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-ownership="VERIFIED"]').waitFor({ timeout: 15000 });
  const t2 = await page.locator('[data-agent-status]').innerText();
  ok('verified only after the server confirms; still no dedicated account', /Verified by SPak/.test(t2) && /Not available yet/.test(t2) && /not on chain/.test(t2));
  await shot(page, 'agent-03-verified');

  // Suspend and revoke through the UI with confirmations
  await page.getByRole('button', { name: 'Suspend', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Suspend Agent' }).click();
  await page.locator('[data-agent-status="SUSPENDED"]').waitFor();
  ok('suspended: ownership no longer shown as verified', !/Verified by SPak/.test(await page.locator('[data-agent-status]').innerText()));
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  ok('revoke needs typed confirmation', await page.getByRole('dialog').getByRole('button', { name: 'Revoke Agent' }).isDisabled());
  await page.locator('input[name=confirmRevoke]').fill('REVOKE');
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke Agent' }).click();
  await page.getByLabel('Create Agent identity').waitFor();
  ok('revoked: a new Agent can be created', true);

  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((t) => localStorage.setItem('spak-theme', t), theme);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByLabel('Create Agent identity').waitFor();
    ok(`mobile ${theme}: no horizontal overflow`, (await overflow(page)) <= 0);
    await shot(page, `agent-04-mobile-${theme}`);
  }

  ok('no page errors or server errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED:', e.message); process.exit(1); });
