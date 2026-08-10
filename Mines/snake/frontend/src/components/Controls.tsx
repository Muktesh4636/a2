import { formatMoney, formatMultiplier } from '../game/format'

const BET_PRESETS = [10, 50, 100, 200, 500, 1000]

type Props = {
  balance: number
  betAmount: number
  busy: boolean
  lastProfit: number | null
  lastMultiplier: number | null
  lastStatus: 'won' | 'lost' | null
  onBetChange: (value: number) => void
  onPlay: () => void
}

export function Controls({
  balance,
  betAmount,
  busy,
  lastProfit,
  lastMultiplier,
  lastStatus,
  onBetChange,
  onPlay,
}: Props) {
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
            disabled={busy}
            onChange={(e) => onBetChange(Number(e.target.value))}
          />
          <div className="quick-btns">
            <button
              type="button"
              disabled={busy}
              onClick={() => onBetChange(Math.max(1, Math.floor(betAmount / 2)))}
            >
              ½
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onBetChange(betAmount * 2)}
            >
              2×
            </button>
          </div>
        </div>
        <div className="bet-presets" role="group" aria-label="Quick bet amounts">
          {BET_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              className={betAmount === n ? 'is-active' : ''}
              disabled={busy || n > balance}
              onClick={() => onBetChange(n)}
              aria-pressed={betAmount === n}
            >
              ₹{n}
            </button>
          ))}
        </div>
      </label>

      <button
        type="button"
        className="primary-btn"
        disabled={busy || betAmount <= 0 || betAmount > balance}
        onClick={onPlay}
      >
        {busy ? 'Rolling…' : `Bet ${formatMoney(betAmount)}`}
      </button>

      <p className="hint">
        Place a bet to roll two dice. The green marker moves clockwise from Play —
        like Ludo. Land on a multiplier for that profit, or hit a snake and lose.
      </p>

      {(lastStatus === 'lost' || lastStatus === 'won') && (
        <>
          {lastStatus === 'lost' && (
            <div className="status-banner status-banner--lost">Hit the snake — bet lost.</div>
          )}
          {lastStatus === 'won' && (
            <div className="status-banner status-banner--won">
              Won {formatMultiplier(lastMultiplier ?? 1)}
            </div>
          )}
          <div className="stats">
            <div>
              <span>Landed</span>
              <strong>
                {lastStatus === 'lost' ? 'Snake' : formatMultiplier(lastMultiplier ?? 1)}
              </strong>
            </div>
            <div>
              <span>Profit</span>
              <strong className={(lastProfit ?? 0) >= 0 ? 'profit' : 'loss'}>
                {(lastProfit ?? 0) >= 0 ? '+' : ''}
                {formatMoney(lastProfit ?? 0)}
              </strong>
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
