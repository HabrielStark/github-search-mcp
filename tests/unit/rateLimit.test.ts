import { describe, it, expect } from "vitest";
import { isRateLimitLow, parseRateLimit, toRateLimitSummary } from "../../src/utils/rateLimit.js";

const NOW = Date.UTC(2026, 0, 1);

describe("parseRateLimit", () => {
  it("parses headers and converts reset to ISO", () => {
    const reset = Math.floor(Date.now() / 1000) + 60;
    const headers = new Headers({
      "x-ratelimit-limit": "60",
      "x-ratelimit-remaining": "42",
      "x-ratelimit-used": "18",
      "x-ratelimit-reset": String(reset),
    });
    const info = parseRateLimit(headers);
    expect(info.limit).toBe(60);
    expect(info.remaining).toBe(42);
    expect(info.used).toBe(18);
    expect(info.resetAt).toBe(new Date(reset * 1000).toISOString());
  });

  it("returns nulls for missing headers", () => {
    const info = parseRateLimit(new Headers());
    expect(info).toEqual({ limit: null, remaining: null, used: null, resetAt: null });
  });

  it("treats empty/garbage counters as null rather than coercing to 0", () => {
    // Number("") === 0 would otherwise be read as a real "0 remaining" and
    // wrongly trigger rate-limit handling.
    const headers = new Headers({
      "x-ratelimit-limit": "",
      "x-ratelimit-remaining": "  ",
      "x-ratelimit-used": "abc",
      "x-ratelimit-reset": "",
    });
    const info = parseRateLimit(headers);
    expect(info).toEqual({ limit: null, remaining: null, used: null, resetAt: null });
  });

  it("trims surrounding whitespace on counters and reset", () => {
    expect(parseRateLimit(new Headers({ "x-ratelimit-remaining": " 42 " })).remaining).toBe(42);
    const epoch = Math.floor(NOW / 1000) + 60;
    expect(parseRateLimit(new Headers({ "x-ratelimit-reset": ` ${epoch} ` })).resetAt).toBe(
      new Date(epoch * 1000).toISOString(),
    );
  });

  it("rejects non-integer counters but accepts a signed integer", () => {
    expect(parseRateLimit(new Headers({ "x-ratelimit-remaining": "4.5" })).remaining).toBeNull();
    expect(parseRateLimit(new Headers({ "x-ratelimit-remaining": "-5" })).remaining).toBe(-5);
  });

  it("rejects non-integer and non-positive reset epochs", () => {
    expect(parseRateLimit(new Headers({ "x-ratelimit-reset": "0" })).resetAt).toBeNull();
    expect(parseRateLimit(new Headers({ "x-ratelimit-reset": "12.5" })).resetAt).toBeNull();
    expect(parseRateLimit(new Headers({ "x-ratelimit-reset": "-5" })).resetAt).toBeNull();
    expect(parseRateLimit(new Headers({ "x-ratelimit-remaining": "-4" })).remaining).toBe(-4);
  });

  it("rejects an out-of-range reset epoch without throwing RangeError", () => {
    const huge = new Headers({ "x-ratelimit-reset": "99999999999999999999" });
    expect(() => parseRateLimit(huge)).not.toThrow();
    expect(parseRateLimit(huge).resetAt).toBeNull();
  });

  it("accepts the max valid epoch and rejects exactly one past it", () => {
    const max = 8_640_000_000_000; // max JS Date in seconds
    expect(parseRateLimit(new Headers({ "x-ratelimit-reset": String(max) })).resetAt).toBe(
      new Date(max * 1000).toISOString(),
    );
    expect(
      parseRateLimit(new Headers({ "x-ratelimit-reset": String(max + 1) })).resetAt,
    ).toBeNull();
  });
});

describe("isRateLimitLow", () => {
  it("is true at/below threshold", () => {
    expect(isRateLimitLow({ limit: 60, remaining: 3, used: 57, resetAt: null })).toBe(true);
  });
  it("is false above threshold and for null", () => {
    expect(isRateLimitLow({ limit: 60, remaining: 30, used: 30, resetAt: null })).toBe(false);
    expect(isRateLimitLow(null)).toBe(false);
  });
  it("is inclusive of the threshold and guards a null remaining", () => {
    expect(isRateLimitLow({ limit: 60, remaining: 5, used: 55, resetAt: null }, 5)).toBe(true);
    expect(isRateLimitLow({ limit: 60, remaining: 6, used: 54, resetAt: null }, 5)).toBe(false);
    expect(isRateLimitLow({ limit: 60, remaining: null, used: null, resetAt: null })).toBe(false);
  });
});

describe("toRateLimitSummary", () => {
  it("narrows to remaining + resetAt", () => {
    expect(toRateLimitSummary({ limit: 60, remaining: 9, used: 51, resetAt: "x" })).toEqual({
      remaining: 9,
      resetAt: "x",
    });
    expect(toRateLimitSummary(null)).toEqual({ remaining: null, resetAt: null });
  });
});
