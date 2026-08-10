import { formatMoney, formatMultiplier } from '../game/format'
import type { ApiGame } from '../api/client'

type Props = {
  balance: number
  betAmount: number
  stepsCleared: number
  multiplier: number
  profit: number
  status: ApiGame['status'] | 'idle'
  onBetChange: (value: number) => void
  onStart: () => void
  onCashOut: () => void
}

export function Controls({
  balance,
  betAmount,
  stepsCleared,
  multiplier,
  profit,
  status,
  onBetChange,
  onStart,
  onCashOut,
}: Props) {
  const playing = status === 'playing'
  const canCashOut = playing && stepsCleared > 0

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
            disabled={playing}
            onChange={(e) => onBetChange(Number(e.target.value))}
          />
          <div className="quick-btns">
            <button
              type="button"
              disabled={playing}
              onClick={() => onBetChange(Math.max(1, Math.floor(betAmount / 2)))}
            >
              ½
            </button>
            <button
              type="button"
              disabled={playing}
              onClick={() => onBetChange(betAmount * 2)}
            >
              2×
            </button>
          </div>
        </div>
      </label>

      {playing && (
        <div className="stats">
          <div>
            <span>Steps</span>
            <strong>{stepsCleared} / 9</strong>
          </div>
          <div>
            <span>Multiplier</span>
            <strong>{formatMultiplier(multiplier)}</strong>
          </div>
          <div>
            <span>Profit</span>
            <strong className="profit">+{formatMoney(profit)}</strong>
          </div>
        </div>
      )}

      {status === 'lost' && (
        <div className="status-banner status-banner--lost">
          You hit danger! Bet lost. Full route revealed.
        </div>
      )}
      {status === 'cashed' && (
        <div className="status-banner status-banner--won">
          Cashed out +{formatMoney(profit)}
        </div>
      )}
      {status === 'won' && (
        <div className="status-banner status-banner--won">
          Reached the top! +{formatMoney(profit)}
        </div>
      )}

      {playing ? (
        <button
          type="button"
          className="primary-btn cashout-btn"
          disabled={!canCashOut}
          onClick={onCashOut}
        >
          {canCashOut
            ? `Cash Out ${formatMoney(betAmount + profit)}`
            : 'Take a step to cash out'}
        </button>
      ) : (
        <button
          type="button"
          className="primary-btn"
          disabled={betAmount <= 0 || betAmount > balance}
          onClick={onStart}
        >
          Bet
        </button>
      )}

      <p className="hint">
        {playing
          ? 'Click a bright green step on the board to climb. Cash out anytime to lock profit.'
          : 'Press Bet first, then click a green step on the bottom row to start climbing.'}
      </p>
    </aside>
  )
}
