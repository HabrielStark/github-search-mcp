import type { Config } from "../config.js";
import { cacheKeys, stableHash, type CacheStore } from "../cache/cacheStore.js";
import type { GitHubClient } from "../adapters/githubClient.js";
import type { Logger } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";
import type { ScoreWeights } from "../types/score.js";
import type { RepositoryAnalysis } from "../types/analysis.js";
import type { LicenseReport } from "../types/license.js";
import type { RepositoryProfile } from "../types/repository.js";
import type { ScoreReport } from "../types/score.js";
import type { DocumentationReport, MaintenanceReport, RiskReport } from "../types/analysis.js";
import { analyzeLicense } from "./licenseAnalyzer.js";
import { analyzeDocumentation } from "./documentationAnalyzer.js";
import { analyzeMaintenance } from "./maintenanceAnalyzer.js";
import { analyzePackageSignals } from "./packageAnalyzer.js";
import { analyzeRisk } from "./riskAnalyzer.js";
import { computeRelevance, computeScore } from "../scoring/scoreEngine.js";

export interface AnalyzeOptions {
  includeReadme?: boolean;
  includeTree?: boolean;
  includeLicense?: boolean;
  includePackageFiles?: boolean;
  query?: string;
  useCase?: string;
  saasUseCase?: boolean;
  weights?: ScoreWeights;
}

export interface RepositoryAnalyzerDeps {
  github: GitHubClient;
  cache: CacheStore;
  logger: Logger;
  config: Config;
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function withinDays(iso: string, days: number, now: number): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return now - t <= days * 86_400_000;
}

function buildSummary(
  profile: RepositoryProfile,
  license: LicenseReport,
  maintenance: MaintenanceReport,
  documentation: DocumentationReport,
  risk: RiskReport,
  score: ScoreReport,
): string {
  const pushNote =
    maintenance.lastPushDaysAgo === null
      ? "unknown last activity"
      : `last push ${maintenance.lastPushDaysAgo}d ago`;
  const licenseNote = license.detected ? `${license.detected} (${license.category})` : "no license";
  const docNote = documentation.hasReadme ? `docs ${documentation.score}/100` : "no README";
  return (
    `${profile.repository}: score ${score.total}/100, ${risk.level} risk. ` +
    `License: ${licenseNote}. ${profile.stars}★/${profile.forks} forks, ${pushNote}, ${docNote}. ` +
    `Top risk factor: ${risk.reasons[0] ?? "none"}`
  );
}

/**
 * Orchestrates a full single-repository analysis. Underlying
 * GitHub calls are individually cached; the composed analysis is also cached.
 */
export class RepositoryAnalyzer {
  private readonly deps: RepositoryAnalyzerDeps;

  constructor(deps: RepositoryAnalyzerDeps) {
    this.deps = deps;
  }

  async analyze(
    owner: string,
    repo: string,
    options: AnalyzeOptions = {},
  ): Promise<RepositoryAnalysis> {
    const includeReadme = options.includeReadme !== false;
    const includeTree = options.includeTree !== false;
    const includeLicense = options.includeLicense !== false;
    const includePackageFiles = options.includePackageFiles !== false;

    const optionsHash = stableHash({
      includeReadme,
      includeTree,
      includeLicense,
      includePackageFiles,
      query: options.query ?? null,
      useCase: options.useCase ?? null,
      saas: options.saasUseCase ?? false,
      weights: options.weights ?? null,
    });
    const cacheKey = cacheKeys.analysis(owner, repo, optionsHash);
    const cachedAnalysis = this.deps.cache.get<RepositoryAnalysis>(cacheKey);
    if (cachedAnalysis !== undefined) return cachedAnalysis;

    const profile = await this.deps.github.getProfile(owner, repo);
    const repository = profile.repository;
    // Tracks whether any enrichment call failed transiently (rate-limit/5xx/etc).
    // A degraded analysis (missing tree/readme/license) must NOT be cached as
    // authoritative, or a transient blip poisons results for the whole TTL.
    let degraded = false;

    let treePaths: string[] = [];
    if (includeTree || includePackageFiles) {
      try {
        const tree = await this.deps.github.getTree(owner, repo, profile.defaultBranch, true);
        treePaths = tree.files
          .slice(0, this.deps.config.limits.maxFilesToInspect)
          .map((file) => file.path);
      } catch (err) {
        degraded = true;
        this.deps.logger.debug("analyze: tree unavailable", { repository, error: errMsg(err) });
      }
    }

    let readme: string | null = null;
    if (includeReadme) {
      try {
        readme = (await this.deps.github.getReadme(owner, repo, profile.defaultBranch)).content;
      } catch (err) {
        if (!(err instanceof AppError && err.code === "README_NOT_FOUND")) {
          degraded = true;
          this.deps.logger.debug("analyze: readme error", { repository, error: errMsg(err) });
        }
      }
    }

    let licenseInfo: { spdxId: string | null; name: string | null; key: string | null } = {
      spdxId: profile.license,
      name: null,
      key: null,
    };
    if (includeLicense) {
      try {
        const info = await this.deps.github.getLicenseInfo(owner, repo);
        licenseInfo = info ?? { spdxId: null, name: null, key: null };
      } catch (err) {
        degraded = true;
        this.deps.logger.debug("analyze: license error", { repository, error: errMsg(err) });
      }
    }
    const license = analyzeLicense(
      { repository, spdxId: licenseInfo.spdxId, name: licenseInfo.name, key: licenseInfo.key },
      { saasUseCase: options.saasUseCase },
    );

    const packageSignals = analyzePackageSignals(treePaths);
    const documentation = analyzeDocumentation({ readme, treePaths });

    const lastReleaseAt = await this.deps.github.getLatestReleaseDate(owner, repo);
    const now = Date.now();
    const hasRecentRelease =
      lastReleaseAt === undefined || lastReleaseAt === null
        ? undefined
        : withinDays(lastReleaseAt, 365, now);
    if (lastReleaseAt === undefined) {
      degraded = true;
      this.deps.logger.debug("analyze: releases error", { repository });
    }

    const maintenance = analyzeMaintenance({
      pushedAt: profile.pushedAt,
      updatedAt: profile.updatedAt,
      archived: profile.archived,
      openIssues: profile.openIssues,
      stars: profile.stars,
      forks: profile.forks,
      hasCI: packageSignals.hasCI,
      lastReleaseAt,
      now,
    });

    const risk = analyzeRisk({
      license,
      maintenance,
      documentation,
      packageSignals,
      profile: {
        archived: profile.archived,
        openIssues: profile.openIssues,
        stars: profile.stars,
        forks: profile.forks,
      },
      saasUseCase: options.saasUseCase,
      hasRecentRelease,
    });

    const relevance = computeRelevance({
      query: options.query,
      useCase: options.useCase,
      name: repo,
      description: profile.description,
      topics: profile.topics,
      readme,
    });

    const score = computeScore({
      relevance: relevance.score,
      maintenance,
      documentation,
      license,
      packageSignals,
      stars: profile.stars,
      forks: profile.forks,
      weights: options.weights,
    });
    score.reasons = [...score.reasons, ...relevance.reasons];

    const summary = buildSummary(profile, license, maintenance, documentation, risk, score);

    const analysis: RepositoryAnalysis = {
      repository,
      profile,
      license,
      documentation,
      maintenance,
      packageSignals,
      risk,
      score,
      summary,
    };

    if (degraded) {
      this.deps.logger.debug("analyze: degraded result not cached", { repository });
    } else {
      try {
        this.deps.cache.set(cacheKey, analysis, this.deps.config.cache.ttlHours * 3_600_000);
      } catch (err) {
        this.deps.logger.debug("analyze: cache set failed", { error: errMsg(err) });
      }
    }
    return analysis;
  }
}
