import type { SpakError } from "../errors/codes";
import type { Allocation, AmountSpec, Condition, Constraints, Schedule, Target } from "../schemas/intent";
import type { Token } from "../tokenizer/tokenize";

export type VerbClass =
  | "SWAP" | "BRIDGE" | "SEND" | "TRANSFER" | "PAY" | "QUERY" | "STATUS" | "HISTORY" | "CANCEL"
  | "REBALANCE" | "SCHEDULE" | "NOTIFY" | "AMEND";

export type Keyword = "portfolio" | "balance" | "history" | "status" | "pending" | "scheduled" | "amend" | "self" | "destination_word" | "source_word";

export interface RecipientSlot {
  kind: "EXTERNAL" | "SELF" | "PLACEHOLDER";
  address: string | null;
}

/** The parser's structured reading of one instruction. Provider-neutral, not yet validated. */
export interface Frame {
  tokens: Token[];
  verbs: { word: string; cls: VerbClass; index: number }[];
  primary: VerbClass | null;
  amount: AmountSpec | null;
  sourceSymbol: string | null;
  sourceNetwork: string | null;
  destSymbol: string | null;
  destNetwork: string | null;
  /** Networks with no grammatical role, e.g. bare "arbitrum" in a follow-up. */
  looseNetworks: string[];
  /** Assets with no grammatical role. */
  looseSymbols: string[];
  recipient: RecipientSlot | null;
  refundAddress: string | null;
  schedule: Schedule | null;
  scheduleMissing: string[];
  condition: Condition | null;
  constraints: Constraints;
  target: Target | null;
  query: { assets: string[]; networks: string[] } | null;
  allocations: Allocation[] | null;
  keywords: Set<Keyword>;
  /** Problems found while parsing: ambiguity, unsupported names, malformed addresses. */
  issues: SpakError[];
  assumptions: string[];
  /** Unknown tickers the user wrote where an asset belongs. */
  unknownSymbols: string[];
}
