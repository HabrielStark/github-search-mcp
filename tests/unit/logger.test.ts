import { describe, it, expect } from "vitest";
import { createLogger, silentLogger } from "../../src/utils/logger.js";

function capture(): { stream: { write(c: string): boolean }; lines: string[] } {
  const lines: string[] = [];
  return {
    stream: {
      write: (c: string) => {
        lines.push(c);
        return true;
      },
    },
    lines,
  };
}

describe("createLogger", () => {
  it("writes JSON entries with level/msg/meta and a timestamp", () => {
    const { stream, lines } = capture();
    createLogger({ level: "debug", stream }).info("hello", { a: 1 });
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("hello");
    expect(entry.meta).toEqual({ a: 1 });
    expect(typeof entry.time).toBe("string");
  });

  it("filters messages below the configured level", () => {
    const { stream, lines } = capture();
    const log = createLogger({ level: "warn", stream });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines.map((l) => JSON.parse(l).level)).toEqual(["warn", "error"]);
  });

  it("redacts the configured token and known token patterns", () => {
    const { stream, lines } = capture();
    const log = createLogger({ level: "info", token: "supersecretvalue", stream });
    log.info("using supersecretvalue and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    expect(lines[0]).not.toContain("supersecretvalue");
    expect(lines[0]).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    expect(lines[0]).toContain("***");
  });

  it("silentLogger performs no output and never throws", () => {
    expect(() => {
      silentLogger.debug("x");
      silentLogger.info("x");
      silentLogger.warn("x");
      silentLogger.error("x");
    }).not.toThrow();
  });
});
