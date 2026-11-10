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
| NEAR | NEAR Wallet Selector 10 (Meteor, MyNearWallet) | NEP-413 `signMessage` with a 32-byte nonce and recipient = app host | ed25519 over sha256(NEP-413 Borsh payload). Implicit accounts: key must equal the account id. Named accounts: NEAR RPC `view_access_key` must return `FullAccess` |

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
| `SPAK_APP_ORIGIN` | Required in production, e.g. `https://spak.app`. Drives message domain, CSRF origin and Secure cookies |
| `NEAR_RPC_URL` | Defaults to `https://rpc.mainnet.near.org` |

Local development without `DATABASE_URL` uses an embedded PGlite database in `.data/pglite` (git-ignored), migrated on first use.

## Tests

- `tests/auth/verify.test.ts`: signature verification per family with real keys (viem accounts, ed25519 key pairs), NEP-413 Borsh layout, implicit and named NEAR accounts.
- `tests/auth/service.test.ts`: sign-in, sessions, idle and absolute expiry, logout, replay (including concurrent), expired challenges, wrong-wallet signatures, cross-user linking, multiple wallets, disconnect rules, network switching, agent identity. Real SQL on PGlite with the project migrations.
- `tests/auth/routes.test.ts`: the real Next.js route handlers with real requests and cookies: cookie flags, CSRF, rate limiting, input validation, protected SPak-in routes, client-sent wallet addresses ignored, follow-ups through an authenticated session.
- `tests/live/near-rpc.live.test.ts` (`npm run test:live`): mainnet `view_access_key` for an unknown key, a FullAccess key and a FunctionCall key.
