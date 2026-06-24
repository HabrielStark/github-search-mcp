# GitHub Search MCP

> Read-only MCP server for searching GitHub repositories, comparing open-source candidates, and generating practical integration notes.

`github-search-mcp` gives any MCP-compatible client a focused set of tools for
repository research. It searches GitHub, inspects licenses and project health,
compares candidates, and returns structured output your agent can use directly.

- **GitHub-native research**: public GitHub REST API, optional token for higher limits.
- **Read-only by design**: no issue, PR, commit, file, or shell writes.
- **Agent-friendly output**: compact JSON plus readable summaries.
- **Dependency decisions**: license, maintenance, docs, adoption, package signals, and risk.

## Quick start

Run without installing:

```bash
npx github-search-mcp
```

Or install globally:

```bash
npm install -g github-search-mcp
github-search-mcp
```

The server speaks MCP over **stdio** by default. A GitHub token is optional but
recommended for higher rate limits:

```bash
GITHUB_TOKEN=ghp_xxx npx github-search-mcp
```

## Connect to an MCP client

Most clients accept a server entry like this:

```json
{
  "mcpServers": {
    "github-search": {
      "command": "npx",
      "args": ["-y", "github-search-mcp"],
      "env": { "GITHUB_TOKEN": "" }
    }
  }
}
```

To use the optional HTTP transport instead:

```bash
github-search-mcp --transport http --port 7345
# Streamable HTTP endpoint: http://127.0.0.1:7345/mcp
```

The legacy `oss-research-mcp` binary is kept as an alias for compatibility.

## Demo

Open the user-experience demo at [`demo/index.html`](demo/index.html), or watch
the included walkthrough:

[`demo/github-search-mcp-demo.mp4`](demo/github-search-mcp-demo.mp4)

The demo shows the first-run path: start the server, connect an MCP client,
search GitHub, compare candidates, and generate integration notes.

## Tools

The product is named GitHub Search MCP. Tool names keep the tested `oss_` prefix
for API compatibility.

| Tool                                | Purpose                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `oss_search_repositories`           | Search GitHub repositories by query and filters.                                  |
| `oss_get_repository_profile`        | Basic repository metadata.                                                        |
| `oss_get_repository_tree`           | File and directory tree of a branch.                                              |
| `oss_read_repository_file`          | Read a single text file, with binary rejection and truncation guards.             |
| `oss_get_readme`                    | Fetch the README.                                                                 |
| `oss_check_license`                 | Detect license and classify rights and risk.                                      |
| `oss_analyze_repository`            | Full analysis: profile, license, docs, maintenance, package signals, risk, score. |
| `oss_compare_repositories`          | Score and rank multiple repositories.                                             |
| `oss_find_open_source_alternatives` | Find ranked OSS alternatives for a target or use case.                            |
| `oss_generate_integration_notes`    | Read-only integration notes for adopting a repo.                                  |
| `oss_deepwiki_summary`              | Optional DeepWiki summary for a repo.                                             |
| `oss_health_check`                  | Server status, version, cache backend, and rate limit.                            |

### Example tool calls

Find alternatives to a paid API:

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
an optional config file at `~/.github-search-mcp/config.json`. CLI flags override
both.

| Variable                     | Default                             | Description                                                                           |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`               | _(unset)_                           | Optional token for higher rate limits. Read from env only.                            |
| `OSS_MCP_TRANSPORT`          | `stdio`                             | `stdio` or `http`.                                                                    |
| `OSS_MCP_PORT`               | `7345`                              | HTTP port.                                                                            |
| `OSS_MCP_CACHE_ENABLED`      | `true`                              | Enable response caching.                                                              |
| `OSS_MCP_CACHE_PATH`         | `~/.github-search-mcp/cache.sqlite` | SQLite cache path.                                                                    |
| `OSS_MCP_CACHE_TTL_HOURS`    | `24`                                | Cache TTL in hours.                                                                   |
| `OSS_MCP_DEEPWIKI_ENABLED`   | `false`                             | Optional DeepWiki adapter. Set `true` to enable external calls to `mcp.deepwiki.com`. |
| `OSS_MCP_MAX_RESULTS`        | `20`                                | Default max search results.                                                           |
| `OSS_MCP_REQUEST_TIMEOUT_MS` | `15000`                             | Outbound request timeout.                                                             |
| `OSS_MCP_LOG_LEVEL`          | `info`                              | `debug` / `info` / `warn` / `error`.                                                  |

CLI options:

```text
github-search-mcp [options]
  --transport stdio|http
  --port <number>
  --cache true|false
  --deepwiki true|false
  --log-level debug|info|warn|error
  -h, --help
  -v, --version
```

## GitHub API limits

The public GitHub REST API allows about 60 requests/hour unauthenticated and
about 5,000/hour with a token. Responses are cached to minimize requests. Every
tool result includes a rate-limit summary, and the server warns on stderr when
the remaining quota is low.

## Security notes

- **Read-only**: no issue, PR, commit, file writes, or shell execution.
- **Domain allowlist**: outbound HTTPS only to `api.github.com`,
  `raw.githubusercontent.com`, and `mcp.deepwiki.com` when DeepWiki is enabled.
- **Untrusted content**: READMEs, file contents, descriptions, and topics are
  returned as data and must not be treated as instructions.
- **Secret hygiene**: the GitHub token is read only from an environment variable
  and is never logged, cached, or returned in tool output.
- **HTTP transport**: binds to loopback by default and rejects untrusted `Host`
  headers. Do not expose it publicly without an authenticating proxy.

See [SECURITY.md](SECURITY.md) for the full policy and reporting process.

## License

[MIT](LICENSE), simple and permissive.
