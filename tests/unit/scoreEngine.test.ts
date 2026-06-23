import { describe, it, expect } from "vitest";
import {
  computeRelevance,
  computeScore,
  integrationDifficulty,
  licenseRiskFactor,
  type ScoreComponents,
} from "../../src/scoring/scoreEngine.js";
import { DEFAULT_WEIGHTS } from "../../src/scoring/scoreWeights.js";
import type { LicenseReport } from "../../src/types/license.js";
import type {
  DocumentationReport,
  MaintenanceReport,
  PackageSignals,
} from "../../src/types/analysis.js";

const permissive: LicenseReport = {
  repository: "o/r",
  detected: "MIT",
  spdxId: "MIT",
  category: "permissive",
  commercialUse: "yes",
  privateUse: "yes",
  modification: "yes",
  distribution: "yes",
  riskLevel: "low",
  notes: [],
};
const richDocs: DocumentationReport = {
  hasReadme: true,
  hasExamples: true,
  hasDocsFolder: true,
  hasInstallSection: true,
  hasUsageSection: true,
  hasChangelog: true,
  hasContributing: true,
  hasSecurity: true,
  score: 100,
};
const healthyMaint: MaintenanceReport = {
  lastPushDaysAgo: 10,
  openIssues: 5,
  stars: 5000,
  forks: 500,
  archived: false,
  score: 90,
};
const richPkg: PackageSignals = {
  detectedPackageManagers: ["npm"],
  hasTests: true,
  hasCI: true,
  hasDockerfile: true,
  hasExamples: true,
};

// Neutral fixtures for the exact-value cases below: a minimal-but-present
// repository (README only, no extra signals) so each test can dial in exactly
// the inputs whose effect on the score it pins.
function licenseReport(o: Partial<LicenseReport> = {}): LicenseReport {
  return { ...permissive, ...o };
}
function documentationReport(o: Partial<DocumentationReport> = {}): DocumentationReport {
  return {
    hasReadme: true,
    hasExamples: false,
    hasDocsFolder: false,
    hasInstallSection: false,
    hasUsageSection: false,
    hasChangelog: false,
    hasContributing: false,
    hasSecurity: false,
    score: 100,
    ...o,
  };
}
function maintenanceReport(o: Partial<MaintenanceReport> = {}): MaintenanceReport {
  return {
    lastPushDaysAgo: 0,
    openIssues: 0,
    stars: 0,
    forks: 0,
    archived: false,
    score: 100,
    ...o,
  };
}
function packageSignals(o: Partial<PackageSignals> = {}): PackageSignals {
  return {
    detectedPackageManagers: [],
    hasTests: false,
    hasCI: false,
    hasDockerfile: false,
    hasExamples: false,
    ...o,
  };
}
function scoreComponents(o: Partial<ScoreComponents> = {}): ScoreComponents {
  return {
    relevance: 1,
    maintenance: maintenanceReport(),
    documentation: documentationReport(),
    license: licenseReport(),
    packageSignals: packageSignals(),
    stars: 0,
    forks: 0,
    ...o,
  };
}

describe("computeRelevance", () => {
  it("scores keyword matches in name/description highly", () => {
    const r = computeRelevance({
      query: "redis cache",
      name: "redis",
      description: "an in-memory cache",
      topics: [],
      readme: null,
    });
    expect(r.score).toBeGreaterThan(0.7);
  });

  it("returns a neutral score without query keywords", () => {
    const r = computeRelevance({ name: "x", description: null, topics: [] });
    expect(r.score).toBe(0.6);
  });

  it("uses the exact neutral note when there are no keywords", () => {
    const r = computeRelevance({ name: "tool", description: null, topics: [] });
    expect(r.score).toBe(0.6);
    expect(r.reasons).toEqual(["No query keywords provided; using neutral relevance."]);
  });

  it("weights name > topic > description > readme and matches substrings", () => {
    expect(
      computeRelevance({ query: "vector", name: "myvectordb", description: null, topics: [] })
        .score,
    ).toBe(1);
    expect(
      computeRelevance({
        query: "search",
        name: "tool",
        description: null,
        topics: ["search-engine"],
      }).score,
    ).toBe(0.9);
    expect(
      computeRelevance({
        query: "billing",
        name: "tool",
        description: "a billing system",
        topics: [],
      }).score,
    ).toBe(0.8);
    expect(
      computeRelevance({
        query: "queue",
        name: "tool",
        description: null,
        topics: [],
        readme: "a message queue",
      }).score,
    ).toBe(0.5);
  });

  it("lowercases description, topics and readme before matching", () => {
    expect(
      computeRelevance({
        query: "billing",
        name: "tool",
        description: "A BILLING SYSTEM",
        topics: [],
      }).score,
    ).toBe(0.8);
    expect(
      computeRelevance({
        query: "search",
        name: "tool",
        description: null,
        topics: ["SEARCH-ENGINE"],
      }).score,
    ).toBe(0.9);
    expect(
      computeRelevance({
        query: "queue",
        name: "tool",
        description: null,
        topics: [],
        readme: "A MESSAGE QUEUE",
      }).score,
    ).toBe(0.5);
  });

  it("yields an exact keyword score across fields", () => {
    const r = computeRelevance({
      query: "redis cache",
      name: "redis",
      description: "in-memory cache",
      topics: [],
      readme: null,
    });
    expect(r.score).toBe(0.9); // redis (name = 1) + cache (desc = 0.8) over 2 keywords
  });

  it("lists matched and unmatched keywords with exact phrasing", () => {
    const r = computeRelevance({
      query: "vector missingkw",
      name: "vectordb",
      description: null,
      topics: [],
    });
    expect(r.reasons).toContain("Matched keywords: vector.");
    expect(r.reasons).toContain("Unmatched keywords: missingkw.");
  });

  it("emits an exact reasons array with no stray elements", () => {
    const r = computeRelevance({
      query: "alpha beta",
      name: "alpha",
      description: "beta things",
      topics: [],
    });
    expect(r.reasons).toEqual(["Matched keywords: alpha, beta."]);
  });

  it("emits only an Unmatched line when nothing matches", () => {
    const r = computeRelevance({
      query: "zzzznomatch",
      name: "tool",
      description: null,
      topics: [],
    });
    expect(r.reasons.some((x) => x.startsWith("Matched keywords:"))).toBe(false);
    expect(r.reasons).toContain("Unmatched keywords: zzzznomatch.");
  });

  it("emits only a Matched line when everything matches", () => {
    const r = computeRelevance({ query: "alpha", name: "alpha", description: null, topics: [] });
    expect(r.reasons).toContain("Matched keywords: alpha.");
    expect(r.reasons.some((x) => x.startsWith("Unmatched keywords:"))).toBe(false);
  });

  it("limits the matched-keyword list to eight entries", () => {
    const kws = ["aaa", "bbb", "ccc", "ddd", "eee", "fff", "ggg", "hhh", "iii", "jjj"];
    const r = computeRelevance({
      query: kws.join(" "),
      name: kws.join("-"),
      description: null,
      topics: [],
    });
    const matchedLine = r.reasons.find((x) => x.startsWith("Matched keywords:")) as string;
    expect(matchedLine.split(", ").length).toBe(8);
  });

  it("caps the unmatched list at eight and joins with ', '", () => {
    const kws = ["q1q", "q2q", "q3q", "q4q", "q5q", "q6q", "q7q", "q8q", "q9q", "qaq"];
    const r = computeRelevance({
      query: kws.join(" "),
      name: "nomatchhere",
      description: null,
      topics: [],
    });
    const line = r.reasons.find((x) => x.startsWith("Unmatched keywords:")) as string;
    expect(line.replace("Unmatched keywords: ", "").replace(/\.$/, "").split(", ").length).toBe(8);
  });
});

describe("computeScore", () => {
  it("produces a high total for a strong permissive repo", () => {
    const score = computeScore({
      relevance: 0.9,
      maintenance: healthyMaint,
      documentation: richDocs,
      license: permissive,
      packageSignals: richPkg,
      stars: 5000,
      forks: 500,
    });
    expect(score.total).toBeGreaterThan(75);
    expect(score.total).toBeLessThanOrEqual(100);
  });

  it("never exceeds 100 or drops below 0", () => {
    const score = computeScore({
      relevance: 1,
      maintenance: { ...healthyMaint, score: 100 },
      documentation: { ...richDocs, score: 100 },
      license: permissive,
      packageSignals: richPkg,
      stars: 1_000_000,
      forks: 1_000_000,
    });
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.total).toBeGreaterThanOrEqual(0);
  });

  it("raises the license sub-score when the license weight increases", () => {
    const baseline = computeScore({
      relevance: 0.5,
      maintenance: healthyMaint,
      documentation: richDocs,
      license: permissive,
      packageSignals: richPkg,
      stars: 100,
      forks: 10,
      weights: DEFAULT_WEIGHTS,
    });
    const heavyLicense = computeScore({
      relevance: 0.5,
      maintenance: healthyMaint,
      documentation: richDocs,
      license: permissive,
      packageSignals: richPkg,
      stars: 100,
      forks: 10,
      weights: { ...DEFAULT_WEIGHTS, license: 40 },
    });
    expect(heavyLicense.license).toBeGreaterThan(baseline.license);
  });

  it("penalizes high-risk licenses", () => {
    const low = computeScore({
      relevance: 0.5,
      maintenance: healthyMaint,
      documentation: richDocs,
      license: permissive,
      packageSignals: richPkg,
      stars: 100,
      forks: 10,
    });
    const high = computeScore({
      relevance: 0.5,
      maintenance: healthyMaint,
      documentation: richDocs,
      license: { ...permissive, riskLevel: "high" },
      packageSignals: richPkg,
      stars: 100,
      forks: 10,
    });
    expect(high.license).toBeLessThan(low.license);
  });

  it("emits the exact six reason strings for a neutral baseline", () => {
    const r = computeScore(scoreComponents());
    expect(r.reasons).toEqual([
      "Relevance 30/30",
      "Maintenance 20/20",
      "License 15/15 (low risk)",
      "Documentation 15/15",
      "Adoption 0/10",
      "Integration 0/10",
    ]);
    expect(r.total).toBe(80);
  });

  it("reflects the license risk level inside the license reason", () => {
    expect(
      computeScore(scoreComponents({ license: licenseReport({ riskLevel: "high" }) })).reasons[2],
    ).toBe("License 3/15 (high risk)");
  });

  it.each([
    [0, 0, false, 0], // no signal
    [0, 0, true, 1.5], // ecosystem only (0.15)
    [9999, 0, false, 5.5], // stars cap → 0.55
    [9999, 0, true, 7], // stars + ecosystem → 0.70
    [0, 9999, false, 3], // forks cap → 0.30
  ])("adoption sub-score for stars=%i forks=%i pkg=%s → %d", (stars, forks, hasPkg, expected) => {
    const r = computeScore(
      scoreComponents({
        stars,
        forks,
        packageSignals: packageSignals({ detectedPackageManagers: hasPkg ? ["npm"] : [] }),
      }),
    );
    expect(r.adoption).toBe(expected);
  });

  it("pins mid-range adoption (log10 divisors and 0.55/0.30 coefficients)", () => {
    expect(computeScore(scoreComponents({ stars: 999 })).adoption).toBe(4.1); // 0.55*0.75*10
    expect(computeScore(scoreComponents({ forks: 999 })).adoption).toBe(2.6); // 0.30*0.857*10
  });

  it("computes integration as a fifth per detected signal", () => {
    const full = computeScore(
      scoreComponents({
        documentation: documentationReport({ hasInstallSection: true, hasExamples: true }),
        packageSignals: packageSignals({
          detectedPackageManagers: ["npm"],
          hasTests: true,
          hasCI: true,
          hasDockerfile: true,
          hasExamples: true,
        }),
      }),
    );
    expect(full.integration).toBe(10); // 5/5 signals
    expect(computeScore(scoreComponents()).integration).toBe(0);
  });

  it("counts the examples integration point from pkg.hasExamples alone (|| not &&)", () => {
    const r = computeScore(
      scoreComponents({ packageSignals: packageSignals({ hasExamples: true }) }),
    );
    expect(r.integration).toBe(2); // exactly one of five signals → 0.2 * 10
  });

  it("counts the tests/CI integration point from either signal alone (|| not &&)", () => {
    expect(
      computeScore(scoreComponents({ packageSignals: packageSignals({ hasTests: true }) }))
        .integration,
    ).toBe(2); // hasTests alone → one of five signals
    expect(
      computeScore(scoreComponents({ packageSignals: packageSignals({ hasCI: true }) }))
        .integration,
    ).toBe(2); // hasCI alone → one of five signals
  });

  it("produces exact sub-scores and total for mixed inputs", () => {
    const documentation: DocumentationReport = { ...richDocs, score: 60 };
    const maintenance: MaintenanceReport = {
      lastPushDaysAgo: 10,
      openIssues: 0,
      stars: 9999,
      forks: 0,
      archived: false,
      score: 80,
    };
    const score = computeScore({
      relevance: 0.5,
      maintenance,
      documentation,
      license: permissive,
      packageSignals: richPkg,
      stars: 9999,
      forks: 0,
    });
    expect(score.relevance).toBe(15); // 0.5 * 30
    expect(score.maintenance).toBe(16); // 0.8 * 20
    expect(score.license).toBe(15); // 1 * 15
    expect(score.documentation).toBe(9); // 0.6 * 15
    expect(score.adoption).toBe(7); // (0.55*1 + 0.3*0 + 0.15) * 10
    expect(score.integration).toBe(10); // 5/5 * 10
    expect(score.total).toBe(72);
  });
});

describe("licenseRiskFactor", () => {
  it("maps each risk level exactly", () => {
    expect(licenseRiskFactor("low")).toBe(1);
    expect(licenseRiskFactor("medium")).toBe(0.6);
    expect(licenseRiskFactor("high")).toBe(0.2);
    expect(licenseRiskFactor("unknown")).toBe(0.35);
  });
});

describe("integrationDifficulty", () => {
  it("is easy with full signals", () => {
    expect(integrationDifficulty(richPkg, richDocs)).toBe("easy");
  });
  it("is hard with no signals", () => {
    expect(integrationDifficulty(packageSignals(), documentationReport({ score: 20 }))).toBe(
      "hard",
    );
  });
  it("maps the factor bands exactly (3 pts → easy, 2 → medium, 1 → hard)", () => {
    expect(
      integrationDifficulty(
        packageSignals({ detectedPackageManagers: ["npm"], hasDockerfile: true }),
        documentationReport({ hasInstallSection: true }),
      ),
    ).toBe("easy");
    expect(
      integrationDifficulty(
        packageSignals({ detectedPackageManagers: ["npm"], hasDockerfile: true }),
        documentationReport(),
      ),
    ).toBe("medium");
    expect(
      integrationDifficulty(packageSignals({ hasDockerfile: true }), documentationReport()),
    ).toBe("hard");
  });
});

describe("DEFAULT_WEIGHTS", () => {
  it("are exact and sum to 100", () => {
    expect(DEFAULT_WEIGHTS).toEqual({
      relevance: 30,
      maintenance: 20,
      license: 15,
      documentation: 15,
      adoption: 10,
      integration: 10,
    });
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});
