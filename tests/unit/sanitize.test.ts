import { describe, it, expect } from "vitest";
import {
  assertAllowedUrl,
  assertSafeRepoPath,
  createRedactor,
  isBinaryContent,
  isBinaryPath,
  parseRepository,
  truncate,
} from "../../src/utils/sanitize.js";
import { AppError } from "../../src/utils/errors.js";

describe("parseRepository", () => {
  it("parses owner/repo", () => {
    expect(parseRepository("octocat/Hello-World")).toEqual({
      owner: "octocat",
      repo: "Hello-World",
      fullName: "octocat/Hello-World",
    });
  });

  it("strips a GitHub URL and .git suffix", () => {
    expect(parseRepository("https://github.com/octocat/Hello-World.git").fullName).toBe(
      "octocat/Hello-World",
    );
  });

  it("accepts dots, underscores and dashes", () => {
    expect(parseRepository("a.b_c/d.e_f-g").fullName).toBe("a.b_c/d.e_f-g");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parseRepository("  owner/repo  ").fullName).toBe("owner/repo");
  });

  it("strips git@, https/http URLs and trailing slashes", () => {
    expect(parseRepository("git@github.com:owner/repo").fullName).toBe("owner/repo");
    expect(parseRepository("https://github.com/owner/repo").fullName).toBe("owner/repo");
    expect(parseRepository("http://github.com/a/b").fullName).toBe("a/b");
    expect(parseRepository("owner/repo/").fullName).toBe("owner/repo");
    expect(parseRepository("a/b///").fullName).toBe("a/b");
  });

  it("strips a trailing slash before removing the .git suffix", () => {
    expect(parseRepository("owner/repo.git/").fullName).toBe("owner/repo");
    expect(parseRepository("https://github.com/owner/repo.git/").fullName).toBe("owner/repo");
    expect(parseRepository("git@github.com:owner/repo.git/").fullName).toBe("owner/repo");
  });

  it("rejects '.' and '..' repository names", () => {
    expect(() => parseRepository("owner/.")).toThrow(/Invalid repository name/);
    expect(() => parseRepository("owner/..")).toThrow(/Invalid repository name/);
  });

  it("includes the offending input in the format error", () => {
    expect(() => parseRepository("nope")).toThrow(
      /Invalid repository format: "nope"\. Expected "owner\/repo"\./,
    );
  });

  it("rejects non-string input with the documented message", () => {
    expect(() => parseRepository(123 as unknown as string)).toThrow(/Repository must be a string/);
    try {
      parseRepository(null as unknown as string);
    } catch (e) {
      expect((e as AppError).code).toBe("INVALID_REPOSITORY_FORMAT");
    }
  });

  it.each(["", "no-slash", "owner/", "/repo", "a/b/c", "owner/.."])(
    "rejects malformed %s",
    (value) => {
      expect(() => parseRepository(value)).toThrowError(AppError);
      try {
        parseRepository(value);
      } catch (err) {
        expect((err as AppError).code).toBe("INVALID_REPOSITORY_FORMAT");
      }
    },
  );
});

describe("isBinaryPath", () => {
  it.each([".png", ".jpg", ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".dylib", ".mp4"])(
    "treats %s as binary",
    (ext) => {
      expect(isBinaryPath(`assets/file${ext}`)).toBe(true);
    },
  );

  it.each(["src/index.ts", "README.md", "Dockerfile", "go.mod", "a/b/c.json"])(
    "treats %s as text",
    (path) => {
      expect(isBinaryPath(path)).toBe(false);
    },
  );

  it("treats a dotfile or a leading-dot extension as text (no extension before index 0)", () => {
    expect(isBinaryPath(".gitignore")).toBe(false);
    expect(isBinaryPath(".png")).toBe(false);
    expect(isBinaryPath("a.png")).toBe(true);
    expect(isBinaryPath("noextension")).toBe(false);
  });

  it("handles backslash path separators", () => {
    expect(isBinaryPath("dir\\sub\\image.jpg")).toBe(true);
    expect(isBinaryPath("dir\\sub\\code.ts")).toBe(false);
  });

  it.each([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".ico",
    ".tiff",
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
    ".mp3",
    ".wav",
    ".flac",
    ".ogg",
    ".zip",
    ".tar",
    ".gz",
    ".bz2",
    ".7z",
    ".rar",
    ".xz",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".bin",
    ".o",
    ".a",
    ".class",
    ".jar",
    ".wasm",
    ".pdf",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".otf",
    ".psd",
    ".sketch",
  ])("treats the full binary-extension table entry %s as binary", (ext) => {
    expect(isBinaryPath(`dir/file${ext}`)).toBe(true);
  });

  it.each([".ts", ".js", ".md", ".json", ".py", ".rs", ".go", ".txt", ".yml", ".toml", ""])(
    "treats %s as text",
    (ext) => {
      expect(isBinaryPath(`dir/file${ext}`)).toBe(false);
    },
  );
});

describe("truncate", () => {
  it("returns full content when within limit", () => {
    expect(truncate("hello", 10)).toEqual({ content: "hello", truncated: false });
  });
  it("truncates when over limit", () => {
    expect(truncate("hello world", 5)).toEqual({ content: "hello", truncated: true });
  });
  it("treats <=0 maxChars as unlimited", () => {
    expect(truncate("hello", 0)).toEqual({ content: "hello", truncated: false });
  });
});

describe("createRedactor", () => {
  it("redacts the configured token", () => {
    const redact = createRedactor("supersecrettoken123");
    expect(redact("auth supersecrettoken123 end")).toBe("auth *** end");
  });
  it("redacts GitHub token patterns", () => {
    const redact = createRedactor();
    expect(redact("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")).toContain("***");
    expect(redact("Bearer abcdef.ghijkl-mnopq")).toContain("***");
  });

  it("redacts a configured token only at length >= 6", () => {
    expect(createRedactor("secret9")("x secret9 y")).toBe("x *** y");
    expect(createRedactor("abcdef")("x abcdef y")).toBe("x *** y"); // exactly 6 → redacted
    expect(createRedactor("abcde")("x abcde y")).toBe("x abcde y"); // 5 → left as-is
  });

  it("redacts GitHub PAT and Bearer patterns with surrounding text", () => {
    expect(createRedactor()(`token ghp_${"a".repeat(20)} end`)).toBe("token *** end");
    expect(createRedactor()("Authorization: Bearer abc.def-123")).toContain("***");
    expect(createRedactor()("Authorization: Bearer   abc123def")).toContain("***");
  });

  it("redacts github_pat_ only at >= 20 trailing chars", () => {
    const redact = createRedactor();
    const short = `github_pat_${"a".repeat(19)}`;
    const long = `github_pat_${"a".repeat(22)}`;
    expect(redact(short)).toBe(short);
    expect(redact(long)).toContain("***");
    expect(redact(long)).not.toContain(long);
  });
});

describe("assertAllowedUrl", () => {
  it("allows GitHub API and raw hosts", () => {
    expect(() =>
      assertAllowedUrl("https://api.github.com/repos/a/b", { deepwikiEnabled: false }),
    ).not.toThrow();
    expect(() =>
      assertAllowedUrl("https://raw.githubusercontent.com/a/b/main/x", { deepwikiEnabled: false }),
    ).not.toThrow();
  });
  it("blocks non-allowlisted hosts", () => {
    expect(() =>
      assertAllowedUrl("https://evil.example.com", { deepwikiEnabled: false }),
    ).toThrowError(AppError);
  });
  it("blocks non-https", () => {
    expect(() =>
      assertAllowedUrl("http://api.github.com", { deepwikiEnabled: false }),
    ).toThrowError(AppError);
  });
  it("gates DeepWiki on the enabled flag", () => {
    expect(() =>
      assertAllowedUrl("https://mcp.deepwiki.com/mcp", { deepwikiEnabled: false }),
    ).toThrow();
    expect(() =>
      assertAllowedUrl("https://mcp.deepwiki.com/mcp", { deepwikiEnabled: true }),
    ).not.toThrow();
  });
  it("throws the exact messages for invalid, non-https and disallowed URLs", () => {
    expect(() => assertAllowedUrl("not a url", { deepwikiEnabled: false })).toThrow(/Invalid URL/);
    expect(() => assertAllowedUrl("http://api.github.com/x", { deepwikiEnabled: false })).toThrow(
      /Only https/,
    );
    expect(() => assertAllowedUrl("https://evil.example.com", { deepwikiEnabled: false })).toThrow(
      /Host not allowed/,
    );
  });
  it("uses the INVALID_INPUT code for a malformed URL", () => {
    try {
      assertAllowedUrl("::::", { deepwikiEnabled: false });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("INVALID_INPUT");
    }
  });
});

describe("isBinaryContent", () => {
  it("flags buffers containing a NUL byte", () => {
    expect(isBinaryContent(Buffer.from([0x68, 0x69, 0x00, 0x21]))).toBe(true);
  });

  it("treats pure UTF-8 text as non-binary", () => {
    expect(isBinaryContent(Buffer.from("hello world\nline two\n", "utf-8"))).toBe(false);
    expect(isBinaryContent(Buffer.from("accented: café — ✓", "utf-8"))).toBe(false);
  });

  it("only sniffs the leading window", () => {
    const buf = Buffer.concat([Buffer.alloc(8000, 0x41), Buffer.from([0x00])]);
    expect(isBinaryContent(buf, 8000)).toBe(false); // NUL is just past the window
    expect(isBinaryContent(buf, 9000)).toBe(true); // widen the window and it's caught
  });

  it("treats an empty buffer as non-binary", () => {
    expect(isBinaryContent(Buffer.alloc(0))).toBe(false);
  });
});

describe("assertSafeRepoPath (path-traversal guard)", () => {
  it("rejects '.' and '..' segments", () => {
    expect(() => assertSafeRepoPath("../../x")).toThrow(/must not contain/);
    expect(() => assertSafeRepoPath("a/./b")).toThrow(/must not contain/);
    expect(() => assertSafeRepoPath("a/../b")).toThrow(/must not contain/);
    expect(() => assertSafeRepoPath("..")).toThrow(AppError);
  });
  it("allows normal paths including dotted filenames", () => {
    expect(() => assertSafeRepoPath("src/index.ts")).not.toThrow();
    expect(() => assertSafeRepoPath("a/b/c.json")).not.toThrow();
    expect(() => assertSafeRepoPath("file.with.dots.ts")).not.toThrow();
    expect(() => assertSafeRepoPath(".github/workflows/ci.yml")).not.toThrow();
  });
});
