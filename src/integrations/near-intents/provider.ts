import { NETWORK_ENV, type SpakNetworkEnv } from "../../environment";
import { OneClickClient } from "./client";
import { ONECLICK_QUOTE_PUBLIC_KEY, TIDEPOOL_QUOTE_PUBLIC_KEY } from "./signature";

export interface ProviderConfig {
  environment: SpakNetworkEnv;
  kind: "ONECLICK_MAINNET" | "TIDEPOOL_TESTNET";
  baseUrl: string;
  apiKey?: string;
  jwt?: string;
  /** When set, every quote's signature must verify against this key or the quote is rejected. */
  quotePublicKey: string | null;
}

export class EnvironmentConfigError extends Error { constructor(m: string) { super(m); this.name = "EnvironmentConfigError"; } }

const TIDEPOOL_HOST = /(^|\.)usetidepool\.tech$/i;
const ONECLICK_HOST = /(^|\.)chaindefuser\.com$/i;
const host = (u: string) => { try { const x = new URL(u); if (x.protocol !== "https:") throw 0; return x.hostname; } catch { throw new EnvironmentConfigError(`${u} is not an https URL.`); } };

/**
 * The execution provider for this build's environment, from the server environment. Fails loudly on any mixing:
 * a testnet build never talks to 1Click, a mainnet build never talks to Tidepool, and neither falls back to the other.
 */
export function providerConfig(env: Record<string, string | undefined> = process.env, network: SpakNetworkEnv = NETWORK_ENV): ProviderConfig {
  const exec = env.SPAK_EXECUTION_ENV || "mainnet";
  if (exec !== network) throw new EnvironmentConfigError(`SPAK_EXECUTION_ENV is "${exec}" but this build is "${network}". Both must name the same environment.`);
  if (network === "tidepool-testnet") {
    for (const k of ["ONECLICK_API_URL", "ONECLICK_API_KEY", "ONECLICK_JWT"]) if (env[k]) throw new EnvironmentConfigError(`${k} is set in the testnet environment. Remove it: the testnet build never talks to 1Click.`);
    const url = env.SPAK_TIDEPOOL_API_URL;
    if (!url) throw new EnvironmentConfigError("SPAK_TIDEPOOL_API_URL is required in the testnet environment.");
    const h = host(url);
    if (ONECLICK_HOST.test(h)) throw new EnvironmentConfigError("SPAK_TIDEPOOL_API_URL points at 1Click mainnet.");
    if (!TIDEPOOL_HOST.test(h) && env.SPAK_TIDEPOOL_ALLOW_CUSTOM_HOST !== "1") throw new EnvironmentConfigError(`SPAK_TIDEPOOL_API_URL host ${h} is not usetidepool.tech. Set SPAK_TIDEPOOL_ALLOW_CUSTOM_HOST=1 for a self-hosted sandbox.`);
    const key = env.SPAK_TIDEPOOL_QUOTE_PUBLIC_KEY || TIDEPOOL_QUOTE_PUBLIC_KEY;
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(key)) throw new EnvironmentConfigError("SPAK_TIDEPOOL_QUOTE_PUBLIC_KEY is not an ed25519 public key.");
    return { environment: network, kind: "TIDEPOOL_TESTNET", baseUrl: url.replace(/\/$/, ""), quotePublicKey: key };
  }
  for (const k of Object.keys(env)) if (k.startsWith("SPAK_TIDEPOOL_") && env[k]) throw new EnvironmentConfigError(`${k} is set in the mainnet environment. Tidepool is testnet only.`);
  const url = env.ONECLICK_API_URL || "https://1click.chaindefuser.com";
  if (TIDEPOOL_HOST.test(host(url))) throw new EnvironmentConfigError("ONECLICK_API_URL points at Tidepool. Tidepool is testnet only; use the tidepool-testnet build.");
  return { environment: network, kind: "ONECLICK_MAINNET", baseUrl: url.replace(/\/$/, ""), apiKey: env.ONECLICK_API_KEY, jwt: env.ONECLICK_JWT,
    quotePublicKey: env.SPAK_ONECLICK_VERIFY_SIGNATURES === "1" ? ONECLICK_QUOTE_PUBLIC_KEY : null };
}

export function providerClient(cfg: ProviderConfig, fetchImpl?: typeof fetch): OneClickClient {
  return new OneClickClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, jwt: cfg.jwt, fetchImpl });
}
