# NEAR Intents Refund Evidence

What the NEAR Intents 1Click API documents and returns about refunds, and what SPak can and cannot conclude from it. Checked on 2026-11-11.

## Sources

| Source | What was read |
|---|---|
| OpenAPI spec | https://1click.chaindefuser.com/docs/v0/openapi.yaml: GetExecutionStatusResponse, SwapDetails, TransactionDetails, Quote, QuoteRequest, HistoryItem |
| Docs | https://docs.near-intents.org: 1Click quickstart (making-a-request, going-live), swap-types, fees, FAQs |
| Official SDK | `@defuse-protocol/one-click-sdk-typescript` 0.1.26, `dist/index.d.ts`: types `SwapDetails`, `TransactionDetails`, `GetExecutionStatusResponse` |
| Observed | `GET /v0/status` on 2026-11-11 for a fresh firm-quote deposit address (Base USDC to Arbitrum USDC, 5 USDC, never funded). Read-only; no funds sent |

## The ten questions

1. **What status indicates a refund?** `status: "REFUNDED"`, documented as "Swap failed, funds returned to refund address". Also relevant: `FAILED` ("Swap encountered an error") and `INCOMPLETE_DEPOSIT` ("Deposit below required amount").
2. **Which field holds the refunded amount?** `swapDetails.refundedAmount`, a string in smallest units, documented as "Amount of `originAsset` transferred to `refundTo`". Also `refundedAmountFormatted`, `refundedAmountUsd` and `refundReason` (free text; the docs' example value is `PARTIAL_DEPOSIT`).
3. **Which field holds origin-chain hashes?** `swapDetails.originChainTxHashes`, an array of `TransactionDetails { hash: string, explorerUrl: string }`.
4. **What does each origin-chain hash mean?** Documented only as "Hashes and explorer URLs for all transactions on the origin chain". No per-hash role is given.
5. **Are deposit and refund hashes told apart?** No. There is no type or role field.
6. **Is there an explicit refund transaction hash?** No. Neither the OpenAPI spec nor SDK 0.1.26 has a refund transaction field, and there is no refund endpoint.
7. **Are hashes available before and after a refund?** Not documented. Observed before any deposit: `originChainTxHashes: []`.
8. **Do repeated responses keep earlier references?** Not documented. SPak keeps every hash it has seen and never erases one when a response is incomplete.
9. **Are these fields guaranteed?** Per the OpenAPI spec:
   - `swapDetails`, `originChainTxHashes`, `destinationChainTxHashes`, `intentHashes` and `nearTxHashes` are required.
   - `refundedAmount` and `refundReason` are optional.
   - Nothing promises that a refund transaction will appear in `originChainTxHashes`.
10. **Are there differences between source chains?** None documented for the status response.

## Observed response (pending deposit, real)

```json
{
  "status": "PENDING_DEPOSIT",
  "updatedAt": "2026-11-11T06:19:21.772Z",
  "correlationId": "779e1637-af7c-410a-b74e-c8d691532581",
  "swapDetails": {
    "depositedAmount": null, "depositedAmountUsd": null, "depositedAmountFormatted": null,
    "intentHashes": [], "nearTxHashes": [],
    "amountIn": null, "amountInFormatted": null, "amountInUsd": null,
    "amountOut": null, "amountOutFormatted": null, "amountOutUsd": null, "slippage": null,
    "refundedAmount": "0", "refundedAmountFormatted": "0", "refundedAmountUsd": "0", "refundReason": null,
    "refundFee": "2400", "withdrawFee": "5300",
    "originChainTxHashes": [], "destinationChainTxHashes": []
  },
  "quoteResponse": "(present; omitted here)"
}
```

Differences from the documentation:

- `refundedAmount` is `"0"` before any refund, not absent. SPak treats it as unknown unless the status is `REFUNDED` and the value is above zero.
- `refundFee` and `withdrawFee` appear in `swapDetails`. In the OpenAPI spec, `refundFee` is documented only on the quote.
- `depositedAmount` fields are present (null before a deposit).

No real `REFUNDED` response has been observed. There is no example here because SPak does not invent one.

## Guaranteed vs not guaranteed

| Guaranteed (OpenAPI required) | Not guaranteed |
|---|---|
| A status value from the 7-value enum | Which origin hash is the refund |
| `originChainTxHashes` array present | That a refund hash appears at all |
| `TransactionDetails.hash` | `refundedAmount` (optional) |
| | Refund timing and the refund fee formula |
| | What happens to deposits after the deadline beyond "funds may be lost" |
| | Whether a refund can be split into several transactions |

## Supported evidence for association

- The status response is fetched for this execution's unique deposit address (and memo), and SPak checks its `quoteResponse.signature` against the firm quote it approved. Any hash in that response's `originChainTxHashes` that is not the user's deposit is therefore linked by the provider to this swap.
- That is evidence the transaction belongs to the swap. It is not evidence the transaction is the refund. The provider does not label it.

## Unsupported assumptions (SPak does not make them)

- "Every non-deposit origin hash is the refund."
- "A transfer to the refund address of the right asset and amount is the refund."
- "A transfer inside a time window is the refund."
- "`refundedAmount` equals the on-chain amount" (no fee formula is documented).

## SPak capability assessment

`SPAK_REFUND_EVIDENCE_CAPABILITY`, default **UNCONFIRMED**.

| Value | Meaning | SPak behaviour |
|---|---|---|
| CONFIRMED | Refund hashes documented, or observed in a real refund, as appearing in `originChainTxHashes` | Provider-listed, chain-verified, non-early transfers count toward REFUNDED |
| UNCONFIRMED (current) | Hashes may be relevant but their meaning is not established | Provider-listed transfers are verified and shown as "provider-listed, unconfirmed". Nothing counts. Refund stays ASSOCIATION_PENDING with a review |
| UNSUPPORTED | Provider gives no usable evidence | Provider listing is ignored. All transfers are candidates. Review |

With the default, SPak never marks an execution REFUNDED automatically. Switch to CONFIRMED only after `docs/REFUND-LIVE-TEST.md` shows refund hashes in `originChainTxHashes`, or NEAR Intents documents it. Record the evidence when you switch.

## Remaining uncertainties

- Whether refund transactions appear in `originChainTxHashes` at all.
- Whether `refundedAmount` is net of `refundFee`.
- Whether partial refunds and EXACT_INPUT excess returns use one transaction or several.
- Refund timing per chain.
