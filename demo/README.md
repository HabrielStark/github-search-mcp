# Demo

This directory contains the public-facing user experience demo for OSS Research
MCP.

## Open the interactive demo

Open `demo/index.html` in a browser. It is a static page with no build step and
no external network dependencies.

## Watch the video

The demo video is `demo/oss-research-mcp-demo.mp4`. It shows the first-run user
flow:

1. Start the MCP server with `npx oss-research-mcp`.
2. Add the server to an MCP client.
3. Search GitHub repositories.
4. Analyze license, maintenance, documentation, and risk.
5. Compare candidates and generate integration notes.

## Regenerate the video

```bash
python scripts/render-demo-video.py
```

The script uses Pillow plus the local `ffmpeg` binary and writes:

- `demo/assets/oss-research-logo-512.png`
- `demo/assets/oss-research-logo-128.png`
- `demo/assets/demo-poster.png`
- `demo/oss-research-mcp-demo.mp4`

Temporary frame files are written to `demo/.frames/` and removed automatically.
