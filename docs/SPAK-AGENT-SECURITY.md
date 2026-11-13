# SPak Agent security

Status: threat model for the proposed architecture.

## 1. Security properties

1. SPak holds no private keys and no full-access key on any Agent account.
2. Association proves ownership; it never transfers signing authority.
3. Widening authority needs the owner's on-chain-verifiable signature. Narrowing needs only a session.
4. Guard decides every transaction, on the server, with the grant as a narrowing overlay.
5. Fail closed: if ownership, grant, Guard or chain state cannot be verified, nothing proceeds.

## 2. Threats

| Threat | Scenario | Impact | Prevention | Detection | Recovery |
|---|---|---|---|---|---|
| Compromised SPak session | Attacker steals the session cookie | Can view data, prepare plans, narrow or revoke | HttpOnly cookie, idle and absolute expiry; widening grants and associations need wallet signatures; every transfer is still signed by the user's wallet | Unusual IP or user agent on sessions | Logout-all, revoke grants, review events |
| Compromised connected wallet | Attacker controls the user's EVM or Solana key | Can move that wallet's funds (outside SPak's control); could sign new associations | Association alone grants nothing; grants need the Agent owner key, not external wallet keys | Compromise report, unexpected association attempts | Remove wallet, block re-association, suspend Agent, user moves funds |
| Unauthorised wallet association | Attacker tries to attach someone's address | Misattribution | Wallet must sign a one-time statement naming the Agent; unique `(family, address)` | Failed or replayed association attempts logged | Reject; nothing to undo |
| Malicious instruction | Text tries to send funds elsewhere or widen limits | Unwanted plan | SPak-in is deterministic with no model to manipulate; plans are checked by Guard and the grant; the user reviews the firm quote | Guard blocks logged | None needed; nothing executes |
| Prompt or instruction manipulation (future language model) | Injected text in an instruction | Wrong plan | Models may only propose plans; Guard and grants decide; grants cannot be created from text | Blocked decisions | Same as above |
| Privilege escalation | Agent or SPak tries to widen its own grant | More authority | Grants verified against an owner full-access key on chain; Agent and SPak keys are never full-access | Grant signer key not in owner key set | Reject; alert |
| Unauthorised signing | SPak signs a transfer the user did not approve | Loss of funds | In L0 to L2 SPak cannot sign anything. In L3, an agent contract enforces limits and the SPak key is function-call only | On-chain monitoring of Agent-derived addresses | Owner deletes SPak key on chain, Guard disable-all |
| Replayed authorisation | Old signed grant or association reused | Stale authority | Nonce consumed once, expiry, version must be newer than the stored one, domain bound | Nonce reuse attempts | Reject |
| Stale permissions | Grant left active for months | Risk outlives intent | Mandatory expiry, re-sign prompts, Guard re-evaluates every stage | Expiry dashboard | Expire automatically |
| Revoked permissions still used | Pending job uses a revoked grant | Unauthorised transfer | Every stage re-reads the grant; approval records the grant version; revocation blocks next stage | Decision log shows the revoked version | Already-approved transfers finish or refund; nothing new starts |
| Compromised SPak infrastructure | Attacker controls SPak servers and database | Could forge grants in the database, prepare malicious plans | No keys to steal; every transfer still needs the user's wallet; future L3 limits live on chain in the agent contract | Audit log integrity checks, chain-vs-database grant comparison | Rotate SPak credentials, users revoke, on-chain key deletion |
| NEAR key compromise (Agent owner key) | Owner's NEAR key stolen | Attacker controls the Agent account, can sign grants | Backup full-access key encouraged; grants require fresh signatures; Agent holds no funds in L0 to L2 | Key set change seen on chain (polling) | Suspend Agent automatically; owner rotates keys with the backup key; if no backup, the Agent is lost and SPak says so plainly |
| Unauthorised Chain Signatures use (future) | Someone requests signatures for Agent-derived addresses | Loss of funds on those addresses | Only the Agent contract can call `sign` for its paths; its methods enforce grant limits; SPak key is function-call only to that contract | Monitoring of derived addresses and contract calls | Owner removes SPak key, pauses contract |
| SPak downtime | Servers unavailable | No new transfers | Fail closed; funds in flight stay with NEAR Intents, which refunds to the user's refund address | Uptime monitoring | Resume tracking; nothing lost |

## 3. Failure behaviour

| Cannot verify | Behaviour |
|---|---|
| Owner key on chain (RPC down) | Grants cannot be widened; existing grants keep working only until their next scheduled re-check, then the Agent is suspended |
| Grant signature | Grant rejected |
| Guard policy or grant | `GUARD_UNAVAILABLE`, nothing proceeds |
| Association signature or nonce | Association rejected |

## 4. Recovery procedures

- **Lost session**: sign in again with any verified wallet.
- **Lost external wallet**: remove it in SPak; the Agent keeps working with other wallets.
- **Lost Agent owner key with a backup key**: sign in with the backup key, rotate keys, re-verify ownership in SPak.
- **Lost Agent owner key without a backup**: the NEAR account cannot be recovered (NEAR documents no protocol recovery). SPak deactivates the Agent record; the user creates a new Agent.
- **Suspected SPak compromise**: users can revoke from the app, and, in L3, delete SPak's function-call key directly on NEAR without SPak.
