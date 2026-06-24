# Security Policy

## Reporting a vulnerability

Please report security issues privately. Open a
[GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories)
on the repository, or email the maintainers if an address is listed in
`package.json`. Do not open public issues for vulnerabilities. We aim to
acknowledge reports within 72 hours.

## Security model

`github-search-mcp` is designed to be safe by default:

- **Read-only.** The server performs no destructive operations: no creating
  issues/PRs, no commits, no file writes, no repository changes.
- **No shell execution.** The server never executes code from analyzed
  repositories and provides no shell-execution tool.
- **Domain allowlist.** Outbound requests are HTTPS-only and restricted to
  `api.github.com`, `raw.githubusercontent.com`, and, only when the optional
  DeepWiki adapter is enabled, `mcp.deepwiki.com`.
- **Untrusted content.** READMEs, file contents, descriptions, topics and any
  other repository text are treated as **data**, never as instructions. Clients
  and downstream agents must do the same.
- **Output limits.** File size, README length, file count and repository count
  are bounded to prevent resource exhaustion.
- **Secret hygiene.** The GitHub token is read only from an environment
  variable. It is never written to logs or the cache, and never returned in
  tool output. Logs (stderr only) are redacted for known token patterns.

## HTTP transport

The optional Streamable HTTP transport has **no authentication** and binds to
loopback (`127.0.0.1`) by default. Do not expose it on a public interface
without placing an authenticating reverse proxy in front of it.

The local HTTP transport also enforces an allowed `Host` header list for the
bound loopback endpoint to reduce DNS-rebinding exposure.

## Dependencies

Before each release we run `pnpm audit` / `npm audit` and keep dependencies
pinned. We recommend enabling Dependabot and GitHub CodeQL on forks.
