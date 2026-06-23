# SRS Compliance

This matrix records the implementation and verification evidence for `srs.txt`
as of the current hardening pass.

## Functional Requirements

| Area                                                                 | Status | Evidence                                                                                                           |
| -------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| FR-001..FR-003 startup/transports                                    | Pass   | `node dist/cli.js --help`, `node dist/cli.js --version`, HTTP transport tests, Inspector stdio tests               |
| FR-004..FR-008 GitHub search/profile/tree/read/file                  | Pass   | MCP tests, live GitHub suite, Inspector `oss_search_repositories` call                                             |
| FR-009..FR-012 license/analyze/compare/alternatives                  | Pass   | unit, integration, exact MCP snapshots, live GitHub suite                                                          |
| FR-013 caching                                                       | Pass   | memory/sqlite cache tests, composed-analysis degraded-cache tests                                                  |
| FR-014 rate limit handling                                           | Pass   | all successful object tool results include `rateLimit`; rate-limit parser/tests and live Inspector output verified |
| FR-015 DeepWiki optional adapter                                     | Pass   | default disabled, one public `oss_deepwiki_summary` tool, live DeepWiki suite                                      |
| FR-016..FR-019 free/read-only/no execution/safe logging/token safety | Pass   | no paid API required, read-only annotations, no shell tools, redaction tests, env-only token config                |
| FR-020 structured errors                                             | Pass   | structured AppError mapping tests and MCP protocol error tests                                                     |

## Non-Functional And Security Requirements

| Area                                       | Status | Evidence                                                                                              |
| ------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------- |
| NFR-001 performance/reliability            | Pass   | retries, timeout/deadline tests, full suite and live suite                                            |
| NFR-003/NFR-004 portability/installability | Pass   | Node 20+ package metadata, `npm exec --package . -- oss-research-mcp --version`, `npm pack --dry-run` |
| NFR-005 open-source readiness              | Pass   | README, LICENSE, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, docs, examples included in package          |
| NFR-006/NFR-007 security/privacy           | Pass   | untrusted-content labeling, domain allowlist, redaction, env-only token, local HTTP Host guard        |
| SEC-001/SEC-002 read-only/no shell         | Pass   | tool annotations and implementation contain no write/shell execution path                             |
| SEC-003 domain allowlist                   | Pass   | GitHub client rejects DeepWiki redirects even when DeepWiki is enabled; DeepWiki is gated separately  |
| SEC-004 prompt-injection resistance        | Pass   | server instructions and integration notes label repository text as untrusted data                     |
| SEC-005 output/file limits                 | Pass   | README/file byte caps, result caps, repository-count caps, `maxFilesToInspect` analyzer/tool tests    |
| SEC-006 secrets redaction                  | Pass   | `runTool` redacts text and structuredContent; logger redaction tests                                  |
| SEC-007 dependency safety                  | Pass   | pinned dependencies, `pnpm audit`, `npm audit --omit=dev`, Dependabot, CodeQL, SHA-pinned Actions     |

## Acceptance Criteria

| Criterion                                               | Status                      | Evidence                                                                                                 |
| ------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| npx/startup                                             | Pass                        | `npm exec --package . -- oss-research-mcp --version`                                                     |
| tools list                                              | Pass                        | built `TOOL_NAMES` = 12; Inspector `tools/list` succeeds                                                 |
| real GitHub search/analyze/compare/license/alternatives | Pass                        | `pnpm test:live`; Inspector real GitHub search returned `react/react`                                    |
| works without token                                     | Pass                        | live unauthenticated run and Inspector search without `GITHUB_TOKEN`                                     |
| token improves limits                                   | Pass with credential caveat | token header path is tested; no live token was present in the environment for an authenticated quota run |
| free API/no code execution/docs/GitHub-ready            | Pass                        | docs, package dry-run, audit gates, workflows                                                            |

## Validation Commands

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:coverage
pnpm audit
npm audit --omit=dev
pnpm test:live
pnpm test:mutation
npm pack --dry-run --json --ignore-scripts
npm exec --yes --package . -- oss-research-mcp --version
npm exec --yes --package @modelcontextprotocol/inspector@0.22.0 -- mcp-inspector --cli node dist/cli.js --method tools/list
npm exec --yes --package @modelcontextprotocol/inspector@0.22.0 -- mcp-inspector --cli node dist/cli.js --method tools/call --tool-name oss_health_check
npm exec --yes --package @modelcontextprotocol/inspector@0.22.0 -- mcp-inspector --cli node dist/cli.js --method tools/call --tool-name oss_search_repositories --tool-arg query=react --tool-arg limit=1
```
