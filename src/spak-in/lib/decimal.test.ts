import { describe, expect, it } from "vitest";
import { addDecimal, compareDecimal, fromBaseUnits, mulDecimal, normalizeDecimal, toBaseUnits } from "./decimal";

describe("decimal", () => {
  it("does exact math with no float drift", () => {
    expect(addDecimal("0.1", "0.2")).toBe("0.3");
    expect(mulDecimal("50", "0.999556")).toBe("49.9778");
    expect(mulDecimal("1.5", "2")).toBe("3");
  });
  it("compares", () => {
    expect(compareDecimal("10", "9.99")).toBe(1);
    expect(compareDecimal("0.50", "0.5")).toBe(0);
    expect(compareDecimal("1", "1.0001")).toBe(-1);
  });
  it("normalizes", () => {
    expect(normalizeDecimal("007.500")).toBe("7.5");
    expect(normalizeDecimal("0")).toBe("0");
  });
  it("converts base units", () => {
    expect(toBaseUnits("50", 6)).toBe("50000000");
    expect(toBaseUnits("0.5", 18)).toBe("500000000000000000");
    expect(fromBaseUnits("586119990", 9)).toBe("0.58611999");
    expect(() => toBaseUnits("1.0000001", 6)).toThrow();
  });
  it("rejects non-decimals", () => {
    expect(() => normalizeDecimal("1e5")).toThrow();
    expect(() => normalizeDecimal("-1")).toThrow();
  });
});
