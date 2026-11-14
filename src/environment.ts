/**
 * SPak network environment. One build and one server process run exactly one environment:
 *
 * - "mainnet" (default): the mainnet registry, NEAR Intents 1Click, mainnet RPCs.
 * - "tidepool-testnet": the testnet registry, the Tidepool sandbox (a community-run, 1Click-shaped API on NEAR
 *   testnet), testnet RPCs. Test tokens only. Tidepool is not affiliated with NEAR or 1Click and its results say
 *   nothing about 1Click production settlement.
 *
 * The value is inlined at build time (NEXT_PUBLIC_), so the browser and the server always agree. There is no switch
 * at run time and no fallback: an unknown value throws. The server additionally requires SPAK_EXECUTION_ENV to say
 * the same thing (see src/server/environment.ts), so one variable alone never moves a deployment to the other side.
 */
export type SpakNetworkEnv = "mainnet" | "tidepool-testnet";

export function parseNetworkEnv(v: string | undefined): SpakNetworkEnv {
  if (v === undefined || v === "" || v === "mainnet") return "mainnet";
  if (v === "tidepool-testnet") return "tidepool-testnet";
  throw new Error(`Unknown SPak network environment "${v}". Use "mainnet" or "tidepool-testnet".`);
}

/** Written out literally so Next.js inlines it into client bundles. */
export const NETWORK_ENV: SpakNetworkEnv = parseNetworkEnv(process.env.NEXT_PUBLIC_SPAK_NETWORK_ENV);
export const IS_TESTNET = NETWORK_ENV === "tidepool-testnet";

/** Who quotes and settles, named honestly per environment. The testnet sandbox is not NEAR Intents' production 1Click. */
export const PROVIDER_LABEL = IS_TESTNET ? "Tidepool (testnet sandbox)" : "NEAR Intents";
