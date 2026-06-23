import { z } from "zod";

/**
 * Upper bounds on free-text tool inputs. These prevent resource exhaustion (a
 * client sending megabytes of text into tokenization / query construction) and
 * malformed upstream requests. Bounds are deliberately generous
 * so no legitimate input is ever rejected.
 */
export const INPUT_LIMITS = {
  repository: 200,
  branch: 255,
  path: 1024,
  query: 256, // GitHub's documented search-query length limit
  qualifier: 100, // language / license / topic / framework
  target: 200,
  useCase: 500,
  stack: 200,
  question: 1000,
} as const;

/** Bounded `owner/repo` (also accepts a GitHub URL / git@ form — see parseRepository). */
export const repositorySchema = z
  .string()
  .min(1)
  .max(INPUT_LIMITS.repository)
  .describe('Repository in "owner/repo" format.');

/** Bounded optional branch/tag name. */
export const branchSchema = z
  .string()
  .min(1)
  .max(INPUT_LIMITS.branch)
  .optional()
  .describe("Branch or tag. Defaults to the default branch.");

/** Bounded repository file path. */
export const pathSchema = z
  .string()
  .min(1)
  .max(INPUT_LIMITS.path)
  .describe("File path within the repository.");
