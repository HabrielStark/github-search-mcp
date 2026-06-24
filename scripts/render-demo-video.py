from __future__ import annotations

import math
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

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
TRANSITION_SECONDS = 0.55

INK = "#05070b"
CANVAS = "#080d14"
PANEL = "#0f1620"
PANEL_2 = "#151e2a"
PANEL_3 = "#f6f8fa"
TEXT = "#f4f7fb"
TEXT_DARK = "#0d1117"
MUTED = "#98a6b3"
MUTED_DARK = "#57606a"
LINE = "#273241"
LINE_LIGHT = "#d0d7de"
BLUE = "#2f81f7"
BLUE_SOFT = "#79c0ff"
GREEN = "#3fb950"
GREEN_SOFT = "#7ee787"
AMBER = "#f2cc60"
PURPLE = "#d2a8ff"
RED = "#ff7b72"
WHITE = "#ffffff"


def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    candidates = {
        "regular": [
            "C:/Windows/Fonts/bahnschrift.ttf",
            "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ],
        "bold": [
            "C:/Windows/Fonts/bahnschrift.ttf",
            "C:/Windows/Fonts/segoeuib.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
        ],
        "mono": [
            "C:/Windows/Fonts/CascadiaCode.ttf",
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


F_DISPLAY = font(92, "bold")
F_TITLE = font(74, "bold")
F_HEAD = font(50, "bold")
F_SUBHEAD = font(34, "bold")
F_BODY = font(28)
F_SMALL = font(22)
F_TINY = font(18)
F_MONO = font(25, "mono")
F_MONO_SMALL = font(20, "mono")


def clamp(value: float, low = 0.0, high = 1.0) -> float:
    return max(low, min(high, value))


def ease(t: float) -> float:
    t = clamp(t)
    return 1 - pow(1 - t, 3)


def smooth(t: float) -> float:
    t = clamp(t)
    return t * t * (3 - 2 * t)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def rgb(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    c = hex_color.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), alpha


def text_size(draw: ImageDraw.ImageDraw, value: str, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), value, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def wrap_lines(
    draw: ImageDraw.ImageDraw,
    value: str,
    max_width: int,
    fnt: ImageFont.FreeTypeFont,
) -> list[str]:
    lines: list[str] = []
    for paragraph in value.split("\n"):
        words = paragraph.split()
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if draw.textlength(candidate, font=fnt) <= max_width or not current:
                current = candidate
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)
    return lines


def fit_font(
    draw: ImageDraw.ImageDraw,
    value: str,
    max_width: int,
    fonts: Iterable[ImageFont.FreeTypeFont],
) -> ImageFont.FreeTypeFont:
    selected = None
    for fnt in fonts:
        selected = fnt
        if draw.textlength(value, font=fnt) <= max_width:
            return fnt
    if selected is None:
        raise ValueError("No fonts provided")
    return selected


def draw_text(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    value: str,
    *,
    fnt: ImageFont.FreeTypeFont,
    fill: str,
    spacing: int = 10,
) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = box
    lines = wrap_lines(draw, value, x2 - x1, fnt)
    line_height = text_size(draw, "Hg", fnt)[1] + spacing
    max_lines = max(1, int((y2 - y1 + spacing) / line_height))
    lines = lines[:max_lines]
    y = y1
    max_right = x1
    for line in lines:
        draw.text((x1, y), line, font=fnt, fill=fill)
        max_right = max(max_right, int(x1 + draw.textlength(line, font=fnt)))
        y += line_height
    return x1, y1, max_right, min(y, y2)


def rounded(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    radius: int,
    fill: str,
    outline: str | None = None,
    width: int = 1,
) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def card(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    *,
    radius: int = 24,
    fill: str = PANEL,
    outline: str = LINE,
) -> None:
    x1, y1, x2, y2 = box
    draw.rounded_rectangle((x1, y1 + 14, x2, y2 + 14), radius=radius, fill="#030508")
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=1)
    draw.line((x1 + radius, y1 + 1, x2 - radius, y1 + 1), fill="#263243", width=1)


def prepare_logo() -> Image.Image:
    if not SOURCE_LOGO.exists():
        raise FileNotFoundError(f"Missing source logo: {SOURCE_LOGO}")
    source = Image.open(SOURCE_LOGO).convert("RGBA")
    px = source.load()
    width, height = source.size
    alpha = Image.new("L", source.size, 255)
    apx = alpha.load()
    seen: set[tuple[int, int]] = set()
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
    source.thumbnail((890, 890), Image.Resampling.LANCZOS)
    canvas.paste(source, ((1024 - source.width) // 2, (1024 - source.height) // 2), source)
    canvas.resize((512, 512), Image.Resampling.LANCZOS).save(LOGO_512)
    canvas.resize((128, 128), Image.Resampling.LANCZOS).save(LOGO_128)
    return canvas


def paste_logo(img: Image.Image, logo: Image.Image, xy: tuple[int, int], size: int) -> None:
    mark = logo.resize((size, size), Image.Resampling.LANCZOS)
    img.paste(mark, xy, mark)


def base_frame() -> Image.Image:
    img = Image.new("RGB", (W, H), CANVAS)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for x in range(0, W, 80):
        draw.line((x, 0, x, H), fill=(240, 246, 252, 8), width=1)
    for y in range(0, H, 80):
        draw.line((0, y, W, y), fill=(240, 246, 252, 8), width=1)
    for y in range(0, 390):
        alpha = int(34 * (1 - y / 390))
        draw.line((0, y, W, y), fill=(47, 129, 247, alpha), width=1)
    draw.rectangle((0, 0, W, H), outline=(255, 255, 255, 12), width=2)
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def draw_brand_bar(img: Image.Image, draw: ImageDraw.ImageDraw, logo: Image.Image) -> None:
    paste_logo(img, logo, (96, 58), 48)
    draw.text((160, 68), "GitHub Search MCP", font=F_SMALL, fill=TEXT)
    labels = ["read-only", "MCP server", "GitHub REST"]
    x = 1300
    for label in labels:
        w = int(draw.textlength(label, font=F_TINY)) + 34
        rounded(draw, (x, 63, x + w, 103), 20, "#0c131d", LINE)
        draw.text((x + 17, 74), label, font=F_TINY, fill=MUTED)
        x += w + 14


def draw_chip(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, color: str) -> int:
    width = int(draw.textlength(label, font=F_TINY)) + 34
    rounded(draw, (x, y, x + width, y + 38), 19, PANEL_2, LINE)
    draw.ellipse((x + 14, y + 14, x + 24, y + 24), fill=color)
    draw.text((x + 32, y + 9), label, font=F_TINY, fill=TEXT)
    return x + width + 12


def draw_terminal(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    lines: list[tuple[str, str]],
    title: str,
) -> None:
    x1, y1, x2, y2 = box
    card(draw, box, radius=26, fill="#050a11", outline="#2a3544")
    draw.text((x1 + 28, y1 + 24), title, font=F_TINY, fill=MUTED)
    y = y1 + 78
    max_width = x2 - x1 - 56
    for value, color in lines:
        if not value:
            y += 22
            continue
        fnt = fit_font(draw, value, max_width, [F_MONO, F_MONO_SMALL, font(18, "mono")])
        draw.text((x1 + 28, y), value, font=fnt, fill=color)
        y += text_size(draw, "Hg", fnt)[1] + 20
        if y > y2 - 42:
            break


def draw_repo_stack(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    repos = [
        ("taskforcesh/bullmq", "MIT", "active", "94"),
        ("fastify/fastify", "MIT", "docs", "91"),
        ("remix-run/react-router", "MIT", "stable", "86"),
    ]
    for index, (name, license_name, tag, score) in enumerate(repos):
        yy = y + index * 122
        card(draw, (x, yy, x + 610, yy + 96), radius=22, fill=PANEL, outline=LINE)
        draw.text((x + 26, yy + 21), name, font=F_SUBHEAD, fill=TEXT)
        cx = draw_chip(draw, x + 26, yy + 59, license_name, GREEN)
        draw_chip(draw, cx, yy + 59, tag, BLUE)
        rounded(draw, (x + 510, yy + 25, x + 582, yy + 65), 20, BLUE)
        draw.text((x + 530, yy + 34), score, font=F_TINY, fill=WHITE)


def draw_signal_card(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    title: str,
    value: str,
    body: str,
    accent: str,
) -> None:
    x1, y1, x2, y2 = box
    card(draw, box, radius=24, fill=PANEL, outline=LINE)
    rounded(draw, (x1 + 24, y1 + 24, x1 + 62, y1 + 62), 19, accent)
    draw.text((x1 + 82, y1 + 27), title, font=F_SMALL, fill=TEXT)
    draw.text((x1 + 26, y1 + 82), value, font=F_HEAD, fill=TEXT)
    draw_text(draw, (x1 + 28, y1 + 148, x2 - 28, y2 - 24), body, fnt=F_TINY, fill=MUTED, spacing=7)


def draw_config_panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int]) -> None:
    config = [
        "{",
        '  "mcpServers": {',
        '    "github-search": {',
        '      "command": "npx",',
        '      "args": ["-y", "github-search-mcp"]',
        "    }",
        "  }",
        "}",
    ]
    draw_terminal(draw, box, [(line, "#d6dee8") for line in config], "mcp-client.json")


def scene_pitch_open(t: float, logo: Image.Image) -> Image.Image:
    img = base_frame()
    draw = ImageDraw.Draw(img)
    draw_brand_bar(img, draw, logo)
    e = ease(t)
    y_shift = int(36 * (1 - e))
    draw_text(
        draw,
        (118, 210 + y_shift, 940, 470 + y_shift),
        "Search GitHub\nwithout tab chaos.",
        fnt=F_DISPLAY,
        fill=TEXT,
        spacing=6,
    )
    draw_text(
        draw,
        (124, 515 + y_shift, 810, 640 + y_shift),
        "Search GitHub, compare open-source candidates, and return a decision-ready MCP result.",
        fnt=F_BODY,
        fill="#c9d1d9",
        spacing=11,
    )
    x = 124
    for label, color in [("search", BLUE), ("license risk", GREEN), ("maintenance", AMBER), ("integration notes", PURPLE)]:
        x = draw_chip(draw, x, 700, label, color)
    card(draw, (1040, 194, 1760, 810), radius=32, fill="#0b111a", outline=LINE)
    draw.text((1088, 242), "agent request", font=F_SMALL, fill=MUTED)
    draw_text(
        draw,
        (1088, 294, 1690, 406),
        "Find a maintained queue library for a TypeScript backend.",
        fnt=F_SUBHEAD,
        fill=TEXT,
    )
    draw.line((1088, 458, 1695, 458), fill=LINE, width=2)
    draw_repo_stack(draw, 1088, 506)
    return img


def scene_pitch_signals(t: float, logo: Image.Image) -> Image.Image:
    img = base_frame()
    draw = ImageDraw.Draw(img)
    draw_brand_bar(img, draw, logo)
    draw_text(draw, (118, 190, 930, 350), "Scoring context,\nnot link spam.", fnt=F_TITLE, fill=TEXT)
    draw_text(
        draw,
        (122, 344, 820, 438),
        "The server returns structured evidence instead of another loose list of links.",
        fnt=F_BODY,
        fill="#c9d1d9",
    )
    cards = [
        ((120, 510, 520, 780), "License", "MIT", "SPDX detection with permissive-license preference.", GREEN),
        ((555, 510, 955, 780), "Maintenance", "active", "Release recency, archived status, and issue signals.", BLUE),
        ((990, 510, 1390, 780), "Docs", "strong", "README, docs folders, examples, and package metadata.", AMBER),
        ((1425, 510, 1800, 780), "Risk", "low", "Warnings stay explicit so an agent cannot hide caveats.", PURPLE),
    ]
    for box, title, value, body, accent in cards:
        draw_signal_card(draw, box, title, value, body, accent)
    return img


def scene_pitch_decision(t: float, logo: Image.Image) -> Image.Image:
    img = base_frame()
    draw = ImageDraw.Draw(img)
    draw_brand_bar(img, draw, logo)
    draw_text(draw, (118, 188, 875, 360), "Turn candidates\ninto an adoption note.", fnt=F_TITLE, fill=TEXT)
    draw_text(
        draw,
        (122, 365, 770, 470),
        "The result is a short recommendation with the checks a developer should actually perform.",
        fnt=F_BODY,
        fill="#c9d1d9",
    )
    draw_terminal(
        draw,
        (980, 185, 1740, 475),
        [
            ("winner: taskforcesh/bullmq", GREEN_SOFT),
            ("why: active releases, MIT, strong docs", "#d6dee8"),
            ("watch: Redis dependency, queue semantics", AMBER),
        ],
        "oss_compare_repositories",
    )
    notes = [
        ("1", "Install and verify the public API shape."),
        ("2", "Review license obligations before shipping."),
        ("3", "Add tests around queue retries and failure states."),
    ]
    x = 132
    for number, body in notes:
        card(draw, (x, 620, x + 500, 815), radius=26, fill=PANEL, outline=LINE)
        rounded(draw, (x + 28, 650, x + 74, 696), 23, BLUE)
        draw.text((x + 44, 663), number, font=F_TINY, fill=WHITE)
        draw_text(draw, (x + 28, 724, x + 450, 790), body, fnt=F_SMALL, fill=TEXT)
        x += 550
    return img


def scene_setup_install(t: float, logo: Image.Image) -> Image.Image:
    img = base_frame()
    draw = ImageDraw.Draw(img)
    draw_brand_bar(img, draw, logo)
    draw_text(draw, (118, 190, 800, 350), "One command\nto start.", fnt=F_TITLE, fill=TEXT)
    draw_text(
        draw,
        (122, 335, 780, 430),
        "The default transport is stdio, so there is no local dashboard or exposed port required.",
        fnt=F_BODY,
        fill="#c9d1d9",
    )
    draw_terminal(
        draw,
        (118, 520, 920, 825),
        [
            ("npx github-search-mcp", GREEN_SOFT),
            ("# optional higher API limit", MUTED),
            ("GITHUB_TOKEN=ghp_xxx npx github-search-mcp", GREEN_SOFT),
            ("ready: stdio", BLUE_SOFT),
        ],
        "terminal",
    )
    draw_config_panel(draw, (1040, 355, 1735, 825))
    return img


def scene_setup_connect(t: float, logo: Image.Image) -> Image.Image:
    img = base_frame()
    draw = ImageDraw.Draw(img)
    draw_brand_bar(img, draw, logo)
    draw_text(draw, (118, 182, 860, 350), "Connect it\nto your MCP client.", fnt=F_TITLE, fill=TEXT)
    draw_text(
        draw,
        (122, 345, 830, 440),
        "The client starts the package, sends tool calls over stdio, and receives structured GitHub research.",
        fnt=F_BODY,
        fill="#c9d1d9",
    )
    x_positions = [190, 710, 1230]
    labels = [("MCP client", "Claude, Cursor, Codex, or another client"), ("GitHub Search MCP", "read-only tool server"), ("GitHub API", "public REST endpoints")]
    for x, (title, body) in zip(x_positions, labels):
        card(draw, (x, 560, x + 390, 760), radius=28, fill=PANEL, outline=LINE)
        draw.text((x + 32, 602), title, font=F_SUBHEAD, fill=TEXT)
        draw_text(draw, (x + 34, 660, x + 340, 720), body, fnt=F_TINY, fill=MUTED)
    for x in [600, 1120]:
        draw.line((x, 660, x + 90, 660), fill=BLUE, width=5)
        draw.polygon([(x + 90, 660), (x + 72, 648), (x + 72, 672)], fill=BLUE)
    return img


def scene_setup_run(t: float, logo: Image.Image) -> Image.Image:
    img = base_frame()
    draw = ImageDraw.Draw(img)
    draw_brand_bar(img, draw, logo)
    draw_text(draw, (118, 170, 830, 340), "Ask the dependency\nquestion directly.", fnt=F_TITLE, fill=TEXT)
    card(draw, (118, 405, 800, 590), radius=26, fill=PANEL, outline=LINE)
    draw.text((152, 438), "user prompt", font=F_TINY, fill=MUTED)
    draw_text(
        draw,
        (152, 478, 730, 555),
        "Find an actively maintained Node.js queue library with permissive licensing.",
        fnt=F_SMALL,
        fill=TEXT,
    )
    draw_repo_stack(draw, 1040, 230)
    draw_terminal(
        draw,
        (118, 660, 800, 850),
        [
            ("tool: oss_find_open_source_alternatives", BLUE_SOFT),
            ("filters: TypeScript, MIT, active", "#d6dee8"),
            ("output: ranked candidates + caveats", GREEN_SOFT),
        ],
        "MCP trace",
    )
    return img


def scene_setup_notes(t: float, logo: Image.Image) -> Image.Image:
    img = base_frame()
    draw = ImageDraw.Draw(img)
    draw_brand_bar(img, draw, logo)
    paste_logo(img, logo, (850, 150), 130)
    title = "Decision-ready output"
    tw, _ = text_size(draw, title, F_TITLE)
    draw.text(((W - tw) // 2, 330), title, font=F_TITLE, fill=TEXT)
    draw_text(
        draw,
        (515, 430, 1405, 520),
        "Search, compare, and generate integration notes without giving the server write access.",
        fnt=F_BODY,
        fill="#c9d1d9",
    )
    draw_terminal(
        draw,
        (590, 610, 1330, 790),
        [
            ("npx github-search-mcp", GREEN_SOFT),
            ("tools: search, analyze, compare, notes", BLUE_SOFT),
        ],
        "run",
    )
    return img


@dataclass(frozen=True)
class Scene:
    start: float
    end: float
    draw: Callable[[float, Image.Image], Image.Image]
    name: str


PITCH_SCENES = [
    Scene(0, 7, scene_pitch_open, "pitch-open"),
    Scene(7, 14, scene_pitch_signals, "pitch-signals"),
    Scene(14, 21, scene_pitch_decision, "pitch-decision"),
    Scene(21, 26, scene_setup_notes, "pitch-close"),
]

SETUP_SCENES = [
    Scene(0, 8, scene_setup_install, "setup-install"),
    Scene(8, 16, scene_setup_connect, "setup-connect"),
    Scene(16, 25, scene_setup_run, "setup-run"),
    Scene(25, 34, scene_setup_notes, "setup-notes"),
]


def scenes_duration(scenes: list[Scene]) -> int:
    return int(scenes[-1].end)


def render_scene_frame(scene: Scene, seconds: float, logo: Image.Image) -> Image.Image:
    local = (seconds - scene.start) / (scene.end - scene.start)
    return scene.draw(ease(local), logo)


def render_frame_at(seconds: float, scenes: list[Scene], logo: Image.Image) -> Image.Image:
    current_index = 0
    for i, scene in enumerate(scenes):
        if scene.start <= seconds < scene.end:
            current_index = i
            break
    current = scenes[current_index]
    frame = render_scene_frame(current, seconds, logo)
    if current_index < len(scenes) - 1 and seconds >= current.end - TRANSITION_SECONDS:
        mix = smooth((seconds - (current.end - TRANSITION_SECONDS)) / TRANSITION_SECONDS)
        next_scene = scenes[current_index + 1]
        neutral = base_frame()
        neutral_draw = ImageDraw.Draw(neutral)
        draw_brand_bar(neutral, neutral_draw, logo)
        if mix < 0.5:
            frame = Image.blend(frame, neutral, smooth(mix * 2))
        else:
            next_frame = render_scene_frame(next_scene, next_scene.start + (mix - 0.5) * 0.5, logo)
            frame = Image.blend(neutral, next_frame, smooth((mix - 0.5) * 2))
    return frame


def render_video(output: Path, scenes: list[Scene], poster: Path, poster_second: int, logo: Image.Image) -> None:
    if FRAMES.exists():
        shutil.rmtree(FRAMES)
    FRAMES.mkdir(parents=True)
    seconds = scenes_duration(scenes)
    total_frames = FPS * seconds
    poster_frame = FPS * poster_second
    for frame_number in range(total_frames):
        img = render_frame_at(frame_number / FPS, scenes, logo)
        if frame_number == poster_frame:
            img.save(poster)
        img.save(FRAMES / f"frame_{frame_number:04d}.png", optimize=False)
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
            "-crf",
            "20",
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
    render_video(PITCH_OUTPUT, PITCH_SCENES, PITCH_POSTER, 2, logo)
    render_video(SETUP_OUTPUT, SETUP_SCENES, SETUP_POSTER, 2, logo)
    shutil.copy2(SETUP_OUTPUT, LEGACY_OUTPUT)
    shutil.copy2(SETUP_POSTER, POSTER)
    print(f"Updated legacy compatibility video {LEGACY_OUTPUT}")


if __name__ == "__main__":
    main()
