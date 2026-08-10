import { formatMoney, formatMultiplier } from '../game/logic'
import type { GameStatus } from '../game/logic'

type Props = {
  balance: number
  betAmount: number
  mineCount: number
  gemsFound: number
  multiplier: number
  profit: number
  status: GameStatus
  onBetChange: (value: number) => void
  onMineCountChange: (value: number) => void
  onStart: () => void
  onCashOut: () => void
}

const MINE_PRESETS = [1, 3, 5, 10, 24]

export function Controls({
  balance,
  betAmount,
  mineCount,
  gemsFound,
  multiplier,
  profit,
  status,
  onBetChange,
  onMineCountChange,
  onStart,
  onCashOut,
}: Props) {
  const playing = status === 'playing'
  const canCashOut = playing && gemsFound > 0

  return (
    <aside className="controls">
<label className="field">
        <span>Bet Amount</span>
        <div className="field-row">
          <span className="prefix">₹</span>
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={betAmount}
            disabled={playing}
            onChange={(e) => onBetChange(Number(e.target.value))}
          />
          <div className="quick-btns">
            <button
              type="button"
              disabled={playing}
              onClick={() => onBetChange(Math.max(0.01, +(betAmount / 2).toFixed(2)))}
            >
              ½
            </button>
            <button
              type="button"
              disabled={playing}
              onClick={() => onBetChange(+(betAmount * 2).toFixed(2))}
            >
              2×
            </button>
          </div>
        </div>
      </label>

      <div className="field">
        <span>Mines</span>
        <div className="mine-presets">
          {MINE_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              className={mineCount === n ? 'is-active' : ''}
              disabled={playing}
              onClick={() => onMineCountChange(n)}
              aria-pressed={mineCount === n}
            >
              {n}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={1}
          max={24}
          value={mineCount}
          disabled={playing}
          aria-label="Number of mines"
          onChange={(e) => onMineCountChange(Number(e.target.value))}
        />
        <div className="mine-meta">
          <span>{mineCount} mines</span>
          <span>{25 - mineCount} gems</span>
        </div>
      </div>

      {playing && (
        <div className="stats">
          <div>
            <span>Multiplier</span>
            <strong>{formatMultiplier(multiplier)}</strong>
          </div>
          <div>
            <span>Profit</span>
            <strong className="profit">+{formatMoney(profit)}</strong>
          </div>
          <div>
            <span>Gems found</span>
            <strong>{gemsFound}</strong>
          </div>
        </div>
      )}

      {status === 'lost' && (
        <div className="status-banner status-banner--lost">
          Boom! You hit a mine. Bet lost.
        </div>
      )}

      {status === 'cashed' && (
        <div className="status-banner status-banner--won">
          Cashed out +{formatMoney(profit)}
        </div>
      )}

      {status === 'won' && (
        <div className="status-banner status-banner--won">
          Cleared the board! +{formatMoney(profit)}
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
            : 'Pick a gem to cash out'}
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
        Click tiles to find diamonds. Each gem raises your profit. Hit a bomb and
        the bet is gone — cash out anytime to lock in winnings.
      </p>
    </aside>
  )
}
