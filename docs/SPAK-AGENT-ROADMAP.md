# SPak Agent roadmap

Status: proposal for review. Identity and wallet association come before permissions; autonomy comes last and separately.

## Stages

### Stage 5: Agent data model and linked identity (no NEAR creation) [implemented on feature/spak-agent-identity]
- **Built**: see [Identity model, section 8](SPAK-AGENT-IDENTITY-MODEL.md#8-stage-5-implementation-built). On-chain attestation is designed there, not built. The legacy `spak_agent_identities` table was kept, not migrated.
- **Objective**: replace the single-row agent identity with the `spak_agents` model; keep today's linked-NEAR behaviour as identity-only L0.
- **Scope**: tables `spak_agents`, `spak_agent_events`; migration of `spak_agent_identities`; owner proof by NEP-413 plus on-chain `view_access_key` check.
- **Dependencies**: existing auth.
- **Backend**: Agent Identity Service, events, owner verification against NEAR RPC.
- **Frontend**: Agent page shows real status, owner key and events.
- **Database**: new tables, data migration from `spak_agent_identities`.
- **Security**: suspend when the owner key disappears on chain; fail closed when RPC is down.
- **Tests**: ownership, cross-user access, replay, key removal, RPC failure.
- **Acceptance**: removing the NEAR wallet suspends the Agent instead of silently unlinking; no Agent action without a verified owner key.

### Stage 6: Wallet association [implemented on feature/spak-agent-wallet-association]
- **Built**: see [Identity model, section 9](SPAK-AGENT-IDENTITY-MODEL.md#9-stage-6-implementation-wallet-association-built). Expiry chosen as 90 days (not 180).
- **Objective**: signed, expiring wallet-to-Agent associations for EVM, Solana and NEAR.
- **Backend**: statements, verification, expiry, revocation, compromise flag.
- **Frontend**: associate, view, remove.
- **Database**: `spak_agent_wallets`.
- **Security**: one-time nonces, domain binding, no association without the wallet's signature.
- **Tests**: every family, replay, expiry, removal, compromised flag, same address other user.
- **Acceptance**: an unverified address can never be associated; removing a wallet revokes its association immediately.

### Stage 7: Dedicated Agent NEAR account (testnet first) [implemented on feature/spak-agent-near-account; no real account created yet]
- **Built**: see [Identity model, section 10](SPAK-AGENT-IDENTITY-MODEL.md#10-stage-7-implementation-dedicated-agent-near-account-built-testnet-only). Blocked on an authorised testnet parent account to run the live test.
- **Objective**: create `name.agents.<parent>` accounts owner-keyed from the first block.
- **Dependencies**: decision on the parent account; factory contract.
- **Backend**: creation requests, NEP-366 relaying or factory call, on-chain key verification.
- **Frontend**: activation flow, backup-key prompt.
- **Database**: creation states on `spak_agents`.
- **Security**: SPak never has a key on the new account; verify key set after creation; contract review.
- **Tests**: testnet end to end, failure midway, name collisions, key set checks.
- **Acceptance**: on testnet, every created account has exactly the owner's key as full access.

### Stage 8: L1 permission grants and Guard overlay
- **Objective**: signed grants that narrow Guard in Agent mode.
- **Backend**: grant service, Guard engine overlay rules, grant version on decisions and reservations.
- **Frontend**: grant editor, history.
- **Database**: `spak_agent_grants`; grant version column on Guard decisions.
- **Security**: widening needs signature, narrowing needs session; no fallback when the grant is missing.
- **Tests**: intersection logic, conflicts, revocation mid-flow, expiry, replay, concurrency.
- **Acceptance**: no Agent-mode transfer passes Guard without an active grant; a grant never loosens Guard.

### Stage 9: Prepared and conditional execution (L2)
- **Objective**: plans prepared ahead, signed by the user at trigger time.
- **Dependencies**: Stage 8, a trigger service, price data.
- **Security**: re-evaluation at trigger; no signing without the user.
- **Acceptance**: a trigger never executes without a fresh user signature.

### Stage 10: Agent contract and Chain Signatures research (testnet)
- **Objective**: prototype an agent contract that enforces limits and calls `v1.signer-prod.testnet`.
- **Acceptance**: written review of fees, latency, threshold and failure modes; no mainnet use.

### Stage 11: Autonomous execution (L3)
- **Objective**: bounded autonomy meeting every requirement in [Permissions, section 7](SPAK-AGENT-PERMISSIONS.md#7-future-autonomous-execution-requirements).
- **Acceptance**: independent review passed; flag-gated; emergency stop verified on chain.

### Developer platform (parallel, after Stage 8)
Decisions to make now so it is not blocked later:
- Agents are addressed by NEAR account id everywhere, so agent-to-agent verification can use NEP-413 signatures.
- Grants are data, not code, so an API key can be issued under a grant with narrower scope.
- Execution ids, decisions and events are already stable, so webhooks can be built on `spak_agent_events` and execution events.
- API keys belong to an Agent, never to a user directly, and can only narrow that Agent's grant.

## Unresolved decisions

1. **Parent account**: which NEAR account SPak owns for Agent names (`spak.near` availability unverified). Fallback: implicit accounts (model E).
2. **Who pays creation**: SPak sponsoring storage and gas, and its cost per Agent (not verified).
3. **Backup key**: required or recommended at activation.
4. **Association expiry**: 180 days proposed.
5. **Grant maximum length**: 90 days proposed for L1, 30 days for L3.
6. **Multiple Agents**: when to allow more than one per user.
7. **Linked personal accounts (model A)**: keep permanently as identity-only, or require migration.
8. **Wallets without NEAR**: whether a passkey-based NEAR key option should exist for users with no NEAR wallet.

## Assumptions that need verification
- Account creation cost and the minimum balance for a new named account.
- Chain Signatures fee per signature, latency and threshold values.
- Whether `intents.near` will add scoped keys (none documented today).
- Meteor wallet support for adding a second full-access key in its interface.

## Recommended next stage
Stage 5. It removes the current gap (a label without a verified owner key), needs no new NEAR infrastructure, and every later stage depends on it.
