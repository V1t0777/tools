#!/usr/bin/env python3
"""Draft-only RGB pixel audit for repeated original far/mid painting pilots.

No third-party dependencies. Decodes Chrome's 8-bit RGB/RGBA PNG, including
PNG scanline filters. This is one narrow strip diagnostic, NOT art signoff.
"""
from __future__ import annotations

import json
import struct
import sys
import zlib
from pathlib import Path


def png_rgb(path: Path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not PNG: {path}")
    offset, pixels, size = 8, [], None
    streams = []
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError("truncated PNG chunk")
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        value = data[offset + 8:offset + 8 + length]
        if len(value) != length:
            raise ValueError("truncated PNG payload")
        if zlib.crc32(kind + value) != struct.unpack_from(">I", data, offset + 8 + length)[0]:
            raise ValueError("PNG CRC mismatch")
        offset += length + 12
        if kind == b"IHDR":
            w, h, bitdepth, colortype, compression, filt, interlace = struct.unpack(">IIBBBBB", value)
            if bitdepth != 8 or colortype not in (2, 6) or compression or filt or interlace:
                raise ValueError("unsupported PNG; expected Chrome 8-bit noninterlaced RGB(A)")
            size = (w, h, 3 if colortype == 2 else 4)
        elif kind == b"IDAT":
            streams.append(value)
        elif kind == b"IEND":
            break
    if size is None or not streams:
        raise ValueError("missing IHDR or IDAT")
    w, h, bpp = size
    scan = zlib.decompress(b"".join(streams))
    rowlen = w * bpp
    if len(scan) != h * (rowlen + 1):
        raise ValueError("unexpected PNG raw data length")
    previous = bytearray(rowlen)
    p = 0
    for _ in range(h):
        filtertype = scan[p]
        current = bytearray(scan[p + 1:p + 1 + rowlen])
        p += rowlen + 1
        for i in range(rowlen):
            left = current[i - bpp] if i >= bpp else 0
            up = previous[i]
            upperleft = previous[i - bpp] if i >= bpp else 0
            if filtertype == 1:
                recon = left
            elif filtertype == 2:
                recon = up
            elif filtertype == 3:
                recon = (left + up) // 2
            elif filtertype == 4:
                pred = left + up - upperleft
                distances = (abs(pred - left), abs(pred - up), abs(pred - upperleft))
                recon = (left, up, upperleft)[distances.index(min(distances))]
            elif filtertype == 0:
                recon = 0
            else:
                raise ValueError(f"unknown PNG scanline filter {filtertype}")
            current[i] = (current[i] + recon) & 255
        pixels.append(current)
        previous = current
    return w, h, bpp, pixels


def seam_audit(path: Path):
    w, h, bpp, rows = png_rgb(path)
    if (w, h) != (320, 568):
        raise ValueError(f"unexpected QA image dimensions: {path}: {w}x{h}")
    x = w // 2
    # Lower part includes the joined mountains; skip mostly transparent sky.
    y0 = int(h * .65)
    seam_sum = control_sum = channels = 0.0
    for y in range(y0, h):
        row = rows[y]
        for c in range(3):
            at = lambda xx: row[xx * bpp + c]
            seam_sum += abs(at(x - 1) - at(x))
            control_sum += (abs(at(x - 4) - at(x - 3)) +
                            abs(at(x + 2) - at(x + 3))) / 2
            channels += 1
    mean = round(seam_sum / channels, 3)
    reference = round(control_sum / channels, 3)
    return {"file": path.name, "seam_rgb_jump": mean, "nearby_control": reference,
            "samples": int(channels),
            "passes": mean <= 4.0 and mean <= reference + 2.25}


def run(directory: Path):
    reports = []
    for layer in ("far", "mid", "mist", "near"):
        for theme in ("warm", "slate"):
            name = (f"pilot-seam-{theme}-320x568.png" if layer == "far" else
                    f"pilot-{layer}-seam-{theme}-320x568.png")
            path = directory / name
            if not path.is_file():
                raise FileNotFoundError(path)
            reports.append(seam_audit(path))
    # Alpha31's *real* raster masks must pass the same decoded-pixel seam
    # comparison, not merely file format or transparent alpha tests.
    for theme in ("warm", "slate"):
        path = directory / f"alpha31-raster-seam-{theme}-320x568.png"
        if not path.is_file():
            raise FileNotFoundError(path)
        reports.append(seam_audit(path))
    # Alpha32 directionally brushed original raster gets independent RGB join QA.
    for theme in ("warm", "slate"):
        path = directory / f"alpha32-raster-seam-{theme}-320x568.png"
        if not path.is_file():
            raise FileNotFoundError(path)
        reports.append(seam_audit(path))
    # The new Alpha33 original-tree-mask bitmap receives the same real decoded
    # Chrome seam test, not just a pixel or output-file count.
    for theme in ("warm", "slate"):
        path = directory / f"alpha33-raster-seam-{theme}-320x568.png"
        if not path.is_file():
            raise FileNotFoundError(path)
        reports.append(seam_audit(path))
    # Alpha34 authored per-tree source art, new 1600px RGBA tile joins.
    for theme in ("warm", "slate"):
        path = directory / f"alpha34-raster-seam-{theme}-320x568.png"
        if not path.is_file():
            raise FileNotFoundError(path)
        reports.append(seam_audit(path))
    result = {
        "scope": "Alpha 26 original far/mid pilot flat tile boundary, Chrome mobile viewport",
        "warning": "Single-row-band RGB diagnostics, not painterly review or hardware proof",
        "results": reports,
    }
    (directory / "headless-painted-pilot-seams.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for item in reports:
        print(item)
    if not all(row["passes"] for row in reports):
        raise SystemExit("Pilot border contrast regression: a visible tile seam candidate remains")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: flappy-v4-pilot-seam-check.py v4-art-qa")
    run(Path(sys.argv[1]))
