import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type ServerContext } from "./shared.js";
import { AppError } from "../utils/errors.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { generateAlternativeQueries } from "../search/queryBuilder.js";
import { integrationDifficulty } from "../scoring/scoreEngine.js";
import { INPUT_LIMITS } from "./schemas.js";
import type { RepositoryCandidate } from "../types/repository.js";
import type { RepositoryAnalysis } from "../types/analysis.js";
import type {
  AlternativeCandidate,
  AlternativesResult,
  RejectedCandidate,
} from "../types/toolResults.js";

const SAAS_HINT =
  /\b(saas|service|api|web|server|host|hosting|cloud|network|multi-tenant|tenant)\b/i;

function buildWhyRelevant(a: RepositoryAnalysis, target: string): string {
  const bits = [
    `${a.score.relevance}/30 relevance to "${target}"`,
    `${a.license.category} license`,
    `${a.risk.level} risk`,
  ];
  if (a.maintenance.lastPushDaysAgo !== null)
    bits.push(`last push ${a.maintenance.lastPushDaysAgo}d ago`);
  bits.push(`${a.profile.stars}★`);
  return `${bits.join(", ")}.`;
}

export function registerFindAlternatives(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "oss_find_open_source_alternatives",
    {
      title: "Find open-source alternatives",
      description:
        "Find open-source GitHub alternatives to a paid API/SDK/library/SaaS for a given use case. Returns ranked candidates with scores, license, risk and integration difficulty.",
      inputSchema: {
        target: z
          .string()
          .min(1)
          .max(INPUT_LIMITS.target)
          .describe('What to replace, e.g. "Stripe".'),
        useCase: z.string().min(1).max(INPUT_LIMITS.useCase).describe("What you need it for."),
        language: z.string().max(INPUT_LIMITS.qualifier).optional(),
        framework: z.string().max(INPUT_LIMITS.qualifier).optional(),
        mustBeFree: z.boolean().default(true),
        mustBeSelfHosted: z.boolean().default(false),
        licensePreference: z.enum(["permissive", "any", "avoid-strong-copyleft"]).default("any"),
        limit: z.number().int().min(1).max(10).default(5),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(ctx, async () => {
        const queries = generateAlternativeQueries({
          target: args.target,
          useCase: args.useCase,
          language: args.language,
          mustBeSelfHosted: args.mustBeSelfHosted,
        });

        const seen = new Map<string, RepositoryCandidate>();
        const rejected: RejectedCandidate[] = [];
        const notes: string[] = [];

        for (const q of queries) {
          try {
            const { items } = await ctx.github.searchRepositories({
              q,
              sort: "best-match",
              order: "desc",
              perPage: 10,
            });
            for (const item of items) {
              if (seen.has(item.fullName)) continue;
              if (item.archived || item.disabled) {
                rejected.push({
                  repository: item.fullName,
                  reason: item.archived ? "Archived repository." : "Disabled repository.",
                });
                continue;
              }
              seen.set(item.fullName, item);
            }
          } catch (err) {
            if (err instanceof AppError && err.code === "GITHUB_RATE_LIMITED") {
              notes.push("GitHub rate limit reached during search; results may be partial.");
              break;
            }
            ctx.logger.debug("alternatives: search failed", {
              query: q,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        notes.push(`Generated ${queries.length} queries; found ${seen.size} unique candidate(s).`);

        const pool = Array.from(seen.values())
          .sort((a, b) => b.stars - a.stars)
          .slice(0, Math.min(15, Math.max(args.limit * 3, 8)));

        const saas = args.mustBeSelfHosted || SAAS_HINT.test(args.useCase);
        const query = `${args.target} ${args.useCase}`;
        const settled = await mapWithConcurrency(pool, 5, (c) =>
          ctx.analyzer.analyze(c.owner, c.name, {
            query,
            useCase: args.useCase,
            saasUseCase: saas,
          }),
        );

        const analyses: RepositoryAnalysis[] = [];
        settled.forEach((outcome, index) => {
          if (outcome.status === "fulfilled") analyses.push(outcome.value);
          else
            ctx.logger.debug("alternatives: analyze failed", {
              repository: pool[index].fullName,
            });
        });

        const kept: RepositoryAnalysis[] = [];
        for (const a of analyses) {
          const cat = a.license.category;
          if (args.mustBeFree && cat === "none") {
            rejected.push({
              repository: a.repository,
              reason: "No license — not safe to use freely.",
            });
            continue;
          }
          if (args.licensePreference === "avoid-strong-copyleft" && cat === "strong-copyleft") {
            rejected.push({
              repository: a.repository,
              reason: `Strong copyleft (${a.license.detected}) excluded by licensePreference.`,
            });
            continue;
          }
          if (args.licensePreference === "permissive" && cat === "strong-copyleft") {
            rejected.push({
              repository: a.repository,
              reason: `Non-permissive (${a.license.detected}) excluded by licensePreference=permissive.`,
            });
            continue;
          }
          kept.push(a);
        }

        kept.sort((a, b) => b.score.total - a.score.total);
        const top = kept.slice(0, args.limit);
        const candidates: AlternativeCandidate[] = top.map((a) => ({
          repository: a.repository,
          url: a.profile.url,
          description: a.profile.description,
          whyRelevant: buildWhyRelevant(a, args.target),
          score: a.score.total,
          license: a.license.detected,
          riskLevel: a.risk.level,
          integrationDifficulty: integrationDifficulty(a.packageSignals, a.documentation),
        }));

        if (args.framework) notes.push(`Framework preference noted: ${args.framework}.`);
        notes.push(`License preference: ${args.licensePreference}; mustBeFree=${args.mustBeFree}.`);

        const result: AlternativesResult = {
          target: args.target,
          useCase: args.useCase,
          candidates,
          bestCandidate: candidates.length > 0 ? candidates[0].repository : null,
          rejectedCandidates: rejected.slice(0, 20),
          notes,
        };
        return result;
      }),
  );
}
