from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "demo"
ASSETS = DEMO / "assets"
FRAMES = DEMO / ".frames"
SOURCE_LOGO = ASSETS / "oss-research-logo-source.png"
LOGO_512 = ASSETS / "oss-research-logo-512.png"
LOGO_128 = ASSETS / "oss-research-logo-128.png"
POSTER = ASSETS / "demo-poster.png"
OUTPUT = DEMO / "oss-research-mcp-demo.mp4"

W, H = 1920, 1080
FPS = 30
SECONDS = 32
TOTAL_FRAMES = FPS * SECONDS

INK = "#0d1117"
MUTED = "#59636e"
LINE = "#d8dee4"
CANVAS = "#f6f8fa"
PANEL = "#ffffff"
ACCENT = "#2ea043"
ACCENT_DARK = "#176f2c"
CODE = "#161b22"


def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    candidates = {
        "regular": [
            "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ],
        "bold": [
            "C:/Windows/Fonts/segoeuib.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
        ],
        "mono": [
            "C:/Windows/Fonts/CascadiaMono.ttf",
            "C:/Windows/Fonts/consola.ttf",
        ],
    }[weight]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


FONT_HERO = font(78, "bold")
FONT_H2 = font(54, "bold")
FONT_H3 = font(30, "bold")
FONT_BODY = font(28)
FONT_SMALL = font(22)
FONT_TINY = font(18)
FONT_MONO = font(24, "mono")
FONT_MONO_SMALL = font(21, "mono")


def ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 0.5 - math.cos(t * math.pi) / 2


def rounded(draw: ImageDraw.ImageDraw, box, radius: int, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw: ImageDraw.ImageDraw, xy, value: str, fill=INK, fnt=FONT_BODY, spacing=8):
    draw.multiline_text(xy, value, fill=fill, font=fnt, spacing=spacing)


def wrap(value: str, max_chars: int) -> str:
    words = value.split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        candidate = " ".join([*current, word])
        if len(candidate) > max_chars and current:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return "\n".join(lines)


def prepare_assets() -> Image.Image:
    ASSETS.mkdir(parents=True, exist_ok=True)
    if not SOURCE_LOGO.exists():
        raise FileNotFoundError(f"Missing source logo: {SOURCE_LOGO}")
    logo = Image.open(SOURCE_LOGO).convert("RGBA")
    logo.thumbnail((512, 512), Image.Resampling.LANCZOS)
    square = Image.new("RGBA", (512, 512), (255, 255, 255, 0))
    square.alpha_composite(logo, ((512 - logo.width) // 2, (512 - logo.height) // 2))
    square.save(LOGO_512)
    square.resize((128, 128), Image.Resampling.LANCZOS).save(LOGO_128)
    return square


def background() -> Image.Image:
    img = Image.new("RGB", (W, H), CANVAS)
    draw = ImageDraw.Draw(img)
    for x in range(0, W, 56):
        draw.line((x, 0, x, H), fill="#eef1f4", width=1)
    for y in range(0, H, 56):
        draw.line((0, y, W, y), fill="#eef1f4", width=1)
    return img


def card_shadow(img: Image.Image, box, radius=34, blur=34):
    x1, y1, x2, y2 = box
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle((x1, y1 + 20, x2, y2 + 20), radius=radius, fill=(13, 17, 23, 34))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    img.paste(Image.alpha_composite(img.convert("RGBA"), shadow).convert("RGB"))


def draw_nav(img: Image.Image, draw: ImageDraw.ImageDraw, logo: Image.Image):
    draw.rounded_rectangle((84, 54, 474, 122), radius=34, fill="#ffffff", outline=LINE)
    nav_logo = logo.resize((48, 48), Image.Resampling.LANCZOS)
    img.paste(nav_logo.convert("RGB"), (104, 64), nav_logo)
    draw.text((166, 75), "OSS Research MCP", font=FONT_SMALL, fill=INK)
    for i, label in enumerate(["Search", "Analyze", "Compare", "Adopt"]):
        x = 1220 + i * 136
        draw.rounded_rectangle((x, 62, x + 112, 114), radius=26, fill="#ffffff", outline=LINE)
        draw.text((x + 20, 77), label, font=FONT_TINY, fill=MUTED)


def terminal(draw: ImageDraw.ImageDraw, box, title: str, lines: list[tuple[str, str]], progress=1.0):
    rounded(draw, box, 30, CODE, outline="#30363d")
    x1, y1, x2, _ = box
    for i, c in enumerate(["#ff6a69", "#d29922", ACCENT]):
        draw.ellipse((x1 + 28 + i * 26, y1 + 26, x1 + 40 + i * 26, y1 + 38), fill=c)
    draw.text((x2 - 260, y1 + 19), title, font=FONT_TINY, fill="#8b949e")
    y = y1 + 74
    visible = int(len(lines) * progress + 0.999)
    for prefix, content in lines[:visible]:
        draw.text((x1 + 34, y), prefix, font=FONT_MONO_SMALL, fill=ACCENT)
        draw.text((x1 + 84, y), content, font=FONT_MONO_SMALL, fill="#f0f6fc")
        y += 42


def pill(draw: ImageDraw.ImageDraw, x, y, label, fill="#eef6f0", color=ACCENT_DARK):
    w = int(draw.textlength(label, font=FONT_TINY)) + 28
    rounded(draw, (x, y, x + w, y + 38), 19, fill)
    draw.text((x + 14, y + 8), label, font=FONT_TINY, fill=color)


def scene_hero(img, draw, logo, t):
    draw_nav(img, draw, logo)
    text(draw, (90, 226), "GitHub research,\ninside your MCP client.", INK, FONT_HERO, spacing=4)
    text(
        draw,
        (94, 430),
        wrap(
            "Search repositories, inspect license risk, compare candidates, and generate adoption notes without leaving the workflow.",
            48,
        ),
        MUTED,
        FONT_BODY,
    )
    pill(draw, 94, 570, "12 read-only tools")
    pill(draw, 304, 570, "No paid API required")
    terminal(
        draw,
        (1010, 214, 1804, 720),
        "first run",
        [
            ("$", "npx oss-research-mcp"),
            (">", "transport: stdio"),
            (">", "cache: sqlite"),
            (">", "deepwiki: disabled by default"),
            (">", "ready for MCP client connections"),
        ],
        progress=t,
    )


def scene_connect(img, draw, logo, t):
    draw_nav(img, draw, logo)
    text(draw, (94, 188), "Connect once.\nUse everywhere.", INK, FONT_HERO, spacing=4)
    text(
        draw,
        (98, 400),
        wrap("Paste the server entry into any MCP-compatible client. Add a token only when you want higher GitHub quota.", 46),
        MUTED,
        FONT_BODY,
    )
    terminal(
        draw,
        (790, 176, 1804, 788),
        "mcpServers.json",
        [
            ("{", '"mcpServers": {'),
            (" ", '"oss-research": {'),
            (" ", '"command": "npx",'),
            (" ", '"args": ["-y", "oss-research-mcp"],'),
            (" ", '"env": { "GITHUB_TOKEN": "" }'),
            (" ", "}"),
            ("}", "}"),
        ],
        progress=t,
    )


def result_row(draw, y, name, desc, score):
    rounded(draw, (812, y, 1744, y + 104), 22, PANEL, outline=LINE)
    draw.text((840, y + 22), name, font=FONT_H3, fill=INK)
    draw.text((840, y + 62), desc, font=FONT_TINY, fill=MUTED)
    rounded(draw, (1614, y + 27, 1716, y + 77), 25, INK)
    draw.text((1638, y + 39), score, font=FONT_TINY, fill="#ffffff")


def scene_search(img, draw, logo, t):
    draw_nav(img, draw, logo)
    text(draw, (94, 188), "Ask for an\nopen-source option.", INK, FONT_HERO, spacing=4)
    text(draw, (98, 400), wrap("The agent calls oss_find_open_source_alternatives and gets ranked candidates with risk context.", 45), MUTED, FONT_BODY)
    rounded(draw, (786, 172, 1782, 788), 34, "#ffffff", outline=LINE)
    draw.text((830, 218), "Postman alternative for API testing client", font=FONT_H3, fill=INK)
    draw.rounded_rectangle((830, 270, 1112, 318), radius=24, fill="#eef6f0")
    draw.text((852, 282), "mustBeSelfHosted: true", font=FONT_TINY, fill=ACCENT_DARK)
    visible = int(3 * t + 0.999)
    rows = [
        ("hoppscotch/hoppscotch", "Strong docs, active project, web-first workflow.", "91"),
        ("usebruno/bruno", "Git-friendly collections and local-first API testing.", "88"),
        ("insomnia/insomnia", "Established API client with broad ecosystem.", "82"),
    ]
    for idx, row in enumerate(rows[:visible]):
        result_row(draw, 354 + idx * 122, *row)


def bar(draw, x, y, label, value, color=ACCENT):
    draw.text((x, y), label, font=FONT_TINY, fill=MUTED)
    rounded(draw, (x, y + 34, x + 420, y + 48), 7, "#eaeef2")
    rounded(draw, (x, y + 34, x + int(420 * value), y + 48), 7, color)


def scene_analyze(img, draw, logo, t):
    draw_nav(img, draw, logo)
    text(draw, (94, 188), "Decision signals,\nnot raw links.", INK, FONT_HERO, spacing=4)
    text(draw, (98, 400), wrap("Analysis combines license, maintenance, documentation, adoption, package signals, and risk.", 46), MUTED, FONT_BODY)
    rounded(draw, (794, 178, 1788, 790), 34, PANEL, outline=LINE)
    draw.text((836, 226), "Repository analysis", font=FONT_H2, fill=INK)
    draw.text((838, 298), "usebruno/bruno", font=FONT_H3, fill=MUTED)
    factor = ease(t)
    bar(draw, 840, 382, "License safety", 0.95 * factor)
    bar(draw, 840, 472, "Maintenance", 0.82 * factor)
    bar(draw, 840, 562, "Documentation", 0.76 * factor)
    rounded(draw, (1370, 382, 1688, 592), 32, "#0d1117")
    draw.text((1415, 430), "88", font=font(88, "bold"), fill="#ffffff")
    draw.text((1424, 532), "overall score", font=FONT_SMALL, fill="#8b949e")
    pill(draw, 1370, 632, "permissive license")
    pill(draw, 1596, 632, "medium risk")


def scene_notes(img, draw, logo, t):
    draw_nav(img, draw, logo)
    text(draw, (94, 188), "Turn research into\nan adoption plan.", INK, FONT_HERO, spacing=4)
    text(draw, (98, 432), wrap("Generate integration notes with install commands, important files, risks, and license reminders.", 46), MUTED, FONT_BODY)
    terminal(
        draw,
        (790, 178, 1804, 810),
        "oss_generate_integration_notes",
        [
            ("1", "Review license obligations before shipping."),
            ("2", "Install dependency or clone the repository."),
            ("3", "Read README, docs, and examples."),
            ("4", "Integrate through public APIs only."),
            ("5", "Add tests around the chosen integration."),
            ("✓", "Decision-ready output for the user."),
        ],
        progress=t,
    )


def draw_progress(draw, frame):
    pct = frame / max(1, TOTAL_FRAMES - 1)
    rounded(draw, (84, H - 54, W - 84, H - 40), 7, "#eaeef2")
    rounded(draw, (84, H - 54, 84 + int((W - 168) * pct), H - 40), 7, ACCENT)


SCENES = [
    scene_hero,
    scene_connect,
    scene_search,
    scene_analyze,
    scene_notes,
]


def render_frame(frame: int, logo: Image.Image) -> Image.Image:
    img = background()
    draw = ImageDraw.Draw(img)
    scene_len = TOTAL_FRAMES / len(SCENES)
    scene_index = min(len(SCENES) - 1, int(frame / scene_len))
    local = (frame - scene_index * scene_len) / scene_len
    SCENES[scene_index](img, draw, logo, ease(local))
    draw_progress(draw, frame)
    return img


def render_video():
    logo = prepare_assets()
    if FRAMES.exists():
        shutil.rmtree(FRAMES)
    FRAMES.mkdir(parents=True)

    poster = render_frame(FPS * 3, logo)
    poster.save(POSTER)

    for frame in range(TOTAL_FRAMES):
        render_frame(frame, logo).save(FRAMES / f"frame_{frame:04d}.png")

    cmd = [
        "ffmpeg",
        "-y",
        "-framerate",
        str(FPS),
        "-i",
        str(FRAMES / "frame_%04d.png"),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-crf",
        "20",
        str(OUTPUT),
    ]
    subprocess.run(cmd, check=True)
    shutil.rmtree(FRAMES)


if __name__ == "__main__":
    render_video()
