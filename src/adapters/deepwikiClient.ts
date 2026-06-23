import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Config } from "../config.js";
import type { Logger } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";
import { assertAllowedUrl } from "../utils/sanitize.js";
import type {
  DeepWikiAnswerResult,
  DeepWikiContentsResult,
  DeepWikiResult,
  DeepWikiStructureResult,
} from "../types/toolResults.js";

const DEEPWIKI_URL = "https://mcp.deepwiki.com/mcp";
const DEEPWIKI_TIMEOUT_MS = 90_000;
const DEEPWIKI_CONNECT_TIMEOUT_MS = 30_000;

export interface DeepWikiToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/** Low-level call into a DeepWiki MCP tool. Injectable for tests. */
export type DeepWikiCaller = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<DeepWikiToolResult>;

export interface DeepWikiClientDeps {
  config: Config;
  logger: Logger;
  /** Override the network call (used by tests). */
  caller?: DeepWikiCaller;
}

function extractText(result: DeepWikiToolResult): string {
  if (!Array.isArray(result.content)) return "";
  return result.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n")
    .trim();
}

function extractTopics(text: string): string[] {
  const topics = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s>#*\-\d.]+/, "").trim())
    .filter((line) => line.length > 0 && line.length < 120 && !/^available pages/i.test(line));
  return Array.from(new Set(topics)).slice(0, 30);
}

/** Default caller: connect to the live DeepWiki MCP server over Streamable HTTP. */
async function liveCaller(
  config: Config,
  toolName: string,
  args: Record<string, unknown>,
): Promise<DeepWikiToolResult> {
  // Defense-in-depth: the URL is constant, but still enforce the allowlist.
  assertAllowedUrl(DEEPWIKI_URL, { deepwikiEnabled: config.deepwiki.enabled });
  const client = new Client({ name: "oss-research-mcp", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(DEEPWIKI_URL));
  try {
    // Bound the handshake explicitly (the SDK's per-call timeout covers only
    // callTool, not connect) so a stalled connect can't hang the tool.
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) => {
        const t = setTimeout(
          () =>
            reject(new Error(`DeepWiki connect timed out after ${DEEPWIKI_CONNECT_TIMEOUT_MS}ms`)),
          DEEPWIKI_CONNECT_TIMEOUT_MS,
        );
        (t as { unref?: () => void }).unref?.();
      }),
    ]);
    const result = (await client.callTool({ name: toolName, arguments: args }, undefined, {
      timeout: DEEPWIKI_TIMEOUT_MS,
    })) as DeepWikiToolResult;
    return result;
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Optional DeepWiki adapter, disabled by default. Wraps the public DeepWiki MCP
 * server tools read_wiki_structure / read_wiki_contents / ask_question. Throws
 * DEEPWIKI_DISABLED when disabled and DEEPWIKI_UNAVAILABLE on any failure — it
 * never crashes the host tool call.
 */
export class DeepWikiClient {
  private readonly config: Config;
  private readonly logger: Logger;
  private readonly caller: DeepWikiCaller;

  constructor(deps: DeepWikiClientDeps) {
    this.config = deps.config;
    this.logger = deps.logger;
    this.caller = deps.caller ?? ((toolName, args) => liveCaller(this.config, toolName, args));
  }

  get enabled(): boolean {
    return this.config.deepwiki.enabled;
  }

  private ensureEnabled(): void {
    if (!this.config.deepwiki.enabled) {
      throw new AppError(
        "DEEPWIKI_DISABLED",
        "DeepWiki adapter is disabled. Enable with OSS_MCP_DEEPWIKI_ENABLED=true or --deepwiki true.",
      );
    }
  }

  private async call(toolName: string, args: Record<string, unknown>): Promise<string> {
    let result: DeepWikiToolResult;
    try {
      result = await this.caller(toolName, args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn("deepwiki call failed", { tool: toolName, error: message });
      throw new AppError("DEEPWIKI_UNAVAILABLE", `DeepWiki ${toolName} failed: ${message}`, {
        cause: err,
      });
    }
    if (result.isError) {
      const text = extractText(result) || "unknown error";
      this.logger.warn("deepwiki returned error", { tool: toolName, text });
      throw new AppError("DEEPWIKI_UNAVAILABLE", `DeepWiki ${toolName} error: ${text}`);
    }
    return extractText(result);
  }

  /** read_wiki_structure: list of documentation topics for a repository. */
  async readWikiStructure(repository: string): Promise<DeepWikiStructureResult> {
    this.ensureEnabled();
    const structure = await this.call("read_wiki_structure", { repoName: repository });
    return {
      repository,
      available: true,
      structure,
      topics: extractTopics(structure),
      source: "deepwiki",
    };
  }

  /** read_wiki_contents: full documentation contents for a repository. */
  async readWikiContents(repository: string): Promise<DeepWikiContentsResult> {
    this.ensureEnabled();
    const content = await this.call("read_wiki_contents", { repoName: repository });
    return { repository, available: true, content, source: "deepwiki" };
  }

  /** ask_question: context-grounded answer about a repository. */
  async askQuestion(repository: string, question: string): Promise<DeepWikiAnswerResult> {
    this.ensureEnabled();
    const answer = await this.call("ask_question", { repoName: repository, question });
    return { repository, available: true, question, answer, source: "deepwiki" };
  }

  /** Convenience summary: an ask_question answer plus topics from the structure. */
  async summarize(repository: string, question?: string): Promise<DeepWikiResult> {
    this.ensureEnabled();
    const finalQuestion =
      question && question.trim().length > 0
        ? question.trim()
        : `Summarize ${repository}: what it does, its key features, and typical use cases.`;
    const summary = await this.call("ask_question", {
      repoName: repository,
      question: finalQuestion,
    });
    let topics: string[] = [];
    try {
      const structure = await this.call("read_wiki_structure", { repoName: repository });
      topics = extractTopics(structure);
    } catch (err) {
      this.logger.debug("deepwiki summarize: structure unavailable", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { repository, available: true, summary, topics, source: "deepwiki" };
  }
}
