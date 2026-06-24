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
DEMO_MP4 = DEMO / "github-search-mcp-demo.mp4"
MEDIA_MP4 = MEDIA / "github-search-mcp-walkthrough.mp4"
MEDIA_GIF = MEDIA / "github-search-mcp-walkthrough-preview.gif"

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
        "regular": ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"],
        "bold": ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"],
        "mono": ["C:/Windows/Fonts/CascadiaMono.ttf", "C:/Windows/Fonts/consola.ttf"],
    }[weight]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


F_DISPLAY = font(94, "bold")
F_H2 = font(38, "bold")
F_BODY = font(27)
F_SMALL = font(20)
F_MONO = font(20, "mono")


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
    draw.ellipse((930, -260, 1600, 500), fill="#0b2d4d")
    draw.ellipse((1110, 40, 1560, 510), fill="#06351d")

    mark = logo.resize((118, 118), Image.Resampling.LANCZOS)
    img.paste(mark, (88, 78), mark)
    draw.text((230, 78), "GITHUB", font=F_SMALL, fill=MUTED)
    draw.text((228, 110), "SEARCH MCP", font=F_DISPLAY, fill=TEXT)
    draw.text((232, 216), "Repository search, license risk, and OSS comparison.", font=F_BODY, fill="#c9d1d9")

    badges = [
        ("DOCS", "#30363d", TEXT),
        ("NPM github-search-mcp", "#ffd33d", "#0d1117"),
        ("README DEMO", BLUE, TEXT),
        ("LICENSE MIT", "#238636", TEXT),
    ]
    x = 232
    for label, bg, fg in badges:
        tw = draw.textbbox((0, 0), label, font=F_MONO)[2]
        rounded(draw, (x, 292, x + tw + 30, 336), 0, bg)
        draw.text((x + 15, 304), label, font=F_MONO, fill=fg)
        x += tw + 36

    rounded(draw, (974, 168, 1318, 346), 16, PANEL, LINE)
    draw.text((1006, 200), "tool call", font=F_SMALL, fill=MUTED)
    draw.text((1006, 239), "oss_search", font=F_H2, fill=TEXT)
    draw.text((1008, 294), "structured GitHub results", font=F_SMALL, fill=GREEN)

    img.save(README_HERO)


def render_media() -> None:
    if not DEMO_MP4.exists():
        raise FileNotFoundError(f"Missing demo video: {DEMO_MP4}")
    shutil.copy2(DEMO_MP4, MEDIA_MP4)
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is required to render GIF preview")
    palette = MEDIA / "palette.png"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            "0",
            "-t",
            "8",
            "-i",
            str(DEMO_MP4),
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
            "8",
            "-i",
            str(DEMO_MP4),
            "-i",
            str(palette),
            "-lavfi",
            "fps=12,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse",
            str(MEDIA_GIF),
        ],
        check=True,
    )
    palette.unlink(missing_ok=True)


def main() -> None:
    render_hero()
    render_media()
    print(f"Rendered {README_HERO}")
    print(f"Rendered {MEDIA_MP4}")
    print(f"Rendered {MEDIA_GIF}")


if __name__ == "__main__":
    main()
