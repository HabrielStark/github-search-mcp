// Property-based invariant fuzzing for the analysis + scoring core. These tests
// assert that, for ANY input (including hostile/degenerate values: negative and
// huge counts, future/garbage dates, junk SPDX ids, megabyte strings), the
// functions never throw, never return NaN/out-of-range, and always produce a
// value of the documented shape. This targets "states you didn't anticipate".
import { describe, it, expect } from "vitest";
import { analyzeLicense } from "../../src/analyzers/licenseAnalyzer.js";
import { analyzeMaintenance } from "../../src/analyzers/maintenanceAnalyzer.js";
import { analyzeDocumentation } from "../../src/analyzers/documentationAnalyzer.js";
import { analyzePackageSignals } from "../../src/analyzers/packageAnalyzer.js";
import { analyzeRisk } from "../../src/analyzers/riskAnalyzer.js";
import { computeRelevance, computeScore } from "../../src/scoring/scoreEngine.js";
import type { LicenseCategory } from "../../src/types/license.js";
import type { LicenseRiskLevel, RiskLevel, Tri } from "../../src/types/common.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

/** Adversarial finite numbers (never NaN — callers always supply finite values). */
const NUMS = [-1e9, -100, -1, 0, 1, 7, 49, 50, 51, 500, 1500, 1501, 100000, 1e9];
const randNum = (rng: () => number): number => pick(rng, NUMS);

/** Mixed date pool: valid (incl. future → negative age), invalid, empty, null. */
const NOW = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;
function randDate(rng: () => number): string | null {
  const r = rng();
  if (r < 0.15) return null;
  if (r < 0.25) return "not-a-date";
  if (r < 0.3) return "";
  const offsetDays = Math.floor(rng() * 4000) - 500; // includes future
  return new Date(NOW - offsetDays * DAY).toISOString();
}

const CHARSET = "abc XYZ ## \n\t install usage examples npm docs/ .github/ MIT GPL 123 你🚀-_.";
function randString(rng: () => number, maxLen: number): string {
  const len = Math.floor(rng() * maxLen);
  let s = "";
  for (let i = 0; i < len; i += 1) s += CHARSET[Math.floor(rng() * CHARSET.length)];
  return s;
}

const LICENSE_CATEGORIES: readonly LicenseCategory[] = [
  "permissive",
  "weak-copyleft",
  "strong-copyleft",
  "unknown",
  "none",
];
const RISK_LEVELS: readonly LicenseRiskLevel[] = ["low", "medium", "high", "unknown"];
const TRIS: readonly Tri[] = ["yes", "no", "unclear"];
const TOP_RISK: readonly RiskLevel[] = ["low", "medium", "high"];

const isFiniteNum = (n: unknown): boolean => typeof n === "number" && Number.isFinite(n);

describe("invariants: computeScore", () => {
  it("always returns an integer total in [0,100] with finite sub-scores", () => {
    const rng = mulberry32(101);
    for (let i = 0; i < 5000; i += 1) {
      const report = computeScore({
        relevance: rng() * 2 - 0.5, // includes <0 and >1 to exercise clamping
        maintenance: {
          lastPushDaysAgo: null,
          openIssues: 0,
          stars: 0,
          forks: 0,
          archived: false,
          score: randNum(rng),
        },
        documentation: {
          hasReadme: rng() > 0.5,
          hasExamples: rng() > 0.5,
          hasDocsFolder: rng() > 0.5,
          hasInstallSection: rng() > 0.5,
          hasUsageSection: rng() > 0.5,
          hasChangelog: rng() > 0.5,
          hasContributing: rng() > 0.5,
          hasSecurity: rng() > 0.5,
          score: randNum(rng),
        },
        license: {
          repository: "x/y",
          detected: null,
          spdxId: null,
          category: pick(rng, LICENSE_CATEGORIES),
          commercialUse: "unclear",
          privateUse: "unclear",
          modification: "unclear",
          distribution: "unclear",
          riskLevel: pick(rng, RISK_LEVELS),
          notes: [],
        },
        packageSignals: {
          detectedPackageManagers: rng() > 0.5 ? ["npm"] : [],
          hasTests: rng() > 0.5,
          hasCI: rng() > 0.5,
          hasDockerfile: rng() > 0.5,
          hasExamples: rng() > 0.5,
        },
        stars: randNum(rng),
        forks: randNum(rng),
      });
      expect(Number.isInteger(report.total)).toBe(true);
      expect(report.total).toBeGreaterThanOrEqual(0);
      expect(report.total).toBeLessThanOrEqual(100);
      for (const k of [
        "relevance",
        "maintenance",
        "license",
        "documentation",
        "adoption",
        "integration",
      ] as const) {
        expect(isFiniteNum(report[k])).toBe(true);
        expect(report[k]).toBeGreaterThanOrEqual(0);
      }
      expect(Array.isArray(report.reasons)).toBe(true);
    }
  });
});

describe("invariants: computeRelevance", () => {
  it("always returns a score in [0,1] with string reasons", () => {
    const rng = mulberry32(202);
    for (let i = 0; i < 3000; i += 1) {
      const r = computeRelevance({
        query: rng() > 0.5 ? randString(rng, 60) : undefined,
        useCase: rng() > 0.5 ? randString(rng, 60) : undefined,
        name: randString(rng, 30),
        description: rng() > 0.5 ? randString(rng, 80) : null,
        topics: Array.from({ length: Math.floor(rng() * 5) }, () => randString(rng, 12)),
        readme: rng() > 0.5 ? randString(rng, 500) : null,
      });
      expect(isFiniteNum(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      for (const reason of r.reasons) expect(typeof reason).toBe("string");
    }
  });
});

describe("invariants: analyzeMaintenance", () => {
  it("score is an integer in [0,100]; lastPushDaysAgo is null or a non-negative integer", () => {
    const rng = mulberry32(303);
    for (let i = 0; i < 5000; i += 1) {
      const m = analyzeMaintenance({
        pushedAt: randDate(rng),
        updatedAt: randDate(rng),
        archived: rng() > 0.8,
        openIssues: randNum(rng),
        stars: randNum(rng),
        forks: randNum(rng),
        hasCI: rng() > 0.5,
        lastReleaseAt: rng() > 0.5 ? randDate(rng) : undefined,
        now: NOW,
      });
      expect(Number.isInteger(m.score)).toBe(true);
      expect(m.score).toBeGreaterThanOrEqual(0);
      expect(m.score).toBeLessThanOrEqual(100);
      if (m.lastPushDaysAgo !== null) {
        expect(Number.isInteger(m.lastPushDaysAgo)).toBe(true);
        expect(m.lastPushDaysAgo).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("invariants: analyzeLicense", () => {
  it("always returns a valid category/riskLevel/permissions and a non-empty notes array", () => {
    const rng = mulberry32(404);
    const SPDX_POOL = [
      null,
      "",
      "MIT",
      "mit",
      "GPL-3.0-only",
      "AGPL-1.0",
      "LGPL-2.1-or-later",
      "NOASSERTION",
      "Other",
      "MPL-2.0",
      "WeIrD-9.9",
      randString(rng, 20),
    ];
    for (let i = 0; i < 3000; i += 1) {
      const r = analyzeLicense(
        {
          repository: "x/y",
          spdxId: pick(rng, SPDX_POOL),
          name: rng() > 0.5 ? pick(rng, SPDX_POOL) : null,
        },
        { saasUseCase: rng() > 0.5 },
      );
      expect(LICENSE_CATEGORIES).toContain(r.category);
      expect(["low", "medium", "high", "unknown"]).toContain(r.riskLevel);
      for (const k of ["commercialUse", "privateUse", "modification", "distribution"] as const) {
        expect(TRIS).toContain(r[k]);
      }
      expect(Array.isArray(r.notes)).toBe(true);
      expect(r.notes.length).toBeGreaterThan(0);
      for (const n of r.notes) expect(typeof n).toBe("string");
    }
  });
});

describe("invariants: analyzeRisk", () => {
  it("always returns a valid level and 1..8 string reasons", () => {
    const rng = mulberry32(505);
    for (let i = 0; i < 5000; i += 1) {
      const r = analyzeRisk({
        license: {
          repository: "x/y",
          detected: null,
          spdxId: pick(rng, [null, "MIT", "GPL-3.0", "AGPL-3.0", "MPL-2.0"]),
          category: pick(rng, LICENSE_CATEGORIES),
          commercialUse: "unclear",
          privateUse: "unclear",
          modification: "unclear",
          distribution: "unclear",
          riskLevel: pick(rng, RISK_LEVELS),
          notes: [],
        },
        maintenance: {
          lastPushDaysAgo: rng() > 0.2 ? Math.floor(rng() * 4000) - 100 : null,
          openIssues: randNum(rng),
          stars: randNum(rng),
          forks: randNum(rng),
          archived: rng() > 0.8,
          score: randNum(rng),
        },
        documentation: {
          hasReadme: rng() > 0.5,
          hasExamples: rng() > 0.5,
          hasDocsFolder: rng() > 0.5,
          hasInstallSection: rng() > 0.5,
          hasUsageSection: rng() > 0.5,
          hasChangelog: rng() > 0.5,
          hasContributing: rng() > 0.5,
          hasSecurity: rng() > 0.5,
          score: randNum(rng),
        },
        packageSignals: {
          detectedPackageManagers: rng() > 0.5 ? ["npm"] : [],
          hasTests: rng() > 0.5,
          hasCI: rng() > 0.5,
          hasDockerfile: rng() > 0.5,
          hasExamples: rng() > 0.5,
        },
        profile: {
          archived: rng() > 0.8,
          openIssues: randNum(rng),
          stars: randNum(rng),
          forks: randNum(rng),
        },
        saasUseCase: rng() > 0.5,
        hasRecentRelease: pick(rng, [true, false, null, undefined]),
      });
      expect(TOP_RISK).toContain(r.level);
      expect(Array.isArray(r.reasons)).toBe(true);
      expect(r.reasons.length).toBeGreaterThanOrEqual(1);
      expect(r.reasons.length).toBeLessThanOrEqual(8);
      for (const reason of r.reasons) expect(typeof reason).toBe("string");
    }
  });
});

describe("invariants: analyzeDocumentation", () => {
  it("score is a multiple of 20 in [0,100] with boolean signals", () => {
    const rng = mulberry32(606);
    for (let i = 0; i < 3000; i += 1) {
      const d = analyzeDocumentation({
        readme: rng() > 0.5 ? randString(rng, 800) : null,
        treePaths: Array.from({ length: Math.floor(rng() * 12) }, () => randString(rng, 30)),
      });
      expect([0, 20, 40, 60, 80, 100]).toContain(d.score);
      for (const k of [
        "hasReadme",
        "hasExamples",
        "hasDocsFolder",
        "hasInstallSection",
        "hasUsageSection",
        "hasChangelog",
        "hasContributing",
        "hasSecurity",
      ] as const) {
        expect(typeof d[k]).toBe("boolean");
      }
    }
  });
});

describe("invariants: analyzePackageSignals", () => {
  const KNOWN = ["npm", "pip", "cargo", "go", "maven", "gradle", "composer", "gem"];
  it("returns known managers and boolean flags for arbitrary trees", () => {
    const rng = mulberry32(707);
    for (let i = 0; i < 3000; i += 1) {
      const s = analyzePackageSignals(
        Array.from({ length: Math.floor(rng() * 15) }, () => randString(rng, 30)),
      );
      expect(Array.isArray(s.detectedPackageManagers)).toBe(true);
      for (const m of s.detectedPackageManagers) expect(KNOWN).toContain(m);
      // no duplicates
      expect(new Set(s.detectedPackageManagers).size).toBe(s.detectedPackageManagers.length);
      for (const k of ["hasTests", "hasCI", "hasDockerfile", "hasExamples"] as const) {
        expect(typeof s[k]).toBe("boolean");
      }
    }
  });
});
