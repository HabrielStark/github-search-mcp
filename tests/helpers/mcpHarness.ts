import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";
import type { Config } from "../../src/config.js";
import { MemoryCacheStore } from "../../src/cache/memoryCacheStore.js";
import { silentLogger } from "../../src/utils/logger.js";
import { makeGitHubFetch } from "./fakeGitHub.js";
import type { FakeGitHubFetch } from "./fakeGitHub.js";
import type { DeepWikiCaller } from "../../src/adapters/deepwikiClient.js";

/** Frozen clock so fixture time-derived fields are deterministic for exact assertions. */
export const FIXED = new Date("2025-06-01T00:00:00.000Z");

export const defaultDeepwiki: DeepWikiCaller = (toolName) => {
  if (toolName === "read_wiki_structure")
    return Promise.resolve({
      content: [{ type: "text", text: "Available pages:\n\n- 1 Overview\n- 2 Architecture" }],
    });
  if (toolName === "read_wiki_contents")
    return Promise.resolve({ content: [{ type: "text", text: "# Docs\nFull contents." }] });
  return Promise.resolve({ content: [{ type: "text", text: "It is a sample project." }] });
};

export interface Harness {
  client: Client;
  fetch: FakeGitHubFetch;
  close: () => Promise<void>;
}

export interface ConnectOptions {
  fetchImpl?: FakeGitHubFetch;
  deepwikiCaller?: DeepWikiCaller;
  deepwikiEnabled?: boolean;
  configOverride?: (config: Config) => Config;
  version?: string;
}

export async function connect(options: ConnectOptions = {}): Promise<Harness> {
  const fetchImpl = options.fetchImpl ?? makeGitHubFetch();
  const base = loadConfig({ env: {}, home: tmpdir() });
  const configWithDeepwiki =
    options.deepwikiEnabled === undefined
      ? base
      : { ...base, deepwiki: { enabled: options.deepwikiEnabled } };
  const config = options.configOverride
    ? options.configOverride(configWithDeepwiki)
    : configWithDeepwiki;
  const { server } = createServer({
    config,
    logger: silentLogger,
    cache: new MemoryCacheStore(),
    fetchImpl,
    deepwikiCaller: options.deepwikiCaller ?? defaultDeepwiki,
    version: options.version ?? "9.9.9",
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "exact", version: "1.0.0" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, fetch: fetchImpl, close: () => client.close() };
}

/** The (untyped) result a client receives back from {@link Client.callTool}. */
export type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

/**
 * Extract the `structuredContent` payload from a tool-call result.
 *
 * Tool outputs are validated against each tool's Zod schema on the server, so
 * by the time a result reaches a test the payload shape is already guaranteed.
 * Returning `any` keeps the per-tool assertions terse without re-deriving every
 * result type here.
 */
export function structured(res: ToolCallResult): any {
  return res.structuredContent;
}
