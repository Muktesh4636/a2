import { Dragon } from './Dragon'
import { StepCell } from './StepCell'
import type { ApiCell, ApiGame } from '../api/client'
import { formatMoney, formatMultiplier } from '../game/format'

type Props = {
  board: ApiCell[][]
  status: ApiGame['status'] | 'idle'
  multiplier: number
  payout: number
  showPayout: boolean
  onChoose: (column: number) => void
}

export function Board({
  board,
  status,
  multiplier,
  payout,
  showPayout,
  onChoose,
}: Props) {
  const playing = status === 'playing'

  return (
    <div className="board-stage">
      <Dragon />
      <div className="stone-frame">
        <div className="board" role="grid" aria-label="Sky Path board">
          {board.map((row, rowIndex) => (
            <div className="board-row" role="row" key={rowIndex}>
              {row.map((cell, colIndex) => (
                <StepCell
                  key={`${rowIndex}-${colIndex}`}
                  cell={cell}
                  disabled={!playing}
                  onClick={() => onChoose(colIndex)}
                />
              ))}
            </div>
          ))}
        </div>

        {showPayout && (
          <div className="payout-card" role="status">
            <strong>{formatMultiplier(multiplier)}</strong>
            <hr />
            <span>{formatMoney(payout)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
