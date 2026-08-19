#!/usr/bin/env python3
"""Remove neighbor-frame bleed from maestro bird sheet cells."""
from __future__ import annotations

from collections import deque
from pathlib import Path
import shutil

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / "public" / "bird-sheet.webp"
OUT_DIR = ROOT / "public" / "bird-frames"
FRAME0_COPY = ROOT / "public" / "bird-frame.png"
STRIP = Path("/tmp/bird-clean-strip.png")

N_FRAMES = 10
CELL_W = 423  # 4230 / 10
CELL_H = 390
OUT_W, OUT_H = 360, 340
ALPHA_THRESH = 40
PAD = 4
EDGE = 6
MARGIN = EDGE


def connected_components(mask: np.ndarray, connectivity: int = 8):
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    sizes: dict[int, int] = {}
    label = 0
    if connectivity == 8:
        neighbors = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    else:
        neighbors = [(-1, 0), (1, 0), (0, -1), (0, 1)]

    for y in range(h):
        for x in range(w):
            if not mask[y, x] or labels[y, x]:
                continue
            label += 1
            q = deque([(y, x)])
            labels[y, x] = label
            count = 0
            while q:
                cy, cx = q.popleft()
                count += 1
                for dy, dx in neighbors:
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                        labels[ny, nx] = label
                        q.append((ny, nx))
            sizes[label] = count
    return labels, sizes


def main() -> None:
    sheet = np.array(Image.open(SHEET).convert("RGBA"))
    assert sheet.shape[0] == CELL_H and sheet.shape[1] == CELL_W * N_FRAMES

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    max_fit_w = OUT_W - 2 * MARGIN
    max_fit_h = OUT_H - 2 * MARGIN
    clean_frames: list[np.ndarray] = []
    rows = []

    for i in range(N_FRAMES):
        x0 = i * CELL_W
        cell = sheet[:, x0 : x0 + CELL_W].copy()
        opaque = cell[:, :, 3] >= ALPHA_THRESH
        labels, sizes = connected_components(opaque, connectivity=8)
        if not sizes:
            raise RuntimeError(f"frame {i}: no opaque pixels")

        main_label = max(sizes, key=sizes.get)
        keep = labels == main_label
        cell[opaque & ~keep] = (0, 0, 0, 0)

        ys, xs = np.where(keep)
        y1, y2 = int(ys.min()), int(ys.max())
        x1, x2 = int(xs.min()), int(xs.max())
        y1p = max(0, y1 - PAD)
        y2p = min(CELL_H - 1, y2 + PAD)
        x1p = max(0, x1 - PAD)
        x2p = min(CELL_W - 1, x2 + PAD)
        bird = cell[y1p : y2p + 1, x1p : x2p + 1]

        bh, bw = bird.shape[:2]
        scale = min(max_fit_w / bw, max_fit_h / bh, 1.0)
        new_w = max(1, int(round(bw * scale)))
        new_h = max(1, int(round(bh * scale)))
        bird = np.array(
            Image.fromarray(bird, "RGBA").resize((new_w, new_h), Image.Resampling.LANCZOS)
        )
        bh, bw = bird.shape[:2]

        out = np.zeros((OUT_H, OUT_W, 4), dtype=np.uint8)
        oy = (OUT_H - bh) // 2
        ox = (OUT_W - bw) // 2
        out[oy : oy + bh, ox : ox + bw] = bird

        Image.fromarray(out, "RGBA").save(OUT_DIR / f"{i}.png", "PNG")
        clean_frames.append(out)

        out_opaque = out[:, :, 3] >= ALPHA_THRESH
        _, out_sizes = connected_components(out_opaque, connectivity=8)
        large = {k: v for k, v in out_sizes.items() if v >= 20}
        oys, oxs = np.where(out_opaque)
        bbox = (int(oxs.min()), int(oys.min()), int(oxs.max()), int(oys.max()))
        rows.append(
            {
                "frame": i,
                "opaque": int(out_opaque.sum()),
                "components": len(out_sizes),
                "large": len(large),
                "bbox": bbox,
                "edge_L": int(out_opaque[:, :EDGE].sum()),
                "edge_R": int(out_opaque[:, -EDGE:].sum()),
                "removed": len(sizes) - 1,
            }
        )

    shutil.copy2(OUT_DIR / "0.png", FRAME0_COPY)

    strip = np.zeros((OUT_H, OUT_W * N_FRAMES, 4), dtype=np.uint8)
    for i, fr in enumerate(clean_frames):
        strip[:, i * OUT_W : (i + 1) * OUT_W] = fr
    Image.fromarray(strip, "RGBA").save(STRIP, "PNG")

    print("frame | opaque | comps | bbox (x0,y0,x1,y1)      | edgeL | edgeR")
    print("-" * 78)
    for r in rows:
        print(
            f"{r['frame']:5d} | {r['opaque']:6d} | {r['components']:5d} | "
            f"{str(r['bbox']):24s} | {r['edge_L']:5d} | {r['edge_R']:5d}"
        )
    print(f"\nWrote {OUT_DIR}/{{0..9}}.png, {FRAME0_COPY}, {STRIP}")


if __name__ == "__main__":
    main()
