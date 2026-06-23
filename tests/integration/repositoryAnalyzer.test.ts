import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { RepositoryAnalyzer } from "../../src/analyzers/repositoryAnalyzer.js";
import { GitHubClient, type FetchLike } from "../../src/adapters/githubClient.js";
import { MemoryCacheStore } from "../../src/cache/memoryCacheStore.js";
import { silentLogger } from "../../src/utils/logger.js";
import { loadConfig, type Config } from "../../src/config.js";
import { jsonResponse, makeGitHubFetch, rateLimitHeaders } from "../helpers/fakeGitHub.js";

function makeAnalyzer(
  fetchImpl: FetchLike,
  configOverride?: (config: Config) => Config,
): {
  analyzer: RepositoryAnalyzer;
  calls: () => number;
} {
  const baseConfig = loadConfig({ env: {}, home: tmpdir() });
  const config = configOverride ? configOverride(baseConfig) : baseConfig;
  const cache = new MemoryCacheStore();
  const github = new GitHubClient({ config, cache, logger: silentLogger, fetchImpl });
  return {
    analyzer: new RepositoryAnalyzer({ github, cache, logger: silentLogger, config }),
    calls: () => (fetchImpl as { calls?: string[] }).calls?.length ?? 0,
  };
}

describe("RepositoryAnalyzer", () => {
  it("produces a complete analysis for a healthy repo", async () => {
    const { analyzer } = makeAnalyzer(makeGitHubFetch());
    const a = await analyzer.analyze("acme", "repo-a", { query: "cli tool" });
    expect(a.repository).toBe("acme/repo-a");
    expect(a.license.category).toBe("permissive");
    expect(a.documentation.hasReadme).toBe(true);
    expect(a.documentation.hasInstallSection).toBe(true);
    expect(a.packageSignals.detectedPackageManagers).toContain("npm");
    expect(a.packageSignals.hasTests).toBe(true);
    expect(a.score.total).toBeGreaterThan(0);
    expect(a.score.total).toBeLessThanOrEqual(100);
    expect(["low", "medium", "high"]).toContain(a.risk.level);
    expect(a.summary).toContain("acme/repo-a");
  });

  it("handles missing README and missing license gracefully (high risk)", async () => {
    const fetchImpl = makeGitHubFetch({
      handler: (url) => {
        if (url.includes("/readme"))
          return jsonResponse(
            { message: "Not Found" },
            { status: 404, headers: rateLimitHeaders() },
          );
        if (url.includes("/license"))
          return jsonResponse(
            { message: "Not Found" },
            { status: 404, headers: rateLimitHeaders() },
          );
        return undefined;
      },
    });
    const { analyzer } = makeAnalyzer(fetchImpl);
    const a = await analyzer.analyze("acme", "repo-a", {});
    expect(a.license.category).toBe("none");
    expect(a.documentation.hasReadme).toBe(false);
    expect(a.risk.level).toBe("high");
  });

  it("caches the composed analysis (no refetch on identical options)", async () => {
    const { analyzer, calls } = makeAnalyzer(makeGitHubFetch());
    await analyzer.analyze("acme", "repo-a", {});
    const before = calls();
    await analyzer.analyze("acme", "repo-a", {});
    expect(calls()).toBe(before);
  });

  it("does NOT cache a degraded analysis (transient tree failure → recovers)", async () => {
    let treeFails = true;
    const fetchImpl = makeGitHubFetch({
      handler: (url) =>
        url.includes("/git/trees/") && treeFails
          ? jsonResponse({ message: "boom" }, { status: 500, headers: rateLimitHeaders() })
          : undefined,
    });
    const config = loadConfig({ env: {}, home: tmpdir() });
    const cache = new MemoryCacheStore();
    const github = new GitHubClient({
      config,
      cache,
      logger: silentLogger,
      fetchImpl,
      sleepImpl: () => Promise.resolve(), // no backoff delay in tests
    });
    const analyzer = new RepositoryAnalyzer({ github, cache, logger: silentLogger, config });

    const degraded = await analyzer.analyze("acme", "repo-a", {});
    expect(degraded.packageSignals.detectedPackageManagers).toEqual([]); // tree missing

    treeFails = false; // GitHub recovers
    const healthy = await analyzer.analyze("acme", "repo-a", {});
    // If the degraded result had been cached, this would still be empty.
    expect(healthy.packageSignals.detectedPackageManagers).toContain("npm");
  });

  it("does NOT cache a degraded analysis (transient releases failure → recovers)", async () => {
    let releasesFail = true;
    const fetchImpl = makeGitHubFetch({
      handler: (url) => {
        if (url.includes("/releases") && releasesFail) {
          return jsonResponse({ message: "boom" }, { status: 500, headers: rateLimitHeaders() });
        }
        if (url.includes("/releases")) {
          return jsonResponse(
            [{ published_at: new Date().toISOString(), created_at: new Date().toISOString() }],
            { headers: rateLimitHeaders() },
          );
        }
        return undefined;
      },
    });
    const config = loadConfig({ env: {}, home: tmpdir() });
    const cache = new MemoryCacheStore();
    const github = new GitHubClient({
      config,
      cache,
      logger: silentLogger,
      fetchImpl,
      sleepImpl: () => Promise.resolve(),
    });
    const analyzer = new RepositoryAnalyzer({ github, cache, logger: silentLogger, config });

    const degraded = await analyzer.analyze("acme", "repo-a", {});
    releasesFail = false;
    const healthy = await analyzer.analyze("acme", "repo-a", {});

    expect(degraded.maintenance.score).toBeLessThan(healthy.maintenance.score);
  });

  it("honors maxFilesToInspect when deriving package and documentation signals", async () => {
    const tree = [
      { path: "README.md", type: "blob", size: 100, sha: "r" },
      { path: "package.json", type: "blob", size: 100, sha: "p" },
      { path: ".github/workflows/ci.yml", type: "blob", size: 100, sha: "c" },
      { path: "test/index.test.ts", type: "blob", size: 100, sha: "t" },
    ];
    const fetchImpl = makeGitHubFetch({
      handler: (url) =>
        url.includes("/git/trees/")
          ? jsonResponse({ sha: "tree", truncated: false, tree }, { headers: rateLimitHeaders() })
          : undefined,
    });
    const { analyzer } = makeAnalyzer(fetchImpl, (config) => ({
      ...config,
      limits: { ...config.limits, maxFilesToInspect: 1 },
    }));

    const analysis = await analyzer.analyze("acme", "repo-a", {});

    expect(analysis.documentation.hasReadme).toBe(true);
    expect(analysis.packageSignals.detectedPackageManagers).toEqual([]);
    expect(analysis.packageSignals.hasCI).toBe(false);
    expect(analysis.packageSignals.hasTests).toBe(false);
  });
});
