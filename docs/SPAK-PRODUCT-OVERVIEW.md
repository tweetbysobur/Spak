# SPak product overview

SPak turns a plain-language instruction into a cross-chain transfer through NEAR Intents. You review every quote. Your wallet signs every deposit. SPak marks a transfer complete only after the destination chain confirms delivery.

## Who it is for

You hold assets on more than one chain and want to move them without choosing bridges, copying deposit addresses or checking explorers by hand.

## Classification

Live means in the code, tested and running in production at usespak.vercel.app. Partial means part of the feature exists. Upcoming means planned and not built.

| Feature | Status | Notes |
|---|---|---|
| Website | Live | usespak.vercel.app |
| Wallet sign-in (EVM, Solana, NEAR) | Live | Signature verified on the server |
| SPak-in instruction parser | Live | Deterministic, no language model |
| Signed NEAR Intents quotes | Live | Quote signature checked |
| Review screen | Live | Amounts, minimum received, fees, recipient |
| One-click confirm | Live | Firm quote, approval and deposit in one confirm |
| NEAR recipient registration fix | Live | 1Click registers the recipient and charges the quoted withdrawFee |
| Delivery verification | Live | 45 of 90 USDC routes automatic; others flagged for manual review up front |
| Refund tracking | Live | |
| One-time payments | Live | Pay another address on the same or another network; payment review, Activity filter and a downloadable receipt after verified delivery. |
| Payment requests | Live | Ask for an amount by link; the payer pays from any supported network and the request turns Paid only after verified delivery of at least that amount |
| Recurring payments | Live | Daily, weekly, two-weekly, monthly or every N days. Each payment is prepared with a fresh quote and waits for your review and wallet signature. Prepared by a daily job (04:17 UTC) and when you open Payments |
| SPak Guard | Live | Limits, allowed networks, assets, recipients |
| SPak Intelligence | Live | Read-only balances and prices on 10 networks |
| Guided tour | Live | First-run tour, replayable from the account menu |
| SPak Agent | Live | Identity, signed permissions (limits, spacing, expiry), pause, revoke and approval monitoring are live. The Agent approves within limits; your wallet signs every deposit. No unattended signing |
| Verified mainnet settlement | In progress | No verified SPak mainnet settlement yet |
| Conditional and scheduled execution | Upcoming | Parsed by SPak-in, not executed. Recurring payments (above) are the first scheduled feature |
| Advanced Agents, developer APIs, rebalancing | Upcoming | |

## Screens

| Screen | Purpose |
|---|---|
| Overview | Recent transfers and a start point |
| Execute | Chat, review and confirm |
| Payments | Recurring payment schedules and payments waiting for your signature |
| Activity | Every transfer with live status |
| Intelligence | Portfolio, insights, route comparison |
| Guard | Your limits |
| Agent | Agent identity setup |
| Settings | Linked wallets and networks |

![Overview](assets/screenshots/app-05-overview.png)
*Overview screen (preview build, simulated wallet).*

![Activity](assets/screenshots/app-15-activity.png)
*Activity screen.*

![Dark theme](assets/screenshots/app-21-overview-dark.png)
*Overview in the dark theme.*
