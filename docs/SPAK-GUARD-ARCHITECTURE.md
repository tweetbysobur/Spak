# SPak Guard architecture

Guard is built from three parts:
- A pure policy engine.
- A service that reads and writes policy state and records decisions.
- One enforcement seam inside the execution state machine.

There is no model call, no external service, and no client-side authority.

## Modules

| File | Role |
|---|---|
| `src/guard/engine.ts` | `evaluateGuard(policy, subject, spending, stage, ceiling, now)`. Pure and deterministic. |
| `src/guard/service.ts` | `GuardService`: load and create policies, settings changes, spending sums, decision records, reservations, and the enforcement entry points. |
| `src/guard/types.ts` | Stages, outcomes, rules and the policy shape. |
| `src/execution/records.ts` | `ExecutionRecords.transition`, where reservations are created, required, consumed and released in the same database transaction as the state change. |
| `src/database/migrations/0009_guard_policies.sql` | Tables, check constraints, and the backfill for transfers approved before Guard. |

## Tables

- `spak_guard_policies`: one row per user. It holds the limits, modes, status and version. It is also the row the approval transaction locks.
- `spak_guard_network_rules`, `spak_guard_asset_rules`, `spak_guard_recipients`: the rest of the policy.
- `spak_guard_policy_history`: append-only change history.
- `spak_guard_decisions`: append-only decision log.
- `spak_guard_reservations`: one per execution, made unique by `execution_id`.

## Enforcement points

| Step | Where | Stage | Effect when not allowed |
|---|---|---|---|
| Instruction or manual form | `guardedInterpret` in `src/server/spak.ts` | PLAN | Decision returned with the result. Stored policy and spending replace anything in the request. |
| Create execution | `ExecutionService.create` | PLAN | Nothing is created or quoted. |
| Indicative quote | `ExecutionService.attachIndicative` (create, re-quote) | QUOTE | The quote is marked REJECTED. The execution stays a draft. |
| Before a firm quote is requested | `ExecutionService.firmQuote` | QUOTE | No deposit address is requested. |
| Firm quote, before it is shown | `ExecutionService.firmQuote`, including a reused firm quote | FIRM_QUOTE | The firm quote is marked REJECTED. |
| Approval | `GuardService.reserveInTx`, inside `ExecutionRecords.transition` | APPROVAL | The transaction rolls back. The approval is invalidated and nothing is reserved. |
| Deposit preparation | `DepositService.approvedExecution` (prepare, manual submit) | DEPOSIT | No deposit instructions. |

## Approval transaction

When the user approves, one database transaction does all of this:
1. Moves the execution from `AWAITING_APPROVAL` to `AWAITING_DEPOSIT`, compare-and-set on the state.
2. Locks the user's policy row (`SELECT ... FOR UPDATE`).
3. Re-reads the latest policy.
4. Requires a `FIRM_QUOTE` decision for this exact quote and plan hash.
5. Sums current spending, excluding this execution.
6. Evaluates the policy.
7. Records the decision and inserts the reservation.

Two approvals from the same user therefore run one after the other. The second sees the first's reservation.

`transition` refuses to commit `AWAITING_APPROVAL` or `QUOTED` to `AWAITING_DEPOSIT` without a RESERVED reservation, whichever caller asks. Later transitions consume or release the reservation in the same transaction.

## Wiring

- `ExecutionService` and `DepositService` both require a `guard` dependency, so neither can be built without Guard.
- `src/server/spak.ts` builds one `GuardService` per process, on the shared database.

## API

| Method and path | Purpose |
|---|---|
| `GET /api/guard` | Policy, spending per window, platform ceiling, unconfigured networks |
| `PATCH /api/guard` | `{ version, ...changes }` |
| `POST /api/guard/recipients` | `{ version, network, address, label? }` |
| `DELETE /api/guard/recipients/:id` | `{ version }` |
| `POST /api/guard/pause` | `{ scope: "REQUESTS" \| "ALL" }` |
| `POST /api/guard/resume` | `{ version }` |
| `GET /api/guard/history` | Policy changes, newest first |
| `GET /api/executions/:id/guard` | Decisions and the reservation for one transfer |

Every route takes the user from the session cookie. None takes a user id.
