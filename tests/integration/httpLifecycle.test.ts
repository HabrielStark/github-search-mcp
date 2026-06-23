// HTTP transport lifecycle: must fail fast on a port conflict (not hang) and
// must sweep idle/abandoned sessions so they cannot leak and exhaust the cap.
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { createServerContext, createMcpServer } from "../../src/server.js";
import { startHttpServer } from "../../src/httpServer.js";
import { loadConfig } from "../../src/config.js";
import { MemoryCacheStore } from "../../src/cache/memoryCacheStore.js";
import { silentLogger } from "../../src/utils/logger.js";
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

const INIT_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "lifecycle", version: "1.0.0" },
  },
});

describe("HTTP transport lifecycle", () => {
  it("rejects instead of hanging when the port is already in use", async () => {
    const first = await startHttpServer({
      createMcpServer: () => createMcpServer(makeContext()),
      port: 0,
      logger: silentLogger,
    });
    try {
      await expect(
        startHttpServer({
          createMcpServer: () => createMcpServer(makeContext()),
          port: first.port, // already bound → EADDRINUSE
          logger: silentLogger,
        }),
      ).rejects.toBeDefined();
    } finally {
      await first.close();
    }
  });

  it("sweeps an abandoned session after its TTL (no leak)", async () => {
    const h = await startHttpServer({
      createMcpServer: () => createMcpServer(makeContext()),
      port: 0,
      logger: silentLogger,
      sessionTtlMs: 50,
    });
    try {
      const res = await fetch(h.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: INIT_BODY,
      });
      expect(res.status).toBe(200);
      expect(h.sessionCount()).toBe(1);
      // The sweeper floor is 1s; wait past a tick with margin.
      await new Promise((r) => setTimeout(r, 1600));
      expect(h.sessionCount()).toBe(0);
    } finally {
      await h.close();
    }
  }, 10000);
});
