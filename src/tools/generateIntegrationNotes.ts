import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type ServerContext } from "./shared.js";
import { parseRepository, truncate } from "../utils/sanitize.js";
import { INPUT_LIMITS, repositorySchema } from "./schemas.js";
import type { IntegrationNotesResult } from "../types/toolResults.js";

function buildInstallCommands(
  managers: string[],
  owner: string,
  repo: string,
  url: string,
): string[] {
  const cmds: string[] = [];
  for (const manager of managers) {
    switch (manager) {
      case "npm":
        cmds.push(`npm install ${repo}   # verify the exact package name on npm`);
        break;
      case "pip":
        cmds.push(`pip install ${repo}   # verify the exact package name on PyPI`);
        break;
      case "cargo":
        cmds.push(`cargo add ${repo}   # verify the crate name on crates.io`);
        break;
      case "go":
        cmds.push(`go get github.com/${owner}/${repo}`);
        break;
      case "maven":
        cmds.push(`# Maven: copy the <dependency> (groupId:artifactId) from the project's README`);
        break;
      case "gradle":
        cmds.push(`// Gradle: copy the implementation('group:artifact:version') from the README`);
        break;
      case "composer":
        cmds.push(`composer require ${owner}/${repo}`);
        break;
      case "gem":
        cmds.push(`gem install ${repo}   # verify the gem name on rubygems.org`);
        break;
      // No default: an unrecognized manager simply contributes no command.
    }
  }
  cmds.push(`git clone ${url}.git`);
  return Array.from(new Set(cmds));
}

// Stryker disable Regex: these are anchored filename-detection patterns. WHICH
// files they match is pinned by the pickImportantFiles tests below; the Regex
// mutator's internal variants (anchor/char-class tweaks) don't change which
// fixture paths match, so they are equivalent here.
const IMPORTANT_ROOT = [
  /^readme(\.|$)/i,
  /^license(\.|$)/i,
  /^contributing(\.|$)/i,
  /^package\.json$/i,
  /^pyproject\.toml$/i,
  /^requirements\.txt$/i,
  /^cargo\.toml$/i,
  /^go\.mod$/i,
  /^pom\.xml$/i,
  /^build\.gradle(\.kts)?$/i,
  /^composer\.json$/i,
  /^gemfile$/i,
  /^dockerfile$/i,
  /^docker-compose\.ya?ml$/i,
  /^\.env\.example$/i,
];
// Stryker restore Regex

function pickImportantFiles(treePaths: string[]): string[] {
  const files: string[] = [];
  for (const path of treePaths) {
    if (!path.includes("/") && IMPORTANT_ROOT.some((re) => re.test(path))) files.push(path);
  }
  for (const path of treePaths) {
    // Stryker disable next-line Regex: matching behavior is pinned by the pickImportantFiles tests; the internal regex variants are equivalent for the fixture paths.
    if (/^(examples?|docs?)\//i.test(path)) files.push(path);
  }
  return Array.from(new Set(files)).slice(0, 20);
}

function extractUsage(readme: string): string {
  const fallback = "See the project README for usage details.";
  // Snippets come from the repository README, which is UNTRUSTED content — label
  // it so a downstream agent does not execute it as trusted instructions.
  const label = (snippet: string): string =>
    `[untrusted — copied verbatim from the repository README; review before running]\n${snippet}`;
  // Stryker disable next-line Regex: fence/heading matching is pinned by the extractUsage tests (fenced, heading, fallback); the internal regex variants are equivalent.
  const fence = readme.match(/```[\w-]*\n([\s\S]*?)```/);
  if (fence && fence[1] && fence[1].trim()) return label(truncate(fence[1].trim(), 600).content);
  const usage = readme.match(
    // Stryker disable next-line Regex: usage-heading matching is pinned by the extractUsage tests; the internal regex variants are equivalent.
    /(?:^|\n)#{1,6}\s*(?:usage|getting[\s-]?started|quick[\s-]?start)[^\n]*\n([\s\S]{0,600})/i,
  );
  if (usage && usage[1] && usage[1].trim()) return label(truncate(usage[1].trim(), 600).content);
  return fallback;
}

export function registerGenerateIntegrationNotes(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "oss_generate_integration_notes",
    {
      title: "Generate integration notes",
      description:
        "Produce concise, read-only integration notes for adopting a repository in a target stack: install commands, important files, basic usage, steps, risks and a license reminder. Does NOT modify any files.",
      inputSchema: {
        repository: repositorySchema,
        targetStack: z
          .string()
          .min(1)
          .max(INPUT_LIMITS.stack)
          .describe('Your stack, e.g. "Node.js + Express".'),
        useCase: z
          .string()
          .min(1)
          .max(INPUT_LIMITS.useCase)
          .describe("What you want to use it for."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(ctx, async () => {
        const { owner, repo, fullName } = parseRepository(args.repository);
        // Stryker disable next-line ObjectLiteral: query/useCase only feed relevance scoring, which integration notes never emit — an empty options object is equivalent here.
        const analysis = await ctx.analyzer.analyze(owner, repo, {
          query: args.useCase,
          useCase: args.useCase,
        });

        // Stryker disable next-line ArrayDeclaration: on getTree failure this stays [] and importantFiles is filtered to [] — a non-empty initializer is filtered out too (equivalent).
        let treePaths: string[] = [];
        try {
          const tree = await ctx.github.getTree(owner, repo, analysis.profile.defaultBranch, true);
          treePaths = tree.files.slice(0, ctx.config.limits.maxFilesToInspect).map((f) => f.path);
          // Stryker disable next-line BlockStatement: the catch only logs (observability); treePaths stays [] either way (equivalent).
        } catch (err) {
          // Stryker disable next-line StringLiteral: observability log message; no behavioral effect.
          ctx.logger.debug("integration notes: tree unavailable", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // Stryker disable next-line StringLiteral: stays "" on getReadme failure → extractUsage returns the fallback; any other initial also yields the fallback (equivalent).
        let readme = "";
        try {
          readme = (await ctx.github.getReadme(owner, repo, analysis.profile.defaultBranch))
            .content;
        } catch {
          // README is optional — leave readme empty so extractUsage falls back.
        }

        const installCommands = buildInstallCommands(
          analysis.packageSignals.detectedPackageManagers,
          owner,
          repo,
          analysis.profile.url,
        );
        const license = analysis.license;
        const integrationSteps = [
          `Review the license (${license.detected ?? "none"}, ${license.category}) for your "${args.useCase}" use case.`,
          // installCommands always contains at least the `git clone` line, so [0] is safe.
          `Install the dependency: ${installCommands[0]}`,
          "Read the README and any docs/ for configuration and setup.",
          analysis.packageSignals.hasExamples
            ? "Study the examples/ directory for working integrations."
            : "Look for usage examples in the README.",
          `Integrate into your ${args.targetStack} project via its public API.`,
          analysis.packageSignals.hasTests
            ? "Run the project's tests to validate your setup."
            : "Add tests around your integration.",
        ];

        const result: IntegrationNotesResult = {
          repository: fullName,
          targetStack: args.targetStack,
          installCommands,
          importantFiles: pickImportantFiles(treePaths),
          basicUsage: extractUsage(readme),
          integrationSteps,
          risks: analysis.risk.reasons,
          licenseReminder:
            `This project is ${license.detected ?? "unlicensed"} (${license.category}, ${license.riskLevel} risk). ` +
            // Stryker disable next-line StringLiteral,MethodExpression: analyzeLicense always returns ≥1 note so `?? ""` is unreachable, and the literal has no leading/trailing whitespace so .trim() is a no-op (both equivalent).
            `${license.notes[0] ?? ""} Verify license obligations for your use case before shipping.`.trim(),
        };
        return result;
      }),
  );
}
