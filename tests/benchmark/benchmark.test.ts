import { describe, expect, it } from "vitest";
import { runBenchmark } from "./run-benchmark";
import { DATASET } from "./dataset";
import { HOLDOUT } from "./holdout";

describe("benchmark", () => {
  it("has at least 200 representative instructions", () => {
    expect(DATASET.length).toBeGreaterThanOrEqual(200);
  });
  it("main set holds its accuracy (regression guard)", async () => {
    const s = await runBenchmark(DATASET);
    expect(s.unsafeValidations).toBe(0);
    expect(s.classificationAccuracy).toBeGreaterThanOrEqual(99);
    expect(s.entityExtractionAccuracy).toBeGreaterThanOrEqual(99);
    expect(s.validationAccuracy).toBeGreaterThanOrEqual(99);
    expect(s.ambiguityDetection).toBe(100);
    expect(s.latencyMs.p95).toBeLessThan(100);
  });
  it("held-out set never validates something it should not", async () => {
    const s = await runBenchmark(HOLDOUT);
    expect(s.unsafeValidations).toBe(0);
  });
});
