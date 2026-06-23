# Tools reference

All tools are read-only and prefixed with `oss_`. Each result is returned both
as a JSON text block and as `structuredContent`. Errors are returned as
structured results with `isError: true` and a body of
`{ "error": { "code", "message", "retryAfter" } }`.
Every successful object result also includes a top-level `rateLimit` summary
(`{ remaining, resetAt }`) based on the last observed GitHub response. If no
GitHub response has been seen yet, both fields are `null`.

## oss_search_repositories

Search GitHub repositories.

Input: `query` (string, required), `language?`, `minStars?`, `license?`,
`topic?`, `sort` (`stars|updated|forks|best-match`, default `best-match`),
`order` (`asc|desc`, default `desc`), `limit?` (1–100).

Output: `{ query, totalCount, items[], rateLimit }` where each item has
`fullName, owner, name, description, url, stars, forks, openIssues, language,
license, archived, pushedAt, topics`.

## oss_get_repository_profile

Input: `repository` (`owner/repo`).
Output: full profile — `repository, description, url, defaultBranch, stars,
forks, watchers, openIssues, language, topics, license, createdAt, updatedAt,
pushedAt, archived, disabled, sizeKb`.

## oss_get_repository_tree

Input: `repository`, `branch?`, `recursive` (default true), `maxFiles`
(default 200, max 2000).
Output: `{ repository, branch, files: [{ path, type, size, sha }], truncated }`.

## oss_read_repository_file

Input: `repository`, `path`, `branch?`, `maxChars?`.
Output: `{ repository, path, branch, content, encoding: "utf-8", truncated }`.
Binary files (by extension) are rejected with `BINARY_FILE_NOT_SUPPORTED`;
files over 1 MB return `FILE_TOO_LARGE`.

## oss_get_readme

Input: `repository`, `maxChars?`.
Output: `{ repository, readmePath, content, truncated }`. Missing README returns
`README_NOT_FOUND`.

## oss_check_license

Input: `repository`.
Output: `{ repository, licenseDetected, spdxId, category, commercialUse,
modification, distribution, privateUse, riskLevel, notes }`.

Categories: `permissive` (MIT, Apache-2.0, BSD, ISC…), `weak-copyleft`
(MPL, LGPL…), `strong-copyleft` (GPL, AGPL), `none`, `unknown`.

## oss_analyze_repository

Input: `repository`, `includeReadme?`, `includeTree?`, `includeLicense?`,
`includePackageFiles?`, `includeDeepWiki?` (all booleans).
Output: `{ repository, profile, license, documentation, maintenance,
packageSignals, risk, score, summary }`.

## oss_compare_repositories

Input: `repositories` (1–10 × `owner/repo`), `criteria?`
(`preferPermissiveLicense`, `preferActiveMaintenance`, `preferEasyIntegration`,
`preferPopular`, `language`).
Output: `{ winner, ranking: [{ repository, score, pros, cons, licenseRisk,
maintenanceRisk, integrationDifficulty }], summary }`.

## oss_find_open_source_alternatives

Input: `target`, `useCase`, `language?`, `framework?`, `mustBeFree`
(default true), `mustBeSelfHosted` (default false), `licensePreference`
(`permissive|any|avoid-strong-copyleft`, default `any`), `limit` (1–10,
default 5).
Output: `{ target, useCase, candidates: [{ repository, url, description,
whyRelevant, score, license, riskLevel, integrationDifficulty }], bestCandidate,
rejectedCandidates, notes }`.

## oss_generate_integration_notes

Input: `repository`, `targetStack`, `useCase`.
Output: `{ repository, targetStack, installCommands, importantFiles, basicUsage,
integrationSteps, risks, licenseReminder }`. This tool never modifies files.

## oss_deepwiki_summary

Input: `repository`, `question?`.
Output: `{ repository, available, summary, topics, source }`.

DeepWiki is an optional integration wrapping the public DeepWiki MCP server
(`mcp.deepwiki.com`). It is disabled by default; set
`OSS_MCP_DEEPWIKI_ENABLED=true` or pass `--deepwiki true` to enable it. When
disabled, the tool returns `DEEPWIKI_DISABLED`. On network/service failure it
returns `DEEPWIKI_UNAVAILABLE`.

## oss_health_check

Input: none.
Output: `{ name, version, status, transport, cacheEnabled, cacheBackend,
deepwikiEnabled, githubAuthenticated, rateLimit, uptimeSeconds }`.

## Error codes

`INVALID_INPUT`, `INVALID_REPOSITORY_FORMAT`, `GITHUB_RATE_LIMITED`,
`GITHUB_NOT_FOUND`, `GITHUB_FORBIDDEN`, `GITHUB_API_ERROR`, `README_NOT_FOUND`,
`LICENSE_NOT_FOUND`, `FILE_TOO_LARGE`, `BINARY_FILE_NOT_SUPPORTED`,
`CACHE_ERROR`, `DEEPWIKI_DISABLED`, `DEEPWIKI_UNAVAILABLE`, `FORBIDDEN_HOST`,
`INTERNAL_ERROR`.
