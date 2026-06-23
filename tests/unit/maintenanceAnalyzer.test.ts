import { describe, it, expect } from "vitest";
import { analyzeMaintenance } from "../../src/analyzers/maintenanceAnalyzer.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 0, 1);
const daysAgo = (d: number): string => new Date(NOW - d * DAY).toISOString();

describe("analyzeMaintenance", () => {
  it("scores a recently-active, CI-enabled repo highly", () => {
    const r = analyzeMaintenance({
      pushedAt: daysAgo(10),
      updatedAt: daysAgo(5),
      archived: false,
      openIssues: 10,
      stars: 5000,
      forks: 800,
      hasCI: true,
      lastReleaseAt: daysAgo(30),
      now: NOW,
    });
    expect(r.lastPushDaysAgo).toBe(5);
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it("caps archived repos at a low score", () => {
    const r = analyzeMaintenance({
      pushedAt: daysAgo(10),
      updatedAt: daysAgo(10),
      archived: true,
      openIssues: 0,
      stars: 100,
      forks: 10,
      hasCI: true,
      now: NOW,
    });
    expect(r.score).toBeLessThanOrEqual(10);
  });

  it("scores stale repos low", () => {
    const r = analyzeMaintenance({
      pushedAt: daysAgo(900),
      updatedAt: daysAgo(900),
      archived: false,
      openIssues: 300,
      stars: 50,
      forks: 5,
      hasCI: false,
      lastReleaseAt: null,
      now: NOW,
    });
    expect(r.lastPushDaysAgo).toBe(900);
    expect(r.score).toBeLessThan(40);
  });

  it("handles missing dates", () => {
    const r = analyzeMaintenance({
      pushedAt: null,
      updatedAt: null,
      archived: false,
      openIssues: 0,
      stars: 0,
      forks: 0,
      hasCI: false,
      now: NOW,
    });
    expect(r.lastPushDaysAgo).toBeNull();
  });

  it("reports perfect signals as a score of exactly 100", () => {
    expect(
      analyzeMaintenance({
        pushedAt: daysAgo(10),
        updatedAt: daysAgo(10),
        archived: false,
        openIssues: 0,
        stars: 1000,
        forks: 100,
        hasCI: true,
        lastReleaseAt: daysAgo(10),
        now: NOW,
      }).score,
    ).toBe(100);
  });

  it("reports mid-range signals as a score of exactly 63", () => {
    expect(
      analyzeMaintenance({
        pushedAt: daysAgo(100),
        updatedAt: daysAgo(100),
        archived: false,
        openIssues: 0,
        stars: 0,
        forks: 0,
        hasCI: false,
        lastReleaseAt: null,
        now: NOW,
      }).score,
    ).toBe(63);
  });
});

describe("analyzeMaintenance — recency factor (other factors held constant)", () => {
  // hasCI=false, release neutral (undefined → 0.5), issues clean (openIssues 0,
  // stars 100) → score = 60*recency + 20, an integer at every boundary.
  const scoreForPushDays = (days: number): number =>
    analyzeMaintenance({
      pushedAt: daysAgo(days),
      updatedAt: daysAgo(days),
      archived: false,
      openIssues: 0,
      stars: 100,
      forks: 0,
      hasCI: false,
      now: NOW,
    }).score;

  it.each([
    [30, 80],
    [31, 74],
    [90, 74],
    [91, 68],
    [180, 68],
    [181, 56],
    [365, 56],
    [366, 41],
    [730, 41],
    [731, 26],
  ])("push %i days ago → score %i", (days, expected) => {
    expect(scoreForPushDays(days)).toBe(expected);
  });

  it("falls back to the null-recency factor (0.3) when dates are missing or unparseable", () => {
    expect(
      analyzeMaintenance({
        pushedAt: null,
        updatedAt: null,
        archived: false,
        openIssues: 0,
        stars: 100,
        forks: 0,
        hasCI: false,
        now: NOW,
      }).score,
    ).toBe(38); // 60*0.3 + 20
    expect(
      analyzeMaintenance({
        pushedAt: "not-a-date",
        updatedAt: null,
        archived: false,
        openIssues: 0,
        stars: 100,
        forks: 0,
        hasCI: false,
        now: NOW,
      }).lastPushDaysAgo,
    ).toBeNull();
  });
});

describe("analyzeMaintenance — release factor (other factors held constant)", () => {
  // recency=1 (0 days), ci=false, issues clean → score = 75 + 10*release.
  const scoreForRelease = (lastReleaseAt: string | null | undefined): number =>
    analyzeMaintenance({
      pushedAt: daysAgo(0),
      updatedAt: daysAgo(0),
      archived: false,
      openIssues: 0,
      stars: 100,
      forks: 0,
      hasCI: false,
      lastReleaseAt,
      now: NOW,
    }).score;

  it.each([
    [180, 85], // <=180 → 1.0
    [181, 82], // <=365 → 0.7
    [365, 82],
    [366, 79], // <=730 → 0.4
    [730, 79],
    [731, 77], // >730 → 0.2
  ])("release %i days ago → score %i", (days, expected) => {
    expect(scoreForRelease(daysAgo(days))).toBe(expected);
  });

  it("distinguishes undefined (not queried → 0.5 → 80) from null (no release → 0.4 → 79)", () => {
    expect(scoreForRelease(undefined)).toBe(80);
    expect(scoreForRelease(null)).toBe(79);
  });
});

describe("analyzeMaintenance — open-issues factor (other factors held constant)", () => {
  // recency=1, ci=false, release neutral → score = 65 + 15*issues.
  const scoreForIssues = (openIssues: number, stars: number, forks: number): number =>
    analyzeMaintenance({
      pushedAt: daysAgo(0),
      updatedAt: daysAgo(0),
      archived: false,
      openIssues,
      stars,
      forks,
      hasCI: false,
      now: NOW,
    }).score;

  it("pins each issue-ratio band edge", () => {
    expect(scoreForIssues(4, 96, 0)).toBe(80); // ratio 0.04 < 0.05 → 1.0
    expect(scoreForIssues(5, 95, 0)).toBe(77); // ratio 0.05 (not < 0.05) → 0.8
    expect(scoreForIssues(15, 85, 0)).toBe(73); // ratio 0.15 → 0.5
    expect(scoreForIssues(30, 70, 0)).toBe(70); // ratio 0.30 → 0.3
  });

  it("uses stars+forks (not minus) for popularity", () => {
    expect(scoreForIssues(20, 100, 100)).toBe(77); // pop 200 → ratio 0.0909 → 0.8
  });

  it("adds open issues to the denominator (not subtracts)", () => {
    expect(scoreForIssues(5, 100, 0)).toBe(80); // 5/105 = 0.0476 < 0.05 → 1.0
  });

  it("handles zero popularity via the open-issue count split at the exact boundary", () => {
    expect(scoreForIssues(500, 0, 0)).toBe(76); // 500 not > 500 → 0.7
    expect(scoreForIssues(501, 0, 0)).toBe(71); // > 500 → 0.4
  });

  it("caps archived repositories at 10 regardless of other signals", () => {
    expect(
      analyzeMaintenance({
        pushedAt: daysAgo(0),
        updatedAt: daysAgo(0),
        archived: true,
        openIssues: 0,
        stars: 100,
        forks: 0,
        hasCI: true,
        now: NOW,
      }).score,
    ).toBeLessThanOrEqual(10);
  });
});

describe("analyzeMaintenance — lastPushDaysAgo is the min of push/update dates", () => {
  const lp = (pushedAt: string | null, updatedAt: string | null): number | null =>
    analyzeMaintenance({
      pushedAt,
      updatedAt,
      archived: false,
      openIssues: 0,
      stars: 0,
      forks: 0,
      hasCI: false,
      now: NOW,
    }).lastPushDaysAgo;

  it("uses whichever date is present, and the smaller when both are", () => {
    expect(lp(daysAgo(10), null)).toBe(10);
    expect(lp(null, daysAgo(20))).toBe(20);
    expect(lp(daysAgo(10), daysAgo(30))).toBe(10);
    expect(lp(daysAgo(30), daysAgo(10))).toBe(10);
    expect(lp(null, null)).toBeNull();
  });
});
