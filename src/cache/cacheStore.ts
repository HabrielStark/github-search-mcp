import { createHash } from "node:crypto";
import type { Config } from "../config.js";
import type { Logger } from "../utils/logger.js";

export type CacheBackend = "sqlite" | "memory" | "disabled";

export interface CacheStore {
  readonly backend: CacheBackend;
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  delete(key: string): void;
  clear(): void;
  close(): void;
}

/** Deterministic short hash for composite cache keys (search params, analysis options). */
export function stableHash(value: unknown): string {
  const json = JSON.stringify(value, (_k, v): unknown => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const record = v as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = record[k];
          return acc;
        }, {});
    }
    return v;
  });
  return createHash("sha1").update(json).digest("hex").slice(0, 16);
}

/** Cache key builders for the GitHub and composed-analysis entries. */
export const cacheKeys = {
  search: (params: unknown): string => `github:search:${stableHash(params)}`,
  repo: (owner: string, repo: string): string => `github:repo:${owner}/${repo}`,
  readme: (owner: string, repo: string, branch: string): string =>
    `github:readme:${owner}/${repo}:${branch}`,
  tree: (owner: string, repo: string, branch: string): string =>
    `github:tree:${owner}/${repo}:${branch}`,
  file: (owner: string, repo: string, branch: string, path: string): string =>
    `github:file:${owner}/${repo}:${branch}:${path}`,
  license: (owner: string, repo: string): string => `github:license:${owner}/${repo}`,
  analysis: (owner: string, repo: string, optionsHash: string): string =>
    `analysis:${owner}/${repo}:${optionsHash}`,
};

/** No-op store used when caching is disabled. */
export class NoopCacheStore implements CacheStore {
  readonly backend: CacheBackend = "disabled";
  get<T>(): T | undefined {
    return undefined;
  }
  set(): void {}
  delete(): void {}
  clear(): void {}
  close(): void {}
}

/**
 * Build the cache backend. Tries SQLite (better-sqlite3) when enabled; if the
 * native module is unavailable or fails to open, falls back to in-memory cache
 * so the server never crashes due to cache problems.
 */
export async function createCache(config: Config, logger: Logger): Promise<CacheStore> {
  // ttlHours <= 0 would make every entry expire instantly (write-only cache),
  // so treat it the same as disabled.
  if (!config.cache.enabled || config.cache.ttlHours <= 0) {
    logger.info("cache disabled");
    return new NoopCacheStore();
  }
  try {
    const { createSqliteCacheStore } = await import("./sqliteCacheStore.js");
    const store = await createSqliteCacheStore(config.cache.path, logger);
    logger.info("cache backend: sqlite", { path: config.cache.path });
    return store;
  } catch (err) {
    const { MemoryCacheStore } = await import("./memoryCacheStore.js");
    logger.warn("cache backend: sqlite unavailable, using memory", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return new MemoryCacheStore();
  }
}
