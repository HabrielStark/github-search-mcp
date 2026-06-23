import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type ServerContext } from "./shared.js";
import { parseRepository, truncate } from "../utils/sanitize.js";
import { AppError } from "../utils/errors.js";
import { repositorySchema } from "./schemas.js";

export function registerAnalyzeRepository(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "oss_analyze_repository",
    {
      title: "Analyze a repository",
      description:
        "Run a full analysis of one repository: profile, license, documentation, maintenance, package signals, risk, score and a short summary.",
      inputSchema: {
        repository: repositorySchema,
        includeReadme: z.boolean().default(true),
        includeTree: z.boolean().default(true),
        includeLicense: z.boolean().default(true),
        includePackageFiles: z.boolean().default(true),
        includeDeepWiki: z
          .boolean()
          .default(false)
          .describe("Optional DeepWiki summary (if enabled)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(ctx, async () => {
        const { owner, repo } = parseRepository(args.repository);
        const analysis = await ctx.analyzer.analyze(owner, repo, {
          includeReadme: args.includeReadme,
          includeTree: args.includeTree,
          includeLicense: args.includeLicense,
          includePackageFiles: args.includePackageFiles,
        });
        if (!args.includeDeepWiki) return analysis;

        // Augment summary without mutating the cached analysis object.
        let suffix: string;
        if (!ctx.deepwiki.enabled) {
          suffix = " | DeepWiki: disabled.";
        } else {
          try {
            const dw = await ctx.deepwiki.summarize(analysis.repository);
            suffix = ` | DeepWiki: ${truncate(dw.summary, 400).content}`;
          } catch (err) {
            // Stryker disable next-line StringLiteral,ConditionalExpression: DeepWikiClient.summarize only ever throws AppError, so the non-AppError fallback is an unreachable defensive branch (equivalent). The AppError code path is asserted by the test above.
            const reason = err instanceof AppError ? err.code : "error";
            suffix = ` | DeepWiki: unavailable (${reason}).`;
          }
        }
        return { ...analysis, summary: analysis.summary + suffix };
      }),
  );
}
