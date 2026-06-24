# GitHub Search MCP visual system

This project uses a GitHub README-first presentation style. The repository page
is treated as the primary product surface, so the visual language is optimized
for GitHub dark mode, Markdown tables, media previews, and direct file links.

## Brand mark

Source:

- `assets/brand/github-search-mcp-logo-source.png`

Generated variants:

- `assets/brand/github-search-mcp-logo.png`
- `demo/assets/github-search-logo-512.png`
- `demo/assets/github-search-logo-128.png`

The mark combines a repository/branch shape with a search lens. It is GitHub
adjacent, but it is not a copied GitHub or Octocat asset.

## Color

| Token  | Hex       | Use                                    |
| ------ | --------- | -------------------------------------- |
| Ink    | `#0d1117` | GitHub dark background                 |
| Panel  | `#161b22` | README cards and product mock surfaces |
| Border | `#30363d` | GitHub dark borders                    |
| Text   | `#f0f6fc` | Primary text on dark                   |
| Muted  | `#8b949e` | Secondary text                         |
| Blue   | `#2f81f7` | Command and README links               |
| Green  | `#3fb950` | Safe/read-only/action accent           |
| Yellow | `#ffd33d` | NPM badge accent                       |

## Typography

The generated images use system fonts available on Windows:

- Segoe UI for display and body text.
- Cascadia Mono or Consolas for command labels and tool names.

README text remains native GitHub Markdown typography.

## Media

Primary README media:

- `assets/brand/github-search-mcp-readme-hero.png`
- `media/github-search-mcp-pitch-preview.gif`
- `media/github-search-mcp-pitch.mp4`
- `media/github-search-mcp-setup-preview.gif`
- `media/github-search-mcp-setup.mp4`
- `media/github-search-mcp-walkthrough-preview.gif` (compatibility alias for setup)
- `media/github-search-mcp-walkthrough.mp4` (compatibility alias for setup)

Interactive/static demo media:

- `demo/index.html`
- `demo/github-search-mcp-pitch.mp4`
- `demo/github-search-mcp-setup.mp4`
- `demo/github-search-mcp-demo.mp4` (compatibility alias for setup)
- `demo/assets/pitch-poster.png`
- `demo/assets/setup-poster.png`
- `demo/assets/demo-poster.png`

## Regeneration

Regenerate the video, logo variants, README hero, and GIF preview:

```powershell
python .\scripts\render-demo-video.py
python .\scripts\render-readme-assets.py
```

Requirements:

- Python with Pillow.
- FFmpeg on `PATH`.

## README layout rules

- Hero image first.
- Short product description under the hero.
- Demo video table before long docs.
- Show both videos: project pitch first, setup walkthrough second.
- Use GIF previews for GitHub inline motion.
- Do not make GIF previews or primary CTAs link to raw MP4 files; browsers often
  download those links instead of presenting a watch experience.
- Keep MP4 links clearly labeled as source/download artifacts only.
- Keep setup commands copyable and close to the top.
- Keep `oss_` tool names visible because they are the stable MCP API surface.
