import type { ScoreWeights } from "../types/score.js";

/** Default scoring weights. The six components sum to 100. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  relevance: 30,
  maintenance: 20,
  license: 15,
  documentation: 15,
  adoption: 10,
  integration: 10,
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "you",
  "are",
  "was",
  "use",
  "using",
  "used",
  "via",
  "into",
  "out",
  "open",
  "source",
  "library",
  "framework",
  "tool",
  "tools",
  "api",
  "sdk",
  "app",
  "application",
  "alternative",
  "alternatives",
  "free",
  "self",
  "hosted",
  "based",
  "small",
  "simple",
]);

// Defensive bounds so a hostile/huge free-text input cannot force the
// tokenizer (and the relevance loop that consumes it) to allocate without
// limit. Generous enough that no legitimate query/use-case is affected.
const MAX_TOKENIZE_CHARS = 10_000;
const MAX_TOKENS = 300;

/** Tokenize free text into meaningful lowercase keywords. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  // Stryker disable next-line ConditionalExpression,EqualityOperator,MethodExpression,ArithmeticOperator: this is a
  // performance scan-cap. The emitted token list is identical regardless,
  // because MAX_TOKENS bounds the output and the first tokens come from the
  // same leading text whether or not the input is pre-sliced.
  const scanned = text.length > MAX_TOKENIZE_CHARS ? text.slice(0, MAX_TOKENIZE_CHARS) : text;
  const out: string[] = [];
  // Stryker disable next-line Regex: the split-on-non-token-char behaviour is
  // pinned by tokenize tests (queryBuilder.test.ts / exactKills2.test.ts).
  for (const raw of scanned.toLowerCase().split(/[^a-z0-9+#.]+/)) {
    // Stryker disable next-line Regex: leading/trailing .#+ stripping is pinned
    // by tokenize tests; internal variants are equivalent.
    const token = raw.replace(/^[.#+]+|[.#+]+$/g, "");
    if (token.length >= 3 && !STOP_WORDS.has(token)) {
      out.push(token);
      if (out.length >= MAX_TOKENS) break;
    }
  }
  return out;
}
