# SPak

Cross-chain execution agent on NEAR. You state an intent. SPak-in parses it, NEAR Intents quotes and settles it, and SPak tracks it until delivery is verified.

PRD: `gentles-build-brain/projects/spak.md`.

## Foundation Release status

Built:
- SPak-in: deterministic intent engine in `src/lib/spak-in`. No LLM. Parser, entity extraction, classification, context resolver, validation, policy and planner. 14 tests.
- SPak Execution: NEAR Intents 1Click client in `src/lib/execution` (tokens, quote, status). Live quotes across 24 networks.
- SPak Chat: natural-language instructions with follow-up prompts for missing fields.
- Manual Swap: network and asset pickers fed by the live NEAR Intents token list.
- Transaction review with every PRD 6.3 field, plus explicit approval.
- Execution tracking. Completed shows only after NEAR Intents reports SUCCESS.
- Basic history (browser storage).

Not built yet:
- Wallet connection. For now you paste your addresses under "Your addresses" and send the deposit from your own wallet.
- NEAR account agent onboarding.
- Database. History lives in the browser.

## Safety rules in code

- A real deposit address is created only after you tick the confirmation and approve (`approved: true`). Before that, every quote is a dry run.
- Ambiguous input (no verb, several amounts, mixed actions) never reaches a quote.
- Recipient and refund addresses are format-checked per network, in the parser and again on the server.
- Slippage is capped at 5%.
- A submitted deposit is never shown as success.

## Run

    npm install
    npm run dev       # http://localhost:3000
    npm test
    npm run typecheck

## API

- `POST /api/intent` with `{ text, context: { addresses } }` returns `ready`, `needs_info` or `rejected`.
- `POST /api/quote` with intent fields and `slippageBps`. Add `approved: true` for a deposit address.
- `GET /api/status?depositAddress=…&deadline=…`
- `GET /api/tokens`
