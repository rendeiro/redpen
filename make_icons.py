# Generates icons/icon{16,32,48,128}.png with no dependencies:
# a dark disc, a white bar (the text) and a red stroke under it.
import struct
import zlib

DARK, WHITE, RED = (20, 20, 20), (255, 255, 255), (229, 38, 31)


def pill(x, y, x0, x1, cy, r):
    """True if (x, y) is inside a horizontal bar with round ends."""
    nx = min(max(x, x0 + r), x1 - r)
    return (x - nx) ** 2 + (y - cy) ** 2 <= r * r


def colour(x, y):
    """Colour at a point in a 1x1 square, or None outside the disc."""
    if (x - 0.5) ** 2 + (y - 0.5) ** 2 > 0.25:
        return None
    if pill(x, y, 0.22, 0.78, 0.40, 0.085):
        return WHITE
    if pill(x, y + 0.03 * (x - 0.5) * 4 * (x - 0.3), 0.20, 0.80, 0.66, 0.05):
        return RED
    return DARK


def png(size, ss=6):
    rows = bytearray()
    for py in range(size):
        rows.append(0)
        for px in range(size):
            r = g = b = a = 0
            for sy in range(ss):
                for sx in range(ss):
                    c = colour((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
                    if c:
                        r, g, b, a = r + c[0], g + c[1], b + c[2], a + 1
            n = ss * ss
            rows += bytes((r // a, g // a, b // a, 255 * a // n) if a else (0, 0, 0, 0))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")


for size in (16, 32, 48, 128):
    with open(f"icons/icon{size}.png", "wb") as f:
        f.write(png(size))
