import { err, type SpakError } from "../errors/codes";
import { MAX_INPUT_LENGTH } from "../schemas/request";
import { tokenize, type Token } from "../tokenizer/tokenize";

export interface ProcessedInput {
  original: string;
  normalized: string;
  tokens: Token[];
}

export type ProcessResult = { ok: true; value: ProcessedInput } | { ok: false; error: SpakError };

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Normalize text without losing numeric information. Pure function. */
export function normalize(text: string): string {
  return text
    .replace(/…/g, "...")
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/ | | /g, " ")
    .replace(/\s*(?:->|=>|→|⇒|⟶)\s*/g, " to ")
    .replace(/(\d)\s*,\s*(\d{3})(?!\d)/g, "$1$2") // 1,000 -> 1000 (repeat below for 1,000,000)
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
    .replace(/(^|\s)\.(\d)/g, "$10.$2") // .5 -> 0.5
    .replace(/\s+&\s+/g, " and ")
    .replace(/([^\s\d]),(\s|$)/g, "$1 ,$2") // detach clause commas, keep "1,000" handled above
    .replace(/(\d),(\s)/g, "$1 ,$2")
    .replace(/[!?]+(\s|$)/g, "$1")
    .replace(/([^\s.])[.;:](\s|$)/g, (_m, a: string, b: string) => `${a}${b}`) // sentence punctuation; decimals have digits after the dot; "..." stays
    .replace(/["()[\]{}<>]/g, " ")
    .replace(/(^|\s)'|'(\s|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Input Processor: receive, check, normalize and tokenize one instruction. */
export function processInput(text: unknown): ProcessResult {
  if (typeof text !== "string") return { ok: false, error: err("INPUT_MALFORMED", "Instruction must be text.") };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: err("INPUT_EMPTY", "Tell SPak what you want to do.") };
  if (trimmed.length > MAX_INPUT_LENGTH) {
    return { ok: false, error: err("INPUT_TOO_LONG", `Keep instructions under ${MAX_INPUT_LENGTH} characters. Split long requests into steps.`) };
  }
  if (CONTROL.test(trimmed)) return { ok: false, error: err("INPUT_MALFORMED", "The instruction contains control characters.") };
  if (!/\p{L}/u.test(trimmed)) return { ok: false, error: err("INPUT_MALFORMED", "The instruction has no words. Try: Swap 50 USDC on Base to SOL on Solana.") };
  const normalized = normalize(trimmed);
  const tokens = tokenize(normalized);
  if (tokens.length > 80) return { ok: false, error: err("INPUT_TOO_LONG", "The instruction has too many parts. Split it into steps.") };
  return { ok: true, value: { original: text, normalized, tokens } };
}
