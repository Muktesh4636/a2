import { OUTCOMES, type MultiplierKey } from './gameConfig'

export function MultiplierBar({ highlighted }: { highlighted: MultiplierKey | null }) {
  return (
    <div className="multiplier-bar" role="list">
      {OUTCOMES.map((o) => (
        <div
          key={o.id}
          role="listitem"
          className={`mult-btn${highlighted === o.multiplier ? ' active' : ''}`}
          style={{ ['--accent' as string]: o.color }}
        >
          <span className="mult-label">{o.label}</span>
          <span className="mult-accent" />
        </div>
      ))}
    </div>
  )
}
