import { OUTCOMES, type MultiplierKey } from './gameConfig'

interface MultiplierBarProps {
  highlighted: MultiplierKey | null
}

export function MultiplierBar({ highlighted }: MultiplierBarProps) {
  return (
    <div className="multiplier-bar" role="list">
      {OUTCOMES.map((o) => {
        const active = highlighted === o.multiplier
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
