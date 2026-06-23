import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "oss-cfg-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns documented defaults", () => {
    const cfg = loadConfig({ env: {}, home });
    expect(cfg.transport).toBe("stdio");
    expect(cfg.port).toBe(7345);
    expect(cfg.cache.enabled).toBe(true);
    expect(cfg.cache.ttlHours).toBe(24);
    expect(cfg.deepwiki.enabled).toBe(false);
    expect(cfg.limits.maxSearchResults).toBe(20);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.githubToken).toBeUndefined();
    expect(cfg.cache.path.startsWith(home)).toBe(true);
  });

  it("applies environment variables", () => {
    const cfg = loadConfig({
      home,
      env: {
        OSS_MCP_TRANSPORT: "http",
        OSS_MCP_PORT: "9000",
        OSS_MCP_CACHE_ENABLED: "false",
        OSS_MCP_DEEPWIKI_ENABLED: "true",
        OSS_MCP_MAX_RESULTS: "7",
        OSS_MCP_LOG_LEVEL: "debug",
        GITHUB_TOKEN: "tok123",
      },
    });
    expect(cfg.transport).toBe("http");
    expect(cfg.port).toBe(9000);
    expect(cfg.cache.enabled).toBe(false);
    expect(cfg.deepwiki.enabled).toBe(true);
    expect(cfg.limits.maxSearchResults).toBe(7);
    expect(cfg.logLevel).toBe("debug");
    expect(cfg.githubToken).toBe("tok123");
  });

  it("lets CLI overrides beat environment", () => {
    const cfg = loadConfig({
      home,
      env: { OSS_MCP_TRANSPORT: "http", OSS_MCP_PORT: "9000" },
      overrides: { transport: "stdio", port: 1234 },
    });
    expect(cfg.transport).toBe("stdio");
    expect(cfg.port).toBe(1234);
  });

  it("reads the token from the env var named in config.json", () => {
    const configPath = join(home, "config.json");
    writeFileSync(configPath, JSON.stringify({ githubTokenEnv: "MY_GH", cache: { ttlHours: 48 } }));
    const cfg = loadConfig({ home, configPath, env: { MY_GH: "secret-token" } });
    expect(cfg.githubToken).toBe("secret-token");
    expect(cfg.cache.ttlHours).toBe(48);
  });

  it("never reads the token from the config file itself", () => {
    const configPath = join(home, "config.json");
    // A stray "githubToken" field must be ignored (token only comes from env).
    writeFileSync(configPath, JSON.stringify({ githubToken: "leaked" }));
    const cfg = loadConfig({ home, configPath, env: {} });
    expect(cfg.githubToken).toBeUndefined();
  });

  it("expands ~ in the cache path", () => {
    const cfg = loadConfig({ home, env: { OSS_MCP_CACHE_PATH: "~/data/cache.sqlite" } });
    expect(cfg.cache.path).toBe(join(home, "data", "cache.sqlite"));
  });

  it("ignores a malformed (non-JSON) config file", () => {
    const configPath = join(home, "config.json");
    mkdirSync(join(home, "noise"), { recursive: true });
    writeFileSync(configPath, "{ not json");
    const cfg = loadConfig({ home, configPath, env: {} });
    expect(cfg.transport).toBe("stdio");
  });

  it("ignores malformed config-file field types without crashing", () => {
    const configPath = join(home, "config.json");
    // Every field is the wrong type — must fall back to defaults, never throw.
    writeFileSync(
      configPath,
      JSON.stringify({
        transport: 8080,
        logLevel: 5,
        port: null,
        cache: { enabled: "nope", path: 123, ttlHours: "x" },
        deepwiki: { enabled: "yes" },
        limits: { maxReadmeChars: "big", maxSearchResults: [] },
      }),
    );
    const cfg = loadConfig({ home, configPath, env: {} });
    expect(cfg.transport).toBe("stdio");
    expect(cfg.logLevel).toBe("info");
    expect(cfg.cache.enabled).toBe(true);
    expect(cfg.cache.ttlHours).toBe(24);
    expect(cfg.limits.maxReadmeChars).toBe(50000);
    expect(cfg.limits.maxSearchResults).toBe(20);
  });
});
