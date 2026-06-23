import type { RiskLevel } from "../types/common.js";
import type {
  DocumentationReport,
  MaintenanceReport,
  PackageSignals,
  RiskReport,
} from "../types/analysis.js";
import type { LicenseReport } from "../types/license.js";

export interface RiskAnalyzerInput {
  license: LicenseReport;
  maintenance: MaintenanceReport;
  documentation: DocumentationReport;
  packageSignals: PackageSignals;
  profile: { archived: boolean; openIssues: number; stars: number; forks: number };
  saasUseCase?: boolean;
  /** undefined = unknown; null = no release; true/false = recent release present or not */
  hasRecentRelease?: boolean | null;
}

function isAgpl(license: LicenseReport): boolean {
  // Stryker disable next-line StringLiteral: the `?? ""` default is only used
  // when spdxId is null, and any non-"AGPL" default yields the same `false`.
  return (license.spdxId ?? "").toUpperCase().startsWith("AGPL");
}

function isGpl(license: LicenseReport): boolean {
  // Stryker disable next-line StringLiteral: equivalent default (see isAgpl).
  const id = (license.spdxId ?? "").toUpperCase();
  return id.startsWith("GPL");
}

/** True if `days` falls in the (lo, hi] window. null (unknown) → false. */
function inactiveWindow(days: number | null, lo: number, hi: number): boolean {
  // Stryker disable next-line ConditionalExpression: type-required null guard;
  // null→0 lies outside any (lo, hi] window so mutating the guard is equivalent.
  // The `> lo` / `<= hi` bounds and `&&` remain mutated and test-killed.
  return days !== null && days > lo && days <= hi;
}

/** Aggregate the sub-reports into a single risk level plus ranked reasons. */
export function analyzeRisk(input: RiskAnalyzerInput): RiskReport {
  const { license, maintenance, documentation, packageSignals, profile } = input;
  const saas = input.saasUseCase ?? false;

  const high: string[] = [];
  const medium: string[] = [];
  const low: string[] = [];

  // High-risk signals.
  if (license.category === "none")
    high.push("No license — no usage rights are granted by default.");
  if (license.category === "unknown")
    high.push("License could not be identified; legal terms are unclear.");
  if (profile.archived) high.push("Repository is archived (read-only, unmaintained).");
  // Stryker disable next-line ConditionalExpression: the `!== null` guard is
  // type-required; null coerces to 0 and `0 > 730` is already false, so mutating
  // the guard is equivalent. The `> 730` threshold and `&&` remain test-killed.
  if (maintenance.lastPushDaysAgo !== null && maintenance.lastPushDaysAgo > 730)
    high.push("No commits in over 24 months.");
  if (!documentation.hasReadme) high.push("No README found.");
  if (!documentation.hasUsageSection && !documentation.hasExamples)
    high.push("No usage instructions or examples found.");
  if (profile.openIssues > 1500)
    high.push(`Very large open-issue backlog (${profile.openIssues}).`);
  if (isAgpl(license) && saas) high.push("AGPL license is high risk for a SaaS/network use case.");
  if (!documentation.hasInstallSection && packageSignals.detectedPackageManagers.length === 0)
    high.push("No clear install process (no install section and no recognized package manifest).");

  // Medium-risk signals.
  if (isGpl(license) && !isAgpl(license))
    medium.push("GPL license imposes copyleft obligations on derivative works.");
  if (license.category === "weak-copyleft")
    medium.push("Weak-copyleft license imposes some sharing obligations.");
  if (documentation.score < 40) medium.push("Weak documentation.");
  if (inactiveWindow(maintenance.lastPushDaysAgo, 365, 730))
    medium.push("Low recent activity (last push 12–24 months ago).");
  if (profile.stars < 50) medium.push("Few stars — limited community adoption signal.");
  if (input.hasRecentRelease === false) medium.push("Latest release is over 12 months old.");

  // Low-risk / positive signals.
  if (license.category === "permissive") low.push("Permissive license.");
  if (maintenance.lastPushDaysAgo !== null && maintenance.lastPushDaysAgo <= 180)
    low.push("Recent commits.");
  if (documentation.hasReadme && documentation.hasUsageSection)
    low.push("Clear README with usage.");
  if (documentation.hasExamples) low.push("Examples available.");
  if (packageSignals.hasTests) low.push("Tests present.");
  if (packageSignals.hasCI) low.push("CI configured.");

  let level: RiskLevel;
  let reasons: string[];
  if (high.length > 0) {
    level = "high";
    reasons = [...high, ...medium].slice(0, 8);
  } else if (medium.length > 0) {
    level = "medium";
    // Stryker disable next-line MethodExpression: there are at most 6 distinct
    // medium reasons, so slicing to 8 is equivalent to the full array.
    reasons = medium.slice(0, 8);
  } else {
    level = "low";
    // Stryker disable next-line all: defensive fallback, provably unreachable —
    // whenever risk resolves to "low", the "no usage/examples" high-risk rule
    // has already guaranteed at least one positive (low) signal, so `low` is
    // never empty here. Kept for safety against future rule changes.
    reasons = low.length > 0 ? low.slice(0, 8) : ["No significant risks detected."];
  }

  return { level, reasons };
}
