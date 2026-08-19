import { useLayoutEffect, useRef, useState } from 'react'
import type { Zone } from './gameConfig'

const REPEATS = 6
/** Fixed arrow sits at the center of the viewport */
export const POINTER_AT = 50

interface TrackProps {
  zones: Zone[]
  /** translateX in px — negative scrolls the strip left under the fixed arrow */
  stripOffset: number
  playing: boolean
  resultMultiplier: number | null
  resultColor: string | null
  resultPayout: number | null
  onWidth?: (width: number) => void
}

function Cycle({ zones, width }: { zones: Zone[]; width: number }) {
  return (
    <div className="track-cycle" style={{ width }}>
      {zones.map((z) => (
        <div
          key={z.id}
          className="zone"
          style={{
            left: `${z.start}%`,
            width: `${z.end - z.start}%`,
            background: z.color,
          }}
        />
      ))}
    </div>
  )
}

export function Track({
  zones,
  stripOffset,
  playing,
  resultMultiplier,
  resultColor,
  resultPayout,
  onWidth,
}: TrackProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [cycleWidth, setCycleWidth] = useState(360)

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const measure = () => {
      const w = el.clientWidth
      setCycleWidth(w)
      onWidth?.(w)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onWidth])

  return (
    <div className="track-stage">
      {resultMultiplier !== null && resultMultiplier > 0 && (
        <div className="win-callout" style={{ color: resultColor ?? '#fff' }}>
          <span className="win-mult">{resultMultiplier.toFixed(2)}x</span>
          {resultPayout !== null && (
            <span className="win-payout">
              +₹
              {resultPayout.toLocaleString('en-IN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          )}
        </div>
      )}

      <div className={`track-wrap${playing ? ' playing' : ''}`}>
        {/* Fixed arrow — does not move */}
        <div className="marker" aria-hidden />

        <div className="track" ref={viewportRef}>
          <div
            className="track-strip"
            style={{
              width: cycleWidth * REPEATS,
              transform: `translateX(${stripOffset}px)`,
            }}
          >
            {Array.from({ length: REPEATS }, (_, i) => (
              <Cycle key={i} zones={zones} width={cycleWidth} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** How far to scroll so `targetPosition` (0–100) lands under the fixed center arrow. */
export function offsetForTarget(
  targetPosition: number,
  cycleWidth: number,
  loops = 4,
): number {
  // Land on copy `loops` (0-based), zone at targetPosition%
  const pointOnStrip =
    loops * cycleWidth + (targetPosition / 100) * cycleWidth
  const pointerPx = (POINTER_AT / 100) * cycleWidth
  return -(pointOnStrip - pointerPx)
}
