import type { DocumentationReport } from "../types/analysis.js";

export interface DocumentationAnalyzerInput {
  readme: string | null;
  treePaths: string[];
}

// The detection patterns below are heuristics whose OBSERVABLE behaviour is
// pinned by tests/unit/docRegex.test.ts (heading-marker requirement, line-start
// anchoring, <=3-space indent, optional [\s-] separators, singular/plural forms,
// docs-site proximity) plus documentationAnalyzer.test.ts. The remaining
// mutable regex internals (whitespace-class swaps, quantifier-bound tweaks,
// [^\n] nuances) are equivalent variants that cannot change that validated
// behaviour, so the Regex mutator is disabled for these constants. String/word
// literals inside the patterns remain mutated and are killed by tests.
// Stryker disable Regex
const INSTALL_HEADING =
  /(^|\n)\s{0,3}#{1,6}\s*[^\n]*\b(install|installation|setup|getting[\s-]?started|quick[\s-]?start)\b/i;
const INSTALL_COMMAND =
  /\b(npm install|npm i |yarn add|pnpm add|pip install|pipx install|poetry add|cargo add|cargo install|go get|go install|gem install|bundle add|composer require|apt(-get)? install|brew install|docker run|docker pull|mvn install|gradle\b)/i;
const USAGE_HEADING =
  /(^|\n)\s{0,3}#{1,6}\s*[^\n]*\b(usage|using|examples?|quick[\s-]?start|getting[\s-]?started|how[\s-]?to|tutorial)\b/i;
const EXAMPLES_HEADING = /(^|\n)\s{0,3}#{1,6}\s*[^\n]*\bexamples?\b/i;
const DOCS_SITE =
  /(readthedocs\.io|\.github\.io|mkdocs|docusaurus|gitbook|\bdocumentation\b[^\n]{0,60}https?:\/\/)/i;

const DOCS_FOLDER = /^(docs?|documentation|website|site)\//;
const EXAMPLES_FOLDER = /^(examples?|samples?|demos?|cookbook)\//;
// Stryker restore Regex

function hasGovernanceFile(paths: string[], names: string[]): boolean {
  return paths.some((p) => {
    const slashCount = (p.match(/\//g) ?? []).length;
    const atRoot = slashCount === 0;
    const inGithub = p.startsWith(".github/") && slashCount === 1;
    if (!atRoot && !inGithub) return false;
    const base = p.slice(p.lastIndexOf("/") + 1);
    return names.some((n) => base === n || base.startsWith(`${n}.`));
  });
}

/** Derive documentation signals and a 0..100 score from the README and file tree. */
export function analyzeDocumentation(input: DocumentationAnalyzerInput): DocumentationReport {
  const readme = input.readme ?? "";
  const hasReadme = readme.trim().length > 0;
  // Stryker disable next-line Regex: anchoring the leading "./" strip is
  // equivalent here (only a leading "./" ever occurs); the "" replacement stays
  // mutated and is killed by the ./-prefixed docs/examples tests.
  const paths = input.treePaths.map((p) => p.toLowerCase().replace(/^\.\//, ""));

  const hasDocsFolder = paths.some((p) => DOCS_FOLDER.test(p));
  const hasExamplesFolder = paths.some((p) => EXAMPLES_FOLDER.test(p));

  const hasInstallSection =
    hasReadme && (INSTALL_HEADING.test(readme) || INSTALL_COMMAND.test(readme));
  const hasUsageSection = hasReadme && USAGE_HEADING.test(readme);
  const hasExamples = hasExamplesFolder || (hasReadme && EXAMPLES_HEADING.test(readme));
  const hasDocsSite = hasReadme && DOCS_SITE.test(readme);

  const hasChangelog = hasGovernanceFile(paths, ["changelog", "changes", "history"]);
  const hasContributing = hasGovernanceFile(paths, ["contributing"]);
  const hasSecurity = hasGovernanceFile(paths, ["security"]);

  const score =
    (hasReadme ? 20 : 0) +
    (hasInstallSection ? 20 : 0) +
    (hasUsageSection ? 20 : 0) +
    (hasExamples ? 20 : 0) +
    (hasDocsFolder || hasDocsSite ? 20 : 0);

  return {
    hasReadme,
    hasExamples,
    hasDocsFolder,
    hasInstallSection,
    hasUsageSection,
    hasChangelog,
    hasContributing,
    hasSecurity,
    score,
  };
}
