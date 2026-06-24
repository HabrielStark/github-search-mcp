# GitHub Search MCP demo

This directory contains the public user-experience demo for GitHub Search MCP:

- `index.html` is a static, browser-openable product walkthrough.
- `github-search-mcp-demo.mp4` is the included video walkthrough.
- `assets/demo-poster.png` is the video poster.
- `assets/github-search-logo-*.png` are the app icon variants.

Open the page directly:

```powershell
Start-Process .\demo\index.html
```

Regenerate the video and logo variants:

```powershell
python .\scripts\render-demo-video.py
```

The renderer requires Pillow and FFmpeg to be available on the machine.
