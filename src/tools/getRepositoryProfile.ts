import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type ServerContext } from "./shared.js";
import { parseRepository } from "../utils/sanitize.js";
import { repositorySchema } from "./schemas.js";

export function registerGetRepositoryProfile(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "oss_get_repository_profile",
    {
      title: "Get repository profile",
      description: "Return the basic profile/metadata of a GitHub repository.",
      inputSchema: {
        repository: repositorySchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(ctx, async () => {
        const { owner, repo } = parseRepository(args.repository);
        return ctx.github.getProfile(owner, repo);
      }),
  );
}
