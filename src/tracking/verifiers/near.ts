import { RpcAnswerError, type ChainRpc } from "@/deposits/rpc";
import type { DeliveryExpectation, DeliveryResult } from "../types";

type Action = { Transfer?: { deposit: string }; FunctionCall?: { method_name: string; args: string } } | string;
interface Receipt { receipt_id: string; receiver_id: string; predecessor_id: string; receipt: { Action?: { actions: Action[] } } }
interface Status {
  final_execution_status?: string;
  status: { SuccessValue?: string; Failure?: unknown };
  receipts?: Receipt[];
  receipts_outcome: { id: string; outcome: { status: { Failure?: unknown } } }[];
}

/** NEAR Intents withdrawals are receipts from intents.near; the outer transaction is signed by a relayer. */
export const NEAR_DESTINATION_SIGNERS = ["intents.near"];

/**
 * NEAR delivery from the receipts (EXPERIMENTAL_tx_status), not the outer transaction: native Transfer receipts
 * to the recipient, or ft_transfer / ft_transfer_call receipts on the exact token contract naming the recipient.
 * Only receipts whose own outcome succeeded count. Gas refunds from "system" are ignored. FINAL only.
 */
export async function verifyNearDelivery(rpc: ChainRpc, e: DeliveryExpectation, signers = NEAR_DESTINATION_SIGNERS): Promise<DeliveryResult> {
  let r: Status | null = null;
  for (const sender of signers) {
    try { r = await rpc.call<Status>(e.network, "EXPERIMENTAL_tx_status", { tx_hash: e.txHash, sender_account_id: sender, wait_until: "NONE" }); break; }
    catch (err) { if (!(err instanceof RpcAnswerError && /UNKNOWN_TRANSACTION|doesn't exist|not found/i.test(`${err.rpcCode} ${err.message}`))) throw err; }
  }
  if (!r) return { outcome: "NOT_FOUND", received: "0", confirmations: null, problems: [], observed: {} };
  const observed: Record<string, unknown> = { finality: r.final_execution_status };
  if (!r.status || (!("SuccessValue" in r.status) && !r.status.Failure)) return { outcome: "PENDING", received: "0", confirmations: null, problems: [], observed };
  const failed = new Set(r.receipts_outcome.filter((o) => o.outcome.status.Failure).map((o) => o.id));
  let received = 0n;
  for (const rc of r.receipts ?? []) {
    if (failed.has(rc.receipt_id) || rc.predecessor_id === "system") continue;
    for (const a of rc.receipt.Action?.actions ?? []) {
      if (typeof a !== "object") continue;
      if (e.kind === "NATIVE" && a.Transfer && rc.receiver_id === e.recipient) received += BigInt(a.Transfer.deposit);
      if (e.kind === "TOKEN" && a.FunctionCall && rc.receiver_id === e.tokenContract && /^ft_transfer(_call)?$/.test(a.FunctionCall.method_name)) {
        try {
          const args = JSON.parse(Buffer.from(a.FunctionCall.args, "base64").toString("utf8")) as { receiver_id?: string; amount?: string };
          if (args.receiver_id === e.recipient && /^\d+$/.test(args.amount ?? "")) received += BigInt(args.amount!);
        } catch { /* not JSON: not a transfer */ }
      }
    }
  }
  observed.received = received.toString();
  if (received === 0n) {
    if (r.status.Failure) return { outcome: "FAILED", received: "0", confirmations: null, problems: ["the destination transaction failed"], observed };
    return { outcome: "NO_TRANSFER", received: "0", confirmations: null, problems: ["no successful transfer of the expected asset to the recipient"], observed };
  }
  return { outcome: r.final_execution_status === "FINAL" ? "CONFIRMED" : "PENDING", received: received.toString(), confirmations: null, problems: [], observed };
}
