# Architecture

```text
MCP Client
   │  MCP protocol (stdio or Streamable HTTP)
   ▼
OSS Research MCP Server
   ├─ tools/            12 read-only MCP tools (oss_*)
   ├─ adapters/         GitHub REST client, optional DeepWiki client
   ├─ analyzers/        license, documentation, maintenance, package, risk,
   │                    and the repository orchestrator
   ├─ scoring/          weights + score engine (0–100)
   ├─ search/           query builder
   ├─ cache/            CacheStore interface, memory + SQLite stores
   └─ utils/            errors, logger, sanitize, rate-limit
```

## Request flow

1. A client calls a tool (e.g. `oss_analyze_repository`).
2. The tool validates input (Zod) and parses the repository reference.
3. The GitHub adapter fetches data (profile, README, tree, license, releases),
   reading from cache first and writing successful responses back.
4. Analyzers turn raw data into structured reports.
5. The scoring engine combines relevance, maintenance, license, documentation,
   adoption and integration into a 0–100 score.
6. The tool returns compact, machine-readable JSON (plus `structuredContent`).

## Caching

Every GitHub call and the composed analysis are cached by key
with a configurable TTL. The composed-analysis cache makes `compare` and
`find_alternatives` fast on repeated repositories, while the underlying GitHub
responses are shared across all tools.

## Safety

- Outbound HTTPS is restricted to an allowlist.
- Repository content is returned strictly as data.
- The token is read from the environment only and redacted everywhere.
- All tools are read-only; there is no shell execution.

See [SECURITY.md](../SECURITY.md) for the full policy.
