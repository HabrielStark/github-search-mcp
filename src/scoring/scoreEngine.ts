import type { IntegrationDifficulty, LicenseRiskLevel } from "../types/common.js";
import type { DocumentationReport, MaintenanceReport, PackageSignals } from "../types/analysis.js";
import type { LicenseReport } from "../types/license.js";
import type { ScoreReport, ScoreWeights } from "../types/score.js";
import { DEFAULT_WEIGHTS, tokenize } from "./scoreWeights.js";

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface RelevanceInput {
  query?: string;
  useCase?: string;
  name: string;
  description: string | null;
  topics: string[];
  readme?: string | null;
}

export interface RelevanceResult {
  score: number;
  reasons: string[];
}

/** Compute a relevance score (0..1) from query / use-case keyword matches. */
export function computeRelevance(input: RelevanceInput): RelevanceResult {
  const keywords = Array.from(new Set([...tokenize(input.query), ...tokenize(input.useCase)]));
  if (keywords.length === 0) {
    return { score: 0.6, reasons: ["No query keywords provided; using neutral relevance."] };
  }
  const name = input.name.toLowerCase();
  // Stryker disable next-line StringLiteral: `?? ""` only applies when description
  // is null, and any default that lacks the keywords yields the same non-match.
  const description = (input.description ?? "").toLowerCase();
  // Stryker disable next-line StringLiteral: topics are joined only for substring
  // search; the separator width cannot change single-word keyword membership.
  const topics = input.topics.join(" ").toLowerCase();
  // Stryker disable next-line StringLiteral,MethodExpression: `?? ""` default is
  // match-neutral (null readme), and the 20k slice is a scan cap that cannot
  // change which keywords match within the (smaller) real READMEs under test.
  const readme = (input.readme ?? "").toLowerCase().slice(0, 20000);

  let sum = 0;
  const matched: string[] = [];
  const missing: string[] = [];
  for (const kw of keywords) {
    let hit = 0;
    if (name.includes(kw)) hit = 1;
    else if (topics.includes(kw)) hit = 0.9;
    else if (description.includes(kw)) hit = 0.8;
    else if (readme.includes(kw)) hit = 0.5;
    if (hit > 0) matched.push(kw);
    else missing.push(kw);
    sum += hit;
  }
  const score = clamp01(sum / keywords.length);
  const reasons: string[] = [];
  if (matched.length) reasons.push(`Matched keywords: ${matched.slice(0, 8).join(", ")}.`);
  if (missing.length) reasons.push(`Unmatched keywords: ${missing.slice(0, 8).join(", ")}.`);
  return { score, reasons };
}

export function licenseRiskFactor(risk: LicenseRiskLevel): number {
  switch (risk) {
    case "low":
      return 1;
    case "medium":
      return 0.6;
    case "high":
      return 0.2;
    default:
      return 0.35;
  }
}

function adoptionFactor(stars: number, forks: number, hasPackageSignals: boolean): number {
  const starScore = Math.min(1, Math.log10(Math.max(0, stars) + 1) / 4); // ~10k stars → 1
  const forkScore = Math.min(1, Math.log10(Math.max(0, forks) + 1) / 3.5); // ~3k forks → 1
  const ecosystem = hasPackageSignals ? 0.15 : 0;
  return clamp01(0.55 * starScore + 0.3 * forkScore + ecosystem);
}

function integrationFactor(pkg: PackageSignals, docs: DocumentationReport): number {
  let points = 0;
  if (pkg.detectedPackageManagers.length > 0) points += 1;
  if (docs.hasInstallSection) points += 1;
  if (pkg.hasExamples || docs.hasExamples) points += 1;
  if (pkg.hasDockerfile) points += 1;
  if (pkg.hasTests || pkg.hasCI) points += 1;
  return points / 5;
}

/** Map package/documentation signals to a coarse integration difficulty. */
export function integrationDifficulty(
  pkg: PackageSignals,
  docs: DocumentationReport,
): IntegrationDifficulty {
  const factor = integrationFactor(pkg, docs);
  if (factor >= 0.6) return "easy";
  // Stryker disable next-line EqualityOperator: factor is always points/5 ∈
  // {0,.2,.4,.6,.8,1} and never exactly 0.3, so `>= 0.3` and `> 0.3` are equivalent.
  if (factor >= 0.3) return "medium";
  return "hard";
}

export interface ScoreComponents {
  relevance: number;
  maintenance: MaintenanceReport;
  documentation: DocumentationReport;
  license: LicenseReport;
  packageSignals: PackageSignals;
  stars: number;
  forks: number;
  weights?: ScoreWeights;
}

/** Combine the component scores into a weighted total out of 100. */
export function computeScore(components: ScoreComponents): ScoreReport {
  const w = components.weights ?? DEFAULT_WEIGHTS;
  const relevance01 = clamp01(components.relevance);
  const maintenance01 = clamp01(components.maintenance.score / 100);
  const license01 = licenseRiskFactor(components.license.riskLevel);
  const documentation01 = clamp01(components.documentation.score / 100);
  const adoption01 = adoptionFactor(
    components.stars,
    components.forks,
    components.packageSignals.detectedPackageManagers.length > 0,
  );
  const integration01 = integrationFactor(components.packageSignals, components.documentation);

  const relevance = relevance01 * w.relevance;
  const maintenance = maintenance01 * w.maintenance;
  const license = license01 * w.license;
  const documentation = documentation01 * w.documentation;
  const adoption = adoption01 * w.adoption;
  const integration = integration01 * w.integration;
  const total = relevance + maintenance + license + documentation + adoption + integration;

  const reasons: string[] = [
    `Relevance ${round1(relevance)}/${w.relevance}`,
    `Maintenance ${round1(maintenance)}/${w.maintenance}`,
    `License ${round1(license)}/${w.license} (${components.license.riskLevel} risk)`,
    `Documentation ${round1(documentation)}/${w.documentation}`,
    `Adoption ${round1(adoption)}/${w.adoption}`,
    `Integration ${round1(integration)}/${w.integration}`,
  ];

  return {
    total: Math.round(total),
    relevance: round1(relevance),
    maintenance: round1(maintenance),
    license: round1(license),
    documentation: round1(documentation),
    adoption: round1(adoption),
    integration: round1(integration),
    reasons,
  };
}
