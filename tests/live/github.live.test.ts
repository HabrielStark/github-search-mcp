import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";
import { MemoryCacheStore } from "../../src/cache/memoryCacheStore.js";
import { silentLogger } from "../../src/utils/logger.js";

// LIVE: real api.github.com calls. Set GITHUB_TOKEN for higher rate limits.
let client: Client;

function body(result: any): any {
  return result.structuredContent;
}

/** Run assertions unless the call was rate-limited (keeps unauthenticated runs non-flaky). */
function unlessRateLimited(result: any, assert: () => void): void {
  if (result.isError && body(result)?.error?.code === "GITHUB_RATE_LIMITED") {
    return;
  }
  assert();
}

beforeAll(async () => {
  const config = {
    ...loadConfig({ env: process.env, home: tmpdir() }),
    deepwiki: { enabled: false },
  };
  const { server } = createServer({
    config,
    logger: silentLogger,
    cache: new MemoryCacheStore(),
    version: "live",
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "live-github", version: "1.0.0" });
  await Promise.all([client.connect(ct), server.connect(st)]);
});

afterAll(async () => {
  await client.close().catch(() => undefined);
});

describe("LIVE GitHub e2e (api.github.com)", () => {
  it("check_license classifies a real MIT repo", async () => {
    const r: any = await client.callTool({
      name: "oss_check_license",
      arguments: { repository: "facebook/react" },
    });
    unlessRateLimited(r, () => {
      expect(body(r).spdxId).toBe("MIT");
      expect(body(r).category).toBe("permissive");
      expect(body(r).riskLevel).toBe("low");
    });
  });

  it("search returns real repositories", async () => {
    const r: any = await client.callTool({
      name: "oss_search_repositories",
      arguments: { query: "sqlite", limit: 3 },
    });
    unlessRateLimited(r, () => {
      expect(body(r).items.length).toBeGreaterThan(0);
      expect(body(r).totalCount).toBeGreaterThan(0);
    });
  });

  it("analyze_repository returns a structured analysis", async () => {
    const r: any = await client.callTool({
      name: "oss_analyze_repository",
      arguments: { repository: "sindresorhus/slugify" },
    });
    unlessRateLimited(r, () => {
      expect(body(r).repository.toLowerCase()).toBe("sindresorhus/slugify");
      expect(typeof body(r).score.total).toBe("number");
      expect(["low", "medium", "high"]).toContain(body(r).risk.level);
    });
  });

  it("compare_repositories ranks real repos", async () => {
    const r: any = await client.callTool({
      name: "oss_compare_repositories",
      arguments: { repositories: ["expressjs/express", "koajs/koa"] },
    });
    unlessRateLimited(r, () => {
      // Valid CompareResult contract. Under an exhausted unauthenticated quota,
      // per-repo analyses are rate-limited and ranking is an empty array with an
      // explanatory summary (graceful degradation) — also acceptable.
      expect(Array.isArray(body(r).ranking)).toBe(true);
      expect(typeof body(r).summary).toBe("string");
      if (body(r).ranking.length > 0) {
        expect(body(r).winner).not.toBeNull();
      }
    });
  });

  it("find_open_source_alternatives returns a candidate list", async () => {
    const r: any = await client.callTool({
      name: "oss_find_open_source_alternatives",
      arguments: { target: "Postman", useCase: "API testing client", limit: 3 },
    });
    unlessRateLimited(r, () => {
      expect(Array.isArray(body(r).candidates)).toBe(true);
    });
  });
});
