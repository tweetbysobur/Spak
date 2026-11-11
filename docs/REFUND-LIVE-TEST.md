# Refund Live Test Procedure

Purpose: observe one real NEAR Intents refund to settle the questions in `docs/NEAR-INTENTS-REFUND-EVIDENCE.md`. The owner runs it with their own small funds and explicit approval. SPak never runs it automatically.

Do not cause a failure on purpose. Use a refund that happens naturally, or a procedure NEAR Intents approves. Ask NEAR Intents support (partners.near-intents.org) for a test route or a known refund case before spending funds.

## 1. Choose the route

- Source and destination must both be SPak-verifiable: EVM, Solana or NEAR. Base USDC to Arbitrum USDC keeps fees low.
- The source wallet must be your verified SPak wallet. It is the refund address.

## 2. Choose the amount

- Use the smallest amount the quote accepts. Usually 1 to 5 USDC.
- Never use more than you are willing to lose to fees.

## 3. Get the firm quote

- In SPak, type the transfer, review it, and click "Get firm quote".
- Record from the review screen: execution ID, quote ID, deposit address, memo if any, deadline, and the refund fee line.

## 4. Record provider references

- On a computer, open `GET /api/quotes/<quoteId>` while signed in and record `providerReference.signature` and `correlationId`. Or ask the developer to run `GET /api/admin/reviews/<id>` later.

## 5. Send the deposit normally

- Approve, then use "Send deposit with wallet". Your wallet asks you to sign. Nothing is sent without that.
- Record the deposit transaction hash.

## 6. Monitor

- Leave the SPak tracking page open, or let the monitor run.
- Every few minutes, save the raw status response: `curl "https://1click.chaindefuser.com/v0/status?depositAddress=<address>"`.
- Save each response to a file with a timestamp.

## 7. If NEAR Intents reports a refund

Capture the full JSON of every response from the first non-PENDING status up to the last. Note especially:

- `status`
- `swapDetails.refundedAmount`, `refundReason`, `refundFee` and `depositedAmount`
- every entry of `originChainTxHashes`, and when each one first appeared
- whether earlier hashes stay listed in later responses

## 8. Identify refund transactions

- In your wallet and on the explorer, find incoming transfers of the source asset to your refund address after the deposit.
- For each one, check whether its hash is in `originChainTxHashes`.

## 9. Verify each transaction

- SPak verifies automatically. You can also run `POST /api/executions/<id>/refund/verify`.
- Check on the explorer: success, sender, recipient = your refund address, token contract, amount in raw units, block time, confirmations.

## 10. Compare amounts

- Compare `refundedAmount` with the sum of the verified transfers.
- Compare `depositedAmount` minus `refundedAmount` with `refundFee`.

## 11. Several transactions

- Note whether the refund arrived as one transaction or several, and whether all of them appear in `originChainTxHashes`.

## 12. Record the result

- Add the observed responses (with addresses redacted if you wish) and your conclusions to `docs/NEAR-INTENTS-REFUND-EVIDENCE.md`.
- Only if refund hashes reliably appear in `originChainTxHashes`, set `SPAK_REFUND_EVIDENCE_CAPABILITY=CONFIRMED`, with a link to the evidence.
- Until then, refunds stay in manual review. That is the intended, safe behaviour.
