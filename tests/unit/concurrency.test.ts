import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "../../src/utils/concurrency.js";

describe("mapWithConcurrency", () => {
  it("bounds concurrency, preserves order, and returns settled results", async () => {
    let active = 0;
    let maxActive = 0;
    const res = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      if (n === 4) throw new Error("boom");
      return n * 2;
    });
    expect(maxActive).toBeGreaterThan(1); // real concurrency (kills "always 1 worker")
    expect(maxActive).toBeLessThanOrEqual(3); // never exceeds the limit (kills min→max)
    expect(res.length).toBe(8);
    expect(res[0]).toEqual({ status: "fulfilled", value: 2 });
    expect(res[3].status).toBe("rejected");
    expect(res[7]).toEqual({ status: "fulfilled", value: 16 });
  });

  it("falls back to a single worker for a non-positive limit (still processes all)", async () => {
    const res = await mapWithConcurrency([1, 2, 3], 0, async (n) => n * 10);
    expect(res).toEqual([
      { status: "fulfilled", value: 10 },
      { status: "fulfilled", value: 20 },
      { status: "fulfilled", value: 30 },
    ]);
  });

  it("returns [] for empty input and never exceeds item count workers", async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
    const r = await mapWithConcurrency([1], 10, async (n) => n + 1);
    expect(r).toEqual([{ status: "fulfilled", value: 2 }]);
  });
});
