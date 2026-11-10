/**
 * SPak-in public interface.
 *
 *   const engine = new SpakIn();
 *   const r = await engine.interpret({ text: "Swap 50 USDC on Base to SOL on Solana", wallets });
 *   if (r.status === "VALIDATED") coordinator.quote(r.plan)
 */
export { SpakIn, ENGINE_VERSION, statusFor, manualIntentSchema, type ManualIntent, type SpakInOptions } from "./engine";
export * from "./schemas";
export * from "./errors";
export { createDefaultRegistry, BUILTIN_INTENTS } from "./classifier/builtins";
export { IntentRegistry, type IntentDefinition, type IntentCategory } from "./registries/intent-registry";
export { listNetworks, getNetwork, type NetworkDefinition } from "./registries/networks";
export { listAssets, getAsset, findAssets, networksForSymbol, ASSET_REGISTRY_META, type AssetDefinition } from "./registries/assets";
export { MemorySessionStore, type SessionStore, type SessionState, type Draft } from "./context/draft";
export { CONTEXT_TTL_MS } from "./context/context-resolver";
export { evaluatePolicy, valueUsd } from "./policy/policy-engine";
export { buildPlan, planHash } from "./planner/execution-planner";
export { sequentialIds, randomIds, hashObject, type IdFactory } from "./lib/hash";
export * as decimal from "./lib/decimal";
export type { Frame } from "./parser/frame";
export * from "./coordinator";
