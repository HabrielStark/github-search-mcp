import type { CacheBackend, CacheStore } from "./cacheStore.js";

interface Entry {
  value: unknown;
  expiresAt: number;
  bytes: number;
}

const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_MAX_BYTES = 64_000_000; // ~64 MB ceiling for the in-memory fallback

/** Best-effort byte size of a value (UTF-16 length of its JSON is a fine proxy). */
function approxBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json.length : 0;
  } catch {
    return 0;
  }
}

/**
 * In-memory cache used when SQLite is unavailable. Bounded by BOTH an entry
 * count and a total-byte budget so a handful of large values (e.g. big trees)
 * cannot grow the heap without bound. Reads return a structured clone so a
 * caller cannot mutate a cached object in place (matches the SQLite backend,
 * which round-trips through JSON).
 */
export class MemoryCacheStore implements CacheStore {
  readonly backend: CacheBackend = "memory";
  private readonly store = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private totalBytes = 0;

  constructor(options: { maxEntries?: number; maxBytes?: number } = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.evict(key);
      return undefined;
    }
    return structuredClone(entry.value) as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.evict(key); // drop any prior entry's bytes first
    const bytes = approxBytes(value);
    if (bytes > this.maxBytes) return;
    // Evict oldest entries until the new one fits within both budgets.
    while (
      this.store.size > 0 &&
      (this.store.size >= this.maxEntries || this.totalBytes + bytes > this.maxBytes)
    ) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.evict(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs), bytes });
    this.totalBytes += bytes;
  }

  delete(key: string): void {
    this.evict(key);
  }

  clear(): void {
    this.store.clear();
    this.totalBytes = 0;
  }

  close(): void {
    this.clear();
  }

  private evict(key: string): void {
    const entry = this.store.get(key);
    if (entry) {
      this.totalBytes -= entry.bytes;
      this.store.delete(key);
    }
  }
}
