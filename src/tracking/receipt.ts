import { getAsset } from "../spak-in/registries/assets";
import { getNetwork } from "../spak-in/registries/networks";
import { fromBaseUnits } from "../spak-in/lib/decimal";
import type { ExecutionView } from "../execution/views";
import type { TrackingView } from "./service";

/**
 * A receipt for a completed transfer or payment. Built only from SPak's own records: the execution, its firm quote,
 * the approval, and SPak's on-chain destination verification. It exists only once delivery is verified on the
 * destination chain; before that there is no receipt, never a provisional one. Anyone can check it by opening the
 * source and destination transactions on the explorers it lists.
 */
export const RECEIPT_VERSION = 1;

export interface ReceiptApproval { approvedAt: string; approvedBy: "USER" | "AGENT_GRANT"; grantVersion: number | null }

const asset = (id: string) => { const a = getAsset(id); return { id, symbol: a?.symbol ?? null, decimals: a?.decimals ?? null }; };
const human = (units: string | null, id: string) => { const a = getAsset(id); return units && a ? fromBaseUnits(units, a.decimals) : null; };
type Fee = { kind: string; bps?: number; amount?: string; assetId?: string; note?: string };

export function buildReceipt(x: ExecutionView, t: TrackingView, approval: ReceiptApproval | null) {
  const confirmed = t.destinationTxs.filter((d) => d.outcome === "CONFIRMED");
  if (x.state !== "COMPLETED" || !t.destination.verifiedAt || !t.destination.verifiedAmountOut || confirmed.length === 0) return null;
  const firm = x.quotes.find((q) => q.id === x.firmQuoteId);
  return {
    receiptVersion: RECEIPT_VERSION,
    kind: x.recipient.kind === "EXTERNAL" ? "PAYMENT" as const : "TRANSFER" as const,
    executionId: x.id,
    provider: x.provider,
    status: "COMPLETED" as const,
    completedAt: t.destination.verifiedAt,
    createdAt: x.createdAt,
    source: {
      network: x.source.network, networkName: getNetwork(x.source.network)?.name ?? x.source.network, asset: asset(x.source.assetId),
      amount: x.source.amountIn, amountFormatted: human(x.source.amountIn, x.source.assetId),
      transactions: t.sourceTxs.map((s) => ({ hash: s.hash, explorerUrl: s.explorerUrl })),
    },
    destination: {
      network: x.destination.network, networkName: getNetwork(x.destination.network)?.name ?? x.destination.network, asset: asset(x.destination.assetId),
      recipient: x.recipient.address, recipientKind: x.recipient.kind,
      amountReceived: t.destination.verifiedAmountOut, amountReceivedFormatted: human(t.destination.verifiedAmountOut, x.destination.assetId),
      minimumApproved: t.destination.minAmountOut, minimumApprovedFormatted: human(t.destination.minAmountOut, x.destination.assetId),
      transactions: confirmed.map((d) => ({ hash: d.txHash, explorerUrl: d.explorerUrl })),
    },
    fees: ((firm?.fees ?? []) as Fee[]).filter((f) => f.kind !== "REFUND"),
    refundAddress: x.refundAddress,
    approval,
    agentId: x.agentId,
    verification: { method: "SPAK_DESTINATION_CHAIN_CHECK" as const, verifiedAt: t.destination.verifiedAt },
  };
}
export type Receipt = NonNullable<ReturnType<typeof buildReceipt>>;
