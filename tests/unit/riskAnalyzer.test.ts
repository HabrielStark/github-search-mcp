import { describe, it, expect } from "vitest";
import { analyzeRisk, type RiskAnalyzerInput } from "../../src/analyzers/riskAnalyzer.js";
import type { LicenseReport } from "../../src/types/license.js";
import type {
  DocumentationReport,
  MaintenanceReport,
  PackageSignals,
} from "../../src/types/analysis.js";

// A fully healthy permissive repository. Each test overrides only the field
// whose effect on the risk verdict it pins, so the baseline never accidentally
// contributes a reason of its own.
function licenseReport(o: Partial<LicenseReport> = {}): LicenseReport {
  return {
    repository: "x/y",
    detected: "MIT",
    spdxId: "MIT",
    category: "permissive",
    commercialUse: "yes",
    privateUse: "yes",
    modification: "yes",
    distribution: "yes",
    riskLevel: "low",
    notes: [],
    ...o,
  };
}
function maintenanceReport(o: Partial<MaintenanceReport> = {}): MaintenanceReport {
  return {
    lastPushDaysAgo: 10,
    openIssues: 5,
    stars: 1000,
    forks: 100,
    archived: false,
    score: 90,
    ...o,
  };
}
function documentationReport(o: Partial<DocumentationReport> = {}): DocumentationReport {
  return {
    hasReadme: true,
    hasExamples: true,
    hasDocsFolder: true,
    hasInstallSection: true,
    hasUsageSection: true,
    hasChangelog: true,
    hasContributing: true,
    hasSecurity: true,
    score: 100,
    ...o,
  };
}
function packageSignals(o: Partial<PackageSignals> = {}): PackageSignals {
  return {
    detectedPackageManagers: ["npm"],
    hasTests: true,
    hasCI: true,
    hasDockerfile: true,
    hasExamples: true,
    ...o,
  };
}
function riskInput(o: Partial<RiskAnalyzerInput> = {}): RiskAnalyzerInput {
  return {
    license: licenseReport(),
    maintenance: maintenanceReport(),
    documentation: documentationReport(),
    packageSignals: packageSignals(),
    profile: { archived: false, openIssues: 5, stars: 1000, forks: 100 },
    hasRecentRelease: true,
    ...o,
  };
}

describe("analyzeRisk — overall verdict", () => {
  it("returns low risk for a healthy permissive repo", () => {
    expect(analyzeRisk(riskInput()).level).toBe("low");
  });

  it("flags no license as high", () => {
    const r = analyzeRisk(
      riskInput({
        license: licenseReport({
          category: "none",
          riskLevel: "high",
          spdxId: null,
          detected: null,
        }),
      }),
    );
    expect(r.level).toBe("high");
    expect(r.reasons.join(" ")).toMatch(/license/i);
  });

  it("flags archived repos as high", () => {
    const r = analyzeRisk(
      riskInput({
        maintenance: maintenanceReport({ archived: true }),
        profile: { archived: true, openIssues: 5, stars: 1000, forks: 100 },
      }),
    );
    expect(r.level).toBe("high");
  });

  it("flags stale repos (>24 months) as high", () => {
    const r = analyzeRisk(
      riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 800, score: 20 }) }),
    );
    expect(r.level).toBe("high");
  });

  it("rates GPL as medium when otherwise healthy", () => {
    const r = analyzeRisk(
      riskInput({
        license: licenseReport({
          detected: "GPL-3.0",
          spdxId: "GPL-3.0",
          category: "strong-copyleft",
          riskLevel: "medium",
        }),
      }),
    );
    expect(r.level).toBe("medium");
  });

  it("flags AGPL for SaaS as high", () => {
    const r = analyzeRisk(
      riskInput({
        license: licenseReport({
          detected: "AGPL-3.0",
          spdxId: "AGPL-3.0",
          category: "strong-copyleft",
          riskLevel: "high",
        }),
        saasUseCase: true,
      }),
    );
    expect(r.level).toBe("high");
    expect(r.reasons.join(" ")).toMatch(/AGPL/);
  });
});

describe("analyzeRisk — exact reasons per branch", () => {
  it("lists the positive signals verbatim for a healthy permissive repo", () => {
    const r = analyzeRisk(riskInput());
    expect(r.level).toBe("low");
    expect(r.reasons).toEqual([
      "Permissive license.",
      "Recent commits.",
      "Clear README with usage.",
      "Examples available.",
      "Tests present.",
      "CI configured.",
    ]);
  });

  it("unknown license → high with the unclear-terms reason", () => {
    const r = analyzeRisk(
      riskInput({ license: licenseReport({ category: "unknown", riskLevel: "high" }) }),
    );
    expect(r.level).toBe("high");
    expect(r.reasons).toContain("License could not be identified; legal terms are unclear.");
  });

  it("no license → high with the no-rights reason", () => {
    const r = analyzeRisk(riskInput({ license: licenseReport({ category: "none" }) }));
    expect(r.reasons).toContain("No license — no usage rights are granted by default.");
  });

  it("archived → high with the archived reason", () => {
    const r = analyzeRisk(
      riskInput({
        profile: { archived: true, openIssues: 5, stars: 1000, forks: 100 },
        maintenance: maintenanceReport({ archived: true }),
      }),
    );
    expect(r.reasons).toContain("Repository is archived (read-only, unmaintained).");
  });

  it("flags a missing README with the exact reason", () => {
    expect(
      analyzeRisk(riskInput({ documentation: documentationReport({ hasReadme: false }) })).reasons,
    ).toContain("No README found.");
  });

  it("missing usage AND examples → high with the exact reason", () => {
    const r = analyzeRisk(
      riskInput({
        documentation: documentationReport({ hasUsageSection: false, hasExamples: false }),
      }),
    );
    expect(r.reasons).toContain("No usage instructions or examples found.");
  });

  it("does NOT flag 'no usage/examples' when usage is present but examples are absent (&& not ||)", () => {
    const r = analyzeRisk(
      riskInput({
        documentation: documentationReport({ hasUsageSection: true, hasExamples: false }),
      }),
    );
    expect(r.reasons).not.toContain("No usage instructions or examples found.");
  });

  it("only flags 'no install process' when BOTH the install section and a package manager are absent", () => {
    expect(
      analyzeRisk(
        riskInput({
          documentation: documentationReport({ hasInstallSection: true }),
          packageSignals: packageSignals({ detectedPackageManagers: [] }),
        }),
      ).reasons,
    ).not.toContain(
      "No clear install process (no install section and no recognized package manifest).",
    );
    expect(
      analyzeRisk(
        riskInput({
          documentation: documentationReport({ hasInstallSection: false }),
          packageSignals: packageSignals({ detectedPackageManagers: ["npm"] }),
        }),
      ).reasons,
    ).not.toContain(
      "No clear install process (no install section and no recognized package manifest).",
    );
    expect(
      analyzeRisk(
        riskInput({
          documentation: documentationReport({ hasInstallSection: false }),
          packageSignals: packageSignals({ detectedPackageManagers: [] }),
        }),
      ).reasons,
    ).toContain(
      "No clear install process (no install section and no recognized package manifest).",
    );
  });

  it("flags a very large backlog (>1500); exactly 1500 does not trigger it", () => {
    const big = analyzeRisk(
      riskInput({ profile: { archived: false, openIssues: 1501, stars: 1000, forks: 100 } }),
    );
    expect(big.reasons.some((r) => /Very large open-issue backlog \(1501\)/.test(r))).toBe(true);
    const ok = analyzeRisk(
      riskInput({ profile: { archived: false, openIssues: 1500, stars: 1000, forks: 100 } }),
    );
    expect(ok.reasons.some((r) => /Very large open-issue backlog/.test(r))).toBe(false);
  });

  it("flags stale (>730 days), and weak-copyleft / GPL / few-stars / old-release as medium reasons", () => {
    expect(
      analyzeRisk(riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 731 }) })).reasons,
    ).toContain("No commits in over 24 months.");

    const weak = analyzeRisk(riskInput({ license: licenseReport({ category: "weak-copyleft" }) }));
    expect(weak.level).toBe("medium");
    expect(weak.reasons).toContain("Weak-copyleft license imposes some sharing obligations.");

    const gpl = analyzeRisk(
      riskInput({
        license: licenseReport({
          category: "strong-copyleft",
          spdxId: "GPL-3.0",
          detected: "GPL-3.0",
        }),
      }),
    );
    expect(gpl.reasons).toContain("GPL license imposes copyleft obligations on derivative works.");

    const fewStars = analyzeRisk(
      riskInput({ profile: { archived: false, openIssues: 5, stars: 49, forks: 0 } }),
    );
    expect(fewStars.reasons).toContain("Few stars — limited community adoption signal.");
    const fifty = analyzeRisk(
      riskInput({ profile: { archived: false, openIssues: 5, stars: 50, forks: 0 } }),
    );
    expect(fifty.reasons).not.toContain("Few stars — limited community adoption signal.");

    const oldRelease = analyzeRisk(riskInput({ hasRecentRelease: false }));
    expect(oldRelease.reasons).toContain("Latest release is over 12 months old.");
    const noRelease = analyzeRisk(riskInput({ hasRecentRelease: null }));
    expect(noRelease.reasons).not.toContain("Latest release is over 12 months old.");
  });

  it("flags weak documentation (score < 40) as medium; exactly 40 does not", () => {
    expect(
      analyzeRisk(riskInput({ documentation: documentationReport({ score: 39 }) })).reasons,
    ).toContain("Weak documentation.");
    expect(
      analyzeRisk(riskInput({ documentation: documentationReport({ score: 40 }) })).reasons,
    ).not.toContain("Weak documentation.");
  });

  it("flags the low-activity window (366–730 days) as a medium reason", () => {
    const r = analyzeRisk(riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 500 }) }));
    expect(r.level).toBe("medium");
    expect(r.reasons).toContain("Low recent activity (last push 12–24 months ago).");
  });
});

describe("analyzeRisk — open-issue and last-push boundaries", () => {
  it("treats 1500 open issues as not-high and 1501 as high", () => {
    expect(
      analyzeRisk(
        riskInput({ profile: { archived: false, openIssues: 1500, stars: 1000, forks: 100 } }),
      ).level,
    ).toBe("low");
    expect(
      analyzeRisk(
        riskInput({ profile: { archived: false, openIssues: 1501, stars: 1000, forks: 100 } }),
      ).level,
    ).toBe("high");
  });

  it("treats a 730-day-old last push as medium and 731 as high", () => {
    expect(
      analyzeRisk(
        riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 730, score: 50 }) }),
      ).level,
    ).toBe("medium");
    expect(
      analyzeRisk(
        riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 731, score: 40 }) }),
      ).level,
    ).toBe("high");
  });

  it("pins the low-activity window edges (365 out, 366 in, 730 in, 731 high-not-medium)", () => {
    const lowAct = "Low recent activity (last push 12–24 months ago).";
    expect(
      analyzeRisk(
        riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 365, score: 60 }) }),
      ).reasons,
    ).not.toContain(lowAct);
    expect(
      analyzeRisk(
        riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 366, score: 60 }) }),
      ).reasons,
    ).toContain(lowAct);
    expect(
      analyzeRisk(
        riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 730, score: 50 }) }),
      ).reasons,
    ).toContain(lowAct);
    const at731 = analyzeRisk(
      riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 731, score: 40 }) }),
    );
    expect(at731.reasons).not.toContain(lowAct);
    expect(at731.reasons).toContain("No commits in over 24 months.");
  });

  it("pins the recent-commit boundary (180 recent, 181 not)", () => {
    expect(
      analyzeRisk(riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 180 }) })).reasons,
    ).toContain("Recent commits.");
    expect(
      analyzeRisk(
        riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 181, score: 80 }) }),
      ).reasons,
    ).not.toContain("Recent commits.");
  });
});

describe("analyzeRisk — SaaS gating and null guards", () => {
  it("does NOT flag AGPL-for-SaaS when saasUseCase is unset (defaults to false)", () => {
    const r = analyzeRisk(
      riskInput({
        license: licenseReport({
          category: "strong-copyleft",
          spdxId: "AGPL-3.0",
          detected: "AGPL-3.0",
        }),
      }),
    );
    expect(r.reasons).not.toContain("AGPL license is high risk for a SaaS/network use case.");
  });

  it("DOES flag AGPL-for-SaaS when saasUseCase is true", () => {
    const r = analyzeRisk(
      riskInput({
        license: licenseReport({
          category: "strong-copyleft",
          spdxId: "AGPL-3.0",
          detected: "AGPL-3.0",
        }),
        saasUseCase: true,
      }),
    );
    expect(r.reasons).toContain("AGPL license is high risk for a SaaS/network use case.");
  });

  it("does NOT flag AGPL-SaaS for a non-AGPL license even when saasUseCase is true (&& not ||)", () => {
    const r = analyzeRisk(
      riskInput({
        license: licenseReport({ category: "permissive", spdxId: "MIT" }),
        saasUseCase: true,
      }),
    );
    expect(r.reasons).not.toContain("AGPL license is high risk for a SaaS/network use case.");
  });

  it("does not treat a null last-push as recent", () => {
    expect(
      analyzeRisk(riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: null }) })).reasons,
    ).not.toContain("Recent commits.");
    expect(
      analyzeRisk(riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 5 }) })).reasons,
    ).toContain("Recent commits.");
  });
});

describe("analyzeRisk — positive signals appear only when warranted", () => {
  it("omits 'Permissive license.' for a non-permissive license", () => {
    expect(
      analyzeRisk(riskInput({ license: licenseReport({ category: "weak-copyleft" }) })).reasons,
    ).not.toContain("Permissive license.");
    expect(analyzeRisk(riskInput()).reasons).toContain("Permissive license.");
  });

  it("omits 'Recent commits.' once the last push is older than 180 days", () => {
    expect(
      analyzeRisk(
        riskInput({ maintenance: maintenanceReport({ lastPushDaysAgo: 200, score: 60 }) }),
      ).reasons,
    ).not.toContain("Recent commits.");
  });

  it("omits the doc/examples/test/CI positives when those signals are absent", () => {
    const r = analyzeRisk(
      riskInput({
        documentation: documentationReport({
          hasUsageSection: false,
          hasExamples: false,
          hasInstallSection: true,
        }),
        packageSignals: packageSignals({
          detectedPackageManagers: ["npm"],
          hasTests: false,
          hasCI: false,
        }),
      }),
    );
    expect(r.reasons).not.toContain("Clear README with usage.");
    expect(r.reasons).not.toContain("Examples available.");
    expect(r.reasons).not.toContain("Tests present.");
    expect(r.reasons).not.toContain("CI configured.");
  });

  it("raises none of the high/medium reasons for a healthy repo", () => {
    const r = analyzeRisk(riskInput());
    for (const absent of [
      "No license — no usage rights are granted by default.",
      "License could not be identified; legal terms are unclear.",
      "Repository is archived (read-only, unmaintained).",
      "No commits in over 24 months.",
      "No README found.",
      "No usage instructions or examples found.",
      "Weak documentation.",
      "Few stars — limited community adoption signal.",
      "Latest release is over 12 months old.",
    ]) {
      expect(r.reasons).not.toContain(absent);
    }
  });

  it("surfaces a low-signal positive only when that signal is present (kills if-true mutants)", () => {
    // SSPL: strong-copyleft but neither GPL nor AGPL → no medium/high, so the
    // verdict stays low and the low-signal array is surfaced.
    const sspl = analyzeRisk(
      riskInput({
        license: licenseReport({
          category: "strong-copyleft",
          spdxId: "SSPL-1.0",
          detected: "SSPL-1.0",
        }),
      }),
    );
    expect(sspl.level).toBe("low");
    expect(sspl.reasons).not.toContain("Permissive license.");

    const noUsage = analyzeRisk(
      riskInput({
        documentation: documentationReport({
          hasUsageSection: false,
          hasExamples: true,
          hasInstallSection: true,
        }),
      }),
    );
    expect(noUsage.level).toBe("low");
    expect(noUsage.reasons).not.toContain("Clear README with usage.");

    const noExamples = analyzeRisk(
      riskInput({
        documentation: documentationReport({ hasExamples: false, hasUsageSection: true }),
      }),
    );
    expect(noExamples.level).toBe("low");
    expect(noExamples.reasons).not.toContain("Examples available.");

    const noTests = analyzeRisk(riskInput({ packageSignals: packageSignals({ hasTests: false }) }));
    expect(noTests.level).toBe("low");
    expect(noTests.reasons).not.toContain("Tests present.");

    const noCI = analyzeRisk(riskInput({ packageSignals: packageSignals({ hasCI: false }) }));
    expect(noCI.level).toBe("low");
    expect(noCI.reasons).not.toContain("CI configured.");
  });
});
