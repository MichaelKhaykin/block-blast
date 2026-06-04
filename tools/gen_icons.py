#!/usr/bin/env python3
"""Generate the Block Blast SVG icons + an HTML wrapper for rasterization.

Produces:
  favicon.svg          rounded, transparent-corner version (browser tab)
  tools/icon-src.svg   full-bleed square version (source for PNG icons)
  tools/icon.html      wraps icon-src.svg at full viewport for Chrome screenshot
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# vivid gem palette (matches engine COLORS)
BLUE = "#3b62e6"
ORANGE = "#f08a1d"
GREEN = "#34b14a"
RED = "#ef4444"

SIZE = 512


def gem(x, y, s, color):
    r = round(s * 0.20)
    inset = round(s * 0.10)
    gloss_h = round(s * 0.40)
    gloss_r = round(r * 0.7)
    return f"""
    <g>
      <rect x="{x}" y="{y}" width="{s}" height="{s}" rx="{r}" fill="{color}"/>
      <rect x="{x+inset}" y="{y+inset}" width="{s-2*inset}" height="{gloss_h}" rx="{gloss_r}"
            fill="#ffffff" opacity="0.30"/>
      <rect x="{x}" y="{y+round(s*0.66)}" width="{s}" height="{round(s*0.34)}" rx="{r}"
            fill="#000000" opacity="0.16"/>
      <rect x="{x}" y="{y}" width="{s}" height="{s}" rx="{r}" fill="none"
            stroke="#000000" stroke-opacity="0.12" stroke-width="2"/>
    </g>"""


def blocks_group():
    block = 150
    gap = 24
    cluster = 2 * block + gap
    start = (SIZE - cluster) // 2
    positions = [
        (start, start, BLUE),
        (start + block + gap, start, ORANGE),
        (start, start + block + gap, GREEN),
        (start + block + gap, start + block + gap, RED),
    ]
    return "".join(gem(x, y, block, c) for (x, y, c) in positions)


def svg(rounded=False, content_scale=1.0):
    bg_rx = 110 if rounded else 0
    panel = (
        '<rect x="76" y="76" width="360" height="360" rx="64" '
        'fill="#1b1640" opacity="0.85"/>'
    )
    content = panel + blocks_group()
    if content_scale != 1.0:
        cx = SIZE / 2
        content = (
            f'<g transform="translate({cx},{cx}) scale({content_scale}) '
            f'translate({-cx},{-cx})">{content}</g>'
        )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="{SIZE}" height="{SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2c2566"/>
      <stop offset="1" stop-color="#14102e"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="{SIZE}" height="{SIZE}" rx="{bg_rx}" fill="url(#bg)"/>
  {content}
</svg>
"""


def write_html(name, svg_text):
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{{margin:0;padding:0}} svg{{display:block}}</style></head>
<body>{svg_text}</body></html>"""
    with open(os.path.join(ROOT, "tools", name), "w") as f:
        f.write(html)


def main():
    # rounded favicon for the browser tab
    with open(os.path.join(ROOT, "favicon.svg"), "w") as f:
        f.write(svg(rounded=True))

    # full-bleed "any" icon source
    src = svg(rounded=False)
    with open(os.path.join(ROOT, "tools", "icon-src.svg"), "w") as f:
        f.write(src)
    write_html("icon.html", src)

    # maskable icon source: artwork shrunk into the central ~80% safe zone,
    # background still full-bleed so adaptive launchers can crop to any shape.
    masksrc = svg(rounded=False, content_scale=0.78)
    with open(os.path.join(ROOT, "tools", "icon-maskable-src.svg"), "w") as f:
        f.write(masksrc)
    write_html("icon-maskable.html", masksrc)

    print("wrote favicon.svg + tools/icon.html + tools/icon-maskable.html")


if __name__ == "__main__":
    main()
