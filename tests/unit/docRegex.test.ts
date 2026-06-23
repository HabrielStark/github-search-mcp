// Pins the markdown-heading detection semantics in documentationAnalyzer.
// Each assertion encodes a real behaviour of the heading/command regexes
// (heading-marker required, line-start anchored, <=3-space indent, optional
// word separators, docs-site proximity) — killing the regex mutants that are
// genuine behaviour rather than equivalent variants.
import { describe, it, expect } from "vitest";
import { analyzeDocumentation } from "../../src/analyzers/documentationAnalyzer.js";

const usage = (readme: string): boolean =>
  analyzeDocumentation({ readme, treePaths: [] }).hasUsageSection;
const install = (readme: string): boolean =>
  analyzeDocumentation({ readme, treePaths: [] }).hasInstallSection;
const examples = (readme: string): boolean =>
  analyzeDocumentation({ readme, treePaths: [] }).hasExamples;
// docs-site contributes the final +20 only (no docs folder, no install/usage/examples).
const docsSiteScore = (readme: string): number =>
  analyzeDocumentation({ readme, treePaths: [] }).score;

describe("documentationAnalyzer — heading regex semantics", () => {
  it("requires an actual '#' heading marker (plain prose does not count)", () => {
    expect(usage("## Usage\nrun it")).toBe(true);
    expect(usage("Usage of this tool is straightforward.")).toBe(false);
  });

  it("anchors headings to line start (a heading as the very first line matches)", () => {
    // Starts with the heading, no leading newline → only matches via the '^' alternative.
    expect(usage("## Usage")).toBe(true);
    // '#' mid-line is not a heading.
    expect(usage("please read the ## Usage notes inline")).toBe(false);
  });

  it("allows up to 3 leading spaces but not 4 (markdown code-block rule)", () => {
    expect(usage("   ## Usage")).toBe(true); // 3 spaces
    expect(usage("    ## Usage")).toBe(false); // 4 spaces → indented code, not a heading
  });

  it("detects examples heading in both singular and plural", () => {
    expect(examples("## Example\nx")).toBe(true);
    expect(examples("## Examples\nx")).toBe(true);
  });

  it("honors the optional separator in getting/quick start headings", () => {
    expect(install("## gettingstarted")).toBe(true); // no separator
    expect(install("## getting started")).toBe(true); // space separator
    expect(install("## getting-started")).toBe(true); // hyphen separator
    expect(usage("## quickstart")).toBe(true);
  });

  it("honors the optional apt(-get) form in install commands", () => {
    expect(install("Install with `apt install foo`")).toBe(true);
    expect(install("Install with `apt-get install foo`")).toBe(true);
    expect(install("npm install foo")).toBe(true);
    expect(install("just clone it and pray")).toBe(false);
  });
});

describe("documentationAnalyzer — docs-site detection (via score)", () => {
  const README = "# Title\n"; // bare readme → score 20 unless a docs site is present
  it.each([
    "https://project.readthedocs.io",
    "https://owner.github.io/project",
    "built with mkdocs",
    "built with docusaurus",
    "hosted on gitbook",
  ])("recognizes a docs site (%s) for the +20 docs score", (line) => {
    expect(docsSiteScore(`${README}${line}`)).toBe(40);
  });

  it("requires the documentation keyword to be near the URL (<=60 chars)", () => {
    expect(docsSiteScore(`${README}documentation at https://x.dev`)).toBe(40);
    const far = `${README}documentation ${"y".repeat(70)} https://x.dev`;
    expect(docsSiteScore(far)).toBe(20); // too far apart → not detected
  });

  it("a bare readme with no site stays at 20", () => {
    expect(docsSiteScore(README)).toBe(20);
  });
});

describe("documentationAnalyzer — governance name literals & ./ strip", () => {
  it("recognizes each changelog alias and a contributing/security file", () => {
    expect(analyzeDocumentation({ readme: "x", treePaths: ["CHANGELOG.md"] }).hasChangelog).toBe(
      true,
    );
    expect(analyzeDocumentation({ readme: "x", treePaths: ["CHANGES.md"] }).hasChangelog).toBe(
      true,
    );
    expect(analyzeDocumentation({ readme: "x", treePaths: ["HISTORY.md"] }).hasChangelog).toBe(
      true,
    );
    expect(analyzeDocumentation({ readme: "x", treePaths: ["CONTRIBUTING"] }).hasContributing).toBe(
      true,
    );
    expect(analyzeDocumentation({ readme: "x", treePaths: ["SECURITY.rst"] }).hasSecurity).toBe(
      true,
    );
    // a non-matching governance-ish name must not trigger
    expect(analyzeDocumentation({ readme: "x", treePaths: ["NOTES.md"] }).hasChangelog).toBe(false);
  });

  it("strips a leading './' from tree paths before folder detection", () => {
    expect(analyzeDocumentation({ readme: "", treePaths: ["./docs/guide.md"] }).hasDocsFolder).toBe(
      true,
    );
    expect(analyzeDocumentation({ readme: "", treePaths: ["./examples/a.ts"] }).hasExamples).toBe(
      true,
    );
  });
});
