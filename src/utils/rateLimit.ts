import type { RateLimitSummary } from "../types/toolResults.js";

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  used: number | null;
  resetAt: string | null;
}

function readNumber(headers: Headers, key: string): number | null {
  const raw = headers.get(key);
  if (raw === null) return null;
  // Stryker disable next-line MethodExpression: the Fetch Headers API already
  // strips surrounding whitespace from values, so this trim is belt-and-braces
  // and its removal is behaviourally equivalent.
  const trimmed = raw.trim();
  // GitHub sends integer counters. A blank/garbage header must NOT be coerced to
  // 0 (Number("") === 0), which would read as a real "0 remaining". The regex
  // also rejects "" so no separate empty check is needed.
  if (!/^-?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Parse the x-ratelimit-* headers from a GitHub response. */
export function parseRateLimit(headers: Headers): RateLimitInfo {
  let resetAt: string | null = null;
  const resetRaw = headers.get("x-ratelimit-reset");
  if (resetRaw !== null) {
    // Stryker disable next-line MethodExpression: Headers already strips surrounding
    // whitespace; this trim is redundant and its removal is equivalent.
    const trimmed = resetRaw.trim();
    const epoch = Number(trimmed);
    // Reject garbage and implausible epochs. Upper bound is the max valid JS
    // Date in seconds (8.64e15 ms); beyond it new Date(...).toISOString() throws.
    if (/^\d+$/.test(trimmed) && epoch > 0 && epoch <= 8_640_000_000_000) {
      resetAt = new Date(epoch * 1000).toISOString();
    }
  }
  return {
    limit: readNumber(headers, "x-ratelimit-limit"),
    remaining: readNumber(headers, "x-ratelimit-remaining"),
    used: readNumber(headers, "x-ratelimit-used"),
    resetAt,
  };
}

/** True when remaining requests are at/below the warning threshold. */
export function isRateLimitLow(info: RateLimitInfo | null, threshold = 5): boolean {
  return info !== null && info.remaining !== null && info.remaining <= threshold;
}

/** Narrow a RateLimitInfo to the {remaining, resetAt} summary used in tool output. */
export function toRateLimitSummary(info: RateLimitInfo | null): RateLimitSummary {
  return { remaining: info?.remaining ?? null, resetAt: info?.resetAt ?? null };
}
