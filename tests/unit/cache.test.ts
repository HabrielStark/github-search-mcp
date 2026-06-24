import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryCacheStore } from "../../src/cache/memoryCacheStore.js";
import { cacheKeys, stableHash, createCache } from "../../src/cache/cacheStore.js";
import { createSqliteCacheStore, SqliteCacheStore } from "../../src/cache/sqliteCacheStore.js";
import { loadConfig } from "../../src/config.js";
import { silentLogger } from "../../src/utils/logger.js";

const sqliteNativeUnavailableInCi =
  process.env.GITHUB_ACTIONS === "true" &&
  process.platform === "win32" &&
  process.versions.node.startsWith("20.");
const describeSqlite = sqliteNativeUnavailableInCi ? describe.skip : describe;

describe("MemoryCacheStore", () => {
  it("stores and retrieves values", () => {
    const c = new MemoryCacheStore();
    c.set("k", { a: 1 }, 1000);
    expect(c.get<{ a: number }>("k")).toEqual({ a: 1 });
    expect(c.get("missing")).toBeUndefined();
  });

  it("expires entries after the TTL", () => {
    vi.useFakeTimers();
    try {
      const c = new MemoryCacheStore();
      c.set("k", "v", 1000);
      vi.advanceTimersByTime(1001);
      expect(c.get("k")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts the oldest entry past maxEntries", () => {
    const c = new MemoryCacheStore({ maxEntries: 2 });
    c.set("a", 1, 10_000);
    c.set("b", 2, 10_000);
    c.set("c", 3, 10_000);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });

  it("deletes and clears", () => {
    const c = new MemoryCacheStore();
    c.set("a", 1, 10_000);
    c.delete("a");
    expect(c.get("a")).toBeUndefined();
    c.set("b", 2, 10_000);
    c.clear();
    expect(c.get("b")).toBeUndefined();
  });
});

describe("stableHash", () => {
  it("is deterministic and order-independent", () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
  });
  it("differs for different inputs", () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
});

describe("cacheKeys", () => {
  it("matches the documented cache-key formats", () => {
    expect(cacheKeys.repo("o", "r")).toBe("github:repo:o/r");
    expect(cacheKeys.readme("o", "r", "main")).toBe("github:readme:o/r:main");
    expect(cacheKeys.tree("o", "r", "main")).toBe("github:tree:o/r:main");
    expect(cacheKeys.file("o", "r", "main", "a.ts")).toBe("github:file:o/r:main:a.ts");
    expect(cacheKeys.license("o", "r")).toBe("github:license:o/r");
    expect(cacheKeys.search({ q: "x" })).toMatch(/^github:search:[0-9a-f]+$/);
    expect(cacheKeys.analysis("o", "r", "h")).toBe("analysis:o/r:h");
  });
});

describeSqlite("SqliteCacheStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "oss-sqlite-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists values across reopen and honors TTL/clear", async () => {
    const path = join(dir, "cache.sqlite");
    const store = await createSqliteCacheStore(path);
    expect(store).toBeInstanceOf(SqliteCacheStore);
    expect(store.backend).toBe("sqlite");

    store.set("k", { v: 42 }, 60_000);
    expect(store.get<{ v: number }>("k")).toEqual({ v: 42 });

    // expired entry
    store.set("old", "x", -1);
    expect(store.get("old")).toBeUndefined();

    store.close();

    // reopen and confirm persistence
    const reopened = await createSqliteCacheStore(path);
    expect(reopened.get<{ v: number }>("k")).toEqual({ v: 42 });
    reopened.delete("k");
    expect(reopened.get("k")).toBeUndefined();
    reopened.set("y", 1, 60_000);
    reopened.clear();
    expect(reopened.get("y")).toBeUndefined();
    reopened.close();
  });
});

describe("MemoryCacheStore — byte budget & isolation", () => {
  it("evicts by total byte budget, not just entry count", () => {
    const c = new MemoryCacheStore({ maxEntries: 1000, maxBytes: 60 });
    c.set("a", "x".repeat(40), 10_000); // ~42 bytes serialized
    c.set("b", "y".repeat(40), 10_000); // would exceed 60 → evict "a"
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBeDefined();
  });

  it("does not store a single entry larger than the byte budget", () => {
    const c = new MemoryCacheStore({ maxEntries: 1000, maxBytes: 10 });
    c.set("huge", "x".repeat(40), 10_000);
    expect(c.get("huge")).toBeUndefined();
  });

  it("returns a clone so callers cannot mutate the cached value", () => {
    const c = new MemoryCacheStore();
    c.set("k", { arr: [1] }, 10_000);
    const v = c.get<{ arr: number[] }>("k");
    v?.arr.push(2);
    expect(c.get<{ arr: number[] }>("k")?.arr).toEqual([1]);
  });
});

describeSqlite("SqliteCacheStore — self-defensive", () => {
  let dir2: string;
  beforeEach(() => {
    dir2 = mkdtempSync(join(tmpdir(), "oss-sqlite-def-"));
  });
  afterEach(() => {
    rmSync(dir2, { recursive: true, force: true });
  });

  it("degrades to a miss/no-op (never throws) when the db becomes unusable", async () => {
    const store = await createSqliteCacheStore(join(dir2, "c.sqlite"));
    store.set("k", { v: 1 }, 60_000);
    store.close(); // statements now throw "database is not open"
    expect(() => store.get("k")).not.toThrow();
    expect(store.get("k")).toBeUndefined();
    expect(() => store.set("k", { v: 2 }, 60_000)).not.toThrow();
    expect(() => store.delete("k")).not.toThrow();
    expect(() => store.clear()).not.toThrow();
  });
});

describe("createCache — ttlHours guard (L7)", () => {
  it("returns a disabled (noop) cache when ttlHours <= 0", async () => {
    const base = loadConfig({ env: {}, home: tmpdir() });
    const store = await createCache(
      { ...base, cache: { ...base.cache, enabled: true, ttlHours: 0 } },
      silentLogger,
    );
    expect(store.backend).toBe("disabled");
    store.set("k", 1, 1000);
    expect(store.get("k")).toBeUndefined();
  });
});
