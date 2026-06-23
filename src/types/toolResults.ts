import type { IntegrationDifficulty, LicenseRiskLevel, RiskLevel, Tri } from "./common.js";
import type { LicenseCategory } from "./license.js";
import type { RepositoryCandidate, RepositoryProfile } from "./repository.js";

export interface RateLimitSummary {
  remaining: number | null;
  resetAt: string | null;
}

export interface SearchRepositoriesResult {
  query: string;
  totalCount: number;
  items: RepositoryCandidate[];
  rateLimit: RateLimitSummary;
}

export type GetRepositoryProfileResult = RepositoryProfile;

export interface TreeFile {
  path: string;
  type: "file" | "dir";
  size: number | null;
  sha: string;
}

export interface RepositoryTreeResult {
  repository: string;
  branch: string;
  files: TreeFile[];
  truncated: boolean;
}

export interface ReadFileResult {
  repository: string;
  path: string;
  branch: string;
  content: string;
  encoding: "utf-8";
  truncated: boolean;
}

export interface ReadmeResult {
  repository: string;
  readmePath: string;
  content: string;
  truncated: boolean;
}

export interface LicenseCheckResult {
  repository: string;
  licenseDetected: string | null;
  spdxId: string | null;
  category: LicenseCategory;
  commercialUse: Tri;
  modification: Tri;
  distribution: Tri;
  privateUse: Tri;
  riskLevel: LicenseRiskLevel;
  notes: string[];
}

export interface CompareRankingEntry {
  repository: string;
  score: number;
  pros: string[];
  cons: string[];
  licenseRisk: RiskLevel;
  maintenanceRisk: RiskLevel;
  integrationDifficulty: IntegrationDifficulty;
}

export interface CompareResult {
  winner: string | null;
  ranking: CompareRankingEntry[];
  summary: string;
}

export interface AlternativeCandidate {
  repository: string;
  url: string;
  description: string | null;
  whyRelevant: string;
  score: number;
  license: string | null;
  riskLevel: RiskLevel;
  integrationDifficulty: IntegrationDifficulty;
}

export interface RejectedCandidate {
  repository: string;
  reason: string;
}

export interface AlternativesResult {
  target: string;
  useCase: string;
  candidates: AlternativeCandidate[];
  bestCandidate: string | null;
  rejectedCandidates: RejectedCandidate[];
  notes: string[];
}

export interface IntegrationNotesResult {
  repository: string;
  targetStack: string;
  installCommands: string[];
  importantFiles: string[];
  basicUsage: string;
  integrationSteps: string[];
  risks: string[];
  licenseReminder: string;
}

export interface DeepWikiResult {
  repository: string;
  available: boolean;
  summary: string;
  topics: string[];
  source: "deepwiki";
}

export interface DeepWikiStructureResult {
  repository: string;
  available: boolean;
  structure: string;
  topics: string[];
  source: "deepwiki";
}

export interface DeepWikiContentsResult {
  repository: string;
  available: boolean;
  content: string;
  source: "deepwiki";
}

export interface DeepWikiAnswerResult {
  repository: string;
  available: boolean;
  question: string;
  answer: string;
  source: "deepwiki";
}

export interface HealthCheckResult {
  name: string;
  version: string;
  status: "ok";
  transport: string;
  cacheEnabled: boolean;
  cacheBackend: "sqlite" | "memory" | "disabled";
  deepwikiEnabled: boolean;
  githubAuthenticated: boolean;
  rateLimit: RateLimitSummary;
  uptimeSeconds: number;
}
