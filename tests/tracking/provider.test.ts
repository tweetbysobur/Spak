/** 1Click status handling (MOCKED HTTP responses) and the provider-to-state mapping. */
import { describe, expect, it } from "vitest";
import { OneClickClient, OneClickError } from "@/integrations/near-intents/client";
import { stateFromProvider } from "@/execution/state";

const client = (res: () => Response | Promise<Response>) => new OneClickClient({ fetchImpl: (async () => res()) as unknown as typeof fetch });
const kind = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as OneClickError).kind; } };
const now = new Date("2026-11-10T12:00:00Z");
const obs = (status: string | null, dest: string[] = []) => ({ status, destinationTxHashes: dest, amountOut: null });

describe("provider status responses", () => {
  it("parses partial responses: missing status and missing swap details are kept as no information", async () => {
    const r = await client(() => Response.json({ correlationId: "c" })).status("0xabc");
    expect(r.status ?? null).toBeNull();
    expect(stateFromProvider("PROCESSING", obs(r.status ?? null), null, now).state).toBe("PROCESSING");
  });
  it("maps rate limits, outages, timeouts and unknown deposit addresses to distinct errors", async () => {
    expect(await kind(client(() => Response.json({ message: "slow down" }, { status: 429 })).status("0x1"))).toBe("RATE_LIMITED");
    expect(await kind(client(() => Response.json({ message: "down" }, { status: 503 })).status("0x1"))).toBe("UNAVAILABLE");
    expect(await kind(client(() => Response.json({ message: "nope" }, { status: 404 })).status("0x1"))).toBe("NOT_FOUND");
    expect(await kind(client(() => { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; }).status("0x1"))).toBe("TIMEOUT");
  });
  it("lifecycle: pending, deposit received, processing, success, failed, refunded, unknown", () => {
    expect(stateFromProvider("AWAITING_DEPOSIT", obs("PENDING_DEPOSIT"), new Date(now.getTime() + 1), now).state).toBe("AWAITING_DEPOSIT");
    expect(stateFromProvider("AWAITING_DEPOSIT", obs("KNOWN_DEPOSIT_TX"), null, now).state).toBe("PROCESSING");
    expect(stateFromProvider("PROCESSING", obs("PROCESSING"), null, now).state).toBe("PROCESSING");
    expect(stateFromProvider("PROCESSING", obs("SUCCESS"), null, now).state).toBe("PROCESSING"); // success without a destination tx
    expect(stateFromProvider("PROCESSING", obs("SUCCESS", ["d"]), null, now).state).toBe("VERIFYING_DESTINATION");
    expect(stateFromProvider("PROCESSING", obs("FAILED"), null, now).state).toBe("FAILED");
    expect(stateFromProvider("PROCESSING", obs("REFUNDED"), null, now).state).toBe("REFUNDED");
    expect(stateFromProvider("VERIFYING_DESTINATION", obs("REFUNDED"), null, now).state).toBe("REFUNDED");
    expect(stateFromProvider("PROCESSING", obs("BRAND_NEW_STATUS"), null, now).state).toBe("UNKNOWN");
    expect(stateFromProvider("PROCESSING", obs("NOT_FOUND"), new Date(0), now).state).toBe("PROCESSING"); // never expires once processing
  });
});
