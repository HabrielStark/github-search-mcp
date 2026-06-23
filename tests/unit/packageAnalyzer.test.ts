import { describe, it, expect } from "vitest";
import { analyzePackageSignals } from "../../src/analyzers/packageAnalyzer.js";

describe("analyzePackageSignals", () => {
  it("detects multiple package managers", () => {
    const r = analyzePackageSignals([
      "package.json",
      "pyproject.toml",
      "Cargo.toml",
      "go.mod",
      "pom.xml",
    ]);
    expect(r.detectedPackageManagers).toEqual(
      expect.arrayContaining(["npm", "pip", "cargo", "go", "maven"]),
    );
  });

  it("detects tests, CI, Docker and examples", () => {
    const r = analyzePackageSignals([
      "test/index.test.ts",
      ".github/workflows/ci.yml",
      "Dockerfile",
      "examples/demo.ts",
    ]);
    expect(r.hasTests).toBe(true);
    expect(r.hasCI).toBe(true);
    expect(r.hasDockerfile).toBe(true);
    expect(r.hasExamples).toBe(true);
  });

  it("detects python test_ files and gitlab CI", () => {
    const r = analyzePackageSignals(["tests/test_main.py", ".gitlab-ci.yml"]);
    expect(r.hasTests).toBe(true);
    expect(r.hasCI).toBe(true);
  });

  it("returns all-false for an empty tree", () => {
    const r = analyzePackageSignals([]);
    expect(r).toEqual({
      detectedPackageManagers: [],
      hasTests: false,
      hasCI: false,
      hasDockerfile: false,
      hasExamples: false,
    });
  });
});

describe("analyzePackageSignals — package-manager manifests", () => {
  it.each([
    ["package.json", "npm"],
    ["pyproject.toml", "pip"],
    ["requirements.txt", "pip"],
    ["setup.py", "pip"],
    ["Pipfile", "pip"],
    ["Cargo.toml", "cargo"],
    ["go.mod", "go"],
    ["pom.xml", "maven"],
    ["build.gradle", "gradle"],
    ["build.gradle.kts", "gradle"],
    ["composer.json", "composer"],
    ["Gemfile", "gem"],
    ["mygem.gemspec", "gem"],
  ])("maps %s → %s", (file, manager) => {
    expect(analyzePackageSignals([file]).detectedPackageManagers).toContain(manager);
  });

  it("maps each manifest to exactly its manager and nothing else", () => {
    for (const [file, manager] of [
      ["package.json", "npm"],
      ["requirements.txt", "pip"],
      ["pyproject.toml", "pip"],
      ["Cargo.toml", "cargo"],
      ["go.mod", "go"],
      ["pom.xml", "maven"],
      ["build.gradle", "gradle"],
      ["composer.json", "composer"],
      ["Gemfile", "gem"],
    ] as const) {
      expect(analyzePackageSignals([file])).toEqual({
        detectedPackageManagers: [manager],
        hasTests: false,
        hasCI: false,
        hasDockerfile: false,
        hasExamples: false,
      });
    }
  });

  it("detects a manifest nested deep in the tree (by basename, not full path)", () => {
    expect(analyzePackageSignals(["packages/core/package.json"]).detectedPackageManagers).toContain(
      "npm",
    );
  });
});

describe("analyzePackageSignals — CI providers", () => {
  it.each([
    ".github/workflows/ci.yml",
    ".gitlab-ci.yml",
    ".travis.yml",
    "azure-pipelines.yml",
    "Jenkinsfile",
    ".drone.yml",
    "appveyor.yml",
    ".appveyor.yml",
    "bitbucket-pipelines.yml",
    ".circleci/config.yml",
  ])("recognizes %s as CI", (file) => {
    expect(analyzePackageSignals([file]).hasCI).toBe(true);
  });

  it("does not flag CI for an unrelated yaml", () => {
    expect(analyzePackageSignals(["config/settings.yml"]).hasCI).toBe(false);
  });
});

describe("analyzePackageSignals — Docker, test and example directories", () => {
  it.each(["Dockerfile", "app.dockerfile", "docker-compose.yml", "compose.yaml"])(
    "recognizes %s as docker",
    (file) => {
      expect(analyzePackageSignals([file]).hasDockerfile).toBe(true);
    },
  );

  it.each([
    "tests/a.ts",
    "test/a.ts",
    "src/spec/a.ts",
    "src/specs/a.ts",
    "pkg/__tests__/a.ts",
    "x.test.ts",
    "y.spec.js",
    "test_thing.py",
  ])("recognizes %s as a test signal", (p) => {
    expect(analyzePackageSignals([p]).hasTests).toBe(true);
  });

  it("does not treat 'contests/' or a plain source file as tests", () => {
    expect(analyzePackageSignals(["contests/a.ts"]).hasTests).toBe(false);
    expect(analyzePackageSignals(["src/main.ts"]).hasTests).toBe(false);
  });

  it.each([
    "examples/a.ts",
    "example/a.ts",
    "samples/a.ts",
    "sample/a.ts",
    "demos/a.ts",
    "demo/a.ts",
  ])("recognizes %s as an examples signal", (p) => {
    expect(analyzePackageSignals([p]).hasExamples).toBe(true);
  });

  it("requires the examples directory to be path-anchored", () => {
    expect(analyzePackageSignals(["myexamples/a.ts"]).hasExamples).toBe(false);
  });

  it("strips a leading './' before matching", () => {
    expect(analyzePackageSignals(["./tests/a.ts"]).hasTests).toBe(true);
    expect(analyzePackageSignals(["./examples/a.ts"]).hasExamples).toBe(true);
  });
});
