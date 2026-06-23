# Examples

- [`mcp-client-config.json`](mcp-client-config.json) — stdio server entry for
  MCP clients (Claude Desktop, Cursor, etc.).
- [`mcp-client-config-http.json`](mcp-client-config-http.json) — connecting over
  the optional Streamable HTTP transport.
- [`tool-calls.md`](tool-calls.md) — copy-paste example arguments for every tool.

## Try it with the MCP Inspector

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/cli.js
```

Then open the printed URL and call any `oss_*` tool.
