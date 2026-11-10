// REAL WALLET APPLICATION TEST: Phantom extension (Chrome Web Store build), fresh throwaway wallet with no funds,
// no Phantom username registered, against the SPak production build on http://localhost:3100.
const { chromium } = require("playwright");
const fs = require("fs");
const { generateMnemonic, english } = require("viem/accounts");
const S = process.env.SPAK_RW_DIR ?? `${process.cwd()}/.rw`;
const APP = "http://localhost:3100";
const mnemonic = generateMnemonic(english);
const PW = "Spak-Test-" + Math.random().toString(36).slice(2, 14) + "-Zq9!x";
const EXPLORE = process.argv[2] === "explore";
const results = [];
const record = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`[${ok ? "PASS" : "FAIL"}] ${name} ${detail}`); };
const ids = async (p) => { const o = []; for (const l of await p.locator("[data-testid]:visible").all()) o.push(await l.getAttribute("data-testid")); return o; };

(async () => {
  const ext = `${S}/ext/phantom`;
  fs.rmSync(`${S}/ph-full-profile`, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(`${S}/ph-full-profile`, { headless: false, viewport: { width: 1200, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  await new Promise((r) => setTimeout(r, 6000));
  const ph = ctx.pages().find((x) => x.url().includes("chrome-extension"));
  const extId = new URL(ph.url()).host;
  const version = JSON.parse(fs.readFileSync(`${ext}/manifest.json`, "utf8")).version;
  await ph.getByText("I Already Have a Wallet").click();
  await ph.getByText("Import Recovery Phrase").click();
  const w = mnemonic.split(" ");
  for (let i = 0; i < 12; i++) await ph.getByTestId(`secret-recovery-phrase-word-input-${i}`).fill(w[i]);
  await ph.getByTestId("onboarding-form-submit-button").click();
  await ph.getByText("Continue", { exact: true }).waitFor({ timeout: 30000 }); await ph.waitForTimeout(1500);
  await ph.getByTestId("onboarding-form-submit-button").click();
  await ph.getByTestId("onboarding-form-password-input").fill(PW);
  await ph.getByTestId("onboarding-form-confirm-password-input").fill(PW);
  await ph.getByTestId("onboarding-form-terms-of-service-checkbox").click({ force: true });
  await ph.getByTestId("onboarding-form-submit-button").click();
  await ph.getByTestId("onboarding-create-username-continue").waitFor({ timeout: 30000 }); // stop here: no username registration
  console.log(`Phantom ${version} ready`);

  const app = await ctx.newPage();
  app.on("console", (m) => { if (m.text().includes("[spak]")) m.args()[1]?.jsonValue().then((v) => console.log("APP CONSOLE", JSON.stringify(v))).catch(() => {}); });
  const session = async () => (await (await app.request.get(`${APP}/api/auth/session`)).json());
  const signedInUI = () => app.getByText("SPak Chat", { exact: true }).isVisible().catch(() => false);
  const row = (section) => app.locator("section").filter({ hasText: section }).getByText("Phantom", { exact: true });
  const extPages = () => ctx.pages().filter((p) => p.url().includes(extId) && !p.url().includes("onboarding"));
  /** Phantom opens its own popup window. Wait for it, record it, press the given button. */
  const phantom = async (buttons, tag) => {
    for (let i = 0; i < 20; i++) {
      for (const p of extPages()) {
        await p.waitForTimeout(800);
        const text = (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
        if (EXPLORE) { const btns = []; for (const l of await p.locator("button:visible").all()) btns.push((await l.innerText()).trim()); console.log(`${tag} page ${p.url().split("/").pop()}: ${text.slice(0, 300)} | ids=${(await ids(p)).join(",")} | buttons=${btns.join("/")}`); }
        for (const b of buttons) {
          const loc = p.getByTestId(b).or(p.getByRole("button", { name: b, exact: true })).first();
          if (await loc.isVisible().catch(() => false)) { await loc.click(); await app.waitForTimeout(2500); return text; }
        }
      }
      await app.waitForTimeout(1000);
    }
    throw new Error(`${tag}: no Phantom prompt with ${buttons.join("/")}`);
  };
  const signOut = async () => { await app.getByText("Wallets", { exact: true }).click(); await app.getByText("Sign out", { exact: true }).click(); await app.getByText("Sign in with a wallet").waitFor(); };

  await app.goto(APP);
  await row(/^Solana/).waitFor({ timeout: 20000 });
  record("Wallet Standard discovery lists Phantom under Solana", true);
  record("EIP-6963 discovery lists Phantom under EVM", await row("ETHEREUM, BASE").isVisible());

  // Solana sign-in
  try {
    await row(/^Solana/).click();
    const t1 = await phantom(["Connect", "primary-button"], "connect");
    let signText = t1;
    if (!(await signedInUI())) signText = await phantom(["Confirm", "Sign", "primary-button"], "sign");
    await app.getByText("SPak Chat", { exact: true }).waitFor({ timeout: 15000 });
    const s = await session();
    record("Phantom Solana sign-in (standard:connect + solana:signMessage)", s.authenticated && s.wallets[0].family === "solana", `${s.wallets?.[0]?.address} | prompt: ${signText.slice(0, 160)}`);
    await app.reload(); await app.waitForTimeout(2500);
    record("Session restored after reload", await signedInUI());
    await signOut();
    record("Sign-out ends the session", (await session()).authenticated === false);
  } catch (e) { record("Phantom Solana sign-in (standard:connect + solana:signMessage)", false, e.message.split("\n")[0]); }

  // Rejection
  try {
    await app.goto(APP); await row(/^Solana/).click();
    await phantom(["Cancel", "Reject", "secondary-button"], "reject");
    const alert = await app.getByRole("alert").filter({ hasText: /./ }).first().innerText({ timeout: 10000 }).catch(() => "");
    record("Rejecting in Phantom cancels cleanly", /Cancelled/.test(alert) && !(await session()).authenticated, alert);
  } catch (e) { record("Rejecting in Phantom cancels cleanly", false, e.message.split("\n")[0]); }

  // EVM through Phantom, then link Solana to the same user
  try {
    await app.goto(APP); await row("ETHEREUM, BASE").click();
    let t = "";
    for (let k = 0; k < 3 && !(await signedInUI()); k++) t = await phantom(["Connect", "Confirm", "Sign", "primary-button"], "evm").catch(() => t);
    await app.getByText("SPak Chat", { exact: true }).waitFor({ timeout: 15000 });
    const s = await session();
    record("Phantom EVM sign-in (EIP-6963 + SIWE personal_sign)", s.authenticated && s.wallets[0].family === "evm", s.wallets?.[0]?.address);
    await app.getByText("Wallets", { exact: true }).click();
    await app.getByText("Link wallet", { exact: true }).click();
    await row(/^Solana/).click();
    await phantom(["Confirm", "Connect", "primary-button"], "link");
    const alert = await app.getByRole("alert").filter({ hasText: /./ }).first().innerText({ timeout: 10000 }).catch(() => "");
    const s2 = await session();
    // This Solana account already owns the SPak user created in the first test, so linking must be refused.
    record("Linking a Phantom account owned by another SPak user is refused", s2.wallets.length === 1 && /another SPak account/.test(alert), alert);
  } catch (e) { record("Phantom EVM sign-in (EIP-6963 + SIWE personal_sign)", false, e.message.split("\n")[0]); }

  fs.writeFileSync(`${S}/ph-results.json`, JSON.stringify({ wallet: `Phantom ${version}`, results }, null, 2));
  await ctx.close();
})().catch((e) => { console.error("ABORTED", e.message.split("\n")[0]); fs.writeFileSync(`${S}/ph-results.json`, JSON.stringify({ aborted: e.message, results }, null, 2)); process.exit(1); });
