import { RpcAnswerError, type ChainRpc } from "../rpc";
import type { DepositExpectation, VerificationResult } from "../types";

type Action = { Transfer?: { deposit: string }; FunctionCall?: { method_name: string; args: string; deposit: string } } | string;
interface TxStatus {
  final_execution_status?: string;
  status: { SuccessValue?: string; Failure?: unknown };
  transaction: { signer_id: string; receiver_id: string; actions: Action[] };
  receipts_outcome: { outcome: { status: { Failure?: unknown } } }[];
}

/**
 * Verify a NEAR deposit: signed by the user's verified account, succeeded in every receipt, and either a Transfer of
 * exactly the amount to the deposit account (native) or ft_transfer of exactly the amount to it on the token contract.
 */
export async function verifyNearDeposit(rpc: ChainRpc, e: DepositExpectation): Promise<VerificationResult> {
  let r: TxStatus;
  try {
    r = await rpc.call<TxStatus>(e.network, "tx", { tx_hash: e.txHash, sender_account_id: e.sender, wait_until: "NONE" });
  } catch (err) {
    if (err instanceof RpcAnswerError && /UNKNOWN_TRANSACTION|doesn't exist|not found/i.test(`${err.rpcCode} ${err.message}`)) return { outcome: "NOT_FOUND", confirmations: null, problems: [], observed: {} };
    throw err;
  }
  const t = r.transaction;
  const observed: Record<string, unknown> = { signer: t.signer_id, receiver: t.receiver_id, finality: r.final_execution_status };
  if (!r.status || (!("SuccessValue" in r.status) && !r.status.Failure)) return { outcome: "PENDING", confirmations: null, problems: [], observed };
  if (r.status.Failure || r.receipts_outcome.some((o) => o.outcome.status.Failure)) return { outcome: "FAILED", confirmations: null, problems: ["the transaction failed"], observed };

  const problems: string[] = [];
  if (t.signer_id !== e.sender) problems.push(`signed by ${t.signer_id}, not your verified account ${e.sender}`);
  if (e.kind === "NATIVE") {
    const sent = t.actions.reduce((s, a) => s + (typeof a === "object" && a.Transfer ? BigInt(a.Transfer.deposit) : 0n), 0n);
    if (t.receiver_id !== e.depositAddress) problems.push(`sent to ${t.receiver_id}, not the deposit account`);
    if (sent !== BigInt(e.amount)) problems.push(`transferred ${sent} yoctoNEAR, required ${e.amount}`);
  } else {
    if (t.receiver_id !== e.tokenContract) problems.push(`called ${t.receiver_id}, not the token contract ${e.tokenContract}`);
    const calls = t.actions.flatMap((a) => (typeof a === "object" && a.FunctionCall?.method_name === "ft_transfer" ? [a.FunctionCall] : []));
    let total = 0n;
    for (const c of calls) {
      try {
        const args = JSON.parse(Buffer.from(c.args, "base64").toString("utf8")) as { receiver_id?: string; amount?: string };
        if (args.receiver_id === e.depositAddress && /^\d+$/.test(args.amount ?? "")) total += BigInt(args.amount!);
      } catch { /* not JSON: not a deposit */ }
    }
    observed.tokenTransferred = total.toString();
    if (!calls.length) problems.push("no ft_transfer call");
    else if (total !== BigInt(e.amount)) problems.push(`ft_transfer of ${total} to the deposit account, required ${e.amount}`);
  }
  if (problems.length) return { outcome: "MISMATCH", confirmations: null, problems, observed };
  return { outcome: r.final_execution_status === "FINAL" ? "CONFIRMED" : "PENDING", confirmations: null, problems: [], observed };
}
