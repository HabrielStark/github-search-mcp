from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "brand"
MEDIA = ROOT / "media"
DEMO = ROOT / "demo"
DEMO_ASSETS = DEMO / "assets"

LOGO_512 = DEMO_ASSETS / "github-search-logo-512.png"
BRAND_LOGO = ASSETS / "github-search-mcp-logo.png"
README_HERO = ASSETS / "github-search-mcp-readme-hero.png"
PITCH_DEMO_MP4 = DEMO / "github-search-mcp-pitch.mp4"
SETUP_DEMO_MP4 = DEMO / "github-search-mcp-setup.mp4"
LEGACY_DEMO_MP4 = DEMO / "github-search-mcp-demo.mp4"
PITCH_MEDIA_MP4 = MEDIA / "github-search-mcp-pitch.mp4"
SETUP_MEDIA_MP4 = MEDIA / "github-search-mcp-setup.mp4"
LEGACY_MEDIA_MP4 = MEDIA / "github-search-mcp-walkthrough.mp4"
PITCH_MEDIA_GIF = MEDIA / "github-search-mcp-pitch-preview.gif"
SETUP_MEDIA_GIF = MEDIA / "github-search-mcp-setup-preview.gif"
LEGACY_MEDIA_GIF = MEDIA / "github-search-mcp-walkthrough-preview.gif"

W, H = 1400, 430
BG = "#0d1117"
PANEL = "#161b22"
LINE = "#30363d"
TEXT = "#f0f6fc"
MUTED = "#8b949e"
GREEN = "#3fb950"
BLUE = "#2f81f7"


def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    candidates = {
        "regular": ["C:/Windows/Fonts/bahnschrift.ttf", "C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"],
        "bold": ["C:/Windows/Fonts/bahnschrift.ttf", "C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"],
        "mono": ["C:/Windows/Fonts/CascadiaMono.ttf", "C:/Windows/Fonts/consola.ttf"],
    }[weight]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


F_DISPLAY = font(72, "bold")
F_H2 = font(36, "bold")
F_BODY = font(27)
F_SMALL = font(20)
F_MONO = font(20, "mono")
F_TINY = font(16)


def rounded(draw: ImageDraw.ImageDraw, box, radius: int, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw: ImageDraw.ImageDraw, xy, value: str, fill=TEXT, fnt=F_BODY, spacing=8):
    draw.multiline_text(xy, value, fill=fill, font=fnt, spacing=spacing)


def render_hero() -> None:
    if not LOGO_512.exists():
        raise FileNotFoundError(f"Generate demo logo first: {LOGO_512}")
    logo = Image.open(LOGO_512).convert("RGBA")
    BRAND_LOGO.parent.mkdir(parents=True, exist_ok=True)
    MEDIA.mkdir(parents=True, exist_ok=True)
    logo.save(BRAND_LOGO)

    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    for x in range(0, W, 56):
        draw.line((x, 0, x, H), fill="#111820", width=1)
    for y in range(0, H, 56):
        draw.line((0, y, W, y), fill="#111820", width=1)

    mark = logo.resize((118, 118), Image.Resampling.LANCZOS)
    img.paste(mark, (88, 78), mark)
    draw.text((230, 76), "READ-ONLY MODEL CONTEXT PROTOCOL SERVER", font=F_SMALL, fill=MUTED)
    draw.text((228, 112), "GitHub Search MCP", font=F_DISPLAY, fill=TEXT)
    draw.text((232, 205), "Repository search, license risk,\nand OSS comparison for agents.", font=F_BODY, fill="#c9d1d9", spacing=7)

    badges = [
        ("DOCS", "#30363d", TEXT),
        ("NPM github-search-mcp", "#ffd33d", "#0d1117"),
        ("DEMO", BLUE, TEXT),
        ("MIT", "#238636", TEXT),
    ]
    x = 232
    for label, bg, fg in badges:
        tw = draw.textbbox((0, 0), label, font=F_MONO)[2]
        rounded(draw, (x, 292, x + tw + 30, 336), 0, bg)
        draw.text((x + 15, 304), label, font=F_MONO, fill=fg)
        x += tw + 36

    rounded(draw, (918, 74, 1294, 356), 18, PANEL, LINE)
    draw.text((950, 106), "agent question", font=F_SMALL, fill=MUTED)
    draw.text((950, 145), "Find an active MIT\nqueue library.", font=F_H2, fill=TEXT, spacing=8)
    draw.line((950, 240, 1262, 240), fill=LINE, width=1)
    rows = [
        ("taskforcesh/bullmq", "94", GREEN),
        ("fastify/fastify", "91", BLUE),
        ("remix-run/react-router", "86", "#a371f7"),
    ]
    y = 262
    for repo, score, color in rows:
        draw.ellipse((950, y + 8, 960, y + 18), fill=color)
        draw.text((970, y), repo, font=F_SMALL, fill="#f0f6fc")
        draw.text((1240, y), score, font=F_TINY, fill="#c9d1d9", anchor="ra")
        y += 29

    img.save(README_HERO)


def render_gif(source: Path, target: Path, seconds: int = 8) -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is required to render GIF preview")
    palette = MEDIA / f"{target.stem}-palette.png"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            "0",
            "-t",
            str(seconds),
            "-i",
            str(source),
            "-vf",
            "fps=12,scale=900:-1:flags=lanczos,palettegen",
            str(palette),
        ],
        check=True,
    )
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            "0",
            "-t",
            str(seconds),
            "-i",
            str(source),
            "-i",
            str(palette),
            "-lavfi",
            "fps=12,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse",
            str(target),
        ],
        check=True,
    )
    palette.unlink(missing_ok=True)


def render_media() -> None:
    for source in (PITCH_DEMO_MP4, SETUP_DEMO_MP4, LEGACY_DEMO_MP4):
        if not source.exists():
            raise FileNotFoundError(f"Missing demo video: {source}")
    shutil.copy2(PITCH_DEMO_MP4, PITCH_MEDIA_MP4)
    shutil.copy2(SETUP_DEMO_MP4, SETUP_MEDIA_MP4)
    shutil.copy2(LEGACY_DEMO_MP4, LEGACY_MEDIA_MP4)
    render_gif(PITCH_DEMO_MP4, PITCH_MEDIA_GIF, 8)
    render_gif(SETUP_DEMO_MP4, SETUP_MEDIA_GIF, 8)
    shutil.copy2(SETUP_MEDIA_GIF, LEGACY_MEDIA_GIF)


def main() -> None:
    render_hero()
    render_media()
    print(f"Rendered {README_HERO}")
    print(f"Rendered {PITCH_MEDIA_MP4}")
    print(f"Rendered {PITCH_MEDIA_GIF}")
    print(f"Rendered {SETUP_MEDIA_MP4}")
    print(f"Rendered {SETUP_MEDIA_GIF}")


if __name__ == "__main__":
    main()
