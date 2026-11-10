import { describe, expect, it } from "vitest";
import { mapStatus } from "./status";

describe("mapStatus", () => {
  it("only reports completed on SUCCESS", () => {
    expect(mapStatus("SUCCESS")).toBe("completed");
    expect(mapStatus("KNOWN_DEPOSIT_TX")).toBe("processing");
    expect(mapStatus("PROCESSING")).toBe("processing");
  });
  it("expires stale pending deposits", () => {
    expect(mapStatus("PENDING_DEPOSIT", "2020-01-01T00:00:00Z")).toBe("expired");
    expect(mapStatus("PENDING_DEPOSIT", "2999-01-01T00:00:00Z")).toBe("awaiting_deposit");
  });
  it("treats anything else as unknown", () => {
    expect(mapStatus(undefined)).toBe("unknown");
    expect(mapStatus("WEIRD")).toBe("unknown");
  });
});
