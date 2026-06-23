import { describe, it, expect } from "vitest";
import { buildSearchQuery, generateAlternativeQueries } from "../../src/search/queryBuilder.js";
import { tokenize } from "../../src/scoring/scoreWeights.js";

describe("buildSearchQuery", () => {
  it("combines query with qualifiers", () => {
    const q = buildSearchQuery({
      query: "payment processing",
      language: "TypeScript",
      minStars: 100,
      license: "MIT",
      topic: "self-hosted",
    });
    expect(q).toContain("payment processing");
    expect(q).toContain("language:TypeScript");
    expect(q).toContain("stars:>=100");
    expect(q).toContain("license:mit");
    expect(q).toContain("topic:self-hosted");
  });

  it("quotes multi-word languages", () => {
    expect(buildSearchQuery({ query: "x", language: "Jupyter Notebook" })).toContain(
      'language:"Jupyter Notebook"',
    );
  });

  it("omits absent filters", () => {
    expect(buildSearchQuery({ query: "redis" })).toBe("redis");
  });

  it("returns the bare query and trims surrounding whitespace", () => {
    expect(buildSearchQuery({ query: "   redis   " })).toBe("redis");
  });

  it("appends each qualifier in order with the correct casing and quoting", () => {
    expect(buildSearchQuery({ query: "db", language: "Go" })).toBe("db language:Go");
    expect(buildSearchQuery({ query: "db", language: "Jupyter Notebook" })).toBe(
      'db language:"Jupyter Notebook"',
    );
    expect(buildSearchQuery({ query: "db", minStars: 100 })).toBe("db stars:>=100");
    expect(buildSearchQuery({ query: "db", license: "MIT" })).toBe("db license:mit");
    expect(buildSearchQuery({ query: "db", topic: "Self-Hosted" })).toBe("db topic:self-hosted");
    expect(
      buildSearchQuery({
        query: "db",
        language: "Rust",
        minStars: 500,
        license: "Apache-2.0",
        topic: "CLI",
      }),
    ).toBe("db language:Rust stars:>=500 license:apache-2.0 topic:cli");
    expect(
      buildSearchQuery({
        query: "payment processing",
        language: "TypeScript",
        minStars: 100,
        license: "MIT",
        topic: "Self-Hosted",
      }),
    ).toBe("payment processing language:TypeScript stars:>=100 license:mit topic:self-hosted");
  });

  it("omits minStars when <= 0 and floors fractional values", () => {
    expect(buildSearchQuery({ query: "db", minStars: 0 })).toBe("db");
    expect(buildSearchQuery({ query: "db", minStars: -5 })).toBe("db");
    expect(buildSearchQuery({ query: "db", minStars: 99.9 })).toBe("db stars:>=99");
  });

  it("trims whitespace inside qualifier values and drops whitespace-only ones", () => {
    expect(buildSearchQuery({ query: "x", language: "  Go  " })).toBe("x language:Go");
    expect(buildSearchQuery({ query: "x", license: "  MIT  " })).toBe("x license:mit");
    expect(buildSearchQuery({ query: "x", topic: "  Self-Hosted  " })).toBe("x topic:self-hosted");
    expect(buildSearchQuery({ query: "x", language: "   " })).toBe("x");
    expect(buildSearchQuery({ query: "x", license: "   " })).toBe("x");
    expect(buildSearchQuery({ query: "x", topic: "   " })).toBe("x");
  });

  it("drops a whitespace-only base query and trims even when qualifiers follow", () => {
    expect(buildSearchQuery({ query: "   " })).toBe("");
    expect(buildSearchQuery({ query: "  redis  ", language: "Go" })).toBe("redis language:Go");
    expect(buildSearchQuery({ query: "", language: "Go" })).toBe("language:Go");
    expect(buildSearchQuery({ query: "   ", topic: "cli" })).toBe("topic:cli");
  });
});

describe("generateAlternativeQueries", () => {
  it("creates several deduped queries with the self-hosted topic", () => {
    const queries = generateAlternativeQueries({
      target: "Stripe",
      useCase: "payment processing for a small SaaS",
      language: "TypeScript",
      mustBeSelfHosted: true,
    });
    expect(queries.length).toBeGreaterThan(2);
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries.some((q) => q.includes("Stripe"))).toBe(true);
    expect(queries.every((q) => q.includes("language:TypeScript"))).toBe(true);
    expect(queries.some((q) => q.includes("topic:self-hosted"))).toBe(true);
  });

  it("works with only a target", () => {
    const queries = generateAlternativeQueries({ target: "Algolia" });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((q) => q.toLowerCase().includes("algolia"))).toBe(true);
  });

  it("produces the exact base phrases (deduped) and trims the target", () => {
    expect(generateAlternativeQueries({ target: "Stripe" })).toEqual([
      "Stripe alternative",
      "Stripe open source alternative",
      "open source Stripe",
    ]);
    expect(generateAlternativeQueries({ target: "  Stripe  " })).toEqual([
      "Stripe alternative",
      "Stripe open source alternative",
      "open source Stripe",
    ]);
  });

  it("adds the self-hosted phrase and topic qualifier on every query", () => {
    expect(generateAlternativeQueries({ target: "Stripe", mustBeSelfHosted: true })).toEqual([
      "Stripe alternative topic:self-hosted",
      "Stripe open source alternative topic:self-hosted",
      "open source Stripe topic:self-hosted",
      "self hosted Stripe topic:self-hosted",
    ]);
  });

  it("derives a use-case phrase and appends a (trimmed) language qualifier", () => {
    const q = generateAlternativeQueries({
      target: "Algolia",
      useCase: "full text search",
      language: "Go",
    });
    expect(q.every((s) => s.endsWith(" language:Go"))).toBe(true);
    expect(q).toContain("Algolia alternative language:Go");
    expect(q).toContain("full text search open source language:Go");
    expect(q.length).toBeLessThanOrEqual(6);
    expect(generateAlternativeQueries({ target: "", useCase: "  full text search  " })).toContain(
      "full text search open source",
    );
  });

  it("emits the self-hosted target phrase with a trimmed language qualifier", () => {
    expect(
      generateAlternativeQueries({
        target: "Stripe",
        mustBeSelfHosted: true,
        language: "  TypeScript  ",
      }),
    ).toContain("self hosted Stripe language:TypeScript topic:self-hosted");
  });

  it("returns no phrases when the target is empty and no use case is given", () => {
    expect(generateAlternativeQueries({ target: "" })).toEqual([]);
    expect(generateAlternativeQueries({ target: "   " })).toEqual([]);
  });

  it("emits a self-hosted use-case phrase only when self-hosting is requested", () => {
    const on = generateAlternativeQueries({
      target: "x",
      useCase: "payment system",
      mustBeSelfHosted: true,
    });
    expect(on).toContain("self hosted payment system topic:self-hosted");
    const off = generateAlternativeQueries({ target: "x", useCase: "payment system" });
    expect(off.some((q) => q.startsWith("self hosted payment system"))).toBe(false);
  });

  it("omits a whitespace-only language qualifier", () => {
    expect(generateAlternativeQueries({ target: "x", language: "   " })).toContain("x alternative");
    expect(generateAlternativeQueries({ target: "x", language: "Go" })).toContain(
      "x alternative language:Go",
    );
  });

  it("uses only the first five use-case keywords", () => {
    const q = generateAlternativeQueries({
      target: "",
      useCase: "alpha bravo charlie delta echo foxtrot",
    });
    expect(q).toContain("alpha bravo charlie delta echo open source");
    expect(q.some((s) => s.includes("foxtrot"))).toBe(false);
  });

  it("dedupes and caps the result at six queries", () => {
    const q = generateAlternativeQueries({
      target: "Stripe",
      useCase: "payments billing invoicing subscriptions",
      mustBeSelfHosted: true,
    });
    expect(new Set(q).size).toBe(q.length);
    expect(q.length).toBeLessThanOrEqual(6);
  });
});

describe("tokenize", () => {
  it("returns meaningful lowercase keywords and drops stop-words/short tokens", () => {
    expect(tokenize("The Open Source Payment Gateway")).toEqual(["payment", "gateway"]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize("")).toEqual([]);
    expect(tokenize("Open-Source Payment Processing for SaaS")).toEqual([
      "payment",
      "processing",
      "saas",
    ]);
    expect(tokenize("a to of")).toEqual([]);
  });

  it("lowercases tokens and keeps interior dots while stripping leading/trailing . # +", () => {
    expect(tokenize("VECTOR")).toEqual(["vector"]);
    expect(tokenize(".vector.")).toEqual(["vector"]);
    expect(tokenize("node.js framework")).toContain("node.js");
  });

  it("keeps tokens of length >= 3, drops shorter ones, and splits on non-token chars", () => {
    expect(tokenize("abc")).toEqual(["abc"]);
    expect(tokenize("ab")).toEqual([]);
    expect(tokenize("redis-server cache")).toEqual(["redis", "server", "cache"]);
  });

  it("filters every configured stop-word to empty", () => {
    const stopwords =
      "the and for with that this from your you are was use using used via into out open source library framework tool tools api sdk app application alternative alternatives free self hosted based small simple";
    expect(tokenize(stopwords)).toEqual([]);
  });

  it("caps the number of tokens it emits (resource-exhaustion defense)", () => {
    // 50k distinct long words → without a cap this would be a 50k-element array.
    const huge = Array.from({ length: 50_000 }, (_, i) => `keyword${i}aaaa`).join(" ");
    const tokens = tokenize(huge);
    expect(tokens.length).toBeLessThanOrEqual(300);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("does not scan beyond the input window for megabyte inputs", () => {
    // 5 MB string must return quickly and bounded, never hang or allocate per-char.
    const big = "alpha ".repeat(900_000); // ~5.4 MB
    const start = Date.now();
    const tokens = tokenize(big);
    expect(tokens.length).toBeLessThanOrEqual(300);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
