#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type CliOverrides } from "./config.js";
import { createLogger, type LogLevel } from "./utils/logger.js";
import { createCache } from "./cache/cacheStore.js";
import { createServerContext, createMcpServer } from "./server.js";
import { startHttpServer, type HttpServerHandle } from "./httpServer.js";
import { readVersion } from "./version.js";

const HELP = `oss-research-mcp — MCP server for open-source GitHub research.

Usage:
  oss-research-mcp [options]

Options:
  --transport stdio|http       Transport to use (default: stdio).
  --port <number>              Port for the HTTP transport (default: 7345).
  --cache true|false           Enable response caching (default: true).
  --deepwiki true|false        Enable the optional DeepWiki adapter (default: false).
  --log-level debug|info|warn|error   Log verbosity (default: info).
  -h, --help                   Show this help.
  -v, --version                Show version.

Environment variables (see .env.example): GITHUB_TOKEN, OSS_MCP_TRANSPORT,
  OSS_MCP_PORT, OSS_MCP_CACHE_ENABLED, OSS_MCP_CACHE_PATH, OSS_MCP_CACHE_TTL_HOURS,
  OSS_MCP_DEEPWIKI_ENABLED, OSS_MCP_MAX_RESULTS, OSS_MCP_REQUEST_TIMEOUT_MS, OSS_MCP_LOG_LEVEL.`;

function parseBoolFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return undefined;
}

interface ParsedArgs {
  overrides: CliOverrides;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const overrides: CliOverrides = {};
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i += 1) {
    let arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      version = true;
      continue;
    }
    let inlineValue: string | undefined;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        inlineValue = arg.slice(eq + 1);
        arg = arg.slice(0, eq);
      }
    }
    const takeValue = (): string | undefined => inlineValue ?? argv[++i];

    switch (arg) {
      case "--transport": {
        const v = takeValue();
        if (v === "stdio" || v === "http") overrides.transport = v;
        break;
      }
      case "--port": {
        const n = Number(takeValue());
        if (Number.isFinite(n)) overrides.port = n;
        break;
      }
      case "--cache":
        overrides.cache = parseBoolFlag(takeValue());
        break;
      case "--deepwiki":
        overrides.deepwiki = parseBoolFlag(takeValue());
        break;
      case "--log-level": {
        const v = takeValue();
        if (v && ["debug", "info", "warn", "error"].includes(v)) overrides.logLevel = v as LogLevel;
        break;
      }
      default:
        break;
    }
  }
  return { overrides, help, version };
}

async function main(): Promise<void> {
  const { overrides, help, version } = parseArgs(process.argv.slice(2));
  const appVersion = readVersion();

  if (version) {
    process.stdout.write(`${appVersion}\n`);
    return;
  }
  if (help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const config = loadConfig({ overrides });
  const logger = createLogger({ level: config.logLevel, token: config.githubToken });
  const cache = await createCache(config, logger);
  const context = createServerContext({ config, logger, cache, version: appVersion });

  let httpHandle: HttpServerHandle | undefined;
  let stdioServer: ReturnType<typeof createMcpServer> | undefined;
  let shuttingDown = false;
  const shutdown = async (code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down");
    // Watchdog: never let a stalled close() block exit (Ctrl+C must always work).
    const forceExit = setTimeout(() => process.exit(code), 5000);
    (forceExit as { unref?: () => void }).unref?.();
    try {
      if (httpHandle) await httpHandle.close();
      if (stdioServer) await stdioServer.close();
    } catch {
      // ignore shutdown errors
    }
    try {
      cache.close();
    } catch {
      // ignore
    }
    clearTimeout(forceExit);
    process.exit(code);
  };
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  if (config.transport === "http") {
    httpHandle = await startHttpServer({
      createMcpServer: () => createMcpServer(context),
      port: config.port,
      logger,
    });
  } else {
    stdioServer = createMcpServer(context);
    await stdioServer.connect(new StdioServerTransport());
    logger.info("oss-research-mcp ready (stdio)", {
      version: appVersion,
      cache: cache.backend,
      deepwiki: config.deepwiki.enabled,
      githubAuth: Boolean(config.githubToken),
    });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
