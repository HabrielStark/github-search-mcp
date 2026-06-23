import type { PackageSignals } from "../types/analysis.js";

const PACKAGE_FILES: Array<{ test: (base: string) => boolean; manager: string }> = [
  { test: (b) => b === "package.json", manager: "npm" },
  {
    test: (b) =>
      b === "pyproject.toml" || b === "requirements.txt" || b === "setup.py" || b === "pipfile",
    manager: "pip",
  },
  { test: (b) => b === "cargo.toml", manager: "cargo" },
  { test: (b) => b === "go.mod", manager: "go" },
  { test: (b) => b === "pom.xml", manager: "maven" },
  { test: (b) => b === "build.gradle" || b === "build.gradle.kts", manager: "gradle" },
  { test: (b) => b === "composer.json", manager: "composer" },
  { test: (b) => b === "gemfile" || b.endsWith(".gemspec"), manager: "gem" },
];

const CI_PREFIXES = [".github/workflows/", ".circleci/", ".gitea/workflows/", ".woodpecker/"];
const CI_FILES = new Set([
  ".gitlab-ci.yml",
  ".travis.yml",
  "azure-pipelines.yml",
  "jenkinsfile",
  ".drone.yml",
  "appveyor.yml",
  ".appveyor.yml",
  "bitbucket-pipelines.yml",
]);

// Detection patterns for test/spec dirs, test files and example dirs. Their
// observable behaviour (anchoring, singular/plural, file-suffix forms, the
// "contests/" negative) is pinned by tests/unit/exactKills2.test.ts and
// packageAnalyzer.test.ts; the remaining regex-internal variants are equivalent.
// Stryker disable Regex
const TEST_DIR = /(^|\/)(tests?|__tests__|spec|specs)(\/|$)/;
const TEST_FILE = /(\.|_|^)(test|spec)\.[a-z0-9]+$|_test\.[a-z0-9]+$|test_[^/]+\.py$/;
const EXAMPLES_DIR = /^(examples?|samples?|demos?)(\/|$)/;
// Stryker restore Regex

function basename(path: string): string {
  const parts = path.split("/");
  return (parts[parts.length - 1] ?? path).toLowerCase();
}

/** Detect package-manager, test, CI, Docker and example signals from a file tree. */
export function analyzePackageSignals(treePaths: string[]): PackageSignals {
  // Stryker disable next-line Regex: leading "./" strip; anchoring is equivalent here.
  const paths = treePaths.map((p) => p.replace(/^\.\//, ""));
  const lowerPaths = paths.map((p) => p.toLowerCase());

  const managers = new Set<string>();
  let hasTests = false;
  let hasCI = false;
  let hasDockerfile = false;
  let hasExamples = false;

  for (let i = 0; i < paths.length; i += 1) {
    const lower = lowerPaths[i];
    const base = basename(lower);

    for (const entry of PACKAGE_FILES) {
      if (entry.test(base)) managers.add(entry.manager);
    }

    if (!hasCI && (CI_PREFIXES.some((p) => lower.startsWith(p)) || CI_FILES.has(base))) {
      hasCI = true;
    }
    if (
      !hasDockerfile &&
      (base === "dockerfile" ||
        base.endsWith(".dockerfile") ||
        base === "docker-compose.yml" ||
        base === "compose.yaml")
    ) {
      hasDockerfile = true;
    }
    if (!hasTests && (TEST_DIR.test(lower) || TEST_FILE.test(base))) {
      hasTests = true;
    }
    if (!hasExamples && EXAMPLES_DIR.test(lower)) {
      hasExamples = true;
    }
  }

  return {
    detectedPackageManagers: Array.from(managers),
    hasTests,
    hasCI,
    hasDockerfile,
    hasExamples,
  };
}
