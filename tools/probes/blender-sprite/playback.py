"""Timed animated playback as GIF: pure-Python encoder with exact per-frame delays (centiseconds). No IO beyond write.

GIF delays are centiseconds, so canon's 333/167 ms become 33/17 cs and 83 ms becomes 8 cs; the README says so.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

CS_PER_MS = 0.1


def ms_to_cs(ms: int) -> int:
    return max(1, round(ms * CS_PER_MS))


def timeline(schedules_ms: Sequence[Sequence[int]], total_cs: int) -> list[tuple[int, tuple[int, ...]]]:
    """Merge independently cycling panels into steps of (duration in cs, frame index per panel) over `total_cs`."""
    cycles = []
    for schedule in schedules_ms:
        durations = [ms_to_cs(d) for d in schedule]
        cycles.append(durations)
    marks = {0, total_cs}
    for durations in cycles:
        period = sum(durations)
        t = 0
        while t < total_cs:
            for d in durations:
                t += d
                if t < total_cs:
                    marks.add(t)

    def frame_at(durations: list[int], t: int) -> int:
        t %= sum(durations)
        acc = 0
        for i, d in enumerate(durations):
            acc += d
            if t < acc:
                return i
        return len(durations) - 1

    ordered = sorted(marks)
    return [(end - start, tuple(frame_at(c, start) for c in cycles)) for start, end in zip(ordered, ordered[1:], strict=False)]


def lzw_compress(indices: bytes, min_code_size: int) -> bytes:
    clear = 1 << min_code_size
    eoi = clear + 1
    out = bytearray()
    acc = 0
    nbits = 0

    def emit(code: int, size: int) -> None:
        nonlocal acc, nbits
        acc |= code << nbits
        nbits += size
        while nbits >= 8:
            out.append(acc & 255)
            acc >>= 8
            nbits -= 8

    table: dict[tuple[int, int], int] = {}
    next_code = eoi + 1
    size = min_code_size + 1
    emit(clear, size)
    prefix = indices[0]
    for k in indices[1:]:
        key = (prefix, k)
        code = table.get(key)
        if code is not None:
            prefix = code
            continue
        emit(prefix, size)
        if next_code < 4096:
            table[key] = next_code
            if next_code == (1 << size):
                size += 1
            next_code += 1
        else:
            emit(clear, size)
            table.clear()
            next_code = eoi + 1
            size = min_code_size + 1
        prefix = k
    emit(prefix, size)
    emit(eoi, size)
    if nbits:
        out.append(acc & 255)
    return bytes(out)


def _sub_blocks(data: bytes) -> bytes:
    out = bytearray()
    for i in range(0, len(data), 255):
        chunk = data[i : i + 255]
        out.append(len(chunk))
        out += chunk
    out.append(0)
    return bytes(out)


def encode_gif(width: int, height: int, palette: Sequence[tuple[int, int, int]], frames: Sequence[bytes], delays_cs: Sequence[int]) -> bytes:
    """GIF89a, looping, global palette (<= 256 colours), full-frame images; `frames` hold palette indices."""
    if len(frames) != len(delays_cs):
        raise ValueError("one delay per frame")
    if not 1 <= len(palette) <= 256:
        raise ValueError("palette must have 1..256 colours")
    bits = max(1, (len(palette) - 1).bit_length())
    table = list(palette) + [(0, 0, 0)] * ((1 << bits) - len(palette))
    out = bytearray(b"GIF89a")
    out += width.to_bytes(2, "little") + height.to_bytes(2, "little")
    out += bytes((0x80 | (bits - 1) | ((bits - 1) << 4), 0, 0))
    for r, g, b in table:
        out += bytes((r, g, b))
    out += b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00"
    min_code = max(2, bits)
    for data, delay in zip(frames, delays_cs, strict=True):
        if len(data) != width * height:
            raise ValueError("frame size mismatch")
        out += b"\x21\xf9\x04\x04" + delay.to_bytes(2, "little") + b"\x00\x00"
        out += b"\x2c" + (0).to_bytes(2, "little") * 2 + width.to_bytes(2, "little") + height.to_bytes(2, "little") + b"\x00"
        out += bytes((min_code,)) + _sub_blocks(lzw_compress(data, min_code))
    out += b"\x3b"
    return bytes(out)


def write_gif(path: str | Path, width: int, height: int, palette, frames, delays_cs) -> int:
    data = encode_gif(width, height, palette, frames, delays_cs)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(data)
    return len(data)
