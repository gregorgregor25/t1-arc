"""Generate the T1 Arc raster and Android launcher assets from brand geometry.

The SVG files remain the editable vector sources. This deterministic Pillow
renderer keeps environments without an SVG rasteriser able to reproduce the
checked-in PNG and WebP assets.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
SCALE = 4


def rgba(hex_value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    value = hex_value.lstrip("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4)) + (
        alpha,
    )


def bezier(points: tuple[tuple[float, float], ...], steps: int = 80):
    p0, p1, p2, p3 = points
    result = []
    for index in range(steps + 1):
        t = index / steps
        u = 1 - t
        result.append(
            (
                u**3 * p0[0]
                + 3 * u**2 * t * p1[0]
                + 3 * u * t**2 * p2[0]
                + t**3 * p3[0],
                u**3 * p0[1]
                + 3 * u**2 * t * p1[1]
                + 3 * u * t**2 * p2[1]
                + t**3 * p3[1],
            )
        )
    return result


def scaled(points):
    return [(round(x * SCALE), round(y * SCALE)) for x, y in points]


def draw_mark(draw: ImageDraw.ImageDraw, x: int, top: int, bottom: int, color, width: int, radius: int, outline_width: int):
    draw.line(
        (x * SCALE, top * SCALE, x * SCALE, bottom * SCALE),
        fill=color,
        width=width * SCALE,
    )
    draw.ellipse(
        (
            (x - radius) * SCALE,
            (top - radius) * SCALE,
            (x + radius) * SCALE,
            (top + radius) * SCALE,
        ),
        fill=color,
        outline=rgba("#F8F5EE"),
        width=outline_width * SCALE,
    )


def brand_foreground(size: int = 1024, monochrome: bool = False) -> Image.Image:
    canvas = Image.new("RGBA", (size * SCALE, size * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    factor = size / 1024

    def f(value: float) -> int:
        return round(value * factor * SCALE)

    if not monochrome:
        draw.ellipse((f(202), f(202), f(822), f(822)), fill=rgba("#252731"), outline=rgba("#4A4D59"), width=max(1, f(6)))
    wave = []
    wave.extend(bezier(((232, 562), (308, 562), (332, 432), (414, 432))))
    wave.extend(bezier(((414, 432), (490, 432), (500, 632), (582, 632)))[1:])
    wave.extend(bezier(((582, 632), (658, 632), (674, 492), (792, 492)))[1:])
    wave = [(x * factor, y * factor) for x, y in wave]
    line_color = rgba("#000000") if monochrome else rgba("#F8F5EE")
    draw.line(
        scaled(wave),
        fill=line_color,
        width=max(1, f(44)),
        joint="curve",
    )
    if monochrome:
        draw.line((f(714), f(310), f(714), f(482)), fill=line_color, width=f(34))
        draw.ellipse((f(684), f(280), f(744), f(340)), fill=line_color)
        draw.line((f(806), f(378), f(806), f(492)), fill=line_color, width=f(26))
        draw.ellipse((f(782), f(354), f(830), f(402)), fill=line_color)
    else:
        draw_mark(draw, round(714 * factor), round(310 * factor), round(482 * factor), rgba("#8EA7FF"), max(1, round(34 * factor)), max(1, round(30 * factor)), max(1, round(10 * factor)))
        draw_mark(draw, round(806 * factor), round(378 * factor), round(492 * factor), rgba("#F0A06A"), max(1, round(26 * factor)), max(1, round(24 * factor)), max(1, round(8 * factor)))
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def brand_icon(size: int = 1024) -> Image.Image:
    canvas = Image.new("RGBA", (size * SCALE, size * SCALE), rgba("#111217"))
    draw = ImageDraw.Draw(canvas)
    factor = size / 1024

    def f(value: float) -> int:
        return round(value * factor * SCALE)

    # Quiet diagonal charcoal lift; restrained enough to survive small sizes.
    for y in range(size * SCALE):
        ratio = y / max(1, size * SCALE - 1)
        start = rgba("#292C36")
        end = rgba("#111217")
        color = tuple(round(start[i] * (1 - ratio) + end[i] * ratio) for i in range(4))
        draw.line((0, y, size * SCALE, y), fill=color)
    mask = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size * SCALE, size * SCALE),
        radius=f(220),
        fill=255,
    )
    transparent = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    transparent.paste(canvas, mask=mask)
    canvas = transparent
    draw = ImageDraw.Draw(canvas)
    draw.ellipse((f(206), f(206), f(818), f(818)), fill=rgba("#252731"), outline=rgba("#4A4D59"), width=max(1, f(6)))
    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((f(160), f(96), f(644), f(580)), fill=rgba("#3156B8", 105))
    glow = glow.filter(ImageFilter.GaussianBlur(f(90)))
    glow_mask = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(glow_mask).ellipse((f(212), f(212), f(812), f(812)), fill=255)
    glow.putalpha(Image.composite(glow.getchannel("A"), Image.new("L", canvas.size, 0), glow_mask))
    canvas.alpha_composite(glow)
    foreground = brand_foreground(size).resize(
        canvas.size, Image.Resampling.LANCZOS
    )
    canvas.alpha_composite(foreground)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def splash_icon(size: int = 512) -> Image.Image:
    foreground = brand_foreground(1024)
    crop = foreground.resize((size, size), Image.Resampling.LANCZOS)
    return crop


def save_webp(image: Image.Image, path: Path):
    image.save(path, "WEBP", lossless=True, quality=100, method=6)


def main():
    icon = brand_icon(1024)
    foreground = brand_foreground(1024)
    monochrome = brand_foreground(1024, monochrome=True)
    splash = splash_icon(512)

    icon.save(ASSETS / "icon.png")
    foreground.save(ASSETS / "android-icon-foreground.png")
    monochrome.save(ASSETS / "android-icon-monochrome.png")
    Image.new("RGBA", (1024, 1024), rgba("#1B1D24")).save(
        ASSETS / "android-icon-background.png"
    )
    splash.save(ASSETS / "splash-icon.png")
    icon.resize((64, 64), Image.Resampling.LANCZOS).save(ASSETS / "favicon.png")

    launcher_sizes = {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }
    foreground_sizes = {
        "mdpi": 108,
        "hdpi": 162,
        "xhdpi": 216,
        "xxhdpi": 324,
        "xxxhdpi": 432,
    }
    for density, output_size in launcher_sizes.items():
        folder = ANDROID_RES / f"mipmap-{density}"
        raster = icon.resize((output_size, output_size), Image.Resampling.LANCZOS)
        save_webp(raster, folder / "ic_launcher.webp")
        save_webp(raster, folder / "ic_launcher_round.webp")
    for density, output_size in foreground_sizes.items():
        folder = ANDROID_RES / f"mipmap-{density}"
        save_webp(
            foreground.resize((output_size, output_size), Image.Resampling.LANCZOS),
            folder / "ic_launcher_foreground.webp",
        )
        save_webp(
            monochrome.resize((output_size, output_size), Image.Resampling.LANCZOS),
            folder / "ic_launcher_monochrome.webp",
        )

    splash_sizes = {
        "mdpi": 288,
        "hdpi": 432,
        "xhdpi": 576,
        "xxhdpi": 864,
        "xxxhdpi": 1152,
    }
    for density, output_size in splash_sizes.items():
        raster = splash.resize((output_size, output_size), Image.Resampling.LANCZOS)
        for qualifier in (f"drawable-{density}", f"drawable-night-{density}"):
            raster.save(ANDROID_RES / qualifier / "splashscreen_logo.png")


if __name__ == "__main__":
    main()
