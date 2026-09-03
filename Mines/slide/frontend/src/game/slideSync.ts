/** Must match Reel.tsx layout + smoothSlideProgress */
export const SPIN_MS = 7000
export const BOX_WIDTH = 92
export const BOX_GAP = 10
export const STRIDE = BOX_WIDTH + BOX_GAP

/** Continuous ease baked into Web Animations keyframes */
export function smoothSlideProgress(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  const easeOut = 1 - (1 - x) ** 2.35
  const smooth = x * x * (3 - 2 * x)
  return easeOut * 0.82 + smooth * 0.18
}

export function endOffset(winIndex: number, viewportWidth: number): number {
  const center = viewportWidth / 2
  return -(winIndex * STRIDE + BOX_WIDTH / 2 - center + BOX_GAP / 2)
}

function progressForTrackX(trackX: number, from: number, to: number): number {
  const delta = to - from
  if (Math.abs(delta) < 1) return 0
  const target = (trackX - from) / delta
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (smoothSlideProgress(mid) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Track translate X when box center sits under the pin. */
function trackXForBoxCenter(boxIndex: number, viewportWidth: number): number {
  const center = viewportWidth / 2
  return center - boxIndex * STRIDE - BOX_WIDTH / 2 - BOX_GAP / 2
}

/** Wall-clock ms for each peg tick as a box center crosses the pin. */
export function scheduleTickTimesMs(
  from: number,
  to: number,
  viewportWidth: number,
  reelLength: number,
  durationMs = SPIN_MS,
): number[] {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const times: number[] = []

  for (let i = 0; i < reelLength; i++) {
    const cross = trackXForBoxCenter(i, viewportWidth)
    if (cross < lo - 1 || cross > hi + 1) continue
    times.push(progressForTrackX(cross, from, to) * durationMs)
  }

  return times.sort((a, b) => a - b)
}
