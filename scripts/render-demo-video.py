from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "demo"
ASSETS = DEMO / "assets"
FRAMES = DEMO / ".frames"
SOURCE_LOGO = ASSETS / "github-search-logo-source.png"
LOGO_512 = ASSETS / "github-search-logo-512.png"
LOGO_128 = ASSETS / "github-search-logo-128.png"
POSTER = ASSETS / "demo-poster.png"
PITCH_POSTER = ASSETS / "pitch-poster.png"
SETUP_POSTER = ASSETS / "setup-poster.png"
PITCH_OUTPUT = DEMO / "github-search-mcp-pitch.mp4"
SETUP_OUTPUT = DEMO / "github-search-mcp-setup.mp4"
LEGACY_OUTPUT = DEMO / "github-search-mcp-demo.mp4"

W, H = 1920, 1080
FPS = 30
PITCH_SECONDS = 26
SETUP_SECONDS = 34

BG = "#0d1117"
BG_DARK = "#010409"
PANEL = "#161b22"
PANEL_2 = "#0d1117"
TEXT = "#f0f6fc"
MUTED = "#8b949e"
LINE = "#30363d"
BLUE = "#2f81f7"
BLUE_2 = "#79c0ff"
GREEN = "#3fb950"
GREEN_2 = "#7ee787"
AMBER = "#d29922"
RED = "#f85149"
WHITE = "#ffffff"


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


F_HERO = font(92, "bold")
F_H1 = font(68, "bold")
F_H2 = font(46, "bold")
F_H3 = font(30, "bold")
F_BODY = font(28)
F_SMALL = font(22)
F_TINY = font(18)
F_MONO = font(25, "mono")
F_MONO_SM = font(21, "mono")


def ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 0.5 - math.cos(t * math.pi) / 2


def rounded(draw: ImageDraw.ImageDraw, box, radius: int, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw: ImageDraw.ImageDraw, xy, value: str, fill=TEXT, fnt=F_BODY, spacing=8):
    draw.multiline_text(xy, value, fill=fill, font=fnt, spacing=spacing)


def text_size(draw: ImageDraw.ImageDraw, value: str, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), value, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def wrap(value: str, chars: int) -> str:
    words = value.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) <= chars:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return "\n".join(lines)


def paste_logo(img: Image.Image, logo: Image.Image, xy: tuple[int, int], size: int):
    mark = logo.resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
    img.paste(mark, xy, mark)


def prepare_logo() -> Image.Image:
    if not SOURCE_LOGO.exists():
        raise FileNotFoundError(f"Missing source logo: {SOURCE_LOGO}")
    source = Image.open(SOURCE_LOGO).convert("RGBA")
    px = source.load()
    width, height = source.size
    alpha = Image.new("L", source.size, 255)
    apx = alpha.load()
    seen = set()
    stack = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or x < 0 or y < 0 or x >= width or y >= height:
            continue
        seen.add((x, y))
        r, g, b, _ = px[x, y]
        if r < 238 or g < 238 or b < 238:
            continue
        apx[x, y] = 0
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    source.putalpha(alpha)
    bbox = alpha.getbbox()
    if bbox is None:
        raise RuntimeError("Could not isolate logo foreground")
    source = source.crop(bbox)
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    source.thumbnail((900, 900), Image.Resampling.LANCZOS)
    canvas.paste(source, ((1024 - source.width) // 2, (1024 - source.height) // 2), source)
    canvas.resize((512, 512), Image.Resampling.LANCZOS).save(LOGO_512)
    canvas.resize((128, 128), Image.Resampling.LANCZOS).save(LOGO_128)
    return canvas


def base_frame() -> Image.Image:
    img = Image.new("RGB", (W, H), BG_DARK)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for x in range(0, W, 72):
        od.line((x, 0, x, H), fill=(240, 246, 252, 10), width=1)
    for y in range(0, H, 72):
        od.line((0, y, W, y), fill=(240, 246, 252, 10), width=1)
    for y in range(0, 360):
        alpha = int(24 * (1 - y / 360))
        od.line((0, y, W, y), fill=(47, 129, 247, alpha), width=1)
    overlay = overlay.filter(ImageFilter.GaussianBlur(1))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    return img


def nav(img: Image.Image, draw: ImageDraw.ImageDraw, logo: Image.Image):
    paste_logo(img, logo, (98, 58), 54)
    draw.text((168, 69), "GitHub Search MCP", font=F_SMALL, fill=TEXT)
    x = 1320
    for item in ["Demo", "Flow", "Commands", "Tools"]:
        draw.text((x, 76), item, font=F_TINY, fill="#c9d1d9")
        x += 132


def pill(draw: ImageDraw.ImageDraw, xy: tuple[int, int], value: str, accent=GREEN_2):
    x, y = xy
    tw, th = text_size(draw, value, F_TINY)
    rounded(draw, (x, y, x + tw + 36, y + 36), 18, "#12261b", "#2f6f3e")
    rounded(draw, (x + 13, y + 13, x + 23, y + 23), 5, GREEN)
    draw.text((x + 30, y + 8), value, font=F_TINY, fill=accent)


def product_window(img: Image.Image, draw: ImageDraw.ImageDraw, logo: Image.Image, x=980, y=220):
    rounded(draw, (x, y, x + 760, y + 600), 22, PANEL, LINE, 2)
    rounded(draw, (x, y, x + 760, y + 58), 22, BG, LINE, 1)
    draw.rectangle((x + 1, y + 36, x + 759, y + 58), fill=BG)
    rounded(draw, (x + 24, y + 23, x + 36, y + 35), 6, RED)
    rounded(draw, (x + 48, y + 23, x + 60, y + 35), 6, AMBER)
    rounded(draw, (x + 72, y + 23, x + 84, y + 35), 6, GREEN)
    draw.text((x + 112, y + 19), "github-search-mcp / search session", font=F_MONO_SM, fill="#c9d1d9")
    draw.line((x + 250, y + 58, x + 250, y + 600), fill=LINE, width=2)
    paste_logo(img, logo, (x + 30, y + 88), 48)
    draw.text((x + 92, y + 88), "GitHub Search", font=F_SMALL, fill=TEXT)
    draw.text((x + 92, y + 117), "MCP repository scout", font=F_TINY, fill=MUTED)
    menu = ["Search repositories", "Analyze repository", "Compare candidates", "License risk", "Integration notes"]
    for i, item in enumerate(menu):
        yy = y + 178 + i * 52
        if i == 0:
            rounded(draw, (x + 24, yy, x + 226, yy + 38), 9, "#10233d", "#1f6feb")
            fill = "#79c0ff"
        else:
            fill = MUTED
        draw.text((x + 42, yy + 10), item, font=F_TINY, fill=fill)
    cmd_x, cmd_y = x + 282, y + 86
    rounded(draw, (cmd_x, cmd_y, x + 728, cmd_y + 78), 12, BG_DARK, LINE)
    draw.text((cmd_x + 18, cmd_y + 14), "Tool call", font=F_TINY, fill=MUTED)
    draw.text((cmd_x + 18, cmd_y + 42), "Find a Node.js queue library", font=F_SMALL, fill=TEXT)
    rounded(draw, (x + 656, cmd_y + 18, x + 710, cmd_y + 60), 9, "#238636")
    draw.text((x + 670, cmd_y + 29), "Run", font=F_TINY, fill=WHITE)
    repos = [
        ("taskforcesh/bullmq", "Strong docs and active releases.", "94/100", ["MIT", "TypeScript", "active"]),
        ("OptimalBits/bull", "Broad adoption, lower recent velocity.", "81/100", ["MIT", "popular", "legacy"]),
        ("bee-queue/bee-queue", "Smaller surface, higher risk.", "68/100", ["MIT", "small", "risk"]),
    ]
    for i, (name, desc, score, tags) in enumerate(repos):
        yy = y + 192 + i * 118
        rounded(draw, (cmd_x, yy, x + 728, yy + 100), 12, PANEL, LINE)
        draw.text((cmd_x + 18, yy + 16), name, font=F_SMALL, fill=TEXT)
        draw.text((cmd_x + 18, yy + 44), desc, font=F_TINY, fill=MUTED)
        tx = cmd_x + 18
        for tag in tags:
            tw, _ = text_size(draw, tag, F_TINY)
            rounded(draw, (tx, yy + 68, tx + tw + 18, yy + 91), 12, PANEL_2, LINE)
            draw.text((tx + 9, yy + 71), tag, font=F_TINY, fill=MUTED)
            tx += tw + 26
        rounded(draw, (x + 628, yy + 20, x + 712, yy + 54), 17, BLUE)
        draw.text((x + 640, yy + 28), score, font=F_TINY, fill=WHITE)


def scene_intro(img: Image.Image, draw: ImageDraw.ImageDraw, logo: Image.Image, t: float):
    nav(img, draw, logo)
    pill(draw, (120, 220), "Read-only GitHub research for MCP clients")
    text(draw, (118, 295), "Search GitHub\nfrom your agent.", TEXT, F_HERO, 4)
    text(
        draw,
        (126, 530),
        wrap("Find repositories, inspect license risk, compare candidates, and produce structured MCP output.", 42),
        "#c9d1d9",
        F_BODY,
        10,
    )
    rounded(draw, (126, 675, 370, 730), 10, "#238636")
    draw.text((160, 691), "Watch the walkthrough", font=F_SMALL, fill=WHITE)
    rounded(draw, (390, 675, 612, 730), 10, "#161b22", LINE)
    draw.text((423, 691), "Copy setup", font=F_SMALL, fill=TEXT)
    for i, (big, small) in enumerate([("12 tools", "search and compare"), ("0 writes", "safe by default"), ("GitHub REST", "token optional")]):
        bx = 126 + i * 200
        rounded(draw, (bx, 790, bx + 172, 870), 12, "#0d1117", "#21262d")
        draw.text((bx + 16, 805), big, font=F_SMALL, fill=WHITE)
        draw.text((bx + 16, 838), small, font=F_TINY, fill=MUTED)
    product_window(img, draw, logo, 990, 240)


def scene_install(img: Image.Image, draw: ImageDraw.ImageDraw, logo: Image.Image, t: float):
    nav(img, draw, logo)
    text(draw, (118, 190), "Start it in one command.", TEXT, F_H1, 4)
    text(draw, (124, 350), wrap("Run over stdio by default. Add a GitHub token only when you want higher API limits.", 48), "#c9d1d9", F_BODY, 10)
    rounded(draw, (120, 510, 960, 842), 18, "#0d1117", LINE, 2)
    draw.text((150, 540), "terminal", font=F_TINY, fill=MUTED)
    lines = [
        ("# Run without installing", MUTED),
        ("npx github-search-mcp", GREEN_2),
        ("", MUTED),
        ("# Optional higher GitHub API limits", MUTED),
        ("GITHUB_TOKEN=ghp_xxx npx github-search-mcp", GREEN_2),
        ("", MUTED),
        ("GitHub Search MCP ready over stdio", BLUE_2),
    ]
    y = 590
    for line, color in lines:
        draw.text((154, y), line, font=F_MONO, fill=color)
        y += 38
    rounded(draw, (1100, 474, 1690, 880), 18, PANEL, LINE, 2)
    draw.text((1135, 512), "MCP client config", font=F_H3, fill=TEXT)
    config = [
        '{',
        '  "mcpServers": {',
        '    "github-search": {',
        '      "command": "npx",',
        '      "args": ["-y", "github-search-mcp"]',
        '    }',
        '  }',
        '}',
    ]
    y = 582
    for line in config:
        draw.text((1138, y), line, font=F_MONO_SM, fill="#c9d1d9")
        y += 34


def scene_search(img: Image.Image, draw: ImageDraw.ImageDraw, logo: Image.Image, t: float):
    nav(img, draw, logo)
    text(draw, (118, 178), "Search, rank, and explain.", TEXT, F_H1, 4)
    text(draw, (124, 336), wrap("The agent asks a practical dependency question. GitHub Search MCP returns candidates with signals attached.", 50), "#c9d1d9", F_BODY, 10)
    product_window(img, draw, logo, 1040, 250)
    rounded(draw, (120, 510, 720, 804), 18, PANEL, LINE, 2)
    draw.text((154, 548), "Agent request", font=F_H3, fill=TEXT)
    text(draw, (154, 606), wrap("Find an actively maintained Node.js queue library with permissive licensing and strong docs.", 34), "#c9d1d9", F_BODY, 8)
    rounded(draw, (154, 724, 355, 774), 10, "#1f6feb")
    draw.text((184, 738), "oss_search", font=F_SMALL, fill=WHITE)


def scene_compare(img: Image.Image, draw: ImageDraw.ImageDraw, logo: Image.Image, t: float):
    nav(img, draw, logo)
    text(draw, (118, 170), "Turn repo noise into a decision.", TEXT, F_H1, 4)
    cards = [
        ("Maintenance", "Release velocity, issue age, branch freshness, archived status.", GREEN_2),
        ("License risk", "SPDX detection, permissive preference, unknown license warnings.", BLUE_2),
        ("Adoption", "Stars, forks, watchers, topics, ecosystem fit.", "#d2a8ff"),
        ("Integration notes", "Install command, key files, usage steps, risks, next checks.", "#f2cc60"),
    ]
    for i, (title, body, color) in enumerate(cards):
        x = 126 + (i % 2) * 470
        y = 390 + (i // 2) * 220
        rounded(draw, (x, y, x + 420, y + 170), 18, PANEL, LINE, 2)
        rounded(draw, (x + 24, y + 24, x + 60, y + 60), 18, color)
        draw.text((x + 82, y + 25), title, font=F_H3, fill=TEXT)
        text(draw, (x + 26, y + 82), wrap(body, 32), MUTED, F_SMALL, 6)
    rounded(draw, (1120, 330, 1708, 806), 18, "#0d1117", LINE, 2)
    draw.text((1154, 370), "Selected result", font=F_H3, fill=TEXT)
    draw.text((1154, 430), "taskforcesh/bullmq", font=F_H2, fill=WHITE)
    text(draw, (1156, 505), wrap("Best fit for a modern TypeScript queue because it balances docs, active maintenance, permissive license, and ecosystem maturity.", 42), "#c9d1d9", F_BODY, 8)
    for i, (label, value, color) in enumerate([("score", "94/100", BLUE), ("license", "MIT", GREEN), ("risk", "low", GREEN)]):
        x = 1156 + i * 172
        rounded(draw, (x, 680, x + 142, 744), 14, PANEL, LINE)
        draw.text((x + 16, 694), label, font=F_TINY, fill=MUTED)
        draw.text((x + 16, 718), value, font=F_SMALL, fill=color)


def scene_end(img: Image.Image, draw: ImageDraw.ImageDraw, logo: Image.Image, t: float):
    nav(img, draw, logo)
    paste_logo(img, logo, (845, 166), 140)
    title = "GitHub Search MCP"
    tw, _ = text_size(draw, title, F_H1)
    draw.text(((W - tw) // 2, 336), title, font=F_H1, fill=TEXT)
    body = "Search GitHub, compare open-source candidates, and ship integration notes from your MCP client."
    text(draw, (520, 446), wrap(body, 58), "#c9d1d9", F_BODY, 10)
    rounded(draw, (650, 610, 1270, 690), 14, "#0d1117", LINE, 2)
    draw.text((696, 636), "npx github-search-mcp", font=F_MONO, fill=GREEN_2)
    rounded(draw, (744, 750, 1178, 812), 12, "#238636")
    draw.text((802, 768), "Open demo/index.html", font=F_SMALL, fill=WHITE)


SCENES = [
    (0, 6, scene_intro),
    (6, 12, scene_install),
    (12, 19, scene_search),
    (19, 25, scene_compare),
    (25, 30, scene_end),
]

PITCH_SCENES = [
    (0, 7, scene_intro),
    (7, 15, scene_search),
    (15, 22, scene_compare),
    (22, 26, scene_end),
]

SETUP_SCENES = [
    (0, 8, scene_install),
    (8, 18, scene_search),
    (18, 28, scene_compare),
    (28, 34, scene_end),
]


def render_frame(frame: int, logo: Image.Image, scenes) -> Image.Image:
    seconds = frame / FPS
    img = base_frame()
    draw = ImageDraw.Draw(img)
    for start, end, scene in scenes:
        if start <= seconds < end:
            local_t = ease((seconds - start) / (end - start))
            scene(img, draw, logo, local_t)
            break
    return img


def render_video(output: Path, scenes, seconds: int, poster: Path, poster_second: int, logo: Image.Image) -> None:
    if FRAMES.exists():
        shutil.rmtree(FRAMES)
    FRAMES.mkdir(parents=True)
    total_frames = FPS * seconds
    poster_frame = FPS * poster_second
    for frame in range(total_frames):
        img = render_frame(frame, logo, scenes)
        if frame == poster_frame:
            img.save(poster)
        img.save(FRAMES / f"frame_{frame:04d}.png", optimize=False)
    subprocess.run(
        [
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
            str(output),
        ],
        check=True,
    )
    shutil.rmtree(FRAMES)
    print(f"Rendered {output}")


def main() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is required to render demo video")
    logo = prepare_logo()
    render_video(PITCH_OUTPUT, PITCH_SCENES, PITCH_SECONDS, PITCH_POSTER, 9, logo)
    render_video(SETUP_OUTPUT, SETUP_SCENES, SETUP_SECONDS, SETUP_POSTER, 10, logo)
    shutil.copy2(SETUP_OUTPUT, LEGACY_OUTPUT)
    shutil.copy2(SETUP_POSTER, POSTER)
    print(f"Updated legacy compatibility video {LEGACY_OUTPUT}")


if __name__ == "__main__":
    main()
