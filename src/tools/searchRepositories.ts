import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type ServerContext } from "./shared.js";
import { buildSearchQuery } from "../search/queryBuilder.js";
import { toRateLimitSummary } from "../utils/rateLimit.js";
import { INPUT_LIMITS } from "./schemas.js";
import type { SearchRepositoriesResult } from "../types/toolResults.js";

export function registerSearchRepositories(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "oss_search_repositories",
    {
      title: "Search GitHub repositories",
      description:
        "Search public GitHub repositories by query, with optional language, minimum stars, license and topic filters. Returns repository metadata and rate-limit info.",
      inputSchema: {
        query: z.string().min(1).max(INPUT_LIMITS.query).describe("Free-text search query."),
        language: z
          .string()
          .max(INPUT_LIMITS.qualifier)
          .optional()
          .describe("Filter by primary language, e.g. TypeScript."),
        minStars: z
          .number()
          .int()
          .min(0)
          .max(1_000_000_000)
          .optional()
          .describe("Minimum star count."),
        license: z
          .string()
          .max(INPUT_LIMITS.qualifier)
          .optional()
          .describe("SPDX license key filter, e.g. mit, apache-2.0."),
        topic: z
          .string()
          .max(INPUT_LIMITS.qualifier)
          .optional()
          .describe("Filter by repository topic."),
        sort: z
          .enum(["stars", "updated", "forks", "best-match"])
          .default("best-match")
          .describe("Sort field."),
        order: z.enum(["asc", "desc"]).default("desc").describe("Sort direction."),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(ctx, async () => {
        const limit = args.limit ?? ctx.config.limits.maxSearchResults;
        const q = buildSearchQuery({
          query: args.query,
          language: args.language,
          minStars: args.minStars,
          license: args.license,
          topic: args.topic,
        });
        const { totalCount, items } = await ctx.github.searchRepositories({
          q,
          sort: args.sort,
          order: args.order,
          perPage: Math.min(Math.max(limit, 1), 100),
        });
        const result: SearchRepositoriesResult = {
          query: q,
          totalCount,
          items: items.slice(0, limit),
          rateLimit: toRateLimitSummary(ctx.github.getLastRateLimit()),
        };
        return result;
      }),
  );
}
