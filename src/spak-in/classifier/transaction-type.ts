import type { RecipientSlot, VerbClass } from "../parser/frame";

export type TxIntentType = "SWAP" | "CROSS_CHAIN_SWAP" | "BRIDGE" | "CROSS_CHAIN_TRANSFER" | "PAYMENT";
export const TX_INTENT_TYPES: ReadonlySet<string> = new Set<TxIntentType>(["SWAP", "CROSS_CHAIN_SWAP", "BRIDGE", "CROSS_CHAIN_TRANSFER", "PAYMENT"]);

export interface TxShape {
  verb: VerbClass | null;
  sourceSymbol: string | null;
  destSymbol: string | null;
  sourceNetwork: string | null;
  destNetwork: string | null;
  recipient: RecipientSlot | null;
}

/**
 * Which transaction a value movement is. Depends on the verb and on what is known.
 * Re-run after context resolution and validation, since filling a network can turn SWAP into CROSS_CHAIN_SWAP.
 */
export function deriveTxType(s: TxShape): TxIntentType | null {
  const external = s.recipient?.kind === "EXTERNAL" || s.recipient?.kind === "PLACEHOLDER";
  const crossChain = !!s.sourceNetwork && !!s.destNetwork && s.sourceNetwork !== s.destNetwork;
  const sameAsset = !s.destSymbol || s.destSymbol === s.sourceSymbol;
  switch (s.verb) {
    case "SWAP":
      if (s.destSymbol && s.destSymbol === s.sourceSymbol) return crossChain ? "BRIDGE" : "SWAP";
      return crossChain ? "CROSS_CHAIN_SWAP" : "SWAP";
    case "BRIDGE":
      if (external) return "PAYMENT";
      return sameAsset ? "BRIDGE" : "CROSS_CHAIN_SWAP";
    case "TRANSFER":
      return external ? "PAYMENT" : "CROSS_CHAIN_TRANSFER";
    case "SEND":
      if (external || !s.recipient && !s.destNetwork) return "PAYMENT";
      return "CROSS_CHAIN_TRANSFER";
    case "PAY":
      return "PAYMENT";
    default:
      return null;
  }
}
