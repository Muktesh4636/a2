import type { ApiCell } from '../api/client'
import { formatMoney, formatMultiplier } from '../game/format'

type Props = {
  board: ApiCell[]
  cols: number
  status: 'selecting' | 'settled' | 'idle'
  totalMultiplier: number
  payout: number
  onToggle: (index: number) => void
  onUnlockAudio?: () => void
}

export function Board({
  board,
  cols,
  status,
  totalMultiplier,
  payout,
  onToggle,
  onUnlockAudio,
}: Props) {
  const selecting = status === 'selecting' || status === 'idle'
  const showResult = status === 'settled'

  return (
    <div className="board-wrap">
      <div
        className="board"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="Pick 4 board"
      >
        {board.map((cell) => {
          const classes = ['box-cell']
          if (cell.selected) classes.push('is-selected')
          if (showResult) classes.push('is-revealed')
          if (cell.highlight && showResult && !cell.selected) classes.push('is-hot')

          return (
            <button
              key={cell.index}
              type="button"
              className={classes.join(' ')}
              disabled={!selecting}
              onPointerDown={() => onUnlockAudio?.()}
              onClick={() => onToggle(cell.index)}
              aria-pressed={cell.selected}
              aria-label={
                cell.multiplier
                  ? `Box ${cell.index + 1}, ${cell.multiplier}x`
                  : `Box ${cell.index + 1}`
              }
            >
              {cell.multiplier && (
                <span className="box-mult">{Number(cell.multiplier).toFixed(2)}x</span>
              )}
            </button>
          )
        })}
      </div>

      {showResult && (
        <div className="payout-card" role="status">
          <strong>{formatMultiplier(totalMultiplier)}</strong>
          <hr />
          <span>{formatMoney(payout)}</span>
        </div>
      )}
    </div>
  )
}
