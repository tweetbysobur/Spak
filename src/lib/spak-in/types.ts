// SPak-in structured intent schema. Deterministic. No LLM dependency.

export type IntentAction = "swap" | "transfer";

export type NetworkId = string; // NEAR Intents 1Click blockchain code, e.g. "base", "sol", "arb"

export interface Intent {
  action: IntentAction;
  amount: string; // decimal string as typed, e.g. "50" or "0.25"
  sourceToken: string; // upper-case symbol
  sourceNetwork?: NetworkId;
  destToken?: string;
  destNetwork?: NetworkId;
  recipient?: string;
  refundTo?: string;
}

export type MissingField =
  | "action"
  | "amount"
  | "sourceToken"
  | "sourceNetwork"
  | "destToken"
  | "destNetwork"
  | "recipient"
  | "refundTo";

export interface WalletContext {
  /** Addresses the user controls, keyed by network. Used as default recipient and refund address. */
  addresses?: Partial<Record<NetworkId, string>>;
}

export interface PolicyConfig {
  maxSlippageBps: number;
  allowedNetworks?: NetworkId[];
  allowedTokens?: string[];
}

export interface ExecutionPlan {
  kind: "cross_chain_swap" | "same_chain_swap" | "bridge" | "cross_chain_transfer" | "same_chain_transfer";
  steps: string[];
  slippageBps: number;
}

export type InterpretResult =
  | { status: "ready"; intent: Required<Pick<Intent, "action" | "amount" | "sourceToken" | "sourceNetwork" | "destToken" | "destNetwork" | "recipient" | "refundTo">>; assumptions: string[]; plan: ExecutionPlan }
  | { status: "needs_info"; partial: Partial<Intent>; missing: MissingField[]; issues: string[]; assumptions: string[] }
  | { status: "rejected"; partial: Partial<Intent>; issues: string[] };
