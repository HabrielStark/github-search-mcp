import { createRedactor } from "./sanitize.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface LoggerOptions {
  level: LogLevel;
  token?: string;
  /** Defaults to process.stderr — never stdout, which is reserved for the MCP channel. */
  stream?: { write(chunk: string): unknown };
}

export function createLogger(options: LoggerOptions): Logger {
  const redact = createRedactor(options.token);
  const stream = options.stream ?? process.stderr;
  const min = LEVEL_ORDER[options.level];

  const emit = (level: LogLevel, message: string, meta?: unknown): void => {
    if (LEVEL_ORDER[level] < min) return;
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      msg: message,
    };
    if (meta !== undefined) entry.meta = meta;
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      line = JSON.stringify({ time: entry.time, level, msg: message });
    }
    stream.write(`${redact(line)}\n`);
  };

  return {
    debug: (m, meta) => emit("debug", m, meta),
    info: (m, meta) => emit("info", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
  };
}

/** Logger that discards everything; used as a default in libraries/tests. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
