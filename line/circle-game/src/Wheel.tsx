import type { Segment } from './gameConfig'
import { RING_COLOR } from './gameConfig'

interface WheelProps {
  segments: Segment[]
  rotation: number
  spinning: boolean
}

const SIZE = 340
const CX = SIZE / 2
const CY = SIZE / 2
const OUTER_R = 148
const INNER_R = 118
const MID_R = (OUTER_R + INNER_R) / 2

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function tilePath(angle: number, span: number): string {
  const half = span / 2
  const a0 = angle - half
  const a1 = angle + half
  const o0 = polar(CX, CY, OUTER_R, a0)
  const o1 = polar(CX, CY, OUTER_R, a1)
  const i1 = polar(CX, CY, INNER_R, a1)
  const i0 = polar(CX, CY, INNER_R, a0)
  return `M ${o0.x} ${o0.y} A ${OUTER_R} ${OUTER_R} 0 0 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${INNER_R} ${INNER_R} 0 0 0 ${i0.x} ${i0.y} Z`
}

export function Wheel({ segments, rotation, spinning }: WheelProps) {
  return (
    <div className="wheel-wrap">
      {/* Fixed pointer */}
      <svg
        className="pointer-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        aria-hidden
      >
        {/* Tip points down into the ring */}
        <path
          d={`M ${CX} 30 L ${CX - 9} 10 L ${CX + 9} 10 Z`}
          fill="#ef4444"
        />
        <circle cx={CX} cy={16} r={3.2} fill="#ef4444" />
      </svg>

      {/* Rotating ring */}
      <div
        className={spinning ? 'wheel-rotor spinning' : 'wheel-rotor'}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-hidden>
          <circle
            cx={CX}
            cy={CY}
            r={MID_R}
            fill="none"
            stroke={RING_COLOR}
            strokeWidth={OUTER_R - INNER_R}
          />
          <circle
            cx={CX}
            cy={CY}
            r={OUTER_R}
            fill="none"
            stroke="#3a4553"
            strokeWidth={1.5}
            opacity={0.5}
          />
          <circle
            cx={CX}
            cy={CY}
            r={INNER_R}
            fill="none"
            stroke="#3a4553"
            strokeWidth={1.5}
            opacity={0.5}
          />
          {segments.map((seg) => (
            <path
              key={seg.id}
              d={tilePath(seg.angle, seg.span)}
              fill={seg.color}
              stroke="#1a252f"
              strokeWidth={1.5}
            />
          ))}
          <circle
            cx={CX}
            cy={CY}
            r={72}
            fill="none"
            stroke="#2a3441"
            strokeWidth={1}
          />
          <circle cx={CX} cy={CY} r={4} fill="#2a3441" />
        </svg>
      </div>
    </div>
  )
}
