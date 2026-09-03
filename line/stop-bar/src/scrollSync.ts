import { ANIM_MS, ZONES } from './gameConfig'
import { POINTER_AT } from './Track'

/** Must match index.css: cubic-bezier(0.12, 0.75, 0.08, 1) */
const BX1 = 0.12
const BY1 = 0.75
const BX2 = 0.08
const BY2 = 1

function bezierXY(t: number): { x: number; y: number } {
  const u = 1 - t
  return {
    x: 3 * u * u * t * BX1 + 3 * u * t * t * BX2 + t * t * t,
    y: 3 * u * u * t * BY1 + 3 * u * t * t * BY2 + t * t * t,
  }
}

/** CSS transition easing: linear time 0–1 → animation progress 0–1 */
export function easingAt(timeFraction: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (bezierXY(mid).x < timeFraction) lo = mid
    else hi = mid
  }
  return bezierXY((lo + hi) / 2).y
}

/** Inverse: animation progress 0–1 → linear time 0–1 */
export function timeForProgress(progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (easingAt(mid) < p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Offsets where a zone edge crosses the fixed center pointer. */
export function crossingOffsets(
  startOffset: number,
  endOffset: number,
  cycleWidth: number,
  repeats = 6,
): number[] {
  const pointerPx = (POINTER_AT / 100) * cycleWidth
  const lo = Math.min(startOffset, endOffset)
  const hi = Math.max(startOffset, endOffset)
  const hits: number[] = []

  for (let loop = 0; loop < repeats; loop++) {
    for (const zone of ZONES) {
      // Tick when the center of each box passes the arrow
      const centerPct = zone.start + (zone.end - zone.start) / 2
      const posOnStrip = loop * cycleWidth + (centerPct / 100) * cycleWidth
      const cross = pointerPx - posOnStrip
      if (cross >= lo - 1 && cross <= hi + 1) hits.push(cross)
    }
  }

  // Travel direction: offset animates start → end
  if (endOffset < startOffset) {
    return hits
      .filter((o) => o <= startOffset + 1 && o >= endOffset - 1)
      .sort((a, b) => b - a)
  }
  return hits
    .filter((o) => o >= startOffset - 1 && o <= endOffset + 1)
    .sort((a, b) => a - b)
}

export function scheduleTimesMs(
  startOffset: number,
  endOffset: number,
  cycleWidth: number,
  durationMs = ANIM_MS,
): number[] {
  const delta = endOffset - startOffset
  if (Math.abs(delta) < 1) return []

  return crossingOffsets(startOffset, endOffset, cycleWidth).map((cross) => {
    const progress = (cross - startOffset) / delta
    return timeForProgress(progress) * durationMs
  })
}
