import { describe, expect, it } from "vitest";
import { fromBaseUnits, toBaseUnits } from "./units";

describe("units", () => {
  it("converts both ways", () => {
    expect(toBaseUnits("50", 6)).toBe("50000000");
    expect(toBaseUnits("0.1", 18)).toBe("100000000000000000");
    expect(fromBaseUnits("586119990", 9)).toBe("0.58611999");
    expect(fromBaseUnits("50000000", 6)).toBe("50");
  });
  it("rejects excess precision", () => {
    expect(() => toBaseUnits("1.1234567", 6)).toThrow();
  });
});
