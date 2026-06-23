import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { DeepWikiClient } from "../../src/adapters/deepwikiClient.js";
import { loadConfig } from "../../src/config.js";
import { silentLogger } from "../../src/utils/logger.js";
import { AppError } from "../../src/utils/errors.js";

// LIVE: real network round-trip against https://mcp.deepwiki.com/mcp
const REPO = "tursodatabase/turso";

/**
 * DeepWiki's ask-based endpoints are AI-generated and can be slow or transiently
 * unavailable. Per spec, an unavailable DeepWiki must surface as a structured
 * DEEPWIKI_UNAVAILABLE error — which is a VALID outcome. So for the slow AI calls
 * we assert success-shape OR a structured DEEPWIKI_UNAVAILABLE (a real network call
 * is always made either way). The fast, reliable endpoints stay strict.
 */
async function liveOk<T>(fn: () => Promise<T>, assertShape: (value: T) => void): Promise<void> {
  try {
    assertShape(await fn());
  } catch (err) {
    if (err instanceof AppError && err.code === "DEEPWIKI_UNAVAILABLE") return;
    throw err;
  }
}

describe("LIVE DeepWiki round-trip (mcp.deepwiki.com)", () => {
  const config = { ...loadConfig({ env: {}, home: tmpdir() }), deepwiki: { enabled: true } };
  const client = new DeepWikiClient({ config, logger: silentLogger });

  it("read_wiki_structure returns real topics", async () => {
    const r = await client.readWikiStructure(REPO);
    expect(r.available).toBe(true);
    expect(r.source).toBe("deepwiki");
    expect(r.structure.length).toBeGreaterThan(20);
    expect(r.topics.length).toBeGreaterThan(0);
  });

  it("read_wiki_contents returns documentation text", async () => {
    const r = await client.readWikiContents(REPO);
    expect(r.content.length).toBeGreaterThan(50);
  });

  it("ask_question returns a grounded answer (or structured unavailable)", async () => {
    await liveOk(
      () => client.askQuestion(REPO, "What programming language is this project written in?"),
      (r) => {
        expect(r.available).toBe(true);
        expect(r.answer.length).toBeGreaterThan(10);
      },
    );
  });

  it("summarize returns an answer plus topics (or structured unavailable)", async () => {
    await liveOk(
      () => client.summarize(REPO),
      (r) => {
        expect(r.summary.length).toBeGreaterThan(10);
      },
    );
  });

  it("returns DEEPWIKI_DISABLED structured error when disabled (no network)", async () => {
    const disabled = new DeepWikiClient({
      config: { ...config, deepwiki: { enabled: false } },
      logger: silentLogger,
    });
    await expect(disabled.summarize(REPO)).rejects.toMatchObject({ code: "DEEPWIKI_DISABLED" });
  });
});
