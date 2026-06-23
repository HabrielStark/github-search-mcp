import { describe, it, expect } from "vitest";
import { analyzeDocumentation } from "../../src/analyzers/documentationAnalyzer.js";

const fullReadme = `# Project

## Installation
npm install project

## Usage
import x from "project";

## Examples
see below
`;

describe("analyzeDocumentation", () => {
  it("scores a complete README + folders at 100", () => {
    const r = analyzeDocumentation({
      readme: fullReadme,
      treePaths: ["docs/guide.md", "examples/demo.ts", "README.md"],
    });
    expect(r.hasReadme).toBe(true);
    expect(r.hasInstallSection).toBe(true);
    expect(r.hasUsageSection).toBe(true);
    expect(r.hasExamples).toBe(true);
    expect(r.hasDocsFolder).toBe(true);
    expect(r.score).toBe(100);
  });

  it("scores empty docs at 0", () => {
    const r = analyzeDocumentation({ readme: null, treePaths: [] });
    expect(r.hasReadme).toBe(false);
    expect(r.score).toBe(0);
  });

  it("detects install command without an Installation heading", () => {
    const r = analyzeDocumentation({
      readme: "# x\nRun `pip install foo` to begin.",
      treePaths: [],
    });
    expect(r.hasInstallSection).toBe(true);
    expect(r.score).toBe(40); // README + install
  });

  it("detects CHANGELOG / CONTRIBUTING / SECURITY files", () => {
    const r = analyzeDocumentation({
      readme: fullReadme,
      treePaths: ["CHANGELOG.md", "CONTRIBUTING.md", ".github/SECURITY.md", "src/index.ts"],
    });
    expect(r.hasChangelog).toBe(true);
    expect(r.hasContributing).toBe(true);
    expect(r.hasSecurity).toBe(true);
  });

  it("reports governance files as absent when missing", () => {
    const r = analyzeDocumentation({ readme: null, treePaths: ["src/index.ts"] });
    expect(r.hasChangelog).toBe(false);
    expect(r.hasContributing).toBe(false);
    expect(r.hasSecurity).toBe(false);
  });
});

describe("analyzeDocumentation — governance file anchoring", () => {
  it("detects governance files at the repository root and under .github/ only", () => {
    expect(analyzeDocumentation({ readme: "x", treePaths: ["CHANGELOG.md"] }).hasChangelog).toBe(
      true,
    );
    expect(
      analyzeDocumentation({ readme: "x", treePaths: [".github/CONTRIBUTING.md"] }).hasContributing,
    ).toBe(true);
    expect(analyzeDocumentation({ readme: "x", treePaths: ["SECURITY.md"] }).hasSecurity).toBe(
      true,
    );
  });

  it("does not count governance files nested outside the root or .github/", () => {
    expect(
      analyzeDocumentation({ readme: "x", treePaths: ["docs/CHANGELOG.md"] }).hasChangelog,
    ).toBe(false);
    expect(
      analyzeDocumentation({ readme: "x", treePaths: ["sub/dir/SECURITY.md"] }).hasSecurity,
    ).toBe(false);
    expect(
      analyzeDocumentation({ readme: "x", treePaths: [".github/ISSUE_TEMPLATE/contributing.md"] })
        .hasContributing,
    ).toBe(false);
  });

  it("matches by exact base name or name-with-extension, not by prefix", () => {
    expect(analyzeDocumentation({ readme: "x", treePaths: ["CHANGELOG"] }).hasChangelog).toBe(true);
    expect(analyzeDocumentation({ readme: "x", treePaths: ["changelogger.md"] }).hasChangelog).toBe(
      false,
    );
  });
});

describe("analyzeDocumentation — README sections, folders and additive score", () => {
  it("detects install via a heading or an inline command, and nothing for plain prose", () => {
    expect(
      analyzeDocumentation({ readme: "## Installation\nrun it", treePaths: [] }).hasInstallSection,
    ).toBe(true);
    expect(
      analyzeDocumentation({ readme: "Just run `npm install foo`", treePaths: [] })
        .hasInstallSection,
    ).toBe(true);
    expect(
      analyzeDocumentation({ readme: "A project about cats.", treePaths: [] }).hasInstallSection,
    ).toBe(false);
  });

  it("detects usage and examples headings", () => {
    expect(analyzeDocumentation({ readme: "## Usage\n...", treePaths: [] }).hasUsageSection).toBe(
      true,
    );
    expect(analyzeDocumentation({ readme: "## Examples\n...", treePaths: [] }).hasExamples).toBe(
      true,
    );
  });

  it("anchors docs/examples folders at the path root", () => {
    expect(analyzeDocumentation({ readme: "", treePaths: ["docs/guide.md"] }).hasDocsFolder).toBe(
      true,
    );
    expect(analyzeDocumentation({ readme: "", treePaths: ["examples/a.ts"] }).hasExamples).toBe(
      true,
    );
    expect(analyzeDocumentation({ readme: "", treePaths: ["mydocs/guide.md"] }).hasDocsFolder).toBe(
      false,
    );
    expect(analyzeDocumentation({ readme: "", treePaths: ["myexamples/a.ts"] }).hasExamples).toBe(
      false,
    );
  });

  it("treats a whitespace-only README as absent (trim) → score 0", () => {
    const r = analyzeDocumentation({ readme: "   \n\t  ", treePaths: [] });
    expect(r.hasReadme).toBe(false);
    expect(r.score).toBe(0);
  });

  it("composes the score additively (full = 100, README-only = 20)", () => {
    const full = analyzeDocumentation({
      readme:
        "# T\n## Installation\nnpm install x\n## Usage\nuse\n## Examples\nex\nhttps://x.readthedocs.io",
      treePaths: ["docs/a.md", "examples/b.ts"],
    });
    expect(full.score).toBe(100);
    expect(analyzeDocumentation({ readme: "# Title only", treePaths: [] }).score).toBe(20);
  });

  it("scores a docs folder alone (no README) at exactly 20", () => {
    expect(analyzeDocumentation({ readme: null, treePaths: ["docs/guide.md"] }).score).toBe(20);
  });

  it("scores README + usage only at exactly 40", () => {
    expect(analyzeDocumentation({ readme: "# x\n## Usage\nuse it", treePaths: [] }).score).toBe(40);
  });
});
