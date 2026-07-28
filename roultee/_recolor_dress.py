#!/usr/bin/env python3
"""Recolor dealer dress: fuchsia -> emerald evening + champagne gold trim."""

import sys
import cv2
import numpy as np

def dress_mask(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    h, s, v = cv2.split(hsv)
    H, W = h.shape

    pink = (((h >= 148) | (h <= 16)) & (s > 85) & (v > 65)).astype(np.uint8) * 255
    mag = (lab[:, :, 1] > 145).astype(np.uint8) * 255
    m = cv2.bitwise_and(pink, mag)

    xs = np.linspace(0, 1, W, dtype=np.float32)[None, :].repeat(H, 0)
    ys = np.linspace(0, 1, H, dtype=np.float32)[:, None].repeat(W, 1)
    # dealer sits on the right; avoid most of the wheel
    region = ((xs > 0.50) & (ys < 0.90)).astype(np.uint8) * 255
    wheel = np.zeros((H, W), np.uint8)
    cv2.ellipse(
        wheel,
        (int(W * 0.34), int(H * 0.84)),
        (int(W * 0.34), int(H * 0.50)),
        0,
        0,
        360,
        255,
        -1,
    )
    face = np.zeros((H, W), np.uint8)
    cv2.ellipse(
        face,
        (int(W * 0.72), int(H * 0.24)),
        (int(W * 0.13), int(H * 0.22)),
        0,
        0,
        360,
        255,
        -1,
    )
    skin = ((h >= 0) & (h <= 25) & (s > 20) & (s < 100) & (v > 95)).astype(np.uint8) * 255

    m = cv2.bitwise_and(m, region)
    m = cv2.bitwise_and(m, cv2.bitwise_not(wheel))
    m = cv2.bitwise_and(m, cv2.bitwise_not(face))
    m = cv2.bitwise_and(m, cv2.bitwise_not(skin))

    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k, iterations=3)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    # re-apply hard exclusions after dilate
    m = cv2.bitwise_and(m, cv2.bitwise_not(wheel))
    m = cv2.bitwise_and(m, cv2.bitwise_not(face))
    return cv2.GaussianBlur(m, (9, 9), 0), wheel


def recolor(bgr, mask_u8, wheel):
    m1 = mask_u8.astype(np.float32) / 255.0
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

    # emerald evening satin
    high = h >= 90
    new_h = np.where(high, 68 + (h - 172) * 0.12, 68 + (h - 6) * 0.22)
    new_h = np.clip(new_h, 52, 85)
    new_s = np.clip(s * 1.06 + 10, 0, 255)
    new_v = np.clip(v * 0.96, 0, 255)

    out = cv2.cvtColor(
        np.stack(
            [h * (1 - m1) + new_h * m1, s * (1 - m1) + new_s * m1, v * (1 - m1) + new_v * m1],
            -1,
        ).astype(np.uint8),
        cv2.COLOR_HSV2BGR,
    )

    # champagne-gold piping theme
    hsv2 = cv2.cvtColor(out, cv2.COLOR_BGR2HSV).astype(np.float32)
    hh, ss, vv = hsv2[:, :, 0], hsv2[:, :, 1], hsv2[:, :, 2]
    dil = cv2.dilate(
        (m1 > 0.28).astype(np.uint8) * 255,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)),
    )
    dil = cv2.GaussianBlur(dil, (5, 5), 0).astype(np.float32) / 255.0
    piping = ((ss < 55) & (vv > 165) & (dil > 0.35) & (m1 < 0.55) & (wheel == 0)).astype(
        np.float32
    )
    piping = cv2.GaussianBlur(piping, (5, 5), 0)
    hh = hh * (1 - piping) + 20 * piping
    ss = ss * (1 - piping) + np.minimum(155.0, ss * 0.2 + 130) * piping
    vv = vv * (1 - piping) + vv * 0.96 * piping
    return cv2.cvtColor(np.stack([hh, ss, vv], -1).astype(np.uint8), cv2.COLOR_HSV2BGR)


def process_video(src, dst):
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise SystemExit(f"Cannot open {src}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    tmp = dst.replace(".mp4", "_raw.mp4")
    writer = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        dm, wheel = dress_mask(frame)
        writer.write(recolor(frame, dm, wheel))
        if i == 90:
            cv2.imwrite("_dress_preview_final.jpg", recolor(frame, dm, wheel))
        i += 1
        if i % 90 == 0:
            print(f"frame {i}", flush=True)
    cap.release()
    writer.release()
    print(f"raw video: {tmp} ({i} frames)", flush=True)
    return tmp


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "roulette_video_only.mp4"
    dst = sys.argv[2] if len(sys.argv) > 2 else "roulette_dress_emerald.mp4"
    process_video(src, dst)
