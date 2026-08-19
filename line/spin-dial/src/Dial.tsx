import type { Segment } from './gameConfig'

const SIZE = 340
const CX = SIZE / 2
const CY = SIZE * 0.62
const R_OUT = 140
const R_IN = 100

function polar(deg: number, r: number) {
  const rad = ((180 - deg) * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) }
}

function wedge(angle: number, span: number) {
  const a0 = angle - span / 2
  const a1 = angle + span / 2
  const o0 = polar(a0, R_OUT)
  const o1 = polar(a1, R_OUT)
  const i1 = polar(a1, R_IN)
  const i0 = polar(a0, R_IN)
  const large = span > 180 ? 1 : 0
  return `M ${o0.x} ${o0.y} A ${R_OUT} ${R_OUT} 0 ${large} 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${R_IN} ${R_IN} 0 ${large} 0 ${i0.x} ${i0.y} Z`
}

interface DialProps {
  segments: Segment[]
  rotation: number
  spinning: boolean
  resultMultiplier: number | null
  resultColor: string | null
  resultPayout: number | null
}

export function Dial({
  segments,
  rotation,
  spinning,
  resultMultiplier,
  resultColor,
  resultPayout,
}: DialProps) {
  return (
    <div className="dial-stage">
      {resultMultiplier !== null && resultMultiplier > 0 && (
        <div className="win-callout" style={{ color: resultColor ?? '#fff' }}>
          <span className="win-mult">{resultMultiplier.toFixed(2)}x</span>
          {resultPayout !== null && (
            <span className="win-payout">
              +₹{resultPayout.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
        </div>
      )}

      <div className="dial-wrap">
        <svg viewBox={`0 0 ${SIZE} ${SIZE * 0.75}`} className="dial-svg" aria-hidden>
          {/* Fixed pointer at top — tip points down into the dial */}
          <polygon points={`${CX},36 ${CX - 10},16 ${CX + 10},16`} fill="#ef4444" />

          <g
            className={spinning ? 'dial-rotor spinning' : 'dial-rotor'}
            style={{
              transform: `rotate(${rotation}deg)`,
              transformOrigin: `${CX}px ${CY}px`,
            }}
          >
            {/* Base arc */}
            <path
              d={`M ${polar(180, (R_OUT + R_IN) / 2).x} ${polar(180, (R_OUT + R_IN) / 2).y} A ${(R_OUT + R_IN) / 2} ${(R_OUT + R_IN) / 2} 0 0 1 ${polar(0, (R_OUT + R_IN) / 2).x} ${polar(0, (R_OUT + R_IN) / 2).y}`}
              fill="none"
              stroke="#2f3847"
              strokeWidth={R_OUT - R_IN}
              strokeLinecap="butt"
            />
            {segments.map((s) => (
              <path key={s.id} d={wedge(s.angle, s.span)} fill={s.color} stroke="#1a252f" strokeWidth={1} />
            ))}
          </g>
        </svg>
      </div>
    </div>
  )
}
