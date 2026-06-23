import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "./shared.js";
import { registerSearchRepositories } from "./searchRepositories.js";
import { registerGetRepositoryProfile } from "./getRepositoryProfile.js";
import { registerGetRepositoryTree } from "./getRepositoryTree.js";
import { registerReadRepositoryFile } from "./readRepositoryFile.js";
import { registerGetReadme } from "./getReadme.js";
import { registerCheckLicense } from "./checkLicense.js";
import { registerAnalyzeRepository } from "./analyzeRepository.js";
import { registerCompareRepositories } from "./compareRepositories.js";
import { registerFindAlternatives } from "./findAlternatives.js";
import { registerGenerateIntegrationNotes } from "./generateIntegrationNotes.js";
import { registerDeepWikiTools } from "./deepwikiSummary.js";
import { registerHealthCheck } from "./healthCheck.js";

export const TOOL_NAMES = [
  "oss_search_repositories",
  "oss_get_repository_profile",
  "oss_get_repository_tree",
  "oss_read_repository_file",
  "oss_get_readme",
  "oss_check_license",
  "oss_analyze_repository",
  "oss_compare_repositories",
  "oss_find_open_source_alternatives",
  "oss_generate_integration_notes",
  "oss_deepwiki_summary",
  "oss_health_check",
] as const;

/** Register all OSS Research MCP tools on the server. */
export function registerAllTools(server: McpServer, ctx: ServerContext): void {
  registerSearchRepositories(server, ctx);
  registerGetRepositoryProfile(server, ctx);
  registerGetRepositoryTree(server, ctx);
  registerReadRepositoryFile(server, ctx);
  registerGetReadme(server, ctx);
  registerCheckLicense(server, ctx);
  registerAnalyzeRepository(server, ctx);
  registerCompareRepositories(server, ctx);
  registerFindAlternatives(server, ctx);
  registerGenerateIntegrationNotes(server, ctx);
  registerDeepWikiTools(server, ctx);
  registerHealthCheck(server, ctx);
}
