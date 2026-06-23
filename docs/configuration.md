# Configuration

Configuration is resolved with this precedence (low → high):

1. Built-in defaults
2. `~/.oss-research-mcp/config.json` (optional)
3. Environment variables
4. CLI flags

## Environment variables

| Variable                     | Default                            | Description                                                                                                 |
| ---------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`               | _(unset)_                          | Optional token for higher rate limits. **Read from env only** — never from the config file, logs, or cache. |
| `OSS_MCP_TRANSPORT`          | `stdio`                            | `stdio` or `http`.                                                                                          |
| `OSS_MCP_PORT`               | `7345`                             | Port for the HTTP transport.                                                                                |
| `OSS_MCP_CACHE_ENABLED`      | `true`                             | Enable response caching.                                                                                    |
| `OSS_MCP_CACHE_PATH`         | `~/.oss-research-mcp/cache.sqlite` | SQLite cache file (`~` expands to home).                                                                    |
| `OSS_MCP_CACHE_TTL_HOURS`    | `24`                               | Cache TTL in hours.                                                                                         |
| `OSS_MCP_DEEPWIKI_ENABLED`   | `false`                            | Optional DeepWiki adapter. Set `true` to enable external calls to `mcp.deepwiki.com`.                       |
| `OSS_MCP_MAX_RESULTS`        | `20`                               | Default maximum search results.                                                                             |
| `OSS_MCP_REQUEST_TIMEOUT_MS` | `15000`                            | Outbound request timeout (ms).                                                                              |
| `OSS_MCP_LOG_LEVEL`          | `info`                             | `debug` / `info` / `warn` / `error`.                                                                        |

## Config file

Optional `~/.oss-research-mcp/config.json`:

```json
{
  "githubTokenEnv": "GITHUB_TOKEN",
  "cache": { "enabled": true, "ttlHours": 24 },
  "deepwiki": { "enabled": false },
  "limits": { "maxSearchResults": 20, "maxFilesToInspect": 30, "maxReadmeChars": 50000 }
}
```

`githubTokenEnv` selects **which** environment variable holds the token (default
`GITHUB_TOKEN`). The token value itself is never stored in the config file.

## CLI flags

```text
--transport stdio|http
--port <number>
--cache true|false
--deepwiki true|false
--log-level debug|info|warn|error
-h, --help
-v, --version
```

## Cache backend

By default the cache uses SQLite via `better-sqlite3`. If that native module is
unavailable on your platform, the server logs a warning (to stderr) and falls
back to an in-memory cache. Set `OSS_MCP_CACHE_ENABLED=false` to disable caching
entirely.

## Logging

Logs are structured JSON written to **stderr only** (stdout is reserved for the
MCP protocol in stdio mode). Known token patterns and the configured token are
redacted from all log output.
