import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Database as SqliteDatabase, Statement } from "better-sqlite3";
import { AppError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { silentLogger } from "../utils/logger.js";
import type { CacheBackend, CacheStore } from "./cacheStore.js";

interface Row {
  value: string;
  expires_at: number;
}

const SWEEP_INTERVAL_MS = 10 * 60_000; // periodic expired-row reap (disk bound)

/**
 * SQLite-backed cache. Every steady-state operation is self-defensive: a runtime
 * SQLite error (corruption, disk-full, contention, I/O) is swallowed and logged
 * so it degrades to a cache miss / no-op and NEVER crashes a tool call.
 */
export class SqliteCacheStore implements CacheStore {
  readonly backend: CacheBackend = "sqlite";
  private readonly db: SqliteDatabase;
  private readonly logger: Logger;
  private readonly getStmt: Statement;
  private readonly setStmt: Statement;
  private readonly delStmt: Statement;
  private readonly sweepStmt: Statement;
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor(db: SqliteDatabase, logger: Logger = silentLogger) {
    this.db = db;
    this.logger = logger;
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000"); // wait, don't throw, on contention
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)",
    );
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache (expires_at)");
    this.db.prepare("DELETE FROM cache WHERE expires_at <= ?").run(Date.now());
    this.getStmt = this.db.prepare("SELECT value, expires_at FROM cache WHERE key = ?");
    this.setStmt = this.db.prepare(
      "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)",
    );
    this.delStmt = this.db.prepare("DELETE FROM cache WHERE key = ?");
    this.sweepStmt = this.db.prepare("DELETE FROM cache WHERE expires_at <= ?");
    // Periodically reap expired rows so the file can't grow without bound on a
    // long-running server. unref() so it never keeps the process alive.
    this.sweeper = setInterval(() => {
      try {
        this.sweepStmt.run(Date.now());
      } catch (err) {
        this.logger.debug("cache sweep failed", { error: errMsg(err) });
      }
    }, SWEEP_INTERVAL_MS);
    (this.sweeper as { unref?: () => void }).unref?.();
  }

  get<T>(key: string): T | undefined {
    try {
      const row = this.getStmt.get(key) as Row | undefined;
      if (!row) return undefined;
      if (row.expires_at <= Date.now()) {
        this.delStmt.run(key);
        return undefined;
      }
      return JSON.parse(row.value) as T;
    } catch (err) {
      this.logger.debug("cache get failed", { error: errMsg(err) });
      try {
        this.delStmt.run(key);
      } catch {
        // best effort
      }
      return undefined;
    }
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) return;
      this.setStmt.run(key, serialized, Date.now() + Math.max(0, ttlMs));
    } catch (err) {
      this.logger.debug("cache set failed", { error: errMsg(err) });
    }
  }

  delete(key: string): void {
    try {
      this.delStmt.run(key);
    } catch (err) {
      this.logger.debug("cache delete failed", { error: errMsg(err) });
    }
  }

  clear(): void {
    try {
      this.db.exec("DELETE FROM cache");
    } catch (err) {
      this.logger.debug("cache clear failed", { error: errMsg(err) });
    }
  }

  close(): void {
    clearInterval(this.sweeper);
    try {
      this.db.close();
    } catch (err) {
      this.logger.debug("cache close failed", { error: errMsg(err) });
    }
  }
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Create a SQLite cache store. Throws CACHE_ERROR if better-sqlite3 cannot be
 * loaded (e.g. native binary missing) so the caller can fall back to memory.
 */
export async function createSqliteCacheStore(
  path: string,
  logger?: Logger,
): Promise<SqliteCacheStore> {
  let DatabaseCtor: new (filename: string) => SqliteDatabase;
  try {
    const mod: unknown = await import("better-sqlite3");
    const candidate = (mod as { default?: unknown }).default ?? mod;
    DatabaseCtor = candidate as new (filename: string) => SqliteDatabase;
  } catch (err) {
    throw new AppError("CACHE_ERROR", "better-sqlite3 is not available", { cause: err });
  }
  let db: SqliteDatabase | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseCtor(path);
    return new SqliteCacheStore(db, logger);
  } catch (err) {
    // Close the handle if construction (table/pragma/prepare) failed, so we don't
    // leak a native handle or leave a -wal/-shm lock behind on the memory fallback.
    try {
      db?.close();
    } catch {
      // best effort
    }
    throw new AppError("CACHE_ERROR", `Failed to open SQLite cache at ${path}`, { cause: err });
  }
}
