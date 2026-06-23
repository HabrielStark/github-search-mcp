import type { MaintenanceReport } from "../types/analysis.js";

export interface MaintenanceAnalyzerInput {
  pushedAt: string | null;
  updatedAt: string | null;
  archived: boolean;
  openIssues: number;
  stars: number;
  forks: number;
  hasCI: boolean;
  lastReleaseAt?: string | null;
  now?: number;
}

const DAY_MS = 86_400_000;

function daysSince(iso: string | null, now: number): number | null {
  // Stryker disable next-line ConditionalExpression: type guard for the null
  // case; Date.parse(null/"") is NaN and the isNaN check below returns null too,
  // so removing this guard is behaviourally equivalent.
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

function recencyFactor(days: number | null): number {
  if (days === null) return 0.3;
  if (days <= 30) return 1;
  if (days <= 90) return 0.9;
  if (days <= 180) return 0.8;
  if (days <= 365) return 0.6;
  if (days <= 730) return 0.35;
  return 0.1;
}

function issuesFactor(openIssues: number, stars: number, forks: number): number {
  const popularity = stars + forks;
  if (popularity <= 0) return openIssues > 500 ? 0.4 : 0.7;
  const ratio = openIssues / (popularity + openIssues);
  if (ratio < 0.05) return 1;
  if (ratio < 0.15) return 0.8;
  if (ratio < 0.3) return 0.5;
  return 0.3;
}

function releaseFactor(lastReleaseAt: string | null | undefined, now: number): number {
  if (lastReleaseAt === undefined) return 0.5; // not queried → neutral
  const days = daysSince(lastReleaseAt ?? null, now);
  if (days === null) return 0.4; // no releases — many healthy projects don't tag releases
  if (days <= 180) return 1;
  if (days <= 365) return 0.7;
  if (days <= 730) return 0.4;
  return 0.2;
}

/** Score project maintenance and activity on a 0..100 scale. */
export function analyzeMaintenance(input: MaintenanceAnalyzerInput): MaintenanceReport {
  const now = input.now ?? Date.now();
  const pushDays = daysSince(input.pushedAt, now);
  const updateDays = daysSince(input.updatedAt, now);
  const lastPushDaysAgo =
    pushDays !== null && updateDays !== null
      ? Math.min(pushDays, updateDays)
      : (pushDays ?? updateDays);

  const recency = recencyFactor(lastPushDaysAgo);
  const ci = input.hasCI ? 1 : 0;
  const release = releaseFactor(input.lastReleaseAt, now);
  const issues = issuesFactor(input.openIssues, input.stars, input.forks);

  let score = 100 * (0.6 * recency + 0.15 * ci + 0.1 * release + 0.15 * issues);
  if (input.archived) score = Math.min(score, 10);

  return {
    lastPushDaysAgo,
    openIssues: input.openIssues,
    stars: input.stars,
    forks: input.forks,
    archived: input.archived,
    score: Math.round(Math.min(100, Math.max(0, score))),
  };
}
