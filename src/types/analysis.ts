import type { RiskLevel } from "./common.js";
import type { LicenseReport } from "./license.js";
import type { RepositoryProfile } from "./repository.js";
import type { ScoreReport } from "./score.js";

export interface DocumentationReport {
  hasReadme: boolean;
  hasExamples: boolean;
  hasDocsFolder: boolean;
  hasInstallSection: boolean;
  hasUsageSection: boolean;
  hasChangelog: boolean;
  hasContributing: boolean;
  hasSecurity: boolean;
  score: number;
}

export interface MaintenanceReport {
  lastPushDaysAgo: number | null;
  openIssues: number;
  stars: number;
  forks: number;
  archived: boolean;
  score: number;
}

export interface PackageSignals {
  detectedPackageManagers: string[];
  hasTests: boolean;
  hasCI: boolean;
  hasDockerfile: boolean;
  hasExamples: boolean;
}

export interface RiskReport {
  level: RiskLevel;
  reasons: string[];
}

export interface RepositoryAnalysis {
  repository: string;
  profile: RepositoryProfile;
  license: LicenseReport;
  documentation: DocumentationReport;
  maintenance: MaintenanceReport;
  packageSignals: PackageSignals;
  risk: RiskReport;
  score: ScoreReport;
  summary: string;
}
