import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type ServerContext } from "./shared.js";
import { toRateLimitSummary } from "../utils/rateLimit.js";
import type { HealthCheckResult } from "../types/toolResults.js";

export function registerHealthCheck(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "oss_health_check",
    {
      title: "Health check",
      description:
        "Report server status, version, transport, cache backend, DeepWiki state, GitHub auth presence and last-seen rate limit. No secrets are returned.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      runTool(ctx, async () => {
        const result: HealthCheckResult = {
          name: "oss-research-mcp",
          version: ctx.version,
          status: "ok",
          transport: ctx.config.transport,
          cacheEnabled: ctx.config.cache.enabled,
          cacheBackend: ctx.cache.backend,
          deepwikiEnabled: ctx.config.deepwiki.enabled,
          githubAuthenticated: ctx.github.authenticated,
          rateLimit: toRateLimitSummary(ctx.github.getLastRateLimit()),
          uptimeSeconds: Math.round((Date.now() - ctx.startedAt) / 1000),
        };
        return Promise.resolve(result);
      }),
  );
}
