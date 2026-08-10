import { useEffect, useRef } from 'react'
import type { ReelBox } from '../api/client'
import { formatMultiplier } from '../game/format'
import { Gem } from './Gem'

/** Keep in sync with `.reel-track` gap + `.case-box` width in App.css */
const BOX_WIDTH = 128
const BOX_GAP = 12
const STRIDE = BOX_WIDTH + BOX_GAP
const SPIN_MS = 7000
const KEYFRAMES = 48

type Props = {
  reel: ReelBox[]
  winIndex: number | null
  spinning: boolean
  opened: boolean
  spinId: number
  onSpinEnd?: () => void
}

function toneClass(tone: string) {
  return `tone-${tone || 'cyan'}`
}

function readTranslateX(el: HTMLElement): number {
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return 0
  const m = new DOMMatrixReadOnly(t)
  return m.m41
}

/** Move track so box[winIndex] center sits exactly on the pin center. */
function alignBoxToPin(
  track: HTMLElement,
  viewport: HTMLElement,
  winIndex: number,
): number {
  const box = track.children[winIndex] as HTMLElement | undefined
  const pin = viewport.querySelector('.pin') as HTMLElement | null
  if (!box || !pin) {
    const pinX = viewport.clientWidth / 2
    return -(winIndex * STRIDE + BOX_WIDTH / 2 - pinX)
  }

  const currentX = readTranslateX(track)
  const boxRect = box.getBoundingClientRect()
  const pinRect = pin.getBoundingClientRect()
  const boxCenter = boxRect.left + boxRect.width / 2
  const pinCenter = pinRect.left + pinRect.width / 2
  return currentX + (pinCenter - boxCenter)
}

function estimateEndOffset(winIndex: number, viewportWidth: number) {
  const pinX = viewportWidth / 2
  return -(winIndex * STRIDE + BOX_WIDTH / 2 - pinX)
}

function smoothSlideProgress(t: number): number {
  const x = Math.min(1, Math.max(0, t))
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

export function Reel({
  reel,
  winIndex,
  spinning,
  opened,
  spinId,
  onSpinEnd,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const onSpinEndRef = useRef(onSpinEnd)
  const animRef = useRef<Animation | null>(null)
  onSpinEndRef.current = onSpinEnd

  useEffect(() => {
    const track = trackRef.current
    const viewport = viewportRef.current
    if (!track || !viewport || winIndex == null || !reel.length) return

    animRef.current?.cancel()
    animRef.current = null

    // Idle / after land — snap with real pin measurement
    if (!spinning) {
      track.style.transform = 'translate3d(0px, 0, 0)'
      // Force layout, then correct to pin
      void track.offsetWidth
      const x = alignBoxToPin(track, viewport, winIndex)
      track.style.transform = `translate3d(${x}px, 0, 0)`
      return
    }

    const from = 28
    // Estimate first; we re-measure on finish for pixel-perfect pin lock
    const estimatedTo = estimateEndOffset(winIndex, viewport.clientWidth)
    track.style.transform = `translate3d(${from}px, 0, 0)`

    const anim = track.animate(buildKeyframes(from, estimatedTo), {
      duration: SPIN_MS,
      easing: 'linear',
      fill: 'forwards',
      composite: 'replace',
    })
    animRef.current = anim

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      anim.cancel()
      // Commit estimated end, then correct using live box/pin rects
      track.style.transform = `translate3d(${estimatedTo}px, 0, 0)`
      void track.offsetWidth
      const exact = alignBoxToPin(track, viewport, winIndex)
      track.style.transform = `translate3d(${exact}px, 0, 0)`
      onSpinEndRef.current?.()
    }

    const timer = window.setTimeout(finish, SPIN_MS)
    anim.finished.catch(() => {})

    return () => {
      window.clearTimeout(timer)
      anim.cancel()
      if (animRef.current === anim) animRef.current = null
    }
  }, [spinning, spinId, winIndex, reel.length])

  const boxes = reel.length
    ? reel
    : Array.from({ length: 12 }, (_, i) => ({
        multiplier: '1.00',
        tone: i % 2 === 0 ? 'cyan' : 'blue',
      }))

  const openIndex =
    !spinning && opened && winIndex != null && winIndex >= 0 ? winIndex : -1

  return (
    <div className={`reel-stage ${spinning ? 'is-spinning' : ''}`}>
      <div className="reel-viewport" ref={viewportRef}>
        <div className="reel-fade reel-fade-left" aria-hidden />
        <div className="reel-fade reel-fade-right" aria-hidden />
        <div className="reel-track" ref={trackRef}>
          {boxes.map((box, i) => {
            const isOpen = i === openIndex
            const mult = Number(box.multiplier)
            return (
              <div
                key={i}
                className={[
                  'case-box',
                  toneClass(box.tone),
                  isOpen ? 'is-open' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ width: BOX_WIDTH, flex: `0 0 ${BOX_WIDTH}px` }}
                data-index={i}
                data-open={isOpen ? 'true' : undefined}
              >
                <div className="case-lid">
                  <span className="lid-window" />
                </div>
                <div className="case-body">
                  <span className="body-latch" />
                </div>
                {isOpen ? (
                  <div className="case-reveal">
                    <div className="prize">
                      <Gem tone={box.tone} size={52} />
                    </div>
                    <div className="ratio-badge">
                      {formatMultiplier(mult)}
                    </div>
                  </div>
                ) : null}
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
