#!/usr/bin/env python3
"""Replace studio background with chroma-key green; keep dealer + roulette wheel."""

import sys
import cv2
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
from mediapipe import Image as MPImage, ImageFormat

MODEL = "_models/selfie_segmenter.tflite"
GREEN_BGR = (0, 255, 0)


def make_segmenter():
    base = mp_python.BaseOptions(model_asset_path=MODEL)
    opts = vision.ImageSegmenterOptions(base_options=base, output_category_mask=True)
    return vision.ImageSegmenter.create_from_options(opts)


def person_alpha(segmenter, bgr):
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    res = segmenter.segment(MPImage(image_format=ImageFormat.SRGB, data=rgb))
    conf = res.confidence_masks[0].numpy_view()
    if conf.ndim == 3:
        conf = conf[:, :, 0]
    if float(conf.mean()) < 0.45:
        a = conf.astype(np.float32)
    else:
        cat = res.category_mask.numpy_view()
        if cat.ndim == 3:
            cat = cat[:, :, 0]
        a = (cat < 128).astype(np.float32)
    a = np.clip((a - 0.12) / 0.5, 0, 1)
    return cv2.GaussianBlur(a, (9, 9), 0)


def wheel_alpha(bgr):
    H, W = bgr.shape[:2]
    # Normalized circle (stable across resolution)
    cx, cy, r = int(W * 0.289), int(H * 0.667), int(min(W, H) * 0.347)
    yy, xx = np.mgrid[:H, :W]
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    disk = dist <= r

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)

    is_set = (
        ((h >= 2) & (h <= 40) & (s >= 10) & (s <= 160) & (v >= 10) & (v <= 170))
        | (v <= 40)
        | ((h >= 8) & (h <= 50) & (s <= 80) & (v >= 120))
    )
    is_wheel = (
        (((h <= 10) | (h >= 168)) & (s > 80) & (v > 55))
        | ((h >= 35) & (h <= 95) & (s > 35) & (v > 35) & (v < 210) & (dist < r * 0.9))
        | ((s < 50) & (v > 110) & (dist < r * 0.6))
        | ((v < 75) & (s < 70) & (dist < r * 0.95))
    )

    wa = np.zeros((H, W), np.uint8)
    # Lower 70% of disk: keep almost all (wheel body)
    lower = disk & (yy > cy - int(r * 0.35))
    wa[lower] = 255
    # Upper disk: only wheel-colored pixels
    upper = disk & (yy <= cy - int(r * 0.35))
    wa[upper & is_wheel] = 255

    wa = cv2.morphologyEx(
        wa, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)), iterations=2
    )
    # Strip remaining set pixels (but keep reds)
    red = (((h <= 10) | (h >= 168)) & (s > 80) & (v > 55)).astype(np.uint8) * 255
    remove = is_set.astype(np.uint8) * 255
    remove = cv2.bitwise_and(remove, cv2.bitwise_not(red))
    wa = cv2.bitwise_and(wa, cv2.bitwise_not(remove))
    wa = cv2.bitwise_and(wa, (disk.astype(np.uint8) * 255))
    wa = cv2.morphologyEx(
        wa, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)), iterations=2
    )
    wa = cv2.GaussianBlur(wa, (9, 9), 0)
    return wa.astype(np.float32) / 255.0


def greenscreen_frame(segmenter, bgr):
    H, W = bgr.shape[:2]
    pa = person_alpha(segmenter, bgr)
    wa = wheel_alpha(bgr)
    alpha = np.clip(np.maximum(pa, wa), 0, 1)

    # Force decorative left screen / curtains / wall to pure green
    xx = np.linspace(0, 1, W, dtype=np.float32)[None, :].repeat(H, 0)
    yy = np.linspace(0, 1, H, dtype=np.float32)[:, None].repeat(W, 1)
    left_set = (xx < 0.27) & (pa < 0.35)
    alpha = np.where(left_set, 0.0, alpha)
    # Re-add only real wheel pixels on the left edge of the wheel
    alpha = np.maximum(alpha, np.where(left_set, wa * (xx > 0.18).astype(np.float32), 0.0))

    # Top strip + upper wall behind dealer -> green (keep person)
    top = yy < 0.08
    alpha = np.where(top & (pa < 0.35), 0.0, alpha)
    # Behind-dealer wall (right side, mid height) that isn't person
    behind = (xx > 0.55) & (yy < 0.55) & (pa < 0.25)
    alpha = np.where(behind, 0.0, alpha)

    green = np.full_like(bgr, GREEN_BGR, dtype=np.float32)
    out = bgr.astype(np.float32) * alpha[..., None] + green * (1.0 - alpha[..., None])
    return np.clip(out, 0, 255).astype(np.uint8)


def process(src, dst_raw, work_scale=1.0):
    segmenter = make_segmenter()
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise SystemExit(f"cannot open {src}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = cv2.VideoWriter(dst_raw, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if work_scale != 1.0:
            small = cv2.resize(
                frame, (int(w * work_scale), int(h * work_scale)), interpolation=cv2.INTER_AREA
            )
            out_s = greenscreen_frame(segmenter, small)
            out = cv2.resize(out_s, (w, h), interpolation=cv2.INTER_LINEAR)
        else:
            out = greenscreen_frame(segmenter, frame)
        writer.write(out)
        if i == 60:
            cv2.imwrite("_gs_preview_final.jpg", out if work_scale == 1.0 else cv2.resize(out_s, (w, h)))
        i += 1
        if i % 60 == 0:
            print(f"frame {i}", flush=True)
    cap.release()
    writer.release()
    print(f"wrote {dst_raw} ({i} frames)", flush=True)


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "roulette_video_only.mp4"
    dst = sys.argv[2] if len(sys.argv) > 2 else "roulette_greenscreen_raw.mp4"
    # Process at native res of source; for 4K use work_scale via arg3
    scale = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
    process(src, dst, work_scale=scale)
