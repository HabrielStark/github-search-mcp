import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import type { Logger } from "../utils/logger.js";
import type { CacheStore } from "../cache/cacheStore.js";
import type { GitHubClient } from "../adapters/githubClient.js";
import type { DeepWikiClient } from "../adapters/deepwikiClient.js";
import type { RepositoryAnalyzer } from "../analyzers/repositoryAnalyzer.js";
import { AppError, toErrorResponse } from "../utils/errors.js";
import { toRateLimitSummary } from "../utils/rateLimit.js";

export interface ServerContext {
  config: Config;
  logger: Logger;
  cache: CacheStore;
  github: GitHubClient;
  deepwiki: DeepWikiClient;
  analyzer: RepositoryAnalyzer;
  startedAt: number;
  version: string;
  redact: (text: string) => string;
}

/**
 * Execute a tool body and convert the result (or a thrown AppError) into a
 * CallToolResult. Tool errors are returned as structured `isError` results
 * rather than protocol errors, and all output is redacted before it leaves the
 * process.
 */
export async function runTool(
  ctx: ServerContext,
  fn: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const result = await fn();
    const payload =
      result && typeof result === "object" && !Array.isArray(result) && !("rateLimit" in result)
        ? { ...result, rateLimit: toRateLimitSummary(ctx.github.getLastRateLimit()) }
        : result;
    // Redact once, then derive BOTH channels from the redacted text so a
    // token-shaped string in untrusted content cannot leak via structuredContent
    // while being masked in the text block.
    const text = ctx.redact(JSON.stringify(payload, null, 2));
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: JSON.parse(text) as Record<string, unknown>,
    };
  } catch (err) {
    if (!(err instanceof AppError)) {
      ctx.logger.error("tool execution error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const payload = toErrorResponse(err);
    const text = ctx.redact(JSON.stringify(payload, null, 2));
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: JSON.parse(text) as Record<string, unknown>,
      isError: true,
    };
  }
}
