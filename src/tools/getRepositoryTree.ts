import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type ServerContext } from "./shared.js";
import { parseRepository } from "../utils/sanitize.js";
import { branchSchema, repositorySchema } from "./schemas.js";
import type { RepositoryTreeResult } from "../types/toolResults.js";

export function registerGetRepositoryTree(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "oss_get_repository_tree",
    {
      title: "Get repository file tree",
      description: "Return the file/directory structure of a repository branch.",
      inputSchema: {
        repository: repositorySchema,
        branch: branchSchema,
        recursive: z.boolean().default(true).describe("Recurse into subdirectories."),
        maxFiles: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .default(200)
          .describe("Maximum number of tree entries to return."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(ctx, async () => {
        const { owner, repo, fullName } = parseRepository(args.repository);
        const branch = args.branch ?? (await ctx.github.getDefaultBranch(owner, repo));
        const tree = await ctx.github.getTree(owner, repo, branch, args.recursive);
        const files = tree.files.slice(0, args.maxFiles);
        const result: RepositoryTreeResult = {
          repository: fullName,
          branch,
          files,
          truncated: tree.truncated || files.length < tree.files.length,
        };
        return result;
      }),
  );
}
