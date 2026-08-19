import { OUTCOMES, type MultiplierKey } from './gameConfig'

interface MultiplierBarProps {
  lastMultiplier: MultiplierKey | null
  highlighted: MultiplierKey | null
}

export function MultiplierBar({ lastMultiplier, highlighted }: MultiplierBarProps) {
  return (
    <div className="multiplier-bar" role="list">
      {OUTCOMES.map((o) => {
        const active =
          highlighted === o.multiplier || lastMultiplier === o.multiplier
        return (
          <div
            key={o.id}
            role="listitem"
            className={`mult-btn${active ? ' active' : ''}`}
            style={{ ['--accent' as string]: o.color }}
          >
            <span className="mult-label">{o.label}</span>
            <span className="mult-accent" />
          </div>
        )
      })}
    </div>
  )
}
