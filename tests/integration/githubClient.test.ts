import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { GitHubClient, type FetchLike } from "../../src/adapters/githubClient.js";
import { MemoryCacheStore } from "../../src/cache/memoryCacheStore.js";
import { silentLogger } from "../../src/utils/logger.js";
import { loadConfig, type Config } from "../../src/config.js";
import { AppError } from "../../src/utils/errors.js";
import {
  jsonResponse,
  makeGitHubFetch,
  rateLimitHeaders,
  repoObject,
} from "../helpers/fakeGitHub.js";

function makeClient(
  fetchImpl: FetchLike,
  overrides: Partial<Config> = {},
  sleepImpl: (ms: number) => Promise<void> = () => Promise.resolve(),
): GitHubClient {
  const config = { ...loadConfig({ env: {}, home: tmpdir() }), ...overrides };
  return new GitHubClient({
    config,
    cache: new MemoryCacheStore(),
    logger: silentLogger,
    fetchImpl,
    sleepImpl,
  });
}

describe("GitHubClient", () => {
  it("searches and maps candidates with rate-limit info", async () => {
    const fetchImpl = makeGitHubFetch();
    const client = makeClient(fetchImpl);
    const { totalCount, items } = await client.searchRepositories({ q: "cli", perPage: 10 });
    expect(totalCount).toBe(2);
    expect(items[0].fullName).toBe("acme/repo-a");
    expect(items[0].license).toBe("MIT");
    expect(client.getLastRateLimit()?.remaining).toBe(59);
  });

  it("maps a full repository profile", async () => {
    const client = makeClient(makeGitHubFetch());
    const profile = await client.getProfile("acme", "repo-a");
    expect(profile.repository).toBe("acme/repo-a");
    expect(profile.defaultBranch).toBe("main");
    expect(profile.watchers).toBe(50);
    expect(profile.sizeKb).toBe(5000);
  });

  it("maps 404 to GITHUB_NOT_FOUND", async () => {
    const client = makeClient(() =>
      Promise.resolve(
        jsonResponse({ message: "Not Found" }, { status: 404, headers: rateLimitHeaders() }),
      ),
    );
    await expect(client.getProfile("x", "y")).rejects.toMatchObject({ code: "GITHUB_NOT_FOUND" });
  });

  it("maps 403 with remaining=0 to GITHUB_RATE_LIMITED with retryAfter", async () => {
    const client = makeClient(() =>
      Promise.resolve(
        jsonResponse(
          { message: "API rate limit exceeded" },
          { status: 403, headers: rateLimitHeaders(0) },
        ),
      ),
    );
    try {
      await client.getProfile("x", "y");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("GITHUB_RATE_LIMITED");
      expect((err as AppError).retryAfter).not.toBeNull();
    }
  });

  it("maps other 403 to GITHUB_FORBIDDEN", async () => {
    const client = makeClient(() =>
      Promise.resolve(
        jsonResponse({ message: "Forbidden" }, { status: 403, headers: rateLimitHeaders(30) }),
      ),
    );
    await expect(client.getProfile("x", "y")).rejects.toMatchObject({ code: "GITHUB_FORBIDDEN" });
  });

  it("maps a missing README to README_NOT_FOUND", async () => {
    const fetchImpl = makeGitHubFetch({
      handler: (url) =>
        url.endsWith("/readme")
          ? jsonResponse({ message: "Not Found" }, { status: 404, headers: rateLimitHeaders() })
          : undefined,
    });
    const client = makeClient(fetchImpl);
    await expect(client.getReadme("acme", "repo-a")).rejects.toMatchObject({
      code: "README_NOT_FOUND",
    });
  });

  it("rejects oversized files with FILE_TOO_LARGE", async () => {
    const fetchImpl = makeGitHubFetch({
      handler: (url) =>
        url.includes("/contents/")
          ? jsonResponse(
              { type: "file", encoding: "base64", size: 2_000_000, path: "big.bin", content: "x" },
              { headers: rateLimitHeaders() },
            )
          : undefined,
    });
    const client = makeClient(fetchImpl);
    await expect(client.getFileContent("acme", "repo-a", "big.txt", "main")).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });

  it("returns null when there is no license", async () => {
    const fetchImpl = makeGitHubFetch({
      handler: (url) =>
        url.endsWith("/license")
          ? jsonResponse({ message: "Not Found" }, { status: 404, headers: rateLimitHeaders() })
          : undefined,
    });
    const client = makeClient(fetchImpl);
    expect(await client.getLicenseInfo("acme", "repo-a")).toBeNull();
  });

  it("maps tree blob/tree entries to file/dir", async () => {
    const client = makeClient(makeGitHubFetch());
    const { files } = await client.getTree("acme", "repo-a", "main", true);
    const pkg = files.find((f) => f.path === "package.json");
    const src = files.find((f) => f.path === "src");
    expect(pkg?.type).toBe("file");
    expect(src?.type).toBe("dir");
  });

  it("caches repository responses (single fetch)", async () => {
    const fetchImpl = makeGitHubFetch();
    const client = makeClient(fetchImpl);
    await client.getProfile("acme", "repo-a");
    await client.getProfile("acme", "repo-a");
    const repoCalls = fetchImpl.calls.filter((u) => u.endsWith("/repos/acme/repo-a"));
    expect(repoCalls.length).toBe(1);
  });

  it("sends the Authorization header only when a token is configured", async () => {
    let authed: string | undefined;
    let anon = true;
    const capture: FetchLike = (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Authorization) authed = headers.Authorization;
      else anon = true;
      return Promise.resolve(jsonResponse(repoObject("a", "b"), { headers: rateLimitHeaders() }));
    };
    await makeClient(capture, { githubToken: "secret123" }).getProfile("a", "b");
    expect(authed).toBe("Bearer secret123");

    authed = undefined;
    await makeClient(capture, { githubToken: undefined }).getProfile("a", "b");
    expect(authed).toBeUndefined();
    expect(anon).toBe(true);
  });
});

describe("GitHubClient — resilience & SSRF defense", () => {
  function redirect(location: string, status = 302): Response {
    return new Response(null, { status, headers: { location, ...rateLimitHeaders() } });
  }

  it("refuses to follow a redirect that leaves the allowlist (metadata SSRF)", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      calls.push(String(url));
      return Promise.resolve(redirect("https://169.254.169.254/latest/meta-data/iam/"));
    };
    const client = makeClient(fetchImpl);
    await expect(client.getProfile("acme", "repo-a")).rejects.toMatchObject({
      code: "FORBIDDEN_HOST",
    });
    // The internal/metadata host must never be requested.
    expect(calls.some((u) => u.includes("169.254.169.254"))).toBe(false);
  });

  it("refuses a redirect that downgrades to http", async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(redirect("http://api.github.com/repos/a/b"));
    const client = makeClient(fetchImpl);
    await expect(client.getProfile("a", "b")).rejects.toMatchObject({ code: "FORBIDDEN_HOST" });
  });

  it("does not allow GitHub redirects to DeepWiki even when DeepWiki is enabled", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      calls.push(String(url));
      return Promise.resolve(redirect("https://mcp.deepwiki.com/mcp"));
    };
    const base = loadConfig({ env: {}, home: tmpdir() });
    const client = makeClient(fetchImpl, { deepwiki: { ...base.deepwiki, enabled: true } });

    await expect(client.getProfile("acme", "repo-a")).rejects.toMatchObject({
      code: "FORBIDDEN_HOST",
    });
    expect(calls.some((u) => u.includes("mcp.deepwiki.com"))).toBe(false);
  });

  it("follows a redirect that stays within the allowlist", async () => {
    let n = 0;
    const fetchImpl: FetchLike = () => {
      n += 1;
      if (n === 1)
        return Promise.resolve(redirect("https://api.github.com/repositories/12345", 301));
      return Promise.resolve(
        jsonResponse(repoObject("acme", "repo-a"), { headers: rateLimitHeaders() }),
      );
    };
    const client = makeClient(fetchImpl);
    const profile = await client.getProfile("acme", "repo-a");
    expect(profile.repository).toBe("acme/repo-a");
    expect(n).toBe(2);
  });

  it("caps redirect chains", async () => {
    let n = 0;
    const fetchImpl: FetchLike = () => {
      n += 1;
      return Promise.resolve(redirect(`https://api.github.com/loop/${n}`));
    };
    const client = makeClient(fetchImpl);
    await expect(client.getProfile("a", "b")).rejects.toMatchObject({ code: "GITHUB_API_ERROR" });
    expect(n).toBeLessThanOrEqual(6); // initial + MAX_REDIRECTS
  });

  it("does NOT send the token after a cross-host redirect (token leak defense)", async () => {
    const auths: Array<string | undefined> = [];
    let n = 0;
    const fetchImpl: FetchLike = (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      auths.push(headers.Authorization);
      n += 1;
      if (n === 1) {
        return Promise.resolve(redirect("https://raw.githubusercontent.com/acme/repo-a/main/meta"));
      }
      return Promise.resolve(
        jsonResponse(repoObject("acme", "repo-a"), { headers: rateLimitHeaders() }),
      );
    };
    const client = makeClient(fetchImpl, { githubToken: "secret123" });
    await client.getProfile("acme", "repo-a");
    expect(auths[0]).toBe("Bearer secret123"); // first hop: api.github.com
    expect(auths[1]).toBeUndefined(); // redirected to raw.* — token dropped
  });

  it("retries a transient 5xx and then succeeds", async () => {
    let n = 0;
    const fetchImpl: FetchLike = () => {
      n += 1;
      if (n === 1) {
        return Promise.resolve(
          jsonResponse({ message: "bad gateway" }, { status: 503, headers: rateLimitHeaders() }),
        );
      }
      return Promise.resolve(
        jsonResponse(repoObject("acme", "repo-a"), { headers: rateLimitHeaders() }),
      );
    };
    const client = makeClient(fetchImpl);
    const profile = await client.getProfile("acme", "repo-a");
    expect(profile.repository).toBe("acme/repo-a");
    expect(n).toBe(2);
  });

  it("gives up after retrying a persistent 5xx (3 attempts total)", async () => {
    let n = 0;
    const fetchImpl: FetchLike = () => {
      n += 1;
      return Promise.resolve(
        jsonResponse({ message: "server error" }, { status: 503, headers: rateLimitHeaders() }),
      );
    };
    const client = makeClient(fetchImpl);
    await expect(client.getProfile("a", "b")).rejects.toMatchObject({ code: "GITHUB_API_ERROR" });
    expect(n).toBe(3);
  });

  it("retries a transient network error then succeeds", async () => {
    let n = 0;
    const fetchImpl: FetchLike = () => {
      n += 1;
      if (n < 3) return Promise.reject(new TypeError("fetch failed"));
      return Promise.resolve(
        jsonResponse(repoObject("acme", "repo-a"), { headers: rateLimitHeaders() }),
      );
    };
    const client = makeClient(fetchImpl);
    const profile = await client.getProfile("acme", "repo-a");
    expect(profile.repository).toBe("acme/repo-a");
    expect(n).toBe(3);
  });

  it("does NOT retry a 404", async () => {
    let n = 0;
    const fetchImpl: FetchLike = () => {
      n += 1;
      return Promise.resolve(
        jsonResponse({ message: "Not Found" }, { status: 404, headers: rateLimitHeaders() }),
      );
    };
    const client = makeClient(fetchImpl);
    await expect(client.getProfile("a", "b")).rejects.toMatchObject({ code: "GITHUB_NOT_FOUND" });
    expect(n).toBe(1);
  });

  it("does NOT retry a timeout/abort", async () => {
    let n = 0;
    const fetchImpl: FetchLike = () => {
      n += 1;
      const err = new Error("The operation timed out.");
      err.name = "TimeoutError";
      return Promise.reject(err);
    };
    const client = makeClient(fetchImpl);
    await expect(client.getProfile("a", "b")).rejects.toMatchObject({ code: "GITHUB_API_ERROR" });
    expect(n).toBe(1);
  });

  it("rejects binary file content by NUL-byte sniff regardless of extension", async () => {
    // ELF/PE-like bytes with an embedded NUL, served for an extensionless path.
    const binary = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02, 0xff, 0xfe]);
    const fetchImpl = makeGitHubFetch({
      handler: (url) =>
        url.includes("/contents/")
          ? jsonResponse(
              {
                type: "file",
                encoding: "base64",
                size: binary.length,
                path: "data",
                content: binary.toString("base64"),
              },
              { headers: rateLimitHeaders() },
            )
          : undefined,
    });
    const client = makeClient(fetchImpl);
    await expect(client.getFileContent("acme", "repo-a", "data", "main")).rejects.toMatchObject({
      code: "BINARY_FILE_NOT_SUPPORTED",
    });
  });

  it("clamps per_page into GitHub's 1..100 range", async () => {
    let seen = "";
    const fetchImpl: FetchLike = (url) => {
      seen = String(url);
      return Promise.resolve(
        jsonResponse({ total_count: 0, items: [] }, { headers: rateLimitHeaders() }),
      );
    };
    const client = makeClient(fetchImpl);
    await client.searchRepositories({ q: "x", perPage: 9999 });
    expect(new URL(seen).searchParams.get("per_page")).toBe("100");
    await client.searchRepositories({ q: "y", perPage: 0 });
    expect(new URL(seen).searchParams.get("per_page")).toBe("1");
  });
});

describe("GitHubClient — README memory guard", () => {
  it("bounds README decoding to a memory-safe ceiling", async () => {
    const hugeText = "a".repeat(3_000_000); // 3 MB of text
    const fetchImpl = makeGitHubFetch({
      handler: (url) =>
        url.endsWith("/readme")
          ? jsonResponse(
              {
                path: "README.md",
                encoding: "base64",
                content: Buffer.from(hugeText, "utf-8").toString("base64"),
              },
              { headers: rateLimitHeaders() },
            )
          : undefined,
    });
    const client = makeClient(fetchImpl);
    const readme = await client.getReadme("acme", "repo-a");
    expect(readme.content.length).toBeLessThanOrEqual(2_000_004);
    expect(readme.content.length).toBeGreaterThan(1_900_000); // not over-truncated
    expect(readme.content.length).toBeLessThan(hugeText.length); // genuinely capped
  });
});

describe("GitHubClient — malformed search results", () => {
  it("skips items missing required fields instead of failing the whole search", async () => {
    const fetchImpl: FetchLike = (url) => {
      if (new URL(String(url)).pathname === "/search/repositories") {
        return Promise.resolve(
          jsonResponse(
            {
              total_count: 3,
              items: [
                repoObject("good", "one"),
                { name: "no-owner", full_name: "x/no-owner" }, // missing owner.login
                null, // entirely malformed
              ],
            },
            { headers: rateLimitHeaders() },
          ),
        );
      }
      return Promise.resolve(
        jsonResponse({ message: "Not Found" }, { status: 404, headers: rateLimitHeaders() }),
      );
    };
    const client = makeClient(fetchImpl);
    const { items, totalCount } = await client.searchRepositories({ q: "x", perPage: 10 });
    expect(totalCount).toBe(3);
    expect(items.length).toBe(1);
    expect(items[0].fullName).toBe("good/one");
  });

  it("returns an empty list when items is not an array", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        jsonResponse({ total_count: 0, items: null }, { headers: rateLimitHeaders() }),
      );
    const client = makeClient(fetchImpl);
    const { items } = await client.searchRepositories({ q: "x", perPage: 10 });
    expect(items).toEqual([]);
  });
});

describe("GitHubClient — path traversal defense (H1)", () => {
  it("rejects '..'/'.' path segments and never issues the traversing request", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      calls.push(String(url));
      return Promise.resolve(
        jsonResponse(
          { type: "file", encoding: "base64", size: 2, content: "aGk=", path: "x" },
          { headers: rateLimitHeaders() },
        ),
      );
    };
    const client = makeClient(fetchImpl);
    await expect(
      client.getFileContent("o", "r", "../../../victim/private/contents/.env", "main"),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(client.getFileContent("o", "r", "a/./b", "main")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(calls.length).toBe(0); // never reached the network
  });
});

describe("GitHubClient — request coalescing & cache-key isolation", () => {
  it("de-duplicates concurrent identical requests into one fetch (M2)", async () => {
    let n = 0;
    const fetchImpl: FetchLike = () => {
      n += 1;
      return new Promise((resolve) =>
        setTimeout(
          () => resolve(jsonResponse(repoObject("a", "b"), { headers: rateLimitHeaders() })),
          20,
        ),
      );
    };
    const client = makeClient(fetchImpl);
    const [p1, p2] = await Promise.all([client.getProfile("a", "b"), client.getProfile("a", "b")]);
    expect(p1.repository).toBe("a/b");
    expect(p2.repository).toBe("a/b");
    expect(n).toBe(1); // coalesced — not two GitHub calls
  });

  it("does not collide the default-branch key with a branch literally named 'default' (L3)", async () => {
    const fetchImpl = makeGitHubFetch();
    const client = makeClient(fetchImpl);
    await client.getReadme("acme", "repo-a"); // no ref → default branch
    await client.getReadme("acme", "repo-a", "default"); // branch named "default"
    const readmeCalls = fetchImpl.calls.filter((u) => u.includes("/readme"));
    expect(readmeCalls.length).toBe(2); // distinct cache keys → two real fetches
  });
});

describe("GitHubClient — cross-hop deadline (L2)", () => {
  it("enforces a single deadline across hops (no per-hop timeout stacking)", async () => {
    let n = 0;
    const fetchImpl: FetchLike = () => {
      n += 1;
      return Promise.resolve(jsonResponse(repoObject("a", "b"), { headers: rateLimitHeaders() }));
    };
    const base = loadConfig({ env: {}, home: tmpdir() });
    // requestTimeoutMs 0 → the deadline is already past on the first hop.
    const client = makeClient(fetchImpl, { limits: { ...base.limits, requestTimeoutMs: 0 } });
    await expect(client.getProfile("a", "b")).rejects.toMatchObject({ code: "GITHUB_API_ERROR" });
    expect(n).toBe(0); // deadline exceeded before any request was issued
  });
});
