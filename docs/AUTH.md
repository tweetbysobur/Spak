# SPak wallet authentication

Milestone: wallet connection and authentication foundation. Branch `feature/spak-wallet-auth`.

Users sign in by signing a one-time text message with a wallet they own. There are no passwords or emails, and no private keys or seed phrases are ever requested or stored. The verified wallets become SPak-in's wallet context. The anonymous `x-spak-user` header is gone.

## Flow

```
browser                         SPak server                              wallet
  │ POST /api/auth/challenge ───▶ normalize + validate address
  │   {family, address, purpose}  random 32-byte nonce, 5 min expiry
  │                               build message (EIP-4361 / SIWS-style / NEP-413)
  │ ◀── {challengeId, message, nonce?, recipient?}   store challenge row
  │ ──────────────────────────────────────────────────────────▶ sign message
  │ ◀──────────────────────────────────────────────────────────  signature
  │ POST /api/auth/verify ──────▶ UPDATE … SET used_at WHERE used_at IS NULL (atomic, once)
  │   {challengeId, signature,    check expiry, check LINK owner
  │    publicKey?}                verify signature against the STORED message
  │                               NEAR named account: RPC view_access_key == FullAccess
  │                               SIGN_IN: find or create user + wallet, new session
  │                               LINK: add wallet to the signed-in user
  │ ◀── Set-Cookie: spak_session (HttpOnly, SameSite=Lax, Secure on https)
```

The server verifies against its own stored copy of the message, so a client cannot change what was signed. The challenge is consumed before the signature is checked, so each challenge has exactly one attempt. That covers replays, concurrent replays and brute force.

## Wallet standards

| Family | Discovery and connection | Message | Verification |
|---|---|---|---|
| EVM (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB, Avalanche, Gnosis) | EIP-6963 multi-wallet discovery, EIP-1193 `eth_requestAccounts`, falls back to `window.ethereum` | EIP-4361 Sign-In with Ethereum (viem `createSiweMessage`) signed with EIP-191 `personal_sign` | viem `verifyMessage` (EOA) |
| Solana | Wallet Standard (`@wallet-standard/app`), `standard:connect` | Sign-In With Solana layout, `solana:signMessage` | ed25519 (`@noble/curves`) against the base58 address |
| NEAR | NEAR Wallet Selector 10 (Meteor). MyNearWallet was removed: it now refuses app requests | NEP-413 `signMessage` with a 32-byte nonce and recipient = app host. The wallet chooses the account while signing; SPak never calls `signIn` (Meteor would add an on-chain function-call key) | ed25519 over sha256(NEP-413 Borsh payload). Implicit accounts: key must equal the account id. Named accounts: NEAR RPC `view_access_key` must return `FullAccess` (RPC failover across `NEAR_RPC_URL` endpoints) |

Function-call keys are refused for NEAR sign-in: they cannot prove control of the account.

## Data model (migration `0001_wallet_auth.sql`, additive)

| Table | Purpose |
|---|---|
| `spak_users` | One row per person. `active_wallet_id` points at the default wallet |
| `spak_auth_sessions` | Login sessions. Stores `sha256(token)` only. Absolute expiry 7 days, idle expiry 24 hours, `revoked_at` on logout |
| `spak_wallets` | Verified wallets. Unique on `(family, address)`: a wallet belongs to one user only |
| `spak_wallet_networks` | Which SPak networks each wallet is used on. EVM wallets default to every EVM network |
| `spak_wallet_challenges` | One-time challenges with nonce, exact message, expiry and `used_at` |
| `spak_agent_identities` | SPak Agent foundation: an optional NEAR account per user, unique across users |

The existing SPak-in tables (`spak_sessions`, `spak_intents`, `spak_submissions`, `spak_audit_log`) are unchanged.

## Sessions and cookies

- Token: 32 random bytes, base64url. Only its SHA-256 is stored.
- Cookie: `__Host-spak_session` on https (forces Secure, Path=/, no Domain), `spak_session` on http://localhost. Always HttpOnly and SameSite=Lax. Page JavaScript cannot read it.
- Validation runs on the server for every protected request: unknown, revoked, expired or idle tokens are refused.
- `POST /api/auth/logout` revokes this session. `POST /api/auth/logout-all` revokes every session of the user.

## Security controls

| Control | Where |
|---|---|
| Replay protection | Atomic one-time challenge consumption, 5 minute expiry, nonce unique in the DB |
| Domain binding | Message names the app host and URI. NEP-413 recipient is the app host |
| Unauthorized association | Unique `(family, address)`; LINK challenges are bound to the requesting user; ownership checks on every wallet action |
| CSRF | SameSite=Lax cookie, plus `Origin` must equal the app origin on every non-GET request (or `Sec-Fetch-Site: same-origin` when Origin is absent) |
| Rate limiting | Challenge 10/min per IP, verify 20/min per IP, interpret 60/min per user, quote 30/min, submit 10/min |
| Input validation | Zod on every body; address format checked per family before a challenge exists |
| Authorization | All SPak-in, wallet and agent routes require a session. Submissions are readable and cancellable by their owner only |
| SPak-in context | Wallet addresses come from verified wallets on the server. Client-sent addresses are ignored. Conversation sessions are namespaced by user id |
| No independent authorization | Submit requires a USER approval from the signed-in user; autonomy is forced off; the user's wallet sends every deposit |
| Headers | `X-Frame-Options: DENY`, `nosniff`, strict referrer policy |

## Manual Access

Sign in → Wallets tab: see connected wallets, make one active, toggle networks per wallet, link another wallet (EVM, Solana or NEAR), disconnect (the last wallet cannot be removed), sign out. SPak-in uses the active wallet for every network it is enabled on and other wallets for the rest.

## SPak Agent identity (foundation)

A user can mark one verified NEAR wallet as their agent identity (`POST /api/agent/identity {walletId}`). This records an association only. No keys are generated or stored, nothing can sign on the user's behalf, and autonomous execution stays off. `mode: "AGENT"` is passed to SPak-in only when an agent identity is linked; the policy still requires manual approval.

## API

| Method | Path | Auth |
|---|---|---|
| POST | `/api/auth/challenge` | none for SIGN_IN, session for LINK |
| POST | `/api/auth/verify` | none for SIGN_IN, session for LINK |
| GET | `/api/auth/session` | optional |
| POST | `/api/auth/logout` | optional |
| POST | `/api/auth/logout-all` | session |
| GET | `/api/wallets` | session |
| PATCH | `/api/wallets/:id` `{active?, networks?, label?}` | session, owner |
| DELETE | `/api/wallets/:id` | session, owner |
| GET/POST/DELETE | `/api/agent/identity` | session |
| POST | `/api/spak-in/interpret`, `/manual`, `/quote`, `/submit` | session |
| GET | `/api/spak-in/submissions/:id` | session, owner |
| POST | `/api/spak-in/submissions/:id/cancel` | session, owner |
| GET | `/api/spak-in/registry` | none |

## Configuration

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Required in production. Run `npm run db:migrate` on deploy |
| `SPAK_APP_ORIGIN` | Required in production, e.g. `https://spak.app`. Drives message domain, CSRF origin and Secure cookies. The server refuses to derive it from request headers in production (a phishing site could otherwise get messages naming its own domain) |
| `NEAR_RPC_URL` | Comma-separated list. Defaults to `https://rpc.mainnet.near.org,https://free.rpc.fastnear.com`. The next endpoint is tried only when one is unreachable, never to override a "key not found" |

Local development without `DATABASE_URL` uses an embedded PGlite database in `.data/pglite` (git-ignored), migrated on first use.

## Tests

- `tests/auth/verify.test.ts`: signature verification per family with real keys (viem accounts, ed25519 key pairs), NEP-413 Borsh layout, implicit and named NEAR accounts.
- `tests/auth/service.test.ts`: sign-in, sessions, idle and absolute expiry, logout, replay (including concurrent), expired challenges, wrong-wallet signatures, cross-user linking, multiple wallets, disconnect rules, network switching, agent identity. Real SQL on PGlite with the project migrations.
- `tests/auth/routes.test.ts`: the real Next.js route handlers with real requests and cookies: cookie flags, CSRF, rate limiting, input validation, protected SPak-in routes, client-sent wallet addresses ignored, follow-ups through an authenticated session.
- `tests/live/near-rpc.live.test.ts` (`npm run test:live`): mainnet `view_access_key` for an unknown key, a FullAccess key and a FunctionCall key.

## Real wallet integration (milestone: feature/real-wallet-integration)

### Supported wallet applications

| Wallet | Families | Status |
|---|---|---|
| MetaMask (extension) | EVM; also Solana through its Wallet Standard registration | Supported, tested with the real extension |
| Phantom (extension) | Solana (Wallet Standard), EVM (EIP-6963) | Supported, tested with the real extension |
| Other EIP-6963 EVM wallets (Rabby, Coinbase Wallet, Brave) | EVM | Expected to work through the same standards. Not tested |
| Other Wallet Standard Solana wallets (Solflare, Backpack) | Solana | Expected to work. Not tested |
| Meteor Wallet (web and extension) | NEAR | Supported. Handoff tested with the real web wallet; full sign-in not tested (needs a NEAR account) |
| MyNearWallet | NEAR | **Removed.** The live app shows "MyNearWallet is being retired and no longer approves requests from apps" |

### Connection requirements

- EVM: a wallet that implements EIP-6963 or injects `window.ethereum`, and `personal_sign`. Smart-contract wallets (ERC-1271) are not supported.
- Solana: a Wallet Standard wallet with `standard:connect` and `solana:signMessage`.
- NEAR: a wallet in NEAR Wallet Selector that implements NEP-413 `signMessage`, signing with a **full-access** key. Pop-ups must be allowed for the site.
- The app must be served from `SPAK_APP_ORIGIN`, so the domain in the sign-in message matches the browser address bar. MetaMask and Phantom both check this and showed no warning in testing.

### Authentication flows

- **EVM / Solana (one click):** connect → challenge for that address → sign → verify.
- **NEAR (two clicks):** first click gets a challenge with no account; the second click ("Open Meteor Wallet to sign") opens the wallet inside the user gesture so the pop-up is not blocked. The wallet returns accountId, publicKey and signature; the server binds the account only after verifying the signature and the on-chain full-access key.
- **NEAR redirect fallback:** if a wallet returns via `callbackUrl#accountId=…&signature=…&state=…`, the result is accepted only when `state` equals the challenge this tab started (sessionStorage), the URL is cleaned immediately so a reload cannot resubmit it, and the server still verifies everything. `#error=…` is shown as a cancellation or wallet error.
- **Choosing an account:** "Let me choose a different account" calls `wallet_requestPermissions` (EVM) or disconnects first (Solana) so the wallet shows its account picker.
- **Account changed mid-flow:** if the wallet's selected account differs from the one the challenge names, SPak stops before asking for a signature and tells the user to start again.
- **MetaMask per-chain permissions:** on a network added after the site connected (seen with Avalanche and Gnosis), MetaMask 13 rejects requests with 4100. SPak asks MetaMask to re-grant access once (its normal connect screen) and retries.
- **Cancel, expiry, errors:** rejections (EIP-1193 4001, Phantom 4001, Meteor cancel, closed pop-up) show "Cancelled in your wallet. Nothing was signed." The challenge stays unused and can be retried until it expires. Challenges expiring within 10 seconds are refused before the wallet is asked. Raw wallet errors are logged to the browser console with a `[spak]` prefix.

### Wallet compatibility results (2026-11-10)

Three kinds of evidence, kept separate:

**1. Automated tests** (`npm test`, 159 tests): signature verification with real keys, service logic on real SQL, route handlers, NEAR callback parsing, error classification, RPC failover, origin guard.

**2. Simulated wallet tests** (`tests/auth/wallet-flow.sim.test.ts`): the real browser flow code against the real route handlers with in-test wallets that sign with real keys. Covers EVM sign-in, rejection, account switch, expiry, 4100 permission retry, Solana sign-in, NEAR sign-in with wallet-chosen account, NEAR cancel and retry, and linking. These are not wallet applications.

**3. Actual wallet application tests** (`tests/real-wallets/*.cjs`, results in `docs/wallet-test-results/`): real Chrome Web Store builds of the extensions, fresh throwaway wallets with no funds, headed Chromium, SPak production build.

| Check | MetaMask 13.56.0 | Phantom 26.38.1 |
|---|---|---|
| Discovered by SPak | Pass (EIP-6963, and as a Solana wallet) | Pass (Wallet Standard and EIP-6963) |
| Wallet shows a sign-in request for the right domain, no transaction | Pass ("Sign-in request", "No changes") | Pass ("Sign In") |
| Sign-in creates a session for the wallet's address | Pass | Pass (Solana and EVM) |
| HttpOnly, SameSite=Lax session cookie | Pass | Not rechecked |
| Session restored after reload | Pass | Pass |
| SPak-in uses the verified address | Pass | Not tested |
| Sign-out | Pass | Pass |
| Rejecting in the wallet | Pass | Pass |
| Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain | Pass, each with matching SIWE Chain ID | Not tested per chain |
| Avalanche, Gnosis (added to MetaMask by the site) | Pass, after the 4100 permission fix | Not tested |
| Link a Solana account | Pass (MetaMask Solana, Snap signing screen) | — |
| Linking a wallet owned by another SPak user is refused | Automated only | Pass |

| Check | Meteor Wallet (web) | MyNearWallet (web) |
|---|---|---|
| Wallet window opens from the click, not blocked | Pass | Pass (before removal) |
| Request carries the server message, 32-byte nonce, recipient, state, callback | Not inspectable (Meteor uses a postMessage channel) | Pass |
| Real wallet page loads | Pass ("Sign in to access your wallets") | Loads, then refuses: "MyNearWallet is being retired and no longer approves requests from apps" |
| Closing the wallet window is reported as a cancellation | Pass | Pass |
| Full NEAR sign-in with a real account | **Not tested** (no mainnet NEAR account) | Not possible |

Phantom asked to register a public username during onboarding. The test stopped before that step; the wallet worked without it.

### Known limitations

- No wallet was tested on a phone, through WalletConnect, or with a hardware wallet. WalletConnect is not integrated.
- A full NEAR sign-in has not been completed with a real NEAR wallet. NEP-413 verification is covered by automated tests and by the live mainnet access-key lookup.
- After MyNearWallet's removal, Meteor is the only NEAR wallet. HOT, Intear and Sender are candidates to add through Wallet Selector.
- MetaMask 13 shows confirmations in its side panel or pop-up; the automated test opened `notification.html` directly to press the buttons. A person sees the normal MetaMask window.
- ERC-1271 smart-contract wallets fail sign-in.
- Rate limits are per server instance.

### Manual testing instructions

1. `npm run build` and start: `SPAK_APP_ORIGIN=http://localhost:3000 SPAK_ALLOW_EMBEDDED_DB=1 npm start`.
2. Use a browser profile with the wallet installed and a test account.
3. For each wallet: sign in; confirm the wallet shows "localhost:3000" and no transaction; reload (still signed in); Wallets tab shows the address; send "Bridge 10 USDC from Base to Arbitrum" in chat and check recipient and refund are your address; sign out.
4. Reject the signature once: SPak shows "Cancelled in your wallet. Nothing was signed."
5. EVM: switch the wallet's network (Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Gnosis) and sign in again. The message must show the matching Chain ID.
6. Link a second wallet from the Wallets tab, toggle its networks, make it active, disconnect it.
7. NEAR (Meteor): click Meteor Wallet, then "Open Meteor Wallet to sign", approve, and check the Wallets tab shows your NEAR account.
8. Wait more than 5 minutes between the two NEAR clicks: SPak must refuse with "The sign-in request expired."

### Re-running the real wallet tests

```
mkdir -p .rw/ext && cd .rw/ext
# download and unpack the Chrome Web Store builds (ids: MetaMask nkbihfbeogaeaoehlefnkodbefgpgknn, Phantom bfnaelmomeimhlpmgjnjophhpkkoljpa)
curl -L -o metamask.crx "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0&acceptformat=crx3&x=id%3Dnkbihfbeogaeaoehlefnkodbefgpgknn%26uc" && mkdir metamask && (cd metamask && unzip -q ../metamask.crx)
curl -L -o phantom.crx  "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0&acceptformat=crx3&x=id%3Dbfnaelmomeimhlpmgjnjophhpkkoljpa%26uc" && mkdir phantom && (cd phantom && unzip -q ../phantom.crx)
cd ../..
npm run build && SPAK_APP_ORIGIN=http://localhost:3100 SPAK_ALLOW_EMBEDDED_DB=1 SPAK_PGLITE_DIR=memory:// npx next start -p 3100 &
xvfb-run -a node tests/real-wallets/mm-full.cjs
xvfb-run -a node tests/real-wallets/ph-full.cjs
xvfb-run -a node tests/real-wallets/near-handoff.cjs
```

The scripts create throwaway wallets with random recovery phrases and never fund them. Wallet UIs change; the scripts rely on their current test ids and may need updates.
