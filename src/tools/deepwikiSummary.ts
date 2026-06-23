import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type ServerContext } from "./shared.js";
import { parseRepository } from "../utils/sanitize.js";
import { INPUT_LIMITS, repositorySchema } from "./schemas.js";

/**
 * Register the optional DeepWiki summary tool from the SRS public tool list.
 * The adapter is disabled by default and returns DEEPWIKI_DISABLED /
 * DEEPWIKI_UNAVAILABLE structured errors when appropriate.
 */
export function registerDeepWikiTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "oss_deepwiki_summary",
    {
      title: "DeepWiki summary",
      description: "Get a DeepWiki AI summary (answer + topics) for a public GitHub repository.",
      inputSchema: {
        repository: repositorySchema,
        question: z
          .string()
          .max(INPUT_LIMITS.question)
          .optional()
          .describe("Optional specific question about the repository."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(ctx, async () => {
        const { fullName } = parseRepository(args.repository);
        return ctx.deepwiki.summarize(fullName, args.question);
      }),
  );
}
