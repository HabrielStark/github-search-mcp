// runTool must redact token-shaped strings on BOTH the text and the
// structuredContent channels (the latter previously leaked verbatim).
import { describe, it, expect } from "vitest";
import { runTool, type ServerContext } from "../../src/tools/shared.js";
import { createRedactor } from "../../src/utils/sanitize.js";
import { silentLogger } from "../../src/utils/logger.js";

const ctx = {
  redact: createRedactor("mysupersecrettoken"),
  logger: silentLogger,
  github: { getLastRateLimit: () => ({ remaining: 17, resetAt: "2026-01-02T03:04:05.000Z" }) },
} as unknown as ServerContext;

describe("runTool — both channels are redacted", () => {
  it("masks token-shaped content in structuredContent, not only in text", async () => {
    const r = await runTool(ctx, async () => ({
      a: `ghp_${"a".repeat(20)}`,
      nested: { t: "x mysupersecrettoken y" },
    }));
    const sc = r.structuredContent as { a: string; nested: { t: string } };
    expect(sc.a).toBe("***");
    expect(sc.nested.t).toBe("x *** y");
    expect(JSON.stringify(sc)).not.toMatch(/ghp_a/);
    expect(JSON.stringify(sc)).not.toContain("mysupersecrettoken");
    const text = (r.content[0] as { text: string }).text;
    expect(text).not.toContain("mysupersecrettoken");
  });

  it("redacts error payloads on both channels", async () => {
    const r = await runTool(ctx, async () => {
      throw new Error("boom mysupersecrettoken");
    });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.structuredContent)).not.toContain("mysupersecrettoken");
    expect((r.content[0] as { text: string }).text).not.toContain("mysupersecrettoken");
  });

  it("adds the current GitHub rate-limit summary to successful object payloads", async () => {
    const r = await runTool(ctx, async () => ({ ok: true }));
    expect(r.structuredContent).toMatchObject({
      ok: true,
      rateLimit: { remaining: 17, resetAt: "2026-01-02T03:04:05.000Z" },
    });
  });

  it("does not overwrite a tool-specific rate-limit summary", async () => {
    const r = await runTool(ctx, async () => ({
      ok: true,
      rateLimit: { remaining: 1, resetAt: null },
    }));
    expect(r.structuredContent).toMatchObject({
      ok: true,
      rateLimit: { remaining: 1, resetAt: null },
    });
  });
});
