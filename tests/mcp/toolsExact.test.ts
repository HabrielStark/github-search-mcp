import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { connect, structured, FIXED, type Harness } from "../helpers/mcpHarness.js";
import { makeGitHubFetch, jsonResponse, rateLimitHeaders } from "../helpers/fakeGitHub.js";

let h: Harness;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED);
  h = await connect();
});

afterAll(async () => {
  await h.close();
  vi.useRealTimers();
});

describe("tool metadata (listTools)", () => {
  it("pins the full tool contract (titles, descriptions, input schemas)", async () => {
    const { tools } = await h.client.listTools();
    const byName = Object.fromEntries(
      tools
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => [
          t.name,
          {
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.annotations,
          },
        ]),
    );
    expect(byName).toMatchSnapshot();
  });
});

describe("oss_get_repository_profile — exact output", () => {
  it("maps the raw repo to the profile shape (with frozen dates)", async () => {
    const res = await h.client.callTool({
      name: "oss_get_repository_profile",
      arguments: { repository: "acme/repo-a" },
    });
    expect(res.isError).toBeFalsy();
    expect(structured(res)).toEqual({
      repository: "acme/repo-a",
      description: "repo-a — a sample repository",
      url: "https://github.com/acme/repo-a",
      defaultBranch: "main",
      stars: 1200,
      forks: 300,
      watchers: 50,
      openIssues: 20,
      language: "TypeScript",
      topics: ["cli", "tool"],
      license: "MIT",
      createdAt: "2020-01-01T00:00:00Z",
      updatedAt: "2025-05-29T00:00:00.000Z",
      pushedAt: "2025-05-27T00:00:00.000Z",
      archived: false,
      disabled: false,
      sizeKb: 5000,
      rateLimit: { remaining: 59, resetAt: "2025-06-01T01:00:00.000Z" },
    });
  });
});

describe("oss_get_repository_tree — exact output + branches", () => {
  it("maps blob→file / tree→dir and reports the branch", async () => {
    const res = await h.client.callTool({
      name: "oss_get_repository_tree",
      arguments: { repository: "acme/repo-a" },
    });
    const t = structured(res);
    expect(t.repository).toBe("acme/repo-a");
    expect(t.branch).toBe("main");
    expect(t.truncated).toBe(false);
    expect(t.files).toHaveLength(13);
    expect(t.files[0]).toEqual({ path: "package.json", type: "file", size: 100, sha: "a1" });
    expect(t.files.find((f: any) => f.path === "src")).toEqual({
      path: "src",
      type: "dir",
      size: null,
      sha: "a5",
    });
  });

  it("truncates to maxFiles and flags truncated", async () => {
    const res = await h.client.callTool({
      name: "oss_get_repository_tree",
      arguments: { repository: "acme/repo-a", maxFiles: 3 },
    });
    const t = structured(res);
    expect(t.files).toHaveLength(3);
    expect(t.truncated).toBe(true);
  });

  it("honors an explicit branch (no default-branch lookup)", async () => {
    const res = await h.client.callTool({
      name: "oss_get_repository_tree",
      arguments: { repository: "acme/repo-a", branch: "dev" },
    });
    expect(structured(res).branch).toBe("dev");
  });
});

describe("oss_get_readme — exact output + truncation", () => {
  it("returns the decoded README untruncated by default", async () => {
    const res = await h.client.callTool({
      name: "oss_get_readme",
      arguments: { repository: "acme/repo-a" },
    });
    const r = structured(res);
    expect(r.repository).toBe("acme/repo-a");
    expect(r.readmePath).toBe("README.md");
    expect(r.truncated).toBe(false);
    expect(r.content).toContain("## Installation");
    expect(r.content).toContain("## Usage");
  });

  it("truncates to maxChars and flags truncated", async () => {
    const res = await h.client.callTool({
      name: "oss_get_readme",
      arguments: { repository: "acme/repo-a", maxChars: 10 },
    });
    const r = structured(res);
    expect(r.content).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });
});

describe("oss_check_license — exact output + profile fallback", () => {
  it("classifies MIT from the license endpoint", async () => {
    const res = await h.client.callTool({
      name: "oss_check_license",
      arguments: { repository: "acme/repo-a" },
    });
    expect(structured(res)).toMatchObject({
      repository: "acme/repo-a",
      licenseDetected: "MIT License",
      spdxId: "MIT",
      category: "permissive",
      commercialUse: "yes",
      modification: "yes",
      distribution: "yes",
      privateUse: "yes",
      riskLevel: "low",
    });
  });

  it("falls back to the profile license when the license endpoint 404s", async () => {
    const fetchImpl = makeGitHubFetch({
      handler: (url) =>
        url.includes("/license")
          ? jsonResponse({ message: "Not Found" }, { status: 404, headers: rateLimitHeaders() })
          : undefined,
    });
    const alt = await connect({ fetchImpl });
    try {
      const res = await alt.client.callTool({
        name: "oss_check_license",
        arguments: { repository: "acme/repo-a" },
      });
      // profile.license is the normalized "MIT", so detection still succeeds.
      expect(structured(res).spdxId).toBe("MIT");
      expect(structured(res).category).toBe("permissive");
      expect(
        alt.fetch.calls.some((u) => u.includes("/repos/acme/repo-a") && !u.includes("/license")),
      ).toBe(true);
    } finally {
      await alt.close();
    }
  });

  it("uses the license endpoint result and skips the profile fallback when present", async () => {
    // Endpoint says Apache-2.0; profile says MIT. The endpoint must win, which
    // only holds if the `if (!info)` fallback is correctly skipped.
    const fetchImpl = makeGitHubFetch({
      handler: (url) =>
        url.includes("/license")
          ? jsonResponse(
              { license: { key: "apache-2.0", name: "Apache License 2.0", spdx_id: "Apache-2.0" } },
              { headers: rateLimitHeaders() },
            )
          : undefined,
    });
    const alt = await connect({ fetchImpl });
    try {
      const res = await alt.client.callTool({
        name: "oss_check_license",
        arguments: { repository: "acme/repo-a" },
      });
      expect(structured(res).spdxId).toBe("Apache-2.0");
    } finally {
      await alt.close();
    }
  });
});

describe("oss_read_repository_file — exact output + guards", () => {
  it("reads a text file as utf-8", async () => {
    const res = await h.client.callTool({
      name: "oss_read_repository_file",
      arguments: { repository: "acme/repo-a", path: "src/index.ts" },
    });
    expect(structured(res)).toEqual({
      repository: "acme/repo-a",
      path: "src/index.ts",
      branch: "main",
      content: "hello world\n",
      encoding: "utf-8",
      truncated: false,
      rateLimit: { remaining: 59, resetAt: "2025-06-01T01:00:00.000Z" },
    });
  });

  it("rejects a binary path by extension before any fetch", async () => {
    const res = await h.client.callTool({
      name: "oss_read_repository_file",
      arguments: { repository: "acme/repo-a", path: "logo.png" },
    });
    expect(res.isError).toBe(true);
    expect(structured(res).error.code).toBe("BINARY_FILE_NOT_SUPPORTED");
    expect(structured(res).error.message).toContain("binary file by extension");
    expect(structured(res).error.message).toContain("logo.png");
  });

  it("rejects path traversal before any fetch", async () => {
    const res = await h.client.callTool({
      name: "oss_read_repository_file",
      arguments: { repository: "acme/repo-a", path: "../etc/passwd" },
    });
    expect(res.isError).toBe(true);
    expect(structured(res).error.code).toBe("INVALID_INPUT");
  });

  it("truncates a large file to maxChars", async () => {
    const res = await h.client.callTool({
      name: "oss_read_repository_file",
      arguments: { repository: "acme/repo-a", path: "src/index.ts", maxChars: 5 },
    });
    const f = structured(res);
    expect(f.content).toHaveLength(5);
    expect(f.truncated).toBe(true);
  });
});

describe("oss_search_repositories — exact output + clamps", () => {
  it("returns mapped candidates, total count and rate limit", async () => {
    const res = await h.client.callTool({
      name: "oss_search_repositories",
      arguments: { query: "cli" },
    });
    const s = structured(res);
    expect(s.totalCount).toBe(2);
    expect(s.items).toHaveLength(2);
    expect(s.items[0]).toEqual({
      fullName: "acme/repo-a",
      owner: "acme",
      name: "repo-a",
      url: "https://github.com/acme/repo-a",
      description: "repo-a — a sample repository",
      stars: 5000,
      forks: 300,
      openIssues: 20,
      language: "TypeScript",
      topics: ["cli", "tool"],
      license: "MIT",
      archived: false,
      disabled: false,
      pushedAt: "2025-05-27T00:00:00.000Z",
      updatedAt: "2025-05-29T00:00:00.000Z",
    });
    expect(s.rateLimit).toEqual({ remaining: 59, resetAt: "2025-06-01T01:00:00.000Z" });
    // default limit (20) is sent as per_page
    expect(
      h.fetch.calls.some((u) => u.includes("/search/repositories") && u.includes("per_page=20")),
    ).toBe(true);
  });

  it("applies the result limit (slice)", async () => {
    const res = await h.client.callTool({
      name: "oss_search_repositories",
      arguments: { query: "cli", limit: 1 },
    });
    expect(structured(res).items).toHaveLength(1);
  });
});

describe("oss_health_check — exact output, no secrets", () => {
  it("reports status/version/cache/auth and a zero uptime under frozen time", async () => {
    const res = await h.client.callTool({ name: "oss_health_check", arguments: {} });
    expect(structured(res)).toEqual({
      name: "oss-research-mcp",
      version: "9.9.9",
      status: "ok",
      transport: "stdio",
      cacheEnabled: true,
      cacheBackend: "memory",
      deepwikiEnabled: false,
      githubAuthenticated: false,
      rateLimit: { remaining: 59, resetAt: "2025-06-01T01:00:00.000Z" },
      uptimeSeconds: 0,
    });
    expect(JSON.stringify(structured(res))).not.toMatch(/token/i);
  });
});
