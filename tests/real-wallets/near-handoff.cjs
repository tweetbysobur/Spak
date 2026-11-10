// REAL WALLET HANDOFF CHECK (partial): SPak opens the real MyNearWallet / Meteor web wallet with a NEP-413
// sign request. We have no mainnet NEAR account, so nothing is signed; we check the popup opens (not blocked),
// the request carries the server's message, nonce, recipient and state, the wallet page loads, and closing it
// is reported as a cancellation.
const { chromium } = require("playwright");
const fs = require("fs");
const S = process.env.SPAK_RW_DIR ?? `${process.cwd()}/.rw`;
const results = [];
const record = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`[${ok ? "PASS" : "FAIL"}] ${name} ${detail}`); };

(async () => {
  const browser = await chromium.launch({ headless: false });
  for (const wallet of (process.argv[2] ? process.argv.slice(2) : ["Meteor Wallet"])) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const app = await ctx.newPage();
    await app.goto("http://localhost:3100");
    await app.getByText(wallet, { exact: true }).click();
    const open = app.getByRole("button", { name: `Open ${wallet} to sign` });
    await open.waitFor({ timeout: 15000 });
    record(`${wallet}: challenge prepared without asking for an account first`, true);
    const popupP = ctx.waitForEvent("page", { timeout: 20000 });
    await open.click();
    let popup;
    try { popup = await popupP; } catch { record(`${wallet}: wallet window opened from the click (not blocked)`, false); await ctx.close(); continue; }
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    await popup.waitForTimeout(6000);
    const u = new URL(popup.url());
    record(`${wallet}: wallet window opened from the click (not blocked)`, true, `${u.origin}${u.pathname}`);
    const q = Object.fromEntries(u.searchParams);
    const inner = q.message ? q : (() => { try { return JSON.parse(q.inputs ?? "{}"); } catch { return {}; } })();
    console.log(`${wallet} request params:`, Object.keys(q).join(","), JSON.stringify(q).slice(0, 400));
    const body = (await popup.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    await popup.screenshot({ path: `${S}/near-${wallet.split(" ")[0]}.png` }).catch(() => {});
    console.log(`${wallet} page:`, body.slice(0, 300));
    if (wallet === "MyNearWallet") {
      const ok = /sign in with your NEAR account/.test(q.message ?? "") && Buffer.from(q.nonce ?? "", "base64").length === 32 && q.recipient === "localhost:3100" && /^chl_/.test(q.state ?? "") && q.callbackUrl === "http://localhost:3100/";
      record("MyNearWallet: NEP-413 request carries server message, 32-byte nonce, recipient, state and callback", ok);
      record("MyNearWallet: real wallet page loads", body.length > 20, body.slice(0, 80));
    } else {
      record("Meteor: real wallet page loads", body.length > 20 && !/403|forbidden/i.test(body), `${u.origin} ${body.slice(0, 80)}`);
    }
    await popup.close();
    const alert = await app.getByRole("alert").filter({ hasText: /./ }).first().innerText({ timeout: 8000 }).catch(() => "");
    record(`${wallet}: closing the wallet window is reported as a cancellation`, /Cancelled/.test(alert), alert);
    await ctx.close();
  }
  fs.writeFileSync(`${S}/near-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => { console.error("ABORTED", e.message.split("\n")[0]); process.exit(1); });
