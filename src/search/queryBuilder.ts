import { tokenize } from "../scoring/scoreWeights.js";

export interface SearchFilters {
  query: string;
  language?: string;
  minStars?: number;
  license?: string;
  topic?: string;
}

function qualifierValue(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/** Build a GitHub repository-search query string from structured filters. */
export function buildSearchQuery(filters: SearchFilters): string {
  const parts: string[] = [];
  const base = filters.query.trim();
  if (base) parts.push(base);
  if (filters.language && filters.language.trim()) {
    parts.push(`language:${qualifierValue(filters.language.trim())}`);
  }
  // minStars defaults to 0 (absent); only a positive value adds the qualifier.
  // (A single coalesced compare keeps every mutant killable.)
  const minStars = filters.minStars ?? 0;
  if (minStars > 0) {
    parts.push(`stars:>=${Math.floor(minStars)}`);
  }
  if (filters.license && filters.license.trim()) {
    parts.push(`license:${filters.license.trim().toLowerCase()}`);
  }
  if (filters.topic && filters.topic.trim()) {
    parts.push(`topic:${filters.topic.trim().toLowerCase()}`);
  }
  // parts are individually clean (base is trimmed and only pushed when truthy;
  // qualifiers carry no padding), so a join alone yields a clean string.
  return parts.join(" ");
}

export interface AlternativeQueryInput {
  target: string;
  useCase?: string;
  language?: string;
  mustBeSelfHosted?: boolean;
}

/**
 * Generate several complementary GitHub search queries for finding open-source
 * alternatives to a target product or service.
 */
export function generateAlternativeQueries(input: AlternativeQueryInput): string[] {
  const target = input.target.trim();
  const useCaseKeywords = tokenize(input.useCase).slice(0, 5).join(" ");

  const phrases: string[] = [];
  if (target) {
    phrases.push(`${target} alternative`);
    phrases.push(`${target} open source alternative`);
    phrases.push(`open source ${target}`);
  }
  if (useCaseKeywords) {
    phrases.push(`${useCaseKeywords} open source`);
    if (input.mustBeSelfHosted) phrases.push(`self hosted ${useCaseKeywords}`);
  }
  if (target && input.mustBeSelfHosted) {
    phrases.push(`self hosted ${target}`);
  }
  // Stryker disable next-line all: defensive fallback, provably unreachable —
  // a truthy `useCaseKeywords` has already pushed a phrase above, so
  // `phrases.length === 0 && useCaseKeywords` can never both hold. Kept for safety.
  if (phrases.length === 0 && useCaseKeywords) phrases.push(useCaseKeywords);

  const qualifiers: string[] = [];
  if (input.language && input.language.trim()) {
    qualifiers.push(`language:${qualifierValue(input.language.trim())}`);
  }
  if (input.mustBeSelfHosted) qualifiers.push("topic:self-hosted");

  const queries = phrases.map((phrase) => [phrase, ...qualifiers].join(" "));
  const unique = Array.from(new Set(queries));
  // Stryker disable next-line MethodExpression: at most 6 phrases are ever
  // generated, so slicing to 6 is equivalent to returning `unique` as-is.
  return unique.slice(0, 6);
}
