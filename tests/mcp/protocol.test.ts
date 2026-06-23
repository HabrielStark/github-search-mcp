import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";
import { MemoryCacheStore } from "../../src/cache/memoryCacheStore.js";
import { silentLogger } from "../../src/utils/logger.js";
import { TOOL_NAMES } from "../../src/tools/index.js";
import { makeGitHubFetch } from "../helpers/fakeGitHub.js";
import type { DeepWikiCaller } from "../../src/adapters/deepwikiClient.js";

let client: Client;

const fakeDeepwiki: DeepWikiCaller = (toolName) => {
  if (toolName === "read_wiki_structure")
    return Promise.resolve({
      content: [
        {
          type: "text",
          text: "Available pages for acme/repo-a:\n\n- 1 Overview\n- 2 Architecture",
        },
      ],
    });
  if (toolName === "read_wiki_contents")
    return Promise.resolve({ content: [{ type: "text", text: "# Docs\nFull contents." }] });
  return Promise.resolve({ content: [{ type: "text", text: "It is a sample project." }] });
};

function structured(result: any): any {
  return result.structuredContent;
}

async function callExpectError(name: string, args: Record<string, unknown>): Promise<boolean> {
  try {
    const res: any = await client.callTool({ name, arguments: args });
    return res.isError === true;
  } catch {
    return true;
  }
}

beforeAll(async () => {
  const config = loadConfig({ env: {}, home: tmpdir() });
  const { server } = createServer({
    config,
    logger: silentLogger,
    cache: new MemoryCacheStore(),
    fetchImpl: makeGitHubFetch(),
    deepwikiCaller: fakeDeepwiki,
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(async () => {
  await client.close();
});

describe("MCP protocol", () => {
  it("lists exactly the oss_ tools with input schemas", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(TOOL_NAMES.length);
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.name.startsWith("oss_")).toBe(true);
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it("search returns structured items", async () => {
    const res = await client.callTool({
      name: "oss_search_repositories",
      arguments: { query: "cli" },
    });
    expect(res.isError).toBeFalsy();
    expect(structured(res).items.length).toBe(2);
    expect(structured(res).rateLimit).toBeDefined();
  });

  it("classifies a MIT license", async () => {
    const res = await client.callTool({
      name: "oss_check_license",
      arguments: { repository: "acme/repo-a" },
    });
    expect(structured(res).category).toBe("permissive");
    expect(structured(res).spdxId).toBe("MIT");
    expect(structured(res).riskLevel).toBe("low");
  });

  it("analyzes a repository into a structured report", async () => {
    const res = await client.callTool({
      name: "oss_analyze_repository",
      arguments: { repository: "acme/repo-a" },
    });
    const a = structured(res);
    expect(a.repository).toBe("acme/repo-a");
    expect(typeof a.score.total).toBe("number");
    expect(a.license.category).toBe("permissive");
    expect(["low", "medium", "high"]).toContain(a.risk.level);
    expect(typeof a.summary).toBe("string");
  });

  it("compares repositories and picks a winner", async () => {
    const res = await client.callTool({
      name: "oss_compare_repositories",
      arguments: { repositories: ["acme/repo-a", "globex/repo-b"] },
    });
    expect(structured(res).ranking.length).toBe(2);
    expect(structured(res).winner).not.toBeNull();
  });

  it("finds ranked alternatives", async () => {
    const res = await client.callTool({
      name: "oss_find_open_source_alternatives",
      arguments: { target: "Stripe", useCase: "payment processing" },
    });
    expect(Array.isArray(structured(res).candidates)).toBe(true);
    expect(structured(res).candidates.length).toBeGreaterThan(0);
    expect(structured(res).bestCandidate).not.toBeNull();
  });

  it("generates integration notes with install commands", async () => {
    const res = await client.callTool({
      name: "oss_generate_integration_notes",
      arguments: { repository: "acme/repo-a", targetStack: "Node.js", useCase: "tooling" },
    });
    expect(structured(res).installCommands.join(" ")).toMatch(/npm install/);
    expect(structured(res).licenseReminder).toMatch(/MIT/);
  });

  it("returns README, tree, profile and file", async () => {
    const readme = await client.callTool({
      name: "oss_get_readme",
      arguments: { repository: "acme/repo-a" },
    });
    expect(structured(readme).content).toMatch(/Installation/);
    const tree = await client.callTool({
      name: "oss_get_repository_tree",
      arguments: { repository: "acme/repo-a" },
    });
    expect(structured(tree).files.length).toBeGreaterThan(0);
    const profile = await client.callTool({
      name: "oss_get_repository_profile",
      arguments: { repository: "acme/repo-a" },
    });
    expect(structured(profile).repository).toBe("acme/repo-a");
    const file = await client.callTool({
      name: "oss_read_repository_file",
      arguments: { repository: "acme/repo-a", path: "src/index.ts" },
    });
    expect(structured(file).encoding).toBe("utf-8");
  });

  it("reports health with no secrets", async () => {
    const res = await client.callTool({ name: "oss_health_check", arguments: {} });
    const h = structured(res);
    expect(h.status).toBe("ok");
    expect(h.version).toBe("1.0.0");
    expect(h.cacheBackend).toBe("memory");
    expect(h.deepwikiEnabled).toBe(false);
    expect(h.githubAuthenticated).toBe(false);
    expect(JSON.stringify(h)).not.toMatch(/token/i);
  });

  it("returns a structured error for a bad repository format", async () => {
    const res = await client.callTool({
      name: "oss_get_repository_profile",
      arguments: { repository: "this is not valid" },
    });
    expect(res.isError).toBe(true);
    expect(structured(res).error.code).toBe("INVALID_REPOSITORY_FORMAT");
  });

  it("rejects a binary file read", async () => {
    const res = await client.callTool({
      name: "oss_read_repository_file",
      arguments: { repository: "acme/repo-a", path: "logo.png" },
    });
    expect(res.isError).toBe(true);
    expect(structured(res).error.code).toBe("BINARY_FILE_NOT_SUPPORTED");
  });

  it("exposes only the SRS DeepWiki summary tool and it is disabled by default", async () => {
    const summary = await client.callTool({
      name: "oss_deepwiki_summary",
      arguments: { repository: "acme/repo-a" },
    });
    expect(summary.isError).toBe(true);
    expect(structured(summary).error.code).toBe("DEEPWIKI_DISABLED");
  });

  it("returns DeepWiki summary when explicitly enabled", async () => {
    const enabledConfig = {
      ...loadConfig({ env: {}, home: tmpdir() }),
      deepwiki: { enabled: true },
    };
    const { server } = createServer({
      config: enabledConfig,
      logger: silentLogger,
      cache: new MemoryCacheStore(),
      fetchImpl: makeGitHubFetch(),
      deepwikiCaller: fakeDeepwiki,
      version: "1.0.0",
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const enabledClient = new Client({ name: "enabled-client", version: "1.0.0" });
    await Promise.all([enabledClient.connect(ct), server.connect(st)]);
    try {
      const summary = await enabledClient.callTool({
        name: "oss_deepwiki_summary",
        arguments: { repository: "acme/repo-a" },
      });
      expect(summary.isError).toBeFalsy();
      expect((summary.structuredContent as any).available).toBe(true);
      expect((summary.structuredContent as any).source).toBe("deepwiki");
    } finally {
      await enabledClient.close();
    }
  });

  it("errors on invalid arguments (missing required query)", async () => {
    expect(await callExpectError("oss_search_repositories", {})).toBe(true);
  });

  it("rejects free-text inputs that exceed their length limits", async () => {
    // query max is 256; useCase max is 500 — both must be rejected before any work.
    expect(await callExpectError("oss_search_repositories", { query: "x".repeat(300) })).toBe(true);
    expect(
      await callExpectError("oss_find_open_source_alternatives", {
        target: "Stripe",
        useCase: "u".repeat(600),
      }),
    ).toBe(true);
    // An over-long repository reference is rejected too.
    expect(
      await callExpectError("oss_get_repository_profile", { repository: `a/${"b".repeat(300)}` }),
    ).toBe(true);
  });
});

describe("MCP protocol — DeepWiki disabled", () => {
  it("returns DEEPWIKI_DISABLED when DeepWiki is turned off", async () => {
    const config = { ...loadConfig({ env: {}, home: tmpdir() }), deepwiki: { enabled: false } };
    const { server } = createServer({
      config,
      logger: silentLogger,
      cache: new MemoryCacheStore(),
      fetchImpl: makeGitHubFetch(),
      version: "1.0.0",
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const disabledClient = new Client({ name: "disabled-client", version: "1.0.0" });
    await Promise.all([disabledClient.connect(ct), server.connect(st)]);
    try {
      const res = await disabledClient.callTool({
        name: "oss_deepwiki_summary",
        arguments: { repository: "acme/repo-a" },
      });
      expect(res.isError).toBe(true);
      expect((res.structuredContent as any).error.code).toBe("DEEPWIKI_DISABLED");
    } finally {
      await disabledClient.close();
    }
  });
});
