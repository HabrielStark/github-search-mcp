import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type ServerContext } from "./shared.js";
import { parseRepository } from "../utils/sanitize.js";
import { AppError } from "../utils/errors.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { INPUT_LIMITS } from "./schemas.js";
import { DEFAULT_WEIGHTS } from "../scoring/scoreWeights.js";
import { integrationDifficulty } from "../scoring/scoreEngine.js";
import type { RiskLevel } from "../types/common.js";
import type { ScoreWeights } from "../types/score.js";
import type { RepositoryAnalysis } from "../types/analysis.js";
import type { CompareRankingEntry, CompareResult } from "../types/toolResults.js";

interface Criteria {
  preferPermissiveLicense?: boolean;
  preferActiveMaintenance?: boolean;
  preferEasyIntegration?: boolean;
  preferPopular?: boolean;
  language?: string;
}

function maintenanceRisk(score: number): RiskLevel {
  if (score >= 70) return "low";
  if (score >= 40) return "medium";
  return "high";
}

function adjustWeights(criteria: Criteria): ScoreWeights {
  const w = { ...DEFAULT_WEIGHTS };
  if (criteria.preferPermissiveLicense) w.license += 12;
  if (criteria.preferActiveMaintenance) w.maintenance += 12;
  if (criteria.preferEasyIntegration) w.integration += 12;
  if (criteria.preferPopular) w.adoption += 12;
  const sum =
    w.relevance + w.maintenance + w.license + w.documentation + w.adoption + w.integration;
  const f = 100 / sum;
  return {
    relevance: w.relevance * f,
    maintenance: w.maintenance * f,
    license: w.license * f,
    documentation: w.documentation * f,
    adoption: w.adoption * f,
    integration: w.integration * f,
  };
}

function prosCons(a: RepositoryAnalysis, language?: string): { pros: string[]; cons: string[] } {
  const pros: string[] = [];
  const cons: string[] = [];
  if (a.license.category === "permissive") pros.push(`Permissive license (${a.license.detected})`);
  else if (a.license.category === "none" || a.license.category === "unknown")
    cons.push("No clear license");
  else if (a.license.category === "strong-copyleft")
    cons.push(`Strong copyleft (${a.license.detected})`);
  if (a.maintenance.archived) cons.push("Archived repository");
  if (a.maintenance.lastPushDaysAgo !== null && a.maintenance.lastPushDaysAgo <= 180)
    pros.push("Recently active");
  else if (a.maintenance.lastPushDaysAgo !== null && a.maintenance.lastPushDaysAgo > 730)
    cons.push("Stale (>24 months)");
  if (a.documentation.score >= 80) pros.push("Strong documentation");
  else if (a.documentation.score < 40) cons.push("Weak documentation");
  if (a.packageSignals.hasTests) pros.push("Has tests");
  if (a.packageSignals.hasCI) pros.push("Has CI");
  pros.push(`${a.profile.stars}★ / ${a.profile.forks} forks`);
  if (
    language &&
    a.profile.language &&
    a.profile.language.toLowerCase() !== language.toLowerCase()
  ) {
    cons.push(`Language is ${a.profile.language}, not ${language}`);
  }
  return { pros: pros.slice(0, 6), cons: cons.slice(0, 6) };
}

export function registerCompareRepositories(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "oss_compare_repositories",
    {
      title: "Compare repositories",
      description:
        "Analyze and rank multiple repositories with a single scoring system and optional preference criteria. Returns a ranking and a winner.",
      inputSchema: {
        repositories: z
          .array(z.string().min(1).max(INPUT_LIMITS.repository))
          .min(1)
          .max(10)
          .describe('Repositories to compare, each "owner/repo".'),
        criteria: z
          .object({
            preferPermissiveLicense: z.boolean().optional(),
            preferActiveMaintenance: z.boolean().optional(),
            preferEasyIntegration: z.boolean().optional(),
            preferPopular: z.boolean().optional(),
            language: z.string().max(INPUT_LIMITS.qualifier).optional(),
          })
          .optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(ctx, async () => {
        const criteria: Criteria = args.criteria ?? {};
        const weights = adjustWeights(criteria);
        const parsed = args.repositories.map((r) => parseRepository(r));

        const settled = await mapWithConcurrency(parsed, 5, (r) =>
          ctx.analyzer.analyze(r.owner, r.repo, { weights }),
        );

        const ranking: CompareRankingEntry[] = [];
        const failures: string[] = [];
        settled.forEach((outcome, index) => {
          const fullName = parsed[index].fullName;
          if (outcome.status === "fulfilled") {
            const a = outcome.value;
            const { pros, cons } = prosCons(a, criteria.language);
            const langMismatch =
              Boolean(criteria.language) &&
              Boolean(a.profile.language) &&
              a.profile.language?.toLowerCase() !== criteria.language?.toLowerCase();
            const score = langMismatch ? Math.max(0, a.score.total - 15) : a.score.total;
            ranking.push({
              repository: a.repository,
              score,
              pros,
              cons,
              licenseRisk: a.license.riskLevel === "unknown" ? "high" : a.license.riskLevel,
              maintenanceRisk: maintenanceRisk(a.maintenance.score),
              integrationDifficulty: integrationDifficulty(a.packageSignals, a.documentation),
            });
          } else {
            const reason =
              outcome.reason instanceof AppError
                ? `${outcome.reason.code}: ${outcome.reason.message}`
                : String(outcome.reason);
            failures.push(`${fullName} (${reason})`);
          }
        });

        ranking.sort((a, b) => b.score - a.score);
        const winner = ranking.length > 0 ? ranking[0].repository : null;
        let summary = ranking.length
          ? `Compared ${ranking.length} repositories. Winner: ${winner} (score ${ranking[0].score}/100).`
          : "No repositories could be analyzed.";
        if (failures.length) summary += ` Could not analyze: ${failures.join("; ")}.`;

        const result: CompareResult = { winner, ranking, summary };
        return result;
      }),
  );
}
