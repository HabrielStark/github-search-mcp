import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import type { LogLevel } from "./utils/logger.js";

export type TransportMode = "stdio" | "http";

export interface Config {
  githubToken: string | undefined;
  transport: TransportMode;
  port: number;
  cache: {
    enabled: boolean;
    path: string;
    ttlHours: number;
  };
  deepwiki: {
    enabled: boolean;
  };
  limits: {
    maxSearchResults: number;
    maxFilesToInspect: number;
    maxReadmeChars: number;
    maxFileChars: number;
    requestTimeoutMs: number;
  };
  logLevel: LogLevel;
}

export interface CliOverrides {
  transport?: TransportMode;
  port?: number;
  cache?: boolean;
  deepwiki?: boolean;
  logLevel?: LogLevel;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  overrides?: CliOverrides;
  /** Explicit config file path (mainly for tests). Defaults to ~/.github-search-mcp/config.json. */
  configPath?: string;
  /** Override home dir resolution (mainly for tests). */
  home?: string;
}

const LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "info", "warn", "error"]);

function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(home, p.slice(2));
  return p;
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return undefined;
}

function parseIntInRange(
  value: string | number | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function parseLogLevel(value: string | undefined): LogLevel | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  return LOG_LEVELS.has(v) ? (v as LogLevel) : undefined;
}

function parseTransport(value: string | undefined): TransportMode | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  return v === "stdio" || v === "http" ? v : undefined;
}

interface FileConfig {
  githubTokenEnv?: string;
  cache?: { enabled?: boolean; ttlHours?: number; path?: string };
  deepwiki?: { enabled?: boolean };
  limits?: {
    maxSearchResults?: number;
    maxFilesToInspect?: number;
    maxReadmeChars?: number;
    maxFileChars?: number;
    requestTimeoutMs?: number;
  };
  logLevel?: string;
  transport?: string;
  port?: number;
}

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asBool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const asObject = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Coerce an arbitrary parsed JSON object into a type-safe FileConfig: every
 * field is either the correct type or absent. This prevents a malformed config
 * file (e.g. {"transport": 8080}) from throwing downstream (.trim() on a number):
 * a malformed config must be non-fatal.
 */
function sanitizeFileConfig(o: Record<string, unknown>): FileConfig {
  const cache = asObject(o.cache);
  const deepwiki = asObject(o.deepwiki);
  const limits = asObject(o.limits);
  return {
    githubTokenEnv: asString(o.githubTokenEnv),
    transport: asString(o.transport),
    logLevel: asString(o.logLevel),
    port: asNumber(o.port),
    cache: {
      enabled: asBool(cache.enabled),
      ttlHours: asNumber(cache.ttlHours),
      path: asString(cache.path),
    },
    deepwiki: { enabled: asBool(deepwiki.enabled) },
    limits: {
      maxSearchResults: asNumber(limits.maxSearchResults),
      maxFilesToInspect: asNumber(limits.maxFilesToInspect),
      maxReadmeChars: asNumber(limits.maxReadmeChars),
      maxFileChars: asNumber(limits.maxFileChars),
      requestTimeoutMs: asNumber(limits.requestTimeoutMs),
    },
  };
}

function readFileConfig(path: string): FileConfig {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return sanitizeFileConfig(parsed as Record<string, unknown>);
    }
  } catch {
    // A missing or malformed config file is non-fatal — the file is optional.
  }
  return {};
}

/**
 * Resolve effective configuration.
 * Precedence (low → high): defaults → config.json → environment → CLI overrides.
 * The GitHub token is read ONLY from the environment variable named by
 * `githubTokenEnv` (default GITHUB_TOKEN) — never from the config file.
 */
export function loadConfig(options: LoadConfigOptions = {}): Config {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const overrides = options.overrides ?? {};

  const configPath = options.configPath ?? join(home, ".github-search-mcp", "config.json");
  const file = readFileConfig(configPath);

  const tokenEnvName =
    typeof file.githubTokenEnv === "string" && file.githubTokenEnv.length > 0
      ? file.githubTokenEnv
      : "GITHUB_TOKEN";
  const rawToken = env[tokenEnvName];
  const githubToken = rawToken && rawToken.trim().length > 0 ? rawToken.trim() : undefined;

  const transport =
    overrides.transport ??
    parseTransport(env.OSS_MCP_TRANSPORT) ??
    parseTransport(file.transport) ??
    "stdio";

  const port =
    parseIntInRange(overrides.port, 1, 65535) ??
    parseIntInRange(env.OSS_MCP_PORT, 1, 65535) ??
    parseIntInRange(file.port, 1, 65535) ??
    7345;

  const cacheEnabled =
    overrides.cache ?? parseBool(env.OSS_MCP_CACHE_ENABLED) ?? file.cache?.enabled ?? true;

  const cachePathRaw =
    env.OSS_MCP_CACHE_PATH ?? file.cache?.path ?? join("~", ".github-search-mcp", "cache.sqlite");
  const cachePathExpanded = expandHome(cachePathRaw, home);
  const cachePath = isAbsolute(cachePathExpanded)
    ? cachePathExpanded
    : join(home, cachePathExpanded);

  const ttlHours =
    parseIntInRange(env.OSS_MCP_CACHE_TTL_HOURS, 0, 24 * 365) ??
    parseIntInRange(file.cache?.ttlHours, 0, 24 * 365) ??
    24;

  const deepwikiEnabled =
    overrides.deepwiki ??
    parseBool(env.OSS_MCP_DEEPWIKI_ENABLED) ??
    file.deepwiki?.enabled ??
    false;

  const maxSearchResults =
    parseIntInRange(env.OSS_MCP_MAX_RESULTS, 1, 100) ??
    parseIntInRange(file.limits?.maxSearchResults, 1, 100) ??
    20;

  const maxFilesToInspect = parseIntInRange(file.limits?.maxFilesToInspect, 1, 100000) ?? 30;

  const maxReadmeChars = parseIntInRange(file.limits?.maxReadmeChars, 100, 5_000_000) ?? 50000;

  const maxFileChars = parseIntInRange(file.limits?.maxFileChars, 100, 5_000_000) ?? 100000;

  const requestTimeoutMs =
    parseIntInRange(env.OSS_MCP_REQUEST_TIMEOUT_MS, 1000, 120000) ??
    parseIntInRange(file.limits?.requestTimeoutMs, 1000, 120000) ??
    15000;

  const logLevel =
    overrides.logLevel ??
    parseLogLevel(env.OSS_MCP_LOG_LEVEL) ??
    parseLogLevel(file.logLevel) ??
    "info";

  return {
    githubToken,
    transport,
    port,
    cache: { enabled: cacheEnabled, path: cachePath, ttlHours },
    deepwiki: { enabled: deepwikiEnabled },
    limits: {
      maxSearchResults,
      maxFilesToInspect,
      maxReadmeChars,
      maxFileChars,
      requestTimeoutMs,
    },
    logLevel,
  };
}
