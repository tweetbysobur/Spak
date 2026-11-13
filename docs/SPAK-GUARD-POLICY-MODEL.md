# SPak Guard policy model

Each user has one Guard policy, stored in the database. The server reads it on every check. A browser never supplies policy values.

## Fields

| Area | Field | Meaning |
|---|---|---|
| Limits | `maxTransactionUsd` | Per-transfer maximum. Optional. The platform ceiling (`SPAK_MAX_EXECUTION_USD`, default 1000) always applies, and this setting can only lower it. |
| | `minTransactionUsd` | Optional minimum. |
| | `dailyLimitUsd`, `weeklyLimitUsd`, `monthlyLimitUsd` | Optional. Rolling windows of 24 hours, 7 days and 30 days. Each must be at or below the next one. |
| Slippage | `maxSlippageBps` | 1 to 5000. Default 100 (1%). A plan or quote above it is refused. It is never raised to fit. |
| Networks | one rule per network: `allowSource`, `allowDestination`, `disabled` | Checked per direction. `disabled` wins. A supported network with no rule needs configuration before use. |
| Assets | `assetMode` `ANY` or `ALLOWLIST`, plus rules `ALLOW` or `BLOCK` by canonical id (`network:address`) | Symbols never match. A block always wins. An empty allowlist needs configuration. |
| Recipients | `recipientMode` `ANY` or `APPROVED_ONLY`, plus approved recipients (network, address, label) | An approval covers one network only. An address approved on Base is not approved on Arbitrum. Sending to your own verified wallet is always allowed. |
| Approval | none | Every transfer needs the user's wallet approval. There is no setting for autonomous execution. |
| Emergency | `status` `ACTIVE` or `PAUSED`, plus `executionDisabled` | Paused: no new transfers. Execution disabled: also no deposit instructions for approved transfers. Tracking, verification and refunds always continue. |

## Default policy

Created on first use, at version 1:
- Every supported network allowed in both directions.
- Any asset.
- Any recipient.
- 1% slippage.
- No personal limits, so the platform ceiling applies.

These are the protections SPak had before Guard existed. An existing user's flow does not change until they edit the policy.

## Versions and history

- Every change raises `version` by one and adds a row to `spak_guard_policy_history`.
- A history row records the actor, the action and each changed field as a before and after pair.
- A write must send the version it was based on. A stale version gets `409 GUARD_VERSION_CONFLICT`.
- Pause needs no version, because stopping must always work.

## Decision outcomes

| Outcome | When |
|---|---|
| `REQUIRES_APPROVAL` | Every rule passes before approval. The user still approves in their wallet. |
| `ALLOWED` | Every rule passes at approval or at deposit preparation. |
| `BLOCKED` | At least one rule fails. |
| `NEEDS_CONFIGURATION` | Nothing fails, but a required setting is missing: no policy, a network with no rule, or an empty allowlist. |

Each decision records:
- The rules evaluated.
- The plain-language reasons.
- The timestamp and the policy version.
- The plan hash, quote id and execution id it is bound to.
- The USD value it checked.

## Spending

- Only spending reservations count. A reservation is made when the user approves a firm quote, and its amount is that quote's USD value.
- A quote alone never counts.

| Execution state | Reservation |
|---|---|
| `AWAITING_DEPOSIT`, `PROCESSING`, `VERIFYING_DESTINATION` | RESERVED, counts |
| `FAILED`, `REFUNDING`, `UNKNOWN` | RESERVED, counts (funds not confirmed back) |
| `COMPLETED` | CONSUMED, counts |
| `CANCELLED`, `EXPIRED`, `REFUNDED` | RELEASED, does not count |
