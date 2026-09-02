"""Write a valid flattened RGB .psd from a PIL image.

ImageMagick's PSD encoder produces a layer/mask section that psd_tools flags as
broken, so sample templates are written here instead: a spec-clean Photoshop
file with an empty layer section, a resolution resource (so print software sees
the right physical size) and RLE-packed image data.

Real designer PSDs — layered, with a named text placeholder — are read by
`renderer.py` unchanged; this module only exists to produce the samples.
"""

from __future__ import annotations

import struct
from pathlib import Path

from PIL import Image

COLOR_MODE_RGB = 3


def _packbits(data: bytes) -> bytes:
    """PackBits RLE, the compression Photoshop uses for method 1."""
    out = bytearray()
    i = 0
    n = len(data)
    while i < n:
        # Look for a run of 3+ identical bytes.
        run_end = i
        while run_end + 1 < n and data[run_end + 1] == data[i] and run_end - i < 127:
            run_end += 1
        run_len = run_end - i + 1

        if run_len >= 3:
            out.append(256 - (run_len - 1))
            out.append(data[i])
            i += run_len
            continue

        # Otherwise accumulate a literal block until a 3-run starts.
        start = i
        while i < n and i - start < 128:
            if (
                i + 2 < n
                and data[i] == data[i + 1] == data[i + 2]
            ):
                break
            i += 1
        length = i - start
        out.append(length - 1)
        out.extend(data[start:i])
    return bytes(out)


def _resolution_resource(dpi: int) -> bytes:
    """Image resource 1005 (ResolutionInfo): DPI in 16.16 fixed point."""
    fixed = int(dpi) << 16
    body = struct.pack(
        ">IHHIHH",
        fixed,  # hRes
        1,  # hResUnit: pixels per inch
        1,  # widthUnit: inches
        fixed,  # vRes
        1,  # vResUnit
        1,  # heightUnit
    )
    block = b"8BIM" + struct.pack(">H", 1005) + b"\x00\x00" + struct.pack(">I", len(body)) + body
    if len(block) % 2:
        block += b"\x00"
    return block


def write_psd(image: Image.Image, path: str | Path, dpi: int = 300) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    rgb = image.convert("RGB")
    width, height = rgb.size
    channels = rgb.split()  # R, G, B planes

    header = struct.pack(
        ">4sH6sHIIHH",
        b"8BPS",
        1,  # version
        b"\x00" * 6,  # reserved
        3,  # channel count
        height,
        width,
        8,  # bit depth
        COLOR_MODE_RGB,
    )

    color_mode_data = struct.pack(">I", 0)

    resources = _resolution_resource(dpi)
    image_resources = struct.pack(">I", len(resources)) + resources

    # Empty layer and mask information section.
    layer_and_mask = struct.pack(">I", 0)

    # Image data, compression method 1 (RLE): all row byte-counts first, then rows.
    row_counts: list[int] = []
    packed_rows: list[bytes] = []
    for plane in channels:
        raw = plane.tobytes()
        for y in range(height):
            row = raw[y * width : (y + 1) * width]
            packed = _packbits(row)
            packed_rows.append(packed)
            row_counts.append(len(packed))

    image_data = struct.pack(">H", 1)
    image_data += b"".join(struct.pack(">H", c) for c in row_counts)
    image_data += b"".join(packed_rows)

    path.write_bytes(
        header + color_mode_data + image_resources + layer_and_mask + image_data
    )
    return path
