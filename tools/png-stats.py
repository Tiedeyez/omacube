#!/usr/bin/env python3
"""Count self-check colours in PNG frames (standard library only).

  tools/png-stats.py [--allow FRACTION] frame.png [...]
  tools/png-stats.py --diff a.png b.png     mean |a - b| and % of pixels that changed

--allow passes a frame with at most that fraction of magenta pixels (self-check
8 uses 1e-5: a pixel or two on silhouettes where the two ways of drawing
sample a depth edge differently; a missed cube would show across its stickers).

  tools/png-stats.py --same a.png b.png [FRACTION [BELOW]]
      fails if more than FRACTION (default 0) of the pixels differ by more
      than BELOW/255 (default 0: at all)
  tools/png-stats.py --same-mask a.png b.png   (debug mode 10 frames: live mask only)

Prints, per file: pixels, magenta (a failed check), pure blue (a ray that
left the stack), and the brightest grey level (the most march steps, for
self-check 3: steps = grey / 255 * 256).
"""
import struct
import sys
import zlib


def read_png(path):
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG")
    pos, idat = 8, b""
    width = height = ctype = depth = None
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
            if depth != 8 or ctype not in (2, 6) or interlace:
                raise ValueError(f"{path}: only 8-bit RGB/RGBA, non-interlaced")
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    bpp = 4 if ctype == 6 else 3
    raw = zlib.decompress(idat)
    stride = width * bpp
    rows, prev = [], bytearray(stride)
    i = 0
    for _ in range(height):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + pred) & 255
        rows.append(bytes(line))
        prev = line
    return width, height, bpp, rows


def diff(a_path, b_path):
    wa, ha, ba, ra = read_png(a_path)
    wb, hb, bb, rb = read_png(b_path)
    if (wa, ha) != (wb, hb):
        raise ValueError("frames differ in size")
    total = changed = 0
    for row_a, row_b in zip(ra, rb):
        for x in range(wa):
            d = sum(abs(row_a[x * ba + k] - row_b[x * bb + k]) for k in range(3))
            total += d
            changed += d > 96
    n = wa * ha
    print(f"mean |diff| {total / (3 * n):.3f}, changed {100.0 * changed / n:.3f}%")
    return total / (3 * n), changed / n


def same(a_path, b_path, allow, below=0):
    wa, ha, ba, ra = read_png(a_path)
    wb, hb, bb, rb = read_png(b_path)
    if (wa, ha) != (wb, hb):
        raise ValueError("frames differ in size")
    changed = worst = 0
    for row_a, row_b in zip(ra, rb):
        for x in range(wa):
            d = max(abs(row_a[x * ba + k] - row_b[x * bb + k]) for k in range(3))
            changed += d > below
            worst = max(worst, d)
    frac = changed / (wa * ha)
    ok = frac <= allow
    print(f"{b_path}: {changed} px differ{f' by more than {below}/255' if below else ''} ({100.0 * frac:.4f}%), largest {worst}/255"
          f" -> {'ok' if ok else 'FAIL'}")
    return 0 if ok else 1


def same_mask(a_path, b_path):
    # Debug mode 10 paints live pixels pure white over a dimmed cache (at most
    # 0.3 * 255). Compare only that white/not-white mask: the dim background
    # comes from each build's own rest pass and may differ in its last bit.
    wa, ha, ba, ra = read_png(a_path)
    wb, hb, bb, rb = read_png(b_path)
    if (wa, ha) != (wb, hb):
        raise ValueError("frames differ in size")
    changed = 0
    for row_a, row_b in zip(ra, rb):
        for x in range(wa):
            wa_ = all(row_a[x * ba + k] > 200 for k in range(3))
            wb_ = all(row_b[x * bb + k] > 200 for k in range(3))
            changed += wa_ != wb_
    print(f"{b_path}: {changed} px differ in the live mask -> {'ok' if changed == 0 else 'FAIL'}")
    return 0 if changed == 0 else 1


def main():
    if len(sys.argv) == 4 and sys.argv[1] == "--same-mask":
        return same_mask(sys.argv[2], sys.argv[3])
    if len(sys.argv) in (4, 5, 6) and sys.argv[1] == "--same":
        return same(sys.argv[2], sys.argv[3], float(sys.argv[4]) if len(sys.argv) >= 5 else 0.0,
                    int(sys.argv[5]) if len(sys.argv) == 6 else 0)
    if len(sys.argv) == 4 and sys.argv[1] == "--diff":
        diff(sys.argv[2], sys.argv[3])
        return 0
    total_bad = 0
    args = sys.argv[1:]
    allow = 0.0
    if len(args) >= 2 and args[0] == "--allow":
        allow, args = float(args[1]), args[2:]
    for path in args:
        w, h, bpp, rows = read_png(path)
        magenta = blue = grey_max = 0
        grey_sum = grey_n = 0
        for row in rows:
            for x in range(0, w * bpp, bpp):
                r, g, b = row[x], row[x + 1], row[x + 2]
                if r > 250 and g < 5 and b > 250:
                    magenta += 1
                elif r < 5 and g < 5 and b > 250:
                    blue += 1
                elif r == g == b:
                    grey_max = max(grey_max, r)
                    grey_sum += r
                    grey_n += 1
        # a nonzero allowance is at least one pixel, whatever the frame size
        total_bad += magenta if magenta > max(allow * w * h, 1 if allow > 0 else 0) else 0
        mean = grey_sum / grey_n if grey_n else 0.0
        print(f"{path}: {w * h} px, magenta {magenta}, blue {blue}, "
              f"max grey {grey_max}, mean grey {mean:.1f}")
    return 1 if total_bad else 0


if __name__ == "__main__":
    sys.exit(main())
