# SPak security

## Principles

- Non-custodial. SPak holds no keys and no funds.
- No server-side signing. Your wallet signs sign-in, approvals and deposits.
- Fail closed. A check that cannot run stops the transfer.
- Nothing shows as complete before the destination chain confirms it.

## Controls

| Area | Control |
|---|---|
| Sign-in | Server challenge, signature verification for EVM, Solana and NEAR, rate limit on challenges |
| Plans | Only plans SPak-in issued to you; approval bound to the exact plan hash and revision |
| Quotes | Quote signature verified; firm quote compared to the shown minimum |
| Deposits | Built by SPak, signed by you; verified on the source chain |
| Delivery | Checked against trusted payout senders on the destination chain |
| Policy | SPak Guard before quote and before deposit |
| Secrets | Only in the host environment, never in the repository |

Further detail: [AUTH.md](AUTH.md), [SPAK-GUARD-SECURITY.md](SPAK-GUARD-SECURITY.md), [SPAK-AGENT-SECURITY.md](SPAK-AGENT-SECURITY.md).

## Reporting

Report a vulnerability privately to the repository owner through GitHub. Do not open a public issue.
