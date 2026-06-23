import type { Config } from "../config.js";
import { cacheKeys, type CacheStore } from "../cache/cacheStore.js";
import type { Logger } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";
import { assertAllowedUrl, assertSafeRepoPath, isBinaryContent } from "../utils/sanitize.js";
import { isRateLimitLow, parseRateLimit, type RateLimitInfo } from "../utils/rateLimit.js";
import type { RepositoryCandidate, RepositoryProfile } from "../types/repository.js";
import type { TreeFile } from "../types/toolResults.js";

// SECURITY: Everything returned by GitHub (descriptions, README, file contents,
// topics, issue text) is UNTRUSTED DATA. It is returned to clients as data and
// must never be interpreted as instructions by the server or downstream agents.

const GITHUB_API = "https://api.github.com";
const GITHUB_API_HOST = "api.github.com";
const API_VERSION = "2026-03-10";
const USER_AGENT = "oss-research-mcp";
const MAX_FILE_BYTES = 1_000_000;
const MAX_README_BYTES = 2_000_000; // hard ceiling on README decode (memory guard)
// Resilience policy for idempotent GETs.
const MAX_RETRIES = 2; // up to 3 total attempts on transient failures
const MAX_REDIRECTS = 5; // hard cap on manually-followed redirects
const RETRY_BASE_MS = 200; // exponential backoff base
const RETRY_MAX_WAIT_MS = 2_000; // never wait longer than this between retries

/** Discard a response body so the underlying socket is released between hops. */
async function drainBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // ignore — best effort cleanup
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GitHubClientDeps {
  config: Config;
  cache: CacheStore;
  logger: Logger;
  fetchImpl?: FetchLike;
  /** Injectable sleep (tests pass a no-op to avoid real backoff delays). */
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface RepositorySearchParams {
  q: string;
  sort?: "stars" | "updated" | "forks" | "best-match";
  order?: "asc" | "desc";
  perPage: number;
}

interface RawLicense {
  key?: string | null;
  name?: string | null;
  spdx_id?: string | null;
}

interface RawRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count?: number;
  subscribers_count?: number;
  language: string | null;
  topics?: string[];
  license: RawLicense | null;
  archived: boolean;
  disabled: boolean;
  pushed_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  default_branch: string;
  size: number;
}

interface RawSearchResponse {
  total_count: number;
  items: RawRepo[];
}

interface RawReadme {
  path: string;
  content: string;
  encoding: string;
}

interface RawContent {
  type: string;
  encoding?: string;
  content?: string;
  size: number;
  path: string;
}

interface RawTreeEntry {
  path: string;
  type: string;
  size?: number;
  sha: string;
}

interface RawTree {
  tree: RawTreeEntry[];
  truncated: boolean;
}

interface RawLicenseResponse {
  license: RawLicense | null;
}

interface RawCommit {
  commit?: { author?: { date?: string }; committer?: { date?: string } };
}

interface RawRelease {
  published_at?: string | null;
  created_at?: string | null;
}

export interface LicenseInfo {
  spdxId: string | null;
  name: string | null;
  key: string | null;
}

function normalizeLicenseId(license: RawLicense | null | undefined): string | null {
  if (!license) return null;
  if (license.spdx_id && license.spdx_id !== "NOASSERTION") return license.spdx_id;
  if (license.name && license.name !== "Other") return license.name;
  return null;
}

function decodeBase64(content: string, maxBytes = Number.POSITIVE_INFINITY): string {
  const clean = content.replace(/\s/g, "");
  // Bound the decode so a pathologically large payload cannot be fully
  // materialized in memory before downstream truncation. Slice to a base64
  // quantum (multiple of 4) to avoid corrupting the final group.
  if (Number.isFinite(maxBytes) && clean.length > Math.ceil(maxBytes / 3) * 4) {
    const limit = Math.ceil(maxBytes / 3) * 4;
    return Buffer.from(clean.slice(0, limit - (limit % 4)), "base64").toString("utf-8");
  }
  return Buffer.from(clean, "base64").toString("utf-8");
}

/**
 * True if a raw search item has the minimum fields `mapCandidate` dereferences.
 * GitHub search results are normally well-formed, but a single malformed item
 * must not throw and abort the entire search — it is skipped instead.
 */
function isMappableRepo(raw: unknown): raw is RawRepo {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as { full_name?: unknown; owner?: { login?: unknown } };
  return (
    typeof r.full_name === "string" &&
    typeof r.owner === "object" &&
    r.owner !== null &&
    typeof r.owner.login === "string"
  );
}

function mapCandidate(raw: RawRepo): RepositoryCandidate {
  return {
    fullName: raw.full_name,
    owner: raw.owner.login,
    name: raw.name,
    url: raw.html_url,
    description: raw.description,
    stars: raw.stargazers_count ?? 0,
    forks: raw.forks_count ?? 0,
    openIssues: raw.open_issues_count ?? 0,
    language: raw.language,
    topics: raw.topics ?? [],
    license: normalizeLicenseId(raw.license),
    archived: Boolean(raw.archived),
    disabled: Boolean(raw.disabled),
    pushedAt: raw.pushed_at,
    updatedAt: raw.updated_at,
  };
}

function mapProfile(raw: RawRepo): RepositoryProfile {
  return {
    repository: raw.full_name,
    description: raw.description,
    url: raw.html_url,
    defaultBranch: raw.default_branch,
    stars: raw.stargazers_count ?? 0,
    forks: raw.forks_count ?? 0,
    watchers: raw.subscribers_count ?? raw.watchers_count ?? 0,
    openIssues: raw.open_issues_count ?? 0,
    language: raw.language,
    topics: raw.topics ?? [],
    license: normalizeLicenseId(raw.license),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    pushedAt: raw.pushed_at,
    archived: Boolean(raw.archived),
    disabled: Boolean(raw.disabled),
    sizeKb: raw.size ?? 0,
  };
}

export class GitHubClient {
  private readonly config: Config;
  private readonly cache: CacheStore;
  private readonly logger: Logger;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private lastRateLimit: RateLimitInfo | null = null;
  // De-duplicates concurrent identical requests (key → shared in-flight promise)
  // so a fan-out doesn't issue N copies of the same GitHub call and burn quota.
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(deps: GitHubClientDeps) {
    this.config = deps.config;
    this.cache = deps.cache;
    this.logger = deps.logger;
    this.fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleepImpl = deps.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get authenticated(): boolean {
    return Boolean(this.config.githubToken);
  }

  getLastRateLimit(): RateLimitInfo | null {
    return this.lastRateLimit;
  }

  private ttlMs(): number {
    return this.config.cache.ttlHours * 3_600_000;
  }

  private async cached<T>(key: string, producer: () => Promise<T>): Promise<T> {
    const hit = this.cache.get<T>(key);
    if (hit !== undefined) return hit;
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const promise = (async () => {
      const value = await producer();
      try {
        this.cache.set(key, value, this.ttlMs());
      } catch (err) {
        this.logger.warn("cache set failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return value;
    })();
    this.inflight.set(key, promise);
    try {
      return (await promise) as T;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async request<T>(path: string): Promise<T> {
    const res = await this.httpGet(`${GITHUB_API}${path}`);

    this.lastRateLimit = parseRateLimit(res.headers);
    if (isRateLimitLow(this.lastRateLimit)) {
      this.logger.warn("GitHub rate limit is low", {
        remaining: this.lastRateLimit.remaining,
        resetAt: this.lastRateLimit.resetAt,
      });
    }

    if (!res.ok) {
      await this.throwForStatus(res);
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      if (this.isAbort(err)) {
        throw new AppError(
          "GITHUB_API_ERROR",
          `GitHub request timed out after ${this.config.limits.requestTimeoutMs}ms`,
          { cause: err },
        );
      }
      throw new AppError("GITHUB_API_ERROR", "Failed to parse GitHub response body", {
        cause: err,
      });
    }
  }

  private isAbort(err: unknown): boolean {
    return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
  }

  /** Backoff (ms) for retry `attempt` (1-based): exponential with full jitter. */
  private backoffMs(attempt: number): number {
    const ceiling = Math.min(RETRY_MAX_WAIT_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
    return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
  }

  private headersFor(url: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
    };
    // SECURITY: the token is sent ONLY to api.github.com. After any
    // cross-host redirect (e.g. to raw.githubusercontent.com) it is dropped so
    // it can never leak to a redirected origin.
    if (this.config.githubToken && new URL(url).hostname === GITHUB_API_HOST) {
      headers.Authorization = `Bearer ${this.config.githubToken}`;
    }
    return headers;
  }

  /**
   * Resilient GET:
   *  - enforces the HTTPS allowlist on EVERY hop (SSRF defense),
   *  - follows redirects MANUALLY, re-validating each Location, so a 3xx to an
   *    internal/metadata host (e.g. 169.254.169.254) or an http downgrade can
   *    never escape the allowlist the way `fetch`'s automatic following would,
   *  - retries transient failures (network errors and HTTP 5xx) with bounded,
   *    jittered exponential backoff. 4xx and timeouts are never retried.
   */
  private async httpGet(initialUrl: string): Promise<Response> {
    // Single deadline across ALL redirect/retry hops, so cumulative latency is
    // bounded by requestTimeoutMs rather than (per-hop timeout × hops + backoff).
    const deadline = Date.now() + this.config.limits.requestTimeoutMs;
    let url = initialUrl;
    let redirects = 0;
    let attempt = 0;

    for (;;) {
      // Throws FORBIDDEN_HOST for a disallowed host or non-https scheme.
      // GitHub traffic is GitHub-only: enabling the optional DeepWiki adapter
      // must not let a GitHub redirect hop into mcp.deepwiki.com.
      assertAllowedUrl(url, { deepwikiEnabled: false });

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new AppError(
          "GITHUB_API_ERROR",
          `GitHub request exceeded the ${this.config.limits.requestTimeoutMs}ms deadline`,
        );
      }

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "GET",
          headers: this.headersFor(url),
          redirect: "manual",
          signal: AbortSignal.timeout(remaining),
        });
      } catch (err) {
        if (this.isAbort(err)) {
          throw new AppError(
            "GITHUB_API_ERROR",
            `GitHub request timed out after ${this.config.limits.requestTimeoutMs}ms`,
            { cause: err },
          );
        }
        if (attempt < MAX_RETRIES) {
          attempt += 1;
          await this.sleepImpl(
            Math.min(this.backoffMs(attempt), Math.max(0, deadline - Date.now())),
          );
          continue;
        }
        throw new AppError(
          "GITHUB_API_ERROR",
          `Network error calling GitHub: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      // Manual redirect handling — re-validate every target against the allowlist.
      if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
        const location = res.headers.get("location") as string;
        await drainBody(res);
        if (redirects >= MAX_REDIRECTS) {
          throw new AppError("GITHUB_API_ERROR", "Too many redirects from GitHub.");
        }
        redirects += 1;
        let next: string;
        try {
          next = new URL(location, url).toString();
        } catch {
          throw new AppError(
            "GITHUB_API_ERROR",
            `Invalid redirect location from GitHub: ${location}`,
          );
        }
        url = next;
        continue;
      }

      // Retry transient server errors (5xx) on idempotent GETs.
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        attempt += 1;
        await drainBody(res);
        await this.sleepImpl(Math.min(this.backoffMs(attempt), Math.max(0, deadline - Date.now())));
        continue;
      }

      return res;
    }
  }

  private async throwForStatus(res: Response): Promise<never> {
    const status = res.status;
    let message: string | undefined;
    let body: unknown;
    try {
      body = await res.json();
      if (body && typeof body === "object" && "message" in body) {
        const m = (body as { message?: unknown }).message;
        if (typeof m === "string") message = m;
      }
    } catch {
      // ignore non-JSON error bodies
    }

    if (status === 401) {
      throw new AppError("GITHUB_FORBIDDEN", "GitHub authentication failed. Check GITHUB_TOKEN.");
    }
    if (status === 403 || status === 429) {
      const remaining = this.lastRateLimit?.remaining;
      const looksRateLimited =
        status === 429 ||
        remaining === 0 ||
        (message ? /rate limit|secondary/i.test(message) : false);
      if (looksRateLimited) {
        let retryAfter = this.lastRateLimit?.resetAt ?? null;
        const retryHeader = res.headers.get("retry-after");
        if (retryHeader) {
          const secs = Number(retryHeader);
          // Bound to a sane, non-negative range so the date can't overflow.
          if (Number.isFinite(secs) && secs >= 0 && secs <= 8_640_000_000) {
            retryAfter = new Date(Date.now() + secs * 1000).toISOString();
          }
        }
        throw new AppError("GITHUB_RATE_LIMITED", message ?? "GitHub rate limit exceeded", {
          retryAfter,
        });
      }
      throw new AppError("GITHUB_FORBIDDEN", message ?? "GitHub request forbidden");
    }
    if (status === 404) {
      throw new AppError("GITHUB_NOT_FOUND", message ?? "GitHub resource not found");
    }
    if (status === 422) {
      throw new AppError("GITHUB_API_ERROR", message ?? "GitHub validation failed", {
        details: { status },
      });
    }
    throw new AppError("GITHUB_API_ERROR", message ?? `GitHub API error (HTTP ${status})`, {
      details: { status },
    });
  }

  async searchRepositories(
    params: RepositorySearchParams,
  ): Promise<{ totalCount: number; items: RepositoryCandidate[] }> {
    return this.cached(cacheKeys.search(params), async () => {
      const usp = new URLSearchParams();
      usp.set("q", params.q);
      if (params.sort && params.sort !== "best-match") usp.set("sort", params.sort);
      if (params.order) usp.set("order", params.order);
      // GitHub rejects per_page outside 1..100 with a 422; clamp defensively.
      const perPage = Math.min(100, Math.max(1, Math.trunc(params.perPage) || 1));
      usp.set("per_page", String(perPage));
      const data = await this.request<RawSearchResponse>(`/search/repositories?${usp.toString()}`);
      const rawItems = Array.isArray(data.items) ? data.items : [];
      const items = rawItems.filter(isMappableRepo).map(mapCandidate);
      if (items.length < rawItems.length) {
        this.logger.debug("search: skipped malformed items", {
          skipped: rawItems.length - items.length,
        });
      }
      return {
        totalCount: typeof data.total_count === "number" ? data.total_count : 0,
        items,
      };
    });
  }

  private async getRepositoryRaw(owner: string, repo: string): Promise<RawRepo> {
    return this.cached(cacheKeys.repo(owner, repo), () =>
      this.request<RawRepo>(`/repos/${owner}/${repo}`),
    );
  }

  async getProfile(owner: string, repo: string): Promise<RepositoryProfile> {
    return mapProfile(await this.getRepositoryRaw(owner, repo));
  }

  async getCandidate(owner: string, repo: string): Promise<RepositoryCandidate> {
    return mapCandidate(await this.getRepositoryRaw(owner, repo));
  }

  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    return (await this.getRepositoryRaw(owner, repo)).default_branch;
  }

  async getReadme(
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<{ path: string; content: string }> {
    // "\u0000default" can never be a real branch name, so the no-ref (default
    // branch) cache entry can't collide with a branch literally named "default".
    const branchKey = ref ?? "\u0000default";
    return this.cached(cacheKeys.readme(owner, repo, branchKey), async () => {
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      let data: RawReadme;
      try {
        data = await this.request<RawReadme>(`/repos/${owner}/${repo}/readme${query}`);
      } catch (err) {
        if (err instanceof AppError && err.code === "GITHUB_NOT_FOUND") {
          throw new AppError("README_NOT_FOUND", `README not found for ${owner}/${repo}`);
        }
        throw err;
      }
      const content =
        data.encoding === "base64" && data.content
          ? decodeBase64(data.content, MAX_README_BYTES)
          : (data.content ?? "").slice(0, MAX_README_BYTES);
      return { path: data.path, content };
    });
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<{ content: string; size: number }> {
    // "\u0000default" can never be a real branch name, so the no-ref (default
    // branch) cache entry can't collide with a branch literally named "default".
    const branchKey = ref ?? "\u0000default";
    return this.cached(cacheKeys.file(owner, repo, branchKey, path), async () => {
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      assertSafeRepoPath(path);
      const segments = path.split("/").filter((segment) => segment.length > 0);
      const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join("/");
      const data = await this.request<RawContent | RawContent[]>(
        `/repos/${owner}/${repo}/contents/${encodedPath}${query}`,
      );
      if (Array.isArray(data)) {
        throw new AppError("INVALID_INPUT", `Path is a directory, not a file: ${path}`);
      }
      if (data.type !== "file") {
        throw new AppError("INVALID_INPUT", `Path is not a regular file: ${path}`);
      }
      if ((data.size ?? 0) > MAX_FILE_BYTES || data.encoding === "none" || !data.content) {
        throw new AppError(
          "FILE_TOO_LARGE",
          `File ${path} is too large to read inline (limit ${MAX_FILE_BYTES} bytes).`,
        );
      }
      const content = this.decodeFileText(data.content, data.encoding, path);
      return { content, size: data.size ?? content.length };
    });
  }

  /**
   * Decode file content, rejecting binary payloads by CONTENT (NUL-byte sniff),
   * not just by extension. The extension blocklist runs at the tool layer; this
   * is the backstop for binary files with text-like or absent extensions.
   */
  private decodeFileText(raw: string, encoding: string | undefined, path: string): string {
    if (encoding !== "base64") return raw;
    const buf = Buffer.from(raw.replace(/\s/g, ""), "base64");
    if (isBinaryContent(buf)) {
      throw new AppError(
        "BINARY_FILE_NOT_SUPPORTED",
        `File ${path} appears to be binary and cannot be read as text.`,
      );
    }
    return buf.toString("utf-8");
  }

  async getTree(
    owner: string,
    repo: string,
    branch: string,
    recursive: boolean,
  ): Promise<{ files: TreeFile[]; truncated: boolean }> {
    const treeKey = `${branch}:${recursive ? "r" : "1"}`;
    return this.cached(cacheKeys.tree(owner, repo, treeKey), async () => {
      const recursiveQuery = recursive ? "?recursive=1" : "";
      const data = await this.request<RawTree>(
        `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}${recursiveQuery}`,
      );
      const files: TreeFile[] = (data.tree ?? [])
        .filter((entry) => entry.type === "blob" || entry.type === "tree")
        .map((entry) => ({
          path: entry.path,
          type: entry.type === "tree" ? "dir" : "file",
          size: entry.size ?? null,
          sha: entry.sha,
        }));
      return { files, truncated: Boolean(data.truncated) };
    });
  }

  async getLicenseInfo(owner: string, repo: string): Promise<LicenseInfo | null> {
    return this.cached(cacheKeys.license(owner, repo), async () => {
      try {
        const data = await this.request<RawLicenseResponse>(`/repos/${owner}/${repo}/license`);
        return {
          spdxId: data.license?.spdx_id ?? null,
          name: data.license?.name ?? null,
          key: data.license?.key ?? null,
        };
      } catch (err) {
        if (err instanceof AppError && err.code === "GITHUB_NOT_FOUND") return null;
        throw err;
      }
    });
  }

  /** Optional enrichment: latest commit date. Returns null on any failure. */
  async getLastCommitDate(owner: string, repo: string, branch?: string): Promise<string | null> {
    try {
      const usp = new URLSearchParams({ per_page: "1" });
      if (branch) usp.set("sha", branch);
      const data = await this.request<RawCommit[]>(
        `/repos/${owner}/${repo}/commits?${usp.toString()}`,
      );
      const first = data[0];
      return first?.commit?.committer?.date ?? first?.commit?.author?.date ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Optional enrichment: latest release date.
   * - string: latest release timestamp
   * - null: request succeeded and the repository has no releases
   * - undefined: request failed, so callers should treat derived analysis as degraded
   */
  async getLatestReleaseDate(owner: string, repo: string): Promise<string | null | undefined> {
    try {
      const data = await this.request<RawRelease[]>(`/repos/${owner}/${repo}/releases?per_page=1`);
      const first = data[0];
      return first?.published_at ?? first?.created_at ?? null;
    } catch {
      return undefined;
    }
  }
}
