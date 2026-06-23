# OSS Research MCP

> MCP server for discovering, analyzing, comparing, and selecting open-source GitHub repositories.

`oss-research-mcp` is a free, open-source [Model Context Protocol](https://modelcontextprotocol.io)
server. It gives any MCP-compatible client a set of read-only tools to find
free open-source alternatives to paid APIs/SDKs/SaaS, analyze repositories,
check licenses, compare options, and produce concise integration notes.

- **No paid API required** — uses the public GitHub REST API.
- **No vendor lock-in** — works with any MCP client, any AI provider.
- **Read-only by default** — never writes to your repos or your project.
- **Safe, structured output** — repository content is treated as untrusted data.

## Why

Picking an open-source dependency means weighing relevance, license risk,
maintenance health, documentation, adoption, and integration effort. This
server automates that research and returns compact, machine-readable reports so
your agent (or you) can decide quickly and safely.

## Quick start

Run without installing (recommended):

```bash
npx oss-research-mcp
```

Or install globally:

```bash
npm install -g oss-research-mcp
oss-research-mcp
```

The server speaks MCP over **stdio** by default. A GitHub token is optional but
recommended for higher rate limits:

```bash
GITHUB_TOKEN=ghp_xxx npx oss-research-mcp
```

## Connect to an MCP client

Most clients accept a server entry like this (stdio):

```json
{
  "mcpServers": {
    "oss-research": {
      "command": "npx",
      "args": ["-y", "oss-research-mcp"],
      "env": { "GITHUB_TOKEN": "" }
    }
  }
}
```

To use the optional HTTP transport instead:

```bash
oss-research-mcp --transport http --port 7345
# Streamable HTTP endpoint: http://127.0.0.1:7345/mcp  (localhost only, no auth)
```

See [`examples/`](examples/) for ready-to-copy client configs and tool calls,
and [`docs/`](docs/) for the full tool and configuration reference.

## Demo

Open the polished user-experience demo at [`demo/index.html`](demo/index.html)
or watch the included video at
[`demo/oss-research-mcp-demo.mp4`](demo/oss-research-mcp-demo.mp4). The demo
shows the complete first-run flow: start the server, connect an MCP client,
search GitHub, analyze repositories, compare candidates, and generate
integration notes.

## Tools

All tools are prefixed with `oss_` and are read-only.

| Tool                                | Purpose                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `oss_search_repositories`           | Search GitHub repositories by query/filters.                                      |
| `oss_get_repository_profile`        | Basic repository metadata.                                                        |
| `oss_get_repository_tree`           | File/directory tree of a branch.                                                  |
| `oss_read_repository_file`          | Read a single text file (binary rejected, large files truncated).                 |
| `oss_get_readme`                    | Fetch the README.                                                                 |
| `oss_check_license`                 | Detect license and classify rights & risk.                                        |
| `oss_analyze_repository`            | Full analysis: profile, license, docs, maintenance, package signals, risk, score. |
| `oss_compare_repositories`          | Score and rank multiple repositories; pick a winner.                              |
| `oss_find_open_source_alternatives` | Find ranked OSS alternatives for a target/use case.                               |
| `oss_generate_integration_notes`    | Read-only integration notes for adopting a repo.                                  |
| `oss_deepwiki_summary`              | DeepWiki: AI summary (answer + topics) for a repo.                                |
| `oss_health_check`                  | Server status, version, cache backend, rate limit.                                |

### Example tool calls

Find alternatives to Stripe:

```json
{
  "name": "oss_find_open_source_alternatives",
  "arguments": {
    "target": "Stripe",
    "useCase": "payment processing for a small SaaS",
    "mustBeFree": true,
    "mustBeSelfHosted": true,
    "licensePreference": "avoid-strong-copyleft"
  }
}
```

Check a license:

```json
{ "name": "oss_check_license", "arguments": { "repository": "facebook/react" } }
```

Compare libraries:

```json
{
  "name": "oss_compare_repositories",
  "arguments": {
    "repositories": ["expressjs/express", "fastify/fastify", "koajs/koa"],
    "criteria": { "preferActiveMaintenance": true, "preferPermissiveLicense": true }
  }
}
```

## Configuration

Configure via environment variables (see [`.env.example`](.env.example)) and/or
an optional config file at `~/.oss-research-mcp/config.json`. CLI flags override
both.

| Variable                     | Default                            | Description                                                                           |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`               | _(unset)_                          | Optional token for higher rate limits. Read from env only.                            |
| `OSS_MCP_TRANSPORT`          | `stdio`                            | `stdio` or `http`.                                                                    |
| `OSS_MCP_PORT`               | `7345`                             | HTTP port.                                                                            |
| `OSS_MCP_CACHE_ENABLED`      | `true`                             | Enable response caching.                                                              |
| `OSS_MCP_CACHE_PATH`         | `~/.oss-research-mcp/cache.sqlite` | SQLite cache path.                                                                    |
| `OSS_MCP_CACHE_TTL_HOURS`    | `24`                               | Cache TTL in hours.                                                                   |
| `OSS_MCP_DEEPWIKI_ENABLED`   | `false`                            | Optional DeepWiki adapter. Set `true` to enable external calls to `mcp.deepwiki.com`. |
| `OSS_MCP_MAX_RESULTS`        | `20`                               | Default max search results.                                                           |
| `OSS_MCP_REQUEST_TIMEOUT_MS` | `15000`                            | Outbound request timeout.                                                             |
| `OSS_MCP_LOG_LEVEL`          | `info`                             | `debug` / `info` / `warn` / `error`.                                                  |

CLI options:

```text
oss-research-mcp [options]
  --transport stdio|http
  --port <number>
  --cache true|false
  --deepwiki true|false
  --log-level debug|info|warn|error
  -h, --help
  -v, --version
```

## GitHub API limits

The public GitHub REST API allows ~60 requests/hour unauthenticated and
~5,000/hour with a token. Responses are cached (SQLite by default, in-memory
fallback) to minimize requests. Every tool result includes a `rateLimit`
summary, and the server warns (on stderr) when the remaining quota is low.

## Security notes

- **Read-only**: no issue/PR/commit/file writes; no shell execution.
- **Domain allowlist**: outbound HTTPS only to `api.github.com`,
  `raw.githubusercontent.com`, and `mcp.deepwiki.com` when DeepWiki is enabled
  with `OSS_MCP_DEEPWIKI_ENABLED=true`.
- **Untrusted content**: READMEs, file contents, descriptions and topics are
  returned as data and must not be treated as instructions.
- **Secret hygiene**: the GitHub token is read only from an environment
  variable and is never logged, cached, or returned in tool output.
- **HTTP transport** has no authentication, binds to loopback by default, and
  rejects untrusted `Host` headers. Do not expose it publicly without an
  authenticating proxy.

See [SECURITY.md](SECURITY.md) for the full policy and how to report issues.

## License

[MIT](LICENSE) — simple, permissive, commercial-friendly.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). Run `pnpm install`, then
`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm audit --prod && npm audit --omit=dev`
before opening a PR.
