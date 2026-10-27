"""Render the PNG app icons (same artwork as app/static/icons/icon.svg) with no dependencies.

    python tools/make_icons.py
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "app" / "static" / "icons"
INDIGO = (0x4F, 0x46, 0xE5)
WHITE = (255, 255, 255)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5


def in_rrect(px, py, x, y, w, h, r):
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    return x <= px <= x + w and y <= py <= y + h and (px - cx) ** 2 + (py - cy) ** 2 <= r * r


LEGS = [(200, 288, 150, 420), (312, 288, 362, 420), (256, 288, 256, 400)]
CHECK = [(196, 198, 238, 240), (238, 240, 318, 156)]


def color_at(x, y, maskable):
    """Colour of artwork point (x, y) in the 512 design space, or None for transparent."""
    if maskable:  # full-bleed background, artwork shrunk into the safe zone
        x, y = 256 + (x - 256) / 0.72, 256 + (y - 256) / 0.72
    elif not in_rrect(x, y, 0, 0, 512, 512, 112):
        return None
    if in_rrect(x, y, 136, 104, 240, 184, 20):
        return INDIGO if any(seg_dist(x, y, *s) <= 14 for s in CHECK) else WHITE
    if any(seg_dist(x, y, *s) <= 15 for s in LEGS):
        return WHITE
    return INDIGO


def render(size, maskable=False, ss=3):
    rows = []
    k = 512 / size
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            r = g = b = a = 0
            for sj in range(ss):
                for si in range(ss):
                    c = color_at((i + (si + 0.5) / ss) * k, (j + (sj + 0.5) / ss) * k, maskable)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            n = ss * ss
            row += bytes([r // a, g // a, b // a, 255 * a // n] if a else [0, 0, 0, 0])
        rows.append(bytes(row))
    return png(size, b"".join(rows))


def png(size, raw):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, mask in [("icon-192.png", 192, False), ("icon-512.png", 512, False),
                             ("icon-maskable-512.png", 512, True), ("apple-touch-icon.png", 180, True)]:
        (OUT / name).write_bytes(render(size, mask))
        print("wrote", name)
