import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServerContext, createMcpServer } from "../../src/server.js";
import { startHttpServer, type HttpServerHandle } from "../../src/httpServer.js";
import { loadConfig } from "../../src/config.js";
import { MemoryCacheStore } from "../../src/cache/memoryCacheStore.js";
import { silentLogger } from "../../src/utils/logger.js";
import { TOOL_NAMES } from "../../src/tools/index.js";
import { makeGitHubFetch } from "../helpers/fakeGitHub.js";

function makeContext() {
  const config = { ...loadConfig({ env: {}, home: tmpdir() }), transport: "http" as const };
  return createServerContext({
    config,
    logger: silentLogger,
    cache: new MemoryCacheStore(),
    fetchImpl: makeGitHubFetch(),
    version: "1.0.0",
  });
}

function postWithHost(url: string, hostHeader: string, body: string): Promise<Response> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          host: hostHeader,
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 0,
              headers: res.headers as Record<string, string>,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

let handle: HttpServerHandle;
let client: Client;

beforeAll(async () => {
  const config = { ...loadConfig({ env: {}, home: tmpdir() }), transport: "http" as const };
  const context = createServerContext({
    config,
    logger: silentLogger,
    cache: new MemoryCacheStore(),
    fetchImpl: makeGitHubFetch(),
    version: "1.0.0",
  });
  handle = await startHttpServer({
    createMcpServer: () => createMcpServer(context),
    port: 0,
    logger: silentLogger,
  });
  client = new Client({ name: "http-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));
});

afterAll(async () => {
  await client.close().catch(() => undefined);
  await handle.close();
});

describe("Streamable HTTP transport", () => {
  it("serves tools/list over HTTP", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(TOOL_NAMES.length);
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("serves tools/call over HTTP", async () => {
    const res: any = await client.callTool({ name: "oss_health_check", arguments: {} });
    expect(res.structuredContent?.status).toBe("ok");
  });

  it("performs a real search over HTTP", async () => {
    const res: any = await client.callTool({
      name: "oss_search_repositories",
      arguments: { query: "cli", limit: 5 },
    });
    const items = res.structuredContent?.items ?? [];
    expect(items.length).toBe(2);
  });
});

describe("Streamable HTTP transport — DoS guards", () => {
  const MCP_HEADERS = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };

  it("rejects oversized request bodies with 413", async () => {
    const h = await startHttpServer({
      createMcpServer: () => createMcpServer(makeContext()),
      port: 0,
      logger: silentLogger,
      maxBodyBytes: 50,
    });
    try {
      const res = await fetch(h.url, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", pad: "x".repeat(500) }),
      });
      expect(res.status).toBe(413);
      const body: any = await res.json();
      expect(body.error.code).toBe("INVALID_INPUT");
    } finally {
      await h.close();
    }
  });

  it("rejects new sessions once the session cap is reached (503)", async () => {
    const h = await startHttpServer({
      createMcpServer: () => createMcpServer(makeContext()),
      port: 0,
      logger: silentLogger,
      maxSessions: 0,
    });
    try {
      const res = await fetch(h.url, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "x", version: "1" },
          },
        }),
      });
      expect(res.status).toBe(503);
      const body: any = await res.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
    } finally {
      await h.close();
    }
  });

  it("rejects requests with an untrusted Host header", async () => {
    const h = await startHttpServer({
      createMcpServer: () => createMcpServer(makeContext()),
      port: 0,
      logger: silentLogger,
    });
    try {
      const res = await postWithHost(
        h.url,
        "evil.test",
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "x", version: "1" },
          },
        }),
      );
      expect(res.status).toBe(403);
      const body: any = await res.json();
      expect(body.error.code).toBe("FORBIDDEN_HOST");
      expect(h.sessionCount()).toBe(0);
    } finally {
      await h.close();
    }
  });

  it("still returns 404 for non-/mcp paths", async () => {
    const h = await startHttpServer({
      createMcpServer: () => createMcpServer(makeContext()),
      port: 0,
      logger: silentLogger,
    });
    try {
      const res = await fetch(`${h.url.replace("/mcp", "")}/health`, { method: "GET" });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    } finally {
      await h.close();
    }
  });
});
