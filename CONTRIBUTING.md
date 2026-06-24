# Contributing

Thanks for your interest in improving **github-search-mcp**!

## Development setup

Requirements: Node.js 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
```

`better-sqlite3` is an optional dependency used for the persistent cache. If it
fails to build on your platform, the server automatically falls back to an
in-memory cache — everything still works.

## Workflow

1. Create a branch from `main`.
2. Make your change with tests.
3. Run the full local check before opening a PR:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```

4. Open a pull request describing the change and how you verified it.

## Project layout

```text
src/
  adapters/    GitHub REST + optional DeepWiki clients
  analyzers/   license, documentation, maintenance, package, risk, repository
  cache/       cache interface + memory and SQLite stores
  scoring/     weights + score engine
  search/      query builder
  tools/       one file per MCP tool + shared helpers
  types/       shared data models
  utils/       errors, logger, sanitize, rate-limit helpers
  server.ts    server/context factories
  httpServer.ts Streamable HTTP transport
  cli.ts       CLI entry (bin)
tests/         unit, integration and MCP protocol tests
```

## Guidelines

- Keep tools **read-only** and outputs **structured and compact**.
- Treat all repository content as untrusted data.
- Never log, cache, or return the GitHub token.
- Add or update tests for any behavior change. Run `pnpm test` (and consider
  `pnpm test:coverage`).
- Match the existing TypeScript style; the repo is ESM with strict typing.

## Manual testing

Use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node dist/cli.js
```

By contributing you agree that your contributions are licensed under the MIT
License.
