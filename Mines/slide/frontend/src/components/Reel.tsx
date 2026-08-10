import { useEffect, useRef } from 'react'
import type { ReelBox } from '../api/client'
import { formatMultiplier } from '../game/format'

const BOX_WIDTH = 92
const BOX_GAP = 10
const STRIDE = BOX_WIDTH + BOX_GAP
const SPIN_MS = 7000
const KEYFRAMES = 48

type Props = {
  reel: ReelBox[]
  winIndex: number | null
  spinning: boolean
  spinId: number
  onSpinEnd?: () => void
}

function toneClass(tone: string) {
  return `tone-${tone || 'gray'}`
}

function endOffset(winIndex: number, viewportWidth: number) {
  const center = viewportWidth / 2
  return -(winIndex * STRIDE + BOX_WIDTH / 2 - center + BOX_GAP / 2)
}

/** Continuous ease: gentle rise, long glide, soft brake — no sharp speed jumps */
function smoothSlideProgress(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  // Smoothstep-blended ease-out keeps motion fluid the whole way
  const easeOut = 1 - (1 - x) ** 2.35
  const smooth = x * x * (3 - 2 * x)
  return easeOut * 0.82 + smooth * 0.18
}

function buildKeyframes(from: number, to: number): Keyframe[] {
  const frames: Keyframe[] = []
  for (let i = 0; i <= KEYFRAMES; i++) {
    const t = i / KEYFRAMES
    const p = smoothSlideProgress(t)
    const x = from + (to - from) * p
    frames.push({
      transform: `translate3d(${x}px, 0, 0)`,
      offset: t,
    })
  }
  return frames
}

export function Reel({ reel, winIndex, spinning, spinId, onSpinEnd }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const onSpinEndRef = useRef(onSpinEnd)
  const animRef = useRef<Animation | null>(null)
  onSpinEndRef.current = onSpinEnd

  useEffect(() => {
    const track = trackRef.current
    const viewport = viewportRef.current
    if (!track || !viewport || winIndex == null || !reel.length) return

    const endX = endOffset(winIndex, viewport.clientWidth)

    animRef.current?.cancel()
    animRef.current = null

    if (!spinning) {
      track.style.transform = `translate3d(${endX}px, 0, 0)`
      return
    }

    const from = 28
    const to = endX

    // Promote to its own layer before animating
    track.style.transform = `translate3d(${from}px, 0, 0)`

    const anim = track.animate(buildKeyframes(from, to), {
      duration: SPIN_MS,
      easing: 'linear', // progress already baked into keyframes
      fill: 'forwards',
      composite: 'replace',
    })
    animRef.current = anim

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      track.style.transform = `translate3d(${to}px, 0, 0)`
      onSpinEndRef.current?.()
    }

    const timer = window.setTimeout(finish, SPIN_MS)
    anim.finished.catch(() => {
      /* cancelled on remount */
    })

    return () => {
      window.clearTimeout(timer)
      anim.cancel()
      if (animRef.current === anim) animRef.current = null
    }
  }, [spinning, spinId, winIndex, reel.length])

  const boxes = reel.length
    ? reel
    : Array.from({ length: 14 }, (_, i) => ({
        multiplier: (1.2 + (i % 5) * 0.3).toFixed(2),
        tone: i % 3 === 0 ? 'blue' : 'gray',
      }))

  const highlight = !spinning && winIndex != null ? winIndex : -1

  return (
    <div className={`reel-stage ${spinning ? 'is-spinning' : ''}`}>
      <div className="reel-viewport" ref={viewportRef}>
        <div className="reel-fade reel-fade-left" aria-hidden />
        <div className="reel-fade reel-fade-right" aria-hidden />
        <div className="reel-track" ref={trackRef}>
          {boxes.map((box, i) => {
            const mult = Number(box.multiplier)
            return (
              <div
                key={i}
                className={`slide-box ${toneClass(box.tone)} ${
                  i === highlight ? 'is-winner' : ''
                }`}
                style={{ width: BOX_WIDTH }}
              >
                <div className="hex">
                  <span>{formatMultiplier(mult)}</span>
                </div>
                <div className="box-bar" />
              </div>
            )
          })}
        </div>
        <div className="pin" aria-hidden>
          <span className="pin-line" />
          <span className="pin-dot" />
        </div>
      </div>
    </div>
  )
}
