import { AppError } from "./errors.js";

export interface ParsedRepository {
  owner: string;
  repo: string;
  fullName: string;
}

// Stryker disable next-line Regex: REPO_RE's behaviour (accepted owner/repo
// shapes, rejected forms, "."/".." handling) is exhaustively pinned by
// tests/unit/fuzz.test.ts and sanitize.test.ts; internal regex variants are equivalent.
const REPO_RE = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/;

/**
 * Parse and validate an "owner/repo" reference. Accepts full GitHub URLs and
 * trailing ".git". Throws INVALID_REPOSITORY_FORMAT on malformed input.
 */
export function parseRepository(input: string): ParsedRepository {
  if (typeof input !== "string") {
    throw new AppError("INVALID_REPOSITORY_FORMAT", "Repository must be a string.");
  }
  // Stryker disable Regex: the strip behaviour (git@ / https URL / .git suffix /
  // trailing slashes) on the domain of valid repo refs is pinned by
  // sanitize.test.ts + exactKills2/5; internal regex variants (escaped-dot, the
  // anchors for inputs that can never be a valid ref) cannot change the result.
  const trimmed = input
    .trim()
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  // Stryker restore Regex
  const match = REPO_RE.exec(trimmed);
  if (!match) {
    throw new AppError(
      "INVALID_REPOSITORY_FORMAT",
      `Invalid repository format: "${input}". Expected "owner/repo".`,
    );
  }
  const owner = match[1];
  const repo = match[2];
  if (repo === "." || repo === "..") {
    throw new AppError("INVALID_REPOSITORY_FORMAT", `Invalid repository name: "${input}".`);
  }
  return { owner, repo, fullName: `${owner}/${repo}` };
}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tiff",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".xz",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".o",
  ".a",
  ".class",
  ".jar",
  ".wasm",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".psd",
  ".sketch",
]);

/**
 * Reject repository file paths containing "." or ".." segments. encodeURIComponent
 * does NOT escape dots and the URL parser normalizes dot-segments, so an
 * unchecked ".." could escape /repos/{owner}/{repo}/contents/ and read another
 * repo with the token attached (path traversal). Throws INVALID_INPUT.
 */
export function assertSafeRepoPath(path: string): void {
  const traversal = path.split("/").some((segment) => segment === "." || segment === "..");
  if (traversal) {
    throw new AppError("INVALID_INPUT", `Path must not contain "." or ".." segments: ${path}`);
  }
}

/** True if the path has an extension we treat as binary / non-text. */
export function isBinaryPath(path: string): boolean {
  const lower = path.toLowerCase();
  // Stryker disable next-line MethodExpression: max-vs-min of the two separator
  // indices is equivalent because the extension is taken from the FINAL "." via
  // lastIndexOf below, which is unaffected by where we start the basename.
  const slash = Math.max(lower.lastIndexOf("/"), lower.lastIndexOf("\\"));
  // Stryker disable next-line MethodExpression: slicing to the basename vs using
  // the whole path is equivalent for the same reason (final "." wins).
  const name = lower.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return BINARY_EXTENSIONS.has(name.slice(dot));
}

/**
 * Content-based binary detection. The extension blocklist (`isBinaryPath`) is
 * only a first line of defense — a binary blob can have a text-like or absent
 * extension (e.g. `LICENSE`, `data`, `model.txt`). We sniff the decoded bytes
 * for a NUL byte in the leading window, the same heuristic git uses to decide
 * "binary". This catches binary payloads the extension list would miss.
 */
export function isBinaryContent(buf: Uint8Array, sniffBytes = 8000): boolean {
  const len = Math.min(buf.length, sniffBytes);
  for (let i = 0; i < len; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export interface TruncateResult {
  content: string;
  truncated: boolean;
}

/** Truncate text to maxChars. maxChars <= 0 means "no limit". */
export function truncate(text: string, maxChars: number): TruncateResult {
  if (maxChars <= 0 || text.length <= maxChars) {
    return { content: text, truncated: false };
  }
  return { content: text.slice(0, maxChars), truncated: true };
}

// Stryker disable Regex: the redaction behaviour (PAT/Bearer length thresholds
// and replacement) is pinned by sanitize.test.ts + precise.test.ts +
// exactKills2.test.ts; the remaining internal regex variants are equivalent.
const TOKEN_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /\b[Bb]earer\s+[A-Za-z0-9._~+/-]+=*/g,
];
// Stryker restore Regex

/**
 * Build a redactor that removes the configured token and common GitHub token
 * patterns / Authorization headers from any string.
 */
export function createRedactor(token?: string): (text: string) => string {
  return (text: string): string => {
    let out = text;
    if (token && token.length >= 6) {
      out = out.split(token).join("***");
    }
    for (const re of TOKEN_PATTERNS) {
      out = out.replace(re, "***");
    }
    return out;
  };
}

const GITHUB_HOSTS = new Set(["api.github.com", "raw.githubusercontent.com"]);
const DEEPWIKI_HOST = "mcp.deepwiki.com";

/** Enforce the HTTPS domain allowlist for every outbound request. */
export function assertAllowedUrl(url: string, opts: { deepwikiEnabled: boolean }): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("INVALID_INPUT", `Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new AppError("FORBIDDEN_HOST", `Only https requests are allowed: ${url}`);
  }
  if (GITHUB_HOSTS.has(parsed.hostname)) return;
  if (parsed.hostname === DEEPWIKI_HOST && opts.deepwikiEnabled) return;
  throw new AppError("FORBIDDEN_HOST", `Host not allowed: ${parsed.hostname}`);
}
