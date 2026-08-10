import { formatMoney, formatMultiplier } from '../game/format'
import type { ApiGame } from '../api/client'

type Props = {
  balance: number
  betAmount: number
  selectedCount: number
  pickCount: number
  status: ApiGame['status'] | 'idle'
  totalMultiplier: number
  payout: number
  profit: number
  onBetChange: (value: number) => void
  onBet: () => void
  onNewRound: () => void
}

export function Controls({
  balance,
  betAmount,
  selectedCount,
  pickCount,
  status,
  totalMultiplier,
  payout,
  profit,
  onBetChange,
  onBet,
  onNewRound,
}: Props) {
  const selecting = status === 'selecting' || status === 'idle'
  const canBet = selecting && selectedCount === pickCount && betAmount > 0 && betAmount <= balance

  return (
    <aside className="controls">
<label className="field">
        <span>Bet Amount</span>
        <div className="field-row">
          <span className="prefix">₹</span>
          <input
            type="number"
            min={1}
            step={1}
            value={betAmount}
            disabled={!selecting}
            onChange={(e) => onBetChange(Number(e.target.value))}
          />
          <div className="quick-btns">
            <button
              type="button"
              disabled={!selecting}
              onClick={() => onBetChange(Math.max(1, Math.floor(betAmount / 2)))}
            >
              ½
            </button>
            <button
              type="button"
              disabled={!selecting}
              onClick={() => onBetChange(betAmount * 2)}
            >
              2×
            </button>
          </div>
        </div>
      </label>

      <div className="stats">
        <div>
          <span>Selected</span>
          <strong>
            {selectedCount} / {pickCount}
          </strong>
        </div>
        {status === 'settled' && (
          <>
            <div>
              <span>Total ratio</span>
              <strong>{formatMultiplier(totalMultiplier)}</strong>
            </div>
            <div>
              <span>Payout</span>
              <strong className="profit">{formatMoney(payout)}</strong>
            </div>
            <div>
              <span>Profit</span>
              <strong className={profit >= 0 ? 'profit' : 'loss'}>
                {profit >= 0 ? '+' : ''}
                {formatMoney(profit)}
              </strong>
            </div>
          </>
        )}
      </div>

      {selecting ? (
        <button type="button" className="primary-btn" disabled={!canBet} onClick={onBet}>
          {selectedCount < pickCount
            ? `Select ${pickCount - selectedCount} more`
            : `Bet ${formatMoney(betAmount)}`}
        </button>
      ) : (
        <button type="button" className="primary-btn" onClick={onNewRound}>
          Play again
        </button>
      )}

      <p className="hint">
        Select exactly 4 boxes, place your bet, then see the ratios on the board.
        Your payout is bet × sum of the four selected ratios.
      </p>
    </aside>
  )
}
