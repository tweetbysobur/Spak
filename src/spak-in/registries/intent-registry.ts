import type { IntentType } from "../schemas/intent";
import type { Frame } from "../parser/frame";
import type { Draft } from "../context/draft";
import type { InterpretRequest } from "../schemas/request";
import type { Clarification } from "../schemas/intent";
import type { SpakError } from "../errors/codes";

export type IntentCategory = "TRANSACTION" | "WRAPPER" | "READ" | "MANAGEMENT";

/**
 * An intent definition. Register new intents without touching the parser or classifier.
 * `match` sees the parsed frame and returns a score; the highest score wins, ties go to the lower `priority` number.
 */
export interface IntentDefinition {
  type: IntentType;
  category: IntentCategory;
  description: string;
  priority: number;
  match: (frame: Frame) => number;
  /** True when executing it moves funds and needs approval. */
  movesFunds: boolean;
  /** Required for custom intents. Without it SPak-in returns UNSUPPORTED and never plans. */
  validate?: (draft: Draft, req: InterpretRequest) => { errors: SpakError[]; missing: Clarification[] };
}

export class IntentRegistry {
  private readonly defs = new Map<string, IntentDefinition>();

  register(def: IntentDefinition): this {
    if (this.defs.has(def.type)) throw new Error(`Intent ${def.type} is already registered.`);
    this.defs.set(def.type, def);
    return this;
  }

  get(type: string): IntentDefinition | undefined {
    return this.defs.get(type);
  }

  list(): IntentDefinition[] {
    return [...this.defs.values()].sort((a, b) => a.priority - b.priority);
  }
}
