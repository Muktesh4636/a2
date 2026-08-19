import { colorOf, type ColorId } from './gameConfig'

interface ReelProps {
  strip: ColorId[]
  /** pixel offset of the strip (negative = scrolled up) */
  offsetY: number
  spinning: boolean
  cellSize: number
  gap: number
}

export function Reel({ strip, offsetY, spinning, cellSize, gap }: ReelProps) {
  return (
    <div className="reel-window" style={{ height: cellSize * 5 + gap * 4, width: cellSize }}>
      <div
        className={`reel-strip${spinning ? ' is-spinning' : ''}`}
        style={{
          transform: `translateY(${offsetY}px)`,
          gap,
        }}
      >
        {strip.map((id, i) => (
          <div
            key={`${id}-${i}`}
            className="reel-cell"
            style={{
              width: cellSize,
              height: cellSize,
              background: colorOf(id),
              boxShadow:
                id === 'white'
                  ? 'inset 0 0 12px rgba(255,255,255,0.35), 0 0 10px rgba(255,255,255,0.15)'
                  : `inset 0 -6px 14px rgba(0,0,0,0.35), 0 0 12px ${colorOf(id)}44`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
