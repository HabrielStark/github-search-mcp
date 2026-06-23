# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-30

### Added

- Initial stable release of the OSS Research MCP server.
- 15 read-only MCP tools (all prefixed `oss_`):
  - `oss_search_repositories`, `oss_get_repository_profile`,
    `oss_get_repository_tree`, `oss_read_repository_file`, `oss_get_readme`,
    `oss_check_license`, `oss_analyze_repository`, `oss_compare_repositories`,
    `oss_find_open_source_alternatives`, `oss_generate_integration_notes`,
    `oss_deepwiki_read_wiki_structure`, `oss_deepwiki_read_wiki_contents`,
    `oss_deepwiki_ask_question`, `oss_deepwiki_summary`, `oss_health_check`.
- Required, enabled-by-default DeepWiki adapter wrapping the public DeepWiki MCP
  server (`read_wiki_structure`, `read_wiki_contents`, `ask_question`), verified
  with a live round-trip test (`pnpm test:live`).
- GitHub REST adapter with rate-limit tracking and structured error mapping.
- License, documentation, maintenance, package and risk analyzers.
- Scoring engine (relevance, maintenance, license, documentation, adoption,
  integration) with a 0–100 total.
- Caching layer: SQLite (better-sqlite3) with automatic in-memory fallback.
- STDIO transport (default) and optional Streamable HTTP transport.
- CLI with `--transport`, `--port`, `--cache`, `--deepwiki`, `--log-level`,
  `--help`, `--version`.
- Full unit, integration and MCP protocol test suites.
- Documentation, examples, security policy, and CI workflows.

[1.0.0]: https://github.com/HabrielStark/OSS-Research-MCP/releases/tag/v1.0.0
