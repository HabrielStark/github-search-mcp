import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { DeepWikiClient, type DeepWikiCaller } from "../../src/adapters/deepwikiClient.js";
import { loadConfig, type Config } from "../../src/config.js";
import { silentLogger } from "../../src/utils/logger.js";
import { AppError } from "../../src/utils/errors.js";

function config(enabled: boolean): Config {
  return { ...loadConfig({ env: {}, home: tmpdir() }), deepwiki: { enabled } };
}

const fakeCaller: DeepWikiCaller = (toolName) => {
  if (toolName === "read_wiki_structure")
    return Promise.resolve({
      content: [
        { type: "text", text: "Available pages for o/r:\n\n- 1 Overview\n- 2 Architecture" },
      ],
    });
  if (toolName === "read_wiki_contents")
    return Promise.resolve({ content: [{ type: "text", text: "# Docs\nFull contents here." }] });
  if (toolName === "ask_question")
    return Promise.resolve({ content: [{ type: "text", text: "It is a sample project." }] });
  return Promise.resolve({ content: [], isError: true });
};

describe("DeepWikiClient", () => {
  it("is disabled by default in the global config", () => {
    expect(loadConfig({ env: {}, home: tmpdir() }).deepwiki.enabled).toBe(false);
  });

  it("is enabled when configured", () => {
    expect(new DeepWikiClient({ config: config(true), logger: silentLogger }).enabled).toBe(true);
  });

  it("throws DEEPWIKI_DISABLED when disabled and never calls the network", async () => {
    let called = false;
    const client = new DeepWikiClient({
      config: config(false),
      logger: silentLogger,
      caller: () => {
        called = true;
        return Promise.resolve({ content: [] });
      },
    });
    await expect(client.summarize("o/r")).rejects.toMatchObject({ code: "DEEPWIKI_DISABLED" });
    await expect(client.readWikiStructure("o/r")).rejects.toMatchObject({
      code: "DEEPWIKI_DISABLED",
    });
    await expect(client.readWikiContents("o/r")).rejects.toMatchObject({
      code: "DEEPWIKI_DISABLED",
    });
    await expect(client.askQuestion("o/r", "q")).rejects.toMatchObject({
      code: "DEEPWIKI_DISABLED",
    });
    expect(called).toBe(false);
  });

  it("read_wiki_structure returns structure + parsed topics", async () => {
    const client = new DeepWikiClient({
      config: config(true),
      logger: silentLogger,
      caller: fakeCaller,
    });
    const r = await client.readWikiStructure("o/r");
    expect(r.available).toBe(true);
    expect(r.source).toBe("deepwiki");
    expect(r.topics).toEqual(expect.arrayContaining(["Overview", "Architecture"]));
  });

  it("read_wiki_contents returns contents", async () => {
    const client = new DeepWikiClient({
      config: config(true),
      logger: silentLogger,
      caller: fakeCaller,
    });
    const r = await client.readWikiContents("o/r");
    expect(r.content).toContain("Full contents");
  });

  it("ask_question returns an answer", async () => {
    const client = new DeepWikiClient({
      config: config(true),
      logger: silentLogger,
      caller: fakeCaller,
    });
    const r = await client.askQuestion("o/r", "what is it?");
    expect(r.question).toBe("what is it?");
    expect(r.answer).toContain("sample project");
  });

  it("summarize returns answer + topics", async () => {
    const client = new DeepWikiClient({
      config: config(true),
      logger: silentLogger,
      caller: fakeCaller,
    });
    const r = await client.summarize("o/r");
    expect(r.summary).toContain("sample project");
    expect(r.topics.length).toBeGreaterThan(0);
  });

  it("maps caller failures to DEEPWIKI_UNAVAILABLE", async () => {
    const client = new DeepWikiClient({
      config: config(true),
      logger: silentLogger,
      caller: () => Promise.reject(new Error("network down")),
    });
    await expect(client.askQuestion("o/r", "q")).rejects.toBeInstanceOf(AppError);
    await expect(client.askQuestion("o/r", "q")).rejects.toMatchObject({
      code: "DEEPWIKI_UNAVAILABLE",
    });
  });

  it("maps tool isError to DEEPWIKI_UNAVAILABLE", async () => {
    const client = new DeepWikiClient({
      config: config(true),
      logger: silentLogger,
      caller: () => Promise.resolve({ content: [{ type: "text", text: "boom" }], isError: true }),
    });
    await expect(client.readWikiContents("o/r")).rejects.toMatchObject({
      code: "DEEPWIKI_UNAVAILABLE",
    });
  });
});
