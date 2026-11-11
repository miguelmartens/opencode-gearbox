"""Gearbox brand asset generator. All text is converted to outlines so the SVGs
render identically on GitHub (which loads SVGs as <img>, without web fonts).

Usage: put ArchivoBlack-Regular.ttf, "SpaceGrotesk%5Bwght%5D.ttf" (variable), JetBrainsMono-Bold.ttf
and JetBrainsMono-Regular.ttf (all SIL OFL 1.1, from github.com/google/fonts and
github.com/JetBrains/JetBrainsMono) in assets/brand/source/fonts/ or set GEARBOX_FONTS, then:

    pip install fonttools uharfbuzz && python3 assets/brand/source/generate.py

PNG exports (social-preview.png, mark-512.png, apple-touch-icon.png) use rsvg-convert.
"""
import math, os
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.varLib.instancer import instantiateVariableFont

FONTS = os.environ.get("GEARBOX_FONTS", os.path.join(os.path.dirname(__file__), "fonts/"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..") + "/"

# ---------- palette: blackish, greyish, whitish ----------
INK = "#0C0C0D"      # background, near black
SURF = "#161618"     # raised surface
SURF2 = "#202023"    # tags, chips
LINE = "#34343A"     # hairlines, frames
SHADOW = "#4A4A51"   # hard offset shadows on dark
MUTE = "#8C8C93"     # secondary text
PAPER = "#EDECE6"    # off-white text and marks
WHITE = "#FAFAF7"
LIGHT_BG = "#F2F1EC" # light-mode background
YELLOW = PAPER       # legacy name used by helpers
LEVELS = [  # gear, name, colour — tachometer: green -> redline
    (1, "low", "#8BE48B"),
    (2, "medium", "#66C7FF"),
    (3, "high", "#B69CFF"),
    (4, "xhigh", "#FF9A3C"),
    (5, "max", "#FF4F4F"),
]


class Font:
    def __init__(self, file, wght=None):
        path = FONTS + file
        tt = TTFont(path)
        if wght and "fvar" in tt:
            tt = instantiateVariableFont(tt, {"wght": wght})
            tmp = f"/tmp/{os.path.basename(file)}.{wght}.ttf"
            tt.save(tmp)
            path = tmp
        self.tt = tt
        self.gs = tt.getGlyphSet()
        self.upm = tt["head"].unitsPerEm
        blob = hb.Blob.from_file_path(path)
        self.hbfont = hb.Font(hb.Face(blob))
        self.order = tt.getGlyphOrder()

    def shape(self, text):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hbfont, buf, {"kern": True, "liga": False})
        return [(self.order[i.codepoint], p.x_advance, p.x_offset) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]

    def width(self, text, size, track=0):
        g = self.shape(text)
        return sum(a for _, a, _ in g) * size / self.upm + track * max(len(g) - 1, 0)

    def path(self, text, x, y, size, track=0, anchor="start"):
        s = size / self.upm
        w = self.width(text, size, track)
        if anchor == "middle":
            x -= w / 2
        elif anchor == "end":
            x -= w
        d = []
        cx = x
        for name, adv, off in self.shape(text):
            pen = SVGPathPen(self.gs)
            self.gs[name].draw(TransformPen(pen, (s, 0, 0, -s, cx + off * s, y)))
            d.append(pen.getCommands())
            cx += adv * s + track
        return "".join(d)

    def glyphs(self, text, size):
        """Per-glyph (path at origin, advance) for text on a curve."""
        s = size / self.upm
        res = []
        for name, adv, off in self.shape(text):
            pen = SVGPathPen(self.gs)
            self.gs[name].draw(TransformPen(pen, (s, 0, 0, -s, 0, 0)))
            res.append((pen.getCommands(), adv * s))
        return res


DISPLAY = Font("ArchivoBlack-Regular.ttf")
GROTESK = Font("SpaceGrotesk%5Bwght%5D.ttf", 700)
GROTESK_M = Font("SpaceGrotesk%5Bwght%5D.ttf", 500)
MONO = Font("JetBrainsMono-Bold.ttf")
MONO_R = Font("JetBrainsMono-Regular.ttf")


def T(font, text, x, y, size, fill=INK, track=0, anchor="start"):
    return f'<path fill="{fill}" d="{font.path(text, x, y, size, track, anchor)}"/>'


def svg(w, h, body, title="Gearbox"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n')


def save(name, content):
    os.makedirs(os.path.dirname(OUT + name), exist_ok=True)
    with open(OUT + name, "w") as f:
        f.write(content)


def block(x, y, w, h, fill, border=INK, bw=6, shadow=10, shadow_col=INK, rx=0):
    """Neo-brutalist box: flat fill, thick border, hard offset shadow."""
    s = ""
    if shadow:
        s += f'<rect x="{x+shadow}" y="{y+shadow}" width="{w}" height="{h}" rx="{rx}" fill="{shadow_col}"/>'
    s += f'<rect x="{x+bw/2}" y="{y+bw/2}" width="{w-bw}" height="{h-bw}" rx="{rx}" fill="{fill}" stroke="{border}" stroke-width="{bw}"/>'
    return s


def gear_icon(cx, cy, r, fill=INK, hole=YELLOW, teeth=8):
    """Simple chunky cog (stand-in for the ⚙ glyph, which our fonts lack)."""
    pts = []
    ro, ri = r, r * 0.74
    n = teeth * 4
    for i in range(n):
        a = 2 * math.pi * i / n - math.pi / 2
        rr = ro if (i % 4) in (1, 2) else ri
        pts.append(f"{cx + rr*math.cos(a):.2f},{cy + rr*math.sin(a):.2f}")
    return (f'<polygon points="{" ".join(pts)}" fill="{fill}"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r*0.32:.2f}" fill="{hole}"/>')


# ---------- the shift gate ----------
def gate_points(x, y, w, h):
    """Endpoints of the 5-speed H pattern inside box (x,y,w,h). Gear -> (px,py)."""
    cols = [x, x + w / 2, x + w]
    top, bot = y, y + h
    return {1: (cols[0], top), 2: (cols[0], bot), 3: (cols[1], top), 4: (cols[1], bot), 5: (cols[2], top)}, (y + h / 2)


def gate(x, y, w, h, sw, color=INK, knob=5, knob_r=None, knob_fill=WHITE, knob_stroke=INK,
         knob_sw=None, show_rest=False):
    pts, mid = gate_points(x, y, w, h)
    cols = [x, x + w / 2, x + w]
    d = f"M{cols[0]},{y}V{y+h}M{cols[1]},{y}V{y+h}M{cols[2]},{y}V{mid}M{cols[0]},{mid}H{cols[2]}"
    s = f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="square" stroke-linejoin="miter"/>'
    if knob:
        kr = knob_r or sw * 1.25
        kx, ky = pts[knob]
        s += f'<circle cx="{kx}" cy="{ky}" r="{kr}" fill="{knob_fill}" stroke="{knob_stroke}" stroke-width="{knob_sw or sw*0.55}"/>'
    return s


# ---------- the mark ----------
def mark_body(theme="dark", shadow=True):
    """theme dark: dark tile, off-white gate. theme light: off-white tile, black gate."""
    if theme == "dark":
        tile, edge, fg, sh_col, hole = SURF, PAPER, PAPER, SHADOW, SURF
    else:
        tile, edge, fg, sh_col, hole = PAPER, INK, INK, INK, PAPER
    sh = 28 if shadow else 0
    box = 512 - sh
    bw = 30
    s = ""
    if shadow:
        s += f'<rect x="{sh}" y="{sh}" width="{box}" height="{box}" fill="{sh_col}"/>'
    s += f'<rect x="{bw/2}" y="{bw/2}" width="{box-bw}" height="{box-bw}" fill="{tile}" stroke="{edge}" stroke-width="{bw}"/>'
    c = box / 2
    s += gate(c - 118, c - 118, 236, 236, 40, fg, knob=5, knob_r=50, knob_fill=fg, knob_stroke=fg, knob_sw=1)
    kx, ky = c + 118, c - 118
    s += f'<circle cx="{kx}" cy="{ky}" r="18" fill="{hole}"/>'
    return s


def build_marks():
    save("mark.svg", svg(512, 512, mark_body("dark"), "Gearbox mark"))
    save("mark-light.svg", svg(512, 512, mark_body("light"), "Gearbox mark"))
    save("mark-flat.svg", svg(512, 512, mark_body("dark", shadow=False), "Gearbox mark"))
    mono = (f'<rect width="512" height="512" fill="{INK}"/>' +
            gate(138, 138, 236, 236, 40, PAPER, knob=5, knob_r=50, knob_fill=PAPER, knob_stroke=PAPER, knob_sw=1) +
            f'<circle cx="374" cy="138" r="18" fill="{INK}"/>')
    save("mark-mono.svg", svg(512, 512, mono, "Gearbox mark"))
    fav = (f'<rect x="2" y="2" width="60" height="60" fill="{SURF}" stroke="{PAPER}" stroke-width="4"/>' +
           gate(17, 17, 30, 30, 6, PAPER, knob=5, knob_r=7.5, knob_fill=PAPER, knob_stroke=PAPER, knob_sw=1) +
           f'<circle cx="47" cy="17" r="2.6" fill="{SURF}"/>')
    save("favicon.svg", svg(64, 64, fav, "Gearbox"))
    for old in ("mark-dark.svg",):
        try:
            os.remove(OUT + old)
        except FileNotFoundError:
            pass


# ---------- wordmarks / lockups ----------
def lockup(theme="dark"):
    fg = PAPER if theme == "dark" else INK
    word_w = DISPLAY.width("gearbox", 150, -3)
    mark = 200
    gap = 36
    w = mark + gap + word_w + 20
    body = f'<g transform="scale({mark/512})">{mark_body(theme)}</g>'
    body += T(DISPLAY, "gearbox", mark + gap, 140, 150, fg, track=-3)
    tw = MONO.width("FOR OPENCODE", 24, 2) + 28
    tx = mark + gap + word_w - tw - 8
    tag_bg, tag_fg = (SURF2, MUTE) if theme == "dark" else (INK, PAPER)
    body += f'<rect x="{tx}" y="166" width="{tw}" height="40" fill="{tag_bg}"/>'
    body += T(MONO, "FOR OPENCODE", tx + 14, 194, 24, tag_fg, track=2)
    return svg(round(w), 220, body, "Gearbox for OpenCode")


def wordmark(theme="dark"):
    fg = PAPER if theme == "dark" else INK
    w = DISPLAY.width("gearbox", 150, -3) + 8
    return svg(round(w), 170, T(DISPLAY, "gearbox", 2, 140, 150, fg, track=-3), "gearbox")


def build_lockups():
    for old in ("lockup-light.svg", "lockup-dark.svg", "wordmark-light.svg", "wordmark-dark.svg"):
        pass
    save("lockup-dark.svg", lockup("dark"))      # for dark backgrounds
    save("lockup-light.svg", lockup("light"))    # for light backgrounds
    save("wordmark-dark.svg", wordmark("dark"))
    save("wordmark-light.svg", wordmark("light"))


# ---------- emblems ----------
def circle_text(font, text, cx, cy, r, size, center_deg=-90, track=0, fill=INK, bottom=False):
    gl = font.glyphs(text, size)
    total = sum(a for _, a in gl) + track * (len(gl) - 1)
    out = []
    pos = 0
    for d, adv in gl:
        mid = pos + adv / 2
        if not bottom:
            ang = center_deg + math.degrees((mid - total / 2) / r)
            out.append(f'<path fill="{fill}" transform="translate({cx},{cy}) rotate({ang+90:.3f}) translate({-adv/2:.2f},{-r:.2f})" d="{d}"/>')
        else:
            ang = center_deg - math.degrees((mid - total / 2) / r)
            cap = size * 0.72
            out.append(f'<path fill="{fill}" transform="translate({cx},{cy}) rotate({ang-90:.3f}) translate({-adv/2:.2f},{r+cap:.2f})" d="{d}"/>')
        pos += adv + track
    return "".join(out)


def emblem_round():
    W, c = 600, 290
    b = f'<circle cx="{c+14}" cy="{c+14}" r="270" fill="{SHADOW}"/>'
    b += f'<circle cx="{c}" cy="{c}" r="266" fill="{SURF}" stroke="{PAPER}" stroke-width="10"/>'
    b += f'<circle cx="{c}" cy="{c}" r="176" fill="{INK}" stroke="{PAPER}" stroke-width="10"/>'
    b += circle_text(DISPLAY, "AUTOMATIC TRANSMISSION", c, c, 204, 34, -90, track=2, fill=PAPER)
    b += circle_text(MONO, "FOR OPENCODE", c, c, 196, 30, 90, track=5, fill=MUTE, bottom=True)
    for ang in (180 - 22, 22):
        a = math.radians(ang)
        b += f'<circle cx="{c + 221*math.cos(a):.1f}" cy="{c + 221*math.sin(a):.1f}" r="9" fill="{PAPER}"/>'
    b += gate(c - 78, c - 78, 156, 156, 28, PAPER, knob=5, knob_r=34, knob_fill=PAPER, knob_stroke=PAPER, knob_sw=1)
    b += f'<circle cx="{c+78}" cy="{c-78}" r="12" fill="{INK}"/>'
    return svg(W, W, b, "Gearbox emblem: automatic transmission for OpenCode")


def emblem_plate():
    W, H = 760, 260
    b = block(0, 0, W - 16, H - 16, INK, PAPER, 8, 16, SHADOW)
    b += f'<rect x="26" y="26" width="{W-68}" height="{H-68}" fill="none" stroke="{LINE}" stroke-width="4"/>'
    b += T(DISPLAY, "5-SPEED", 64, 150, 96, PAPER, track=2)
    b += T(MONO, "AUTO · OPENCODE · GEARBOX", 66, 200, 24, MUTE, track=3)
    b += gate(560, 64, 110, 110, 18, PAPER, knob=5, knob_r=24, knob_fill=PAPER, knob_stroke=PAPER, knob_sw=1)
    b += f'<circle cx="670" cy="64" r="8" fill="{INK}"/>'
    return svg(W, H, b, "5-speed auto")


def emblem_levels():
    pad, x, parts = 18, 0, []
    for n, name, col in LEVELS:
        label = name.upper()
        w = MONO.width(label, 30, 2) + 96
        parts.append((x, w, n, label, col))
        x += w + pad
    W, H = x - pad + 10, 90
    b = ""
    for x, w, n, label, col in parts:
        b += block(x, 0, w, 76, SURF, PAPER, 4, 8, SHADOW)
        b += f'<rect x="{x+4}" y="4" width="46" height="68" fill="{col}"/>'
        b += T(DISPLAY, str(n), x + 27, 52, 34, INK, anchor="middle")
        b += T(MONO, label, x + 66, 50, 30, PAPER, track=2)
    return svg(round(W), H, b, "Gears: low, medium, high, xhigh, max")


def badge_shifted():
    W, H = 300, 52
    b = block(0, 0, W - 5, H - 5, SURF, PAPER, 3, 5, SHADOW)
    b += f'<rect x="3" y="3" width="46" height="41" fill="{PAPER}"/>'
    b += gate(14, 12, 24, 22, 5, INK, knob=5, knob_r=5.5, knob_fill=INK, knob_stroke=INK, knob_sw=1)
    b += T(MONO, "SHIFTED BY GEARBOX", 62, 32, 17, PAPER, track=1)
    return svg(W, H, b, "Shifted by Gearbox")


def build_emblems():
    save("emblem-round.svg", emblem_round())
    save("emblem-5speed.svg", emblem_plate())
    save("gears.svg", emblem_levels())
    save("badge-shifted-by-gearbox.svg", badge_shifted())


# ---------- status bar ----------
def statusbar(level=2, W=1200, H=96, theme="dark", shadow=True):
    n, name, col = LEVELS[level]
    bg, fg, dim, edge, shc = (INK, PAPER, "#5E5E64", LINE, SHADOW) if theme == "dark" else (WHITE, INK, "#9A9AA0", INK, INK)
    sh = 10 if shadow else 0
    b = block(0, 0, W - sh, H - sh, bg, edge, 4, sh, shc)
    size = round((H - sh) * 0.36)
    y = (H - sh) / 2 + size * 0.36
    x = 28
    b += gear_icon(x + 14, (H - sh) / 2, size * 0.55, fg, bg)
    x += 46
    segs = [(name, col), ("·", dim), ("haiku-5-5", fg), ("·", dim), ("◔ 38%", fg), ("·", dim),
            ("cache 4:12", fg), ("·", dim), ("Auto", MUTE if theme == "dark" else "#6B6B70")]
    for txt, c in segs:
        b += T(MONO, txt, x, y, size, c)
        x += MONO.width(txt, size) + size * 0.6
    return svg(W, H, b, f"Status bar: {name} · haiku-5-5 · 38% context · cache 4:12 · Auto")


# ---------- banners ----------
def gate_panel(x, y, size, knob=3, theme="dark"):
    if theme == "dark":
        card, edge, shc, fg, lab = SURF, PAPER, SHADOW, PAPER, MUTE
    else:
        card, edge, shc, fg, lab = WHITE, INK, INK, INK, "#5E5E64"
    b = block(x, y, size, size, card, edge, 6, 16, shc)
    inner = size * 0.46
    gx, gy = x + (size - 16 - inner) / 2, y + (size - 16 - inner) / 2 + 4
    b += gate(gx, gy, inner, inner, size * 0.045, fg, knob=None)
    pts, _ = gate_points(gx, gy, inner, inner)
    for n, name, col in LEVELS:
        px, py = pts[n]
        k = 1.25 if n == knob else 1
        r = size * 0.062 * k
        b += f'<circle cx="{px}" cy="{py}" r="{r}" fill="{col}" stroke="{INK}" stroke-width="{size*0.014}"/>'
        b += T(DISPLAY, str(n), px, py + r * 0.42, r * 0.95, INK, anchor="middle")
        top = py < gy + 1
        ly = py - r - 16 if top else py + r + 34
        b += T(MONO, name.upper(), px, ly, size * 0.048, lab, track=1, anchor="middle")
    return b


def banner(W, H, theme="dark", compact=False):
    dark = theme == "dark"
    bg = INK if dark else LIGHT_BG
    fg = PAPER if dark else INK
    sub = MUTE if dark else "#55555B"
    dot = PAPER if dark else INK
    edge = LINE if dark else INK
    b = f'<rect width="{W}" height="{H}" fill="{bg}"/>'
    b += ('<defs><pattern id="d" width="32" height="32" patternUnits="userSpaceOnUse">'
          f'<circle cx="2" cy="2" r="1.6" fill="{dot}" fill-opacity="{.13 if dark else .12}"/></pattern></defs>'
          f'<rect width="{W}" height="{H}" fill="url(#d)"/>')
    b += f'<rect x="3" y="3" width="{W-6}" height="{H-6}" fill="none" stroke="{edge}" stroke-width="6"/>'
    tag_bg, tag_fg = (SURF2, MUTE) if dark else (INK, PAPER)
    lx = 72
    if compact:
        tag = "OPENCODE PLUGIN"
        tw = MONO.width(tag, 22, 3) + 28
        b += f'<rect x="{lx}" y="62" width="{tw}" height="40" fill="{tag_bg}"/>'
        b += T(MONO, tag, lx + 14, 90, 22, tag_fg, track=3)
        b += T(DISPLAY, "gearbox", lx - 4, 236, 150, fg, track=-4)
        b += T(GROTESK, "Automatic transmission for OpenCode.", lx, 320, 40, fg)
        b += T(GROTESK_M, "Picks the reasoning effort for every prompt and subagent,", lx, 362, 25, sub)
        b += T(GROTESK_M, "and the cheapest model that fits each subagent.", lx, 394, 25, sub)
        b += gate_panel(W - 72 - 330, 54, 330, knob=3, theme=theme)
    else:
        tag = "OPENCODE PLUGIN · MIT"
        tw = MONO.width(tag, 24, 3) + 28
        b += f'<rect x="{lx}" y="70" width="{tw}" height="44" fill="{tag_bg}"/>'
        b += T(MONO, tag, lx + 14, 101, 24, tag_fg, track=3)
        b += T(DISPLAY, "gearbox", lx - 6, 262, 158, fg, track=-4)
        b += T(GROTESK, "Automatic transmission", lx, 374, 50, fg)
        b += T(GROTESK, "for OpenCode.", lx, 430, 50, sub)
        sb = statusbar(2, 710, 68, theme)
        b += f'<g transform="translate({lx},480)">{sb[sb.find(">")+1:-7]}</g>'
        b += gate_panel(W - 72 - 390, 120, 390, knob=3, theme=theme)
    return svg(W, H, b, "Gearbox: automatic transmission for OpenCode")


def build_banners():
    save("banner-readme-dark.svg", banner(1280, 440, "dark", compact=True))
    save("banner-readme-light.svg", banner(1280, 440, "light", compact=True))
    save("social-preview.svg", banner(1280, 640, "dark"))
    save("social-preview-light.svg", banner(1280, 640, "light"))
    save("statusbar.svg", statusbar(2, 1100, 96, "dark"))
    save("statusbar-light.svg", statusbar(2, 1100, 96, "light"))


if __name__ == "__main__":
    build_marks()
    build_lockups()
    build_emblems()
    build_banners()
    print("ok")
