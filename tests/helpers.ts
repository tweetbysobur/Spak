import { SpakIn, sequentialIds, type InterpretRequestInput } from "@/spak-in";

export const EVM = "0x1111111111111111111111111111111111111111";
export const EVM2 = "0x2222222222222222222222222222222222222222";
export const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
export const NEAR = "alice.near";
export const BTC = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
export const WALLETS = { base: EVM, ethereum: EVM, arbitrum: EVM, optimism: EVM, polygon: EVM, bsc: EVM, solana: SOL, near: NEAR };
export const NOW = "2026-11-10T10:00:00.000Z";

export function engine() {
  return new SpakIn({ ids: sequentialIds(), validateOutput: true, clock: () => new Date(NOW) });
}

let n = 0;
export async function run(text: string, extra: Partial<InterpretRequestInput> = {}, e = engine()) {
  return e.interpret({ text, wallets: WALLETS, now: NOW, sessionId: `t${++n}`, ...extra });
}
