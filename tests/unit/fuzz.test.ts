import { describe, it, expect } from "vitest";
import { isBinaryPath, parseRepository, truncate } from "../../src/utils/sanitize.js";
import { buildSearchQuery, generateAlternativeQueries } from "../../src/search/queryBuilder.js";
import { AppError } from "../../src/utils/errors.js";

// Deterministic PRNG so failures are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHARSET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-/ \t!@#$%^&*()+=:?\\<>\"'`~你🚀";

function randomString(rng: () => number, maxLen: number): string {
  const len = Math.floor(rng() * maxLen);
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += CHARSET[Math.floor(rng() * CHARSET.length)];
  }
  return out;
}

const SAFE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SAFE_MID = SAFE + "._-";

function randomSegment(rng: () => number): string {
  const len = 1 + Math.floor(rng() * 20);
  let out = SAFE[Math.floor(rng() * SAFE.length)];
  for (let i = 1; i < len - 1; i += 1) out += SAFE_MID[Math.floor(rng() * SAFE_MID.length)];
  if (len > 1) out += SAFE[Math.floor(rng() * SAFE.length)];
  return out;
}

describe("fuzz: parseRepository", () => {
  it("never throws anything other than INVALID_REPOSITORY_FORMAT on arbitrary input", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 2000; i += 1) {
      const input = randomString(rng, 40);
      try {
        const parsed = parseRepository(input);
        // If it parsed, the result is well-formed.
        expect(parsed.fullName).toBe(`${parsed.owner}/${parsed.repo}`);
        expect(parsed.owner.length).toBeGreaterThan(0);
        expect(parsed.repo.length).toBeGreaterThan(0);
        expect(parsed.repo).not.toBe("..");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("INVALID_REPOSITORY_FORMAT");
      }
    }
  });

  it("round-trips well-formed owner/repo segments", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i += 1) {
      const owner = randomSegment(rng);
      const repo = randomSegment(rng);
      if (repo === "." || repo === "..") continue;
      const parsed = parseRepository(`${owner}/${repo}`);
      expect(parsed.fullName).toBe(`${owner}/${repo}`);
    }
  });
});

describe("fuzz: buildSearchQuery / generateAlternativeQueries", () => {
  it("never throws and always returns a string for buildSearchQuery", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i += 1) {
      const q = buildSearchQuery({
        query: randomString(rng, 30),
        language: rng() > 0.5 ? randomString(rng, 12) : undefined,
        minStars: rng() > 0.5 ? Math.floor(rng() * 1e6) - 10 : undefined,
        license: rng() > 0.5 ? randomString(rng, 10) : undefined,
        topic: rng() > 0.5 ? randomString(rng, 10) : undefined,
      });
      expect(typeof q).toBe("string");
    }
  });

  it("generateAlternativeQueries returns a deduped string array", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 500; i += 1) {
      const queries = generateAlternativeQueries({
        target: randomString(rng, 20),
        useCase: rng() > 0.5 ? randomString(rng, 30) : undefined,
        language: rng() > 0.5 ? randomString(rng, 12) : undefined,
        mustBeSelfHosted: rng() > 0.5,
      });
      expect(Array.isArray(queries)).toBe(true);
      expect(new Set(queries).size).toBe(queries.length);
      expect(queries.length).toBeLessThanOrEqual(6);
      for (const q of queries) expect(typeof q).toBe("string");
    }
  });
});

describe("fuzz: isBinaryPath / truncate", () => {
  it("isBinaryPath always returns a boolean", () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 1000; i += 1) {
      expect(typeof isBinaryPath(randomString(rng, 30))).toBe("boolean");
    }
  });

  it("truncate respects the limit and reports truncation correctly", () => {
    const rng = mulberry32(13);
    for (let i = 0; i < 1000; i += 1) {
      const text = randomString(rng, 200);
      const max = Math.floor(rng() * 250);
      const { content, truncated } = truncate(text, max);
      if (max > 0 && text.length > max) {
        expect(content.length).toBe(max);
        expect(truncated).toBe(true);
      } else {
        expect(content).toBe(text);
        expect(truncated).toBe(false);
      }
    }
  });
});
