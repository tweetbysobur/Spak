# SPak Guard security

## Controls the backend enforces

Each control below has tests in `tests/guard/`.

- **No browser authority.**
  - `/api/spak-in/interpret` and `/api/spak-in/manual` ignore `policy` and `runtime` in the request body.
  - Policy, spending and the autonomy setting come from the database. Autonomy is always off.
- **Ownership.**
  - Every Guard read and write uses the session user.
  - A recipient id or execution id that belongs to another user gives 404.
  - A `userId` field in a settings body is rejected as malformed.
- **No bypass.**
  - The services cannot be built without Guard.
  - The execution state machine refuses the approval transition without a reservation.
  - Deposit preparation requires a live reservation.
- **Binding.**
  - An approval needs a recorded `FIRM_QUOTE` decision for the exact quote id and plan hash.
  - It is evaluated again against the latest policy version inside the approval transaction.
  - A policy change between review and approval is always applied.
- **Concurrency.**
  - Approvals lock the user's policy row, so concurrent approvals cannot overspend.
  - Settings writes use the same lock plus a version check.
  - Default policy creation is safe against concurrent first use.
- **Idempotency.**
  - There is one reservation per execution, enforced by a unique index.
  - Replaying an approval returns the existing approval and adds no reservation.
- **Fail closed.**
  - If loading, validating, evaluating or recording fails, the result is `503 GUARD_UNAVAILABLE`, and the step does not proceed.
  - A corrupt stored value is treated as unavailable, never as "no limit".
  - An unknown USD value blocks every quote-based stage.
- **Safe errors.**
  - Public messages name only the user's own settings in plain words.
  - Internal errors are logged on the server and returned as a generic message.
- **No secrets.** Guard stores no private keys, seed phrases or wallet secrets.
- **Ceiling.** No setting can raise the platform per-transfer ceiling.
- **Emergency.**
  - Pause needs no version.
  - Execution disabled also stops deposit preparation.
  - Tracking, destination verification and refund verification are never blocked, so funds in flight are always followed.

## Known limitations

- Guard does not stop a deposit transaction that was already broadcast. `submit` records and verifies it whatever the policy says, because blocking it would only hide funds in flight.
- USD values come from the NEAR Intents quote (`amountInUsd`). Guard does not cross-check them against a second price source.
- There is no fee limit rule. Fees are bound by the quote validation and the slippage rule only.
- Windows are rolling, not calendar periods.
- A reservation keeps the approved quote's USD value. It is not revalued if the price moves.
- Rate limits are in process memory, as for the rest of the API.
- The Guard settings page in the app is not connected to this API yet.
