// REAL WALLET APPLICATION TEST: MetaMask extension (Chrome Web Store build) with a fresh throwaway wallet
// (random mnemonic generated here, no funds) against the SPak production build on http://localhost:3100.
const { chromium } = require("playwright");
const fs = require("fs");
const { generateMnemonic, english, mnemonicToAccount } = require("viem/accounts");
const S = process.env.SPAK_RW_DIR ?? `${process.cwd()}/.rw`;
const APP = "http://localhost:3100";
const mnemonic = generateMnemonic(english);
const expected = mnemonicToAccount(mnemonic).address.toLowerCase();
const PASSWORD = "spak-" + Math.random().toString(36).slice(2, 10) + "A1!";
const results = [];
const record = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`[${ok ? "PASS" : "FAIL"}] ${name} ${detail}`); };
const CHAINS = [["Ethereum", 1], ["Base", 8453], ["Arbitrum", 42161], ["Optimism", 10], ["Polygon", 137], ["BNB Chain", 56], ["Avalanche", 43114], ["Gnosis", 100]];

(async () => {
  const ext = `${S}/ext/metamask`;
  fs.rmSync(`${S}/mm-full-profile`, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(`${S}/mm-full-profile`, { headless: false, viewport: { width: 1200, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  await new Promise((r) => setTimeout(r, 5000));
  const mm = ctx.pages().find((p) => p.url().includes("chrome-extension"));
  const extId = new URL(mm.url()).host;
  const version = JSON.parse(fs.readFileSync(`${ext}/manifest.json`, "utf8")).version;
  console.log(`MetaMask ${version}, test account ${expected}`);
  // onboarding
  await mm.getByText("I have an existing wallet", { exact: true }).click();
  await mm.getByTestId("onboarding-import-with-srp-button").click();
  await mm.getByTestId("srp-input-import__srp-note").click(); await mm.keyboard.type(mnemonic, { delay: 3 });
  await mm.getByTestId("import-srp-confirm").click();
  await mm.getByTestId("create-password-new-input").fill(PASSWORD);
  await mm.getByTestId("create-password-confirm-input").fill(PASSWORD);
  await mm.getByTestId("create-password-terms").check({ force: true });
  await mm.getByTestId("create-password-submit").click();
  await mm.getByTestId("passkey-maybe-later-button").click();
  await mm.getByTestId("metametrics-checkbox").click(); await mm.getByTestId("metametrics-data-collection-checkbox").click();
  await mm.getByTestId("metametrics-i-agree").click();
  await mm.getByTestId("onboarding-complete-done").click();
  await mm.waitForTimeout(3000);

  const app = await ctx.newPage();
  app.on("console", (m) => { if (m.text().includes("[spak]")) m.args()[1]?.jsonValue().then((v) => console.log("APP CONSOLE", JSON.stringify(v))).catch(() => console.log("APP CONSOLE", m.text())); });
  const mmTab = await ctx.newPage();
  await app.bringToFront();
  const pendingScreen = async () => {
    await mmTab.goto(`chrome-extension://${extId}/notification.html`);
    await mmTab.waitForTimeout(3500);
    return (await mmTab.locator("body").innerText()).replace(/\s+/g, " ");
  };
  const approve = async (testIds) => {
    for (let i = 0; i < 4; i++) {
      const text = await pendingScreen();
      for (const id of testIds) {
        const b = mmTab.getByTestId(id);
        if (await b.isVisible().catch(() => false)) { await b.click(); await app.waitForTimeout(2500); return text; }
      }
      await app.waitForTimeout(1500);
    }
    throw new Error(`no approval screen with ${testIds.join("/")}`);
  };
  const session = async () => (await (await app.request.get(`${APP}/api/auth/session`)).json());
  const signedInUI = () => app.getByText("SPak Chat", { exact: true }).isVisible().catch(() => false);
  const evmRow = () => app.locator("section").filter({ hasText: "ETHEREUM, BASE" }).getByText("MetaMask", { exact: true });
  const signOut = async () => { await app.getByText("Wallets", { exact: true }).click(); await app.getByText("Sign out", { exact: true }).click(); await app.getByText("Sign in with a wallet").waitFor(); };

  // 1. first sign-in: connect + SIWE signature
  await app.goto(APP);
  await app.waitForTimeout(3000);
  await app.screenshot({ path: `${S}/mm-start.png` });
  console.log("start text:", (await app.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300));
  await evmRow().waitFor({ timeout: 20000 });
  record("EIP-6963 discovery lists MetaMask", true);
  await evmRow().click();
  await approve(["confirm-btn"]);
  const signText = await approve(["confirm-footer-button"]);
  record("MetaMask shows a SIWE sign-in request with matching domain and no transaction", /Sign-in request/.test(signText) && /localhost:3100/.test(signText) && /No changes/.test(signText));
  await app.getByText("SPak Chat", { exact: true }).waitFor({ timeout: 15000 });
  let s = await session();
  record("Sign-in creates a session for the MetaMask account", s.authenticated && s.wallets?.[0]?.address === expected, s.wallets?.[0]?.address);
  const cookie = (await ctx.cookies(APP)).find((c) => c.name === "spak_session");
  record("Session cookie is HttpOnly + SameSite=Lax", !!cookie && cookie.httpOnly && cookie.sameSite === "Lax");

  // 2. session restoration
  await app.reload(); await app.waitForTimeout(2500);
  record("Session restored after page reload", await signedInUI());

  // 3. use SPak-in with the verified wallet
  await app.getByPlaceholder("Tell SPak what to do").fill("Bridge 10 USDC from Base to Arbitrum");
  await app.getByRole("button", { name: "Send" }).click();
  await app.getByText("Review transaction").waitFor({ timeout: 30000 }).catch(() => {});
  const body = (await app.locator("main").innerText()).toLowerCase();
  record("SPak-in uses the verified MetaMask address as recipient and refund address", body.includes(expected));

  // 4. sign-out
  await signOut();
  s = await session();
  record("Sign-out ends the session server-side", s.authenticated === false);

  // 5. rejection
  await evmRow().click();
  const rejText = await approve(["confirm-footer-cancel-button"]);
  await app.waitForTimeout(3000);
  await app.screenshot({ path: `${S}/mm-reject.png` });
  const alert = await app.getByRole("alert").filter({ hasText: /./ }).first().innerText({ timeout: 10000 }).catch(() => "");
  console.log("reject screen:", rejText.slice(0, 200), "| app:", (await app.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 400));
  s = await session();
  record("Rejecting the signature in MetaMask cancels cleanly", /Cancelled in your wallet/.test(alert) && !s.authenticated, alert);

  // 6. every EVM network: switch MetaMask's chain for this site, sign in, check the SIWE chain id, sign out
  for (const [name, id] of CHAINS) {
    try {
      const hexId = "0x" + id.toString(16);
      const sw = app.evaluate((h) => window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: h }] }).then(() => "ok", (e) => `err ${e.code} ${e.message}`), hexId);
      await app.waitForTimeout(2000);
      let switched = await Promise.race([sw, new Promise((r) => setTimeout(() => r("pending"), 1500))]);
      if (switched === "pending") { await approve(["confirm-btn", "confirmation-submit-button", "confirm-footer-button"]).catch(() => {}); switched = await sw; }
      if (switched !== "ok") {
        // Not a MetaMask default network: add it (standard EIP-3085 request with public chain data).
        const add = {
          100: { chainId: "0x64", chainName: "Gnosis", nativeCurrency: { name: "xDAI", symbol: "XDAI", decimals: 18 }, rpcUrls: ["https://rpc.gnosischain.com"], blockExplorerUrls: ["https://gnosisscan.io"] },
          43114: { chainId: "0xa86a", chainName: "Avalanche C-Chain", nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 }, rpcUrls: ["https://api.avax.network/ext/bc/C/rpc"], blockExplorerUrls: ["https://snowtrace.io"] },
        }[id];
        if (!add) throw new Error(`switch failed: ${switched}`);
        const ad = app.evaluate((p) => window.ethereum.request({ method: "wallet_addEthereumChain", params: [p] }).then(() => "ok", (e) => `err ${e.code} ${e.message}`), add);
        await app.waitForTimeout(2000);
        for (let k = 0; k < 3; k++) {
          const txt = await pendingScreen();
          const ids = []; for (const l of await mmTab.locator("[data-testid]:visible").all()) ids.push(await l.getAttribute("data-testid"));
          const btns = []; for (const l of await mmTab.locator("button:visible").all()) btns.push((await l.innerText()).trim());
          console.log(`add-chain screen ${k}: ${txt.slice(0, 160)} | ids=${ids.filter((x) => /confirm|submit|approve|cancel|footer/i.test(x)).join(",")} | buttons=${btns.join("/")}`);
          const pick = ["confirmation-submit-button", "confirm-btn", "confirm-footer-button", "page-container-footer-next"].find((x) => ids.includes(x));
          const btn = pick ? mmTab.getByTestId(pick) : mmTab.getByRole("button", { name: /^(Approve|Confirm|Switch network|Add)$/ }).first();
          if (await btn.isVisible().catch(() => false)) { await btn.click(); await app.waitForTimeout(2500); } else break;
          const done = await Promise.race([ad.then(() => true), new Promise((r) => setTimeout(() => r(false), 1000))]);
          if (done) break;
        }
        switched = await ad;
        if (switched !== "ok") throw new Error(`add failed: ${switched}`);
      }
      const chainNow = await app.evaluate(() => window.ethereum.request({ method: "eth_chainId" }));
      const probe = await app.evaluate(() => Promise.race([
        window.ethereum.request({ method: "eth_accounts" }).then((a) => "eth_accounts=" + JSON.stringify(a), (e) => `eth_accounts err ${e.code} ${e.message}`),
        new Promise((r) => setTimeout(() => r("timeout"), 3000)),
      ]));
      console.log(`chain ${id} probe:`, chainNow, probe);
      await evmRow().click();
      let t = "", screens = [];
      for (let k = 0; k < 3 && !(await signedInUI()); k++) {
        const txt = await approve(["confirm-btn", "confirm-footer-button"]).catch(() => "");
        if (txt) { screens.push(txt.slice(0, 40)); if (/Sign-in request/.test(txt)) t = txt; }
        await app.waitForTimeout(1500);
      }
      if (screens.length > 1) console.log(`chain ${id} MetaMask screens:`, screens.join(" -> "));
      await app.getByText("SPak Chat", { exact: true }).waitFor({ timeout: 15000 });
      s = await session();
      const ok = s.authenticated && s.wallets[0].address === expected && t.includes(`Chain ID ${id}`) && parseInt(chainNow, 16) === id;
      record(`Sign-in on ${name} (chain ${id})`, ok, `wallet chain ${parseInt(chainNow, 16)}`);
      await signOut();
    } catch (e) {
      await app.screenshot({ path: `${S}/mm-chain-${id}.png` });
      console.log(`chain ${id} app state:`, (await app.locator("main").innerText()).replace(/\s+/g, " ").slice(-250));
      record(`Sign-in on ${name} (chain ${id})`, false, e.message.split("\n")[0]);
      await app.goto(APP); await app.waitForTimeout(1500);
    }
  }

  await app.goto(APP); await app.waitForTimeout(2000);
  if (await signedInUI()) await signOut();
  // 7. Solana through MetaMask's Wallet Standard registration: sign in with EVM, then link the Solana account
  await evmRow().click();
  await approve(["confirm-footer-button"]);
  await app.getByText("SPak Chat", { exact: true }).waitFor({ timeout: 15000 });
  await app.getByText("Wallets", { exact: true }).click();
  await app.getByText("Link wallet", { exact: true }).click();
  const solRow = app.locator("section").filter({ hasText: /^Solana/ }).getByText("MetaMask", { exact: true });
  try {
    await solRow.click();
    await app.waitForTimeout(3000);
    const pre = await pendingScreen();
    const ids = []; for (const l of await mmTab.locator("[data-testid]:visible").all()) ids.push(await l.getAttribute("data-testid"));
    const btns = []; for (const l of await mmTab.locator("button:visible").all()) btns.push((await l.innerText()).trim());
    console.log("SOL screen:", pre.slice(0, 250), "| ids:", ids.filter((x) => /btn|button|confirm|cancel|footer|submit/i.test(x)).join(","), "| buttons:", btns.join("/"));
    console.log("SOL app:", (await app.locator("main").innerText()).replace(/\s+/g, " ").slice(-200));
    const t1 = await approve(["confirm-sign-message-confirm-snap-footer-button", "confirm-btn", "confirm-footer-button"]);
    let t2 = "";
    try { if (!(await session()).wallets.some((w) => w.family === "solana")) t2 = await approve(["confirm-sign-message-confirm-snap-footer-button", "confirm-footer-button", "confirm-btn"]); } catch { /* connect and sign may be one screen */ }
    await app.waitForTimeout(3000);
    s = await session();
    const sol = s.wallets.find((w) => w.family === "solana");
    record("Link Solana account via MetaMask Wallet Standard (solana:signMessage)", !!sol, sol?.address ?? `screens: ${t1.slice(0, 120)} / ${t2.slice(0, 120)}`);
  } catch (e) {
    record("Link Solana account via MetaMask Wallet Standard (solana:signMessage)", false, e.message.split("\n")[0]);
  }
  await app.screenshot({ path: `${S}/mm-final.png`, fullPage: true });
  fs.writeFileSync(`${S}/mm-results.json`, JSON.stringify({ wallet: `MetaMask ${version}`, account: expected, results }, null, 2));
  await ctx.close();
})().catch(async (e) => { console.error("ABORTED", e.message.split("\n")[0]); fs.writeFileSync(`${S}/mm-results.json`, JSON.stringify({ aborted: e.message, results }, null, 2)); process.exit(1); });
