import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type ServerContext } from "./shared.js";
import { parseRepository } from "../utils/sanitize.js";
import { analyzeLicense } from "../analyzers/licenseAnalyzer.js";
import { repositorySchema } from "./schemas.js";
import type { LicenseCheckResult } from "../types/toolResults.js";

export function registerCheckLicense(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "oss_check_license",
    {
      title: "Check repository license",
      description:
        "Detect a repository's license and classify usage rights and risk (permissive / weak-copyleft / strong-copyleft / none / unknown).",
      inputSchema: {
        repository: repositorySchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(ctx, async () => {
        const { owner, repo, fullName } = parseRepository(args.repository);
        const info = await ctx.github.getLicenseInfo(owner, repo);
        let spdxId = info?.spdxId ?? null;
        const name = info?.name ?? null;
        if (!info) {
          // No dedicated license file — fall back to the profile's license field
          // (string | null), which is null when the repo has no detectable license.
          const profile = await ctx.github.getProfile(owner, repo);
          spdxId = profile.license;
        }
        const report = analyzeLicense({ repository: fullName, spdxId, name });
        const result: LicenseCheckResult = {
          repository: fullName,
          licenseDetected: report.detected,
          spdxId: report.spdxId,
          category: report.category,
          commercialUse: report.commercialUse,
          modification: report.modification,
          distribution: report.distribution,
          privateUse: report.privateUse,
          riskLevel: report.riskLevel,
          notes: report.notes,
        };
        return result;
      }),
  );
}
