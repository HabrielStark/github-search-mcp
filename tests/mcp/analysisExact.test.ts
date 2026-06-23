import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { connect, structured, FIXED, type Harness } from "../helpers/mcpHarness.js";
import {
  makeGitHubFetch,
  jsonResponse,
  rateLimitHeaders,
  repoObject,
} from "../helpers/fakeGitHub.js";
import { AppError } from "../../src/utils/errors.js";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED);
});
afterAll(() => {
  vi.useRealTimers();
});

// A polyglot repo whose tree carries every package-manager manifest, so the
// install-command builder exercises all switch arms in one call.
function polyglotFetch() {
  const h = () => rateLimitHeaders();
  return makeGitHubFetch({
    handler: (url) => {
      const { pathname } = new URL(url);
      const m = /^\/repos\/poly\/glot(\/.*)?$/.exec(pathname);
      if (!m) return undefined;
      const sub = m[1] ?? "";
      if (sub === "") return jsonResponse(repoObject("poly", "glot"), { headers: h() });
      if (sub === "/license")
        return jsonResponse(
          { license: { key: "mit", name: "MIT License", spdx_id: "MIT" } },
          { headers: h() },
        );
      if (sub === "/readme")
        return jsonResponse(
          {
            path: "README.md",
            encoding: "base64",
            content: Buffer.from("# glot\n\nNo usage section here.", "utf-8").toString("base64"),
          },
          { headers: h() },
        );
      if (sub.startsWith("/git/trees/"))
        return jsonResponse(
          {
            sha: "t",
            truncated: false,
            tree: [
              "package.json",
              "requirements.txt",
              "Cargo.toml",
              "go.mod",
              "pom.xml",
              "build.gradle",
              "composer.json",
              "Gemfile",
            ].map((p, i) => ({ path: p, type: "blob", size: 10, sha: `s${i}` })),
          },
          { headers: h() },
        );
      if (sub.startsWith("/releases")) return jsonResponse([], { headers: h() });
      if (sub.startsWith("/commits")) return jsonResponse([], { headers: h() });
      if (sub.startsWith("/contents/"))
        return jsonResponse({ message: "Not Found" }, { status: 404, headers: h() });
      return undefined;
    },
  });
}

describe("oss_analyze_repository", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await connect();
  });
  afterAll(async () => {
    await h.close();
  });

  it("returns the full analysis (no DeepWiki by default)", async () => {
    const res = await h.client.callTool({
      name: "oss_analyze_repository",
      arguments: { repository: "acme/repo-a" },
    });
    expect(res.isError).toBeFalsy();
    expect(structured(res)).toMatchSnapshot();
  });

  it("appends a DeepWiki summary when includeDeepWiki is true", async () => {
    const enabled = await connect({ deepwikiEnabled: true });
    try {
      const res = await enabled.client.callTool({
        name: "oss_analyze_repository",
        arguments: { repository: "acme/repo-a", includeDeepWiki: true },
      });
      expect(structured(res).summary).toContain(" | DeepWiki: ");
    } finally {
      await enabled.close();
    }
  });

  it("notes DeepWiki disabled when the integration is off", async () => {
    const off = await connect({ deepwikiEnabled: false });
    try {
      const res = await off.client.callTool({
        name: "oss_analyze_repository",
        arguments: { repository: "acme/repo-a", includeDeepWiki: true },
      });
      expect(structured(res).summary).toContain(" | DeepWiki: disabled.");
    } finally {
      await off.close();
    }
  });

  it("notes DeepWiki unavailable when summarize throws", async () => {
    const failing = await connect({
      deepwikiEnabled: true,
      deepwikiCaller: () => Promise.reject(new AppError("DEEPWIKI_UNAVAILABLE", "down")),
    });
    try {
      const res = await failing.client.callTool({
        name: "oss_analyze_repository",
        arguments: { repository: "acme/repo-a", includeDeepWiki: true },
      });
      expect(structured(res).summary).toContain(" | DeepWiki: unavailable (DEEPWIKI_UNAVAILABLE)");
    } finally {
      await failing.close();
    }
  });

  it("threads the include* flags into the analysis (no README when disabled)", async () => {
    const res = await h.client.callTool({
      name: "oss_analyze_repository",
      arguments: {
        repository: "acme/repo-a",
        includeReadme: false,
        includeTree: false,
        includeLicense: false,
        includePackageFiles: false,
      },
    });
    // With includeReadme:false the analyzer must not fetch/score the README,
    // which distinguishes the real options object from an empty one.
    expect(structured(res).documentation.hasReadme).toBe(false);
    expect(structured(res).summary).toContain("no README");
  });
});

describe("oss_generate_integration_notes", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await connect();
  });
  afterAll(async () => {
    await h.close();
  });

  it("produces install commands, important files, usage, steps, risks and a license reminder", async () => {
    const res = await h.client.callTool({
      name: "oss_generate_integration_notes",
      arguments: { repository: "acme/repo-a", targetStack: "Node.js", useCase: "tooling" },
    });
    expect(res.isError).toBeFalsy();
    expect(structured(res)).toMatchSnapshot();
  });

  it("builds an install command for every detected package manager", async () => {
    const poly = await connect({ fetchImpl: polyglotFetch() });
    try {
      const res = await poly.client.callTool({
        name: "oss_generate_integration_notes",
        arguments: { repository: "poly/glot", targetStack: "polyglot", useCase: "everything" },
      });
      const cmds: string[] = structured(res).installCommands;
      expect(cmds).toEqual(
        expect.arrayContaining([
          expect.stringContaining("npm install glot"),
          expect.stringContaining("pip install glot"),
          expect.stringContaining("cargo add glot"),
          expect.stringContaining("go get github.com/poly/glot"),
          expect.stringContaining("Maven"),
          expect.stringContaining("Gradle"),
          expect.stringContaining("composer require poly/glot"),
          expect.stringContaining("gem install glot"),
          expect.stringContaining("git clone https://github.com/poly/glot.git"),
        ]),
      );
      // README has no fenced code or usage heading → fallback usage text.
      expect(structured(res).basicUsage).toBe("See the project README for usage details.");
      // Steps adapt to "no examples / no tests".
      expect(structured(res).integrationSteps).toEqual(
        expect.arrayContaining([
          "Look for usage examples in the README.",
          "Add tests around your integration.",
        ]),
      );
    } finally {
      await poly.close();
    }
  });

  it("labels README-derived usage as untrusted and uses the first code fence", async () => {
    const res = await h.client.callTool({
      name: "oss_generate_integration_notes",
      arguments: { repository: "acme/repo-a", targetStack: "Node.js", useCase: "tooling" },
    });
    expect(structured(res).basicUsage).toContain("[untrusted");
    expect(structured(res).basicUsage).toContain("npm install demo");
  });

  it("extracts usage from a heading when there is no code fence", async () => {
    const headingReadme = makeGitHubFetch({
      handler: (url) =>
        url.includes("/readme")
          ? jsonResponse(
              {
                path: "README.md",
                encoding: "base64",
                content: Buffer.from(
                  "# Lib\n\n## Getting Started\nRun the thing with care.\n",
                  "utf-8",
                ).toString("base64"),
              },
              { headers: rateLimitHeaders() },
            )
          : undefined,
    });
    const alt = await connect({ fetchImpl: headingReadme });
    try {
      const res = await alt.client.callTool({
        name: "oss_generate_integration_notes",
        arguments: { repository: "acme/repo-a", targetStack: "Node.js", useCase: "tooling" },
      });
      expect(structured(res).basicUsage).toContain("[untrusted");
      expect(structured(res).basicUsage).toContain("Run the thing with care.");
    } finally {
      await alt.close();
    }
  });

  it("degrades gracefully when the tree and README are unavailable", async () => {
    const noExtras = makeGitHubFetch({
      handler: (url) =>
        url.includes("/git/trees/") || url.includes("/readme")
          ? jsonResponse({ message: "Not Found" }, { status: 404, headers: rateLimitHeaders() })
          : undefined,
    });
    const alt = await connect({ fetchImpl: noExtras });
    try {
      const res = await alt.client.callTool({
        name: "oss_generate_integration_notes",
        arguments: { repository: "acme/repo-a", targetStack: "Node.js", useCase: "tooling" },
      });
      expect(structured(res).importantFiles).toEqual([]);
      expect(structured(res).basicUsage).toBe("See the project README for usage details.");
    } finally {
      await alt.close();
    }
  });

  it("detects all important root files, ignores non-matches, and caps at 20", async () => {
    const rootFiles = [
      "README.md",
      "LICENSE",
      "CONTRIBUTING.md",
      "package.json",
      "pyproject.toml",
      "requirements.txt",
      "Cargo.toml",
      "go.mod",
      "pom.xml",
      "build.gradle",
      "composer.json",
      "Gemfile",
      "Dockerfile",
      "docker-compose.yml",
      ".env.example",
    ];
    const docs = Array.from({ length: 25 }, (_, i) => `docs/d${i}.md`);
    const tree = [...rootFiles, ...docs, "notreadme.md", "random.txt", "src/app.ts"].map(
      (p, i) => ({ path: p, type: "blob", size: 1, sha: `g${i}` }),
    );
    const galore = makeGitHubFetch({
      handler: (url) =>
        url.includes("/git/trees/")
          ? jsonResponse({ sha: "t", truncated: false, tree }, { headers: rateLimitHeaders() })
          : undefined,
    });
    const alt = await connect({ fetchImpl: galore });
    try {
      const res = await alt.client.callTool({
        name: "oss_generate_integration_notes",
        arguments: { repository: "acme/repo-a", targetStack: "Node.js", useCase: "tooling" },
      });
      const important: string[] = structured(res).importantFiles;
      // Every root pattern is detected (root files are pushed before docs).
      for (const f of rootFiles) expect(important).toContain(f);
      // Non-matching root files are excluded.
      expect(important).not.toContain("notreadme.md");
      expect(important).not.toContain("random.txt");
      expect(important).not.toContain("src/app.ts");
      // Capped at 20 even though 15 root + 25 docs match.
      expect(important).toHaveLength(20);
    } finally {
      await alt.close();
    }
  });

  it("honors maxFilesToInspect before selecting important integration files", async () => {
    const tree = ["README.md", "package.json", "LICENSE", "docs/guide.md", "examples/demo.ts"].map(
      (p, i) => ({ path: p, type: "blob", size: 1, sha: `l${i}` }),
    );
    const fetchImpl = makeGitHubFetch({
      handler: (url) =>
        url.includes("/git/trees/")
          ? jsonResponse({ sha: "t", truncated: false, tree }, { headers: rateLimitHeaders() })
          : undefined,
    });
    const limited = await connect({
      fetchImpl,
      configOverride: (config) => ({
        ...config,
        limits: { ...config.limits, maxFilesToInspect: 1 },
      }),
    });
    try {
      const res = await limited.client.callTool({
        name: "oss_generate_integration_notes",
        arguments: { repository: "acme/repo-a", targetStack: "Node.js", useCase: "tooling" },
      });
      expect(structured(res).importantFiles).toEqual(["README.md"]);
    } finally {
      await limited.close();
    }
  });

  it("uses license fallbacks when the repo has no detectable license", async () => {
    const noLicense = makeGitHubFetch({
      handler: (url) => {
        const { pathname } = new URL(url);
        const m = /^\/repos\/no\/lic(\/.*)?$/.exec(pathname);
        if (!m) return undefined;
        const sub = m[1] ?? "";
        if (sub === "")
          return jsonResponse(repoObject("no", "lic", { license: null }), {
            headers: rateLimitHeaders(),
          });
        if (sub === "/license")
          return jsonResponse(
            { message: "Not Found" },
            { status: 404, headers: rateLimitHeaders() },
          );
        return undefined;
      },
    });
    const alt = await connect({ fetchImpl: noLicense });
    try {
      const res = await alt.client.callTool({
        name: "oss_generate_integration_notes",
        arguments: { repository: "no/lic", targetStack: "Node.js", useCase: "tooling" },
      });
      expect(structured(res).integrationSteps[0]).toContain("(none, none)");
      expect(structured(res).licenseReminder).toContain("This project is unlicensed (none,");
    } finally {
      await alt.close();
    }
  });

  it("falls back to README text when a code fence is empty/whitespace", async () => {
    const wsFence = makeGitHubFetch({
      handler: (url) =>
        url.includes("/readme")
          ? jsonResponse(
              {
                path: "README.md",
                encoding: "base64",
                content: Buffer.from("# x\n```\n   \n```\n", "utf-8").toString("base64"),
              },
              { headers: rateLimitHeaders() },
            )
          : undefined,
    });
    const alt = await connect({ fetchImpl: wsFence });
    try {
      const res = await alt.client.callTool({
        name: "oss_generate_integration_notes",
        arguments: { repository: "acme/repo-a", targetStack: "Node.js", useCase: "tooling" },
      });
      expect(structured(res).basicUsage).toBe("See the project README for usage details.");
    } finally {
      await alt.close();
    }
  });

  it("falls back when a usage heading has only whitespace content", async () => {
    const wsUsage = makeGitHubFetch({
      handler: (url) =>
        url.includes("/readme")
          ? jsonResponse(
              {
                path: "README.md",
                encoding: "base64",
                content: Buffer.from("# x\n\n## Usage\n   \n", "utf-8").toString("base64"),
              },
              { headers: rateLimitHeaders() },
            )
          : undefined,
    });
    const alt = await connect({ fetchImpl: wsUsage });
    try {
      const res = await alt.client.callTool({
        name: "oss_generate_integration_notes",
        arguments: { repository: "acme/repo-a", targetStack: "Node.js", useCase: "tooling" },
      });
      expect(structured(res).basicUsage).toBe("See the project README for usage details.");
    } finally {
      await alt.close();
    }
  });
});
