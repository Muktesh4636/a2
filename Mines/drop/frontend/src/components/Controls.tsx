import { formatMoney, formatMultiplier } from '../game/format'

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
      </label>

      {lastStatus && lastMultiplier != null && lastProfit != null && (
        <div className="stats">
          <div>
            <span>Landed</span>
            <strong>{formatMultiplier(lastMultiplier)}</strong>
          </div>
          <div>
            <span>Profit</span>
            <strong className={lastProfit >= 0 ? 'profit' : 'loss'}>
              {lastProfit >= 0 ? '+' : ''}
              {formatMoney(lastProfit)}
            </strong>
          </div>
        </div>
      )}

      {lastStatus === 'won' && (
        <div className="status-banner status-banner--won">
          Won {formatMultiplier(lastMultiplier ?? 1)}
        </div>
      )}

      <button
        type="button"
        className="primary-btn"
        disabled={busy || betAmount <= 0 || betAmount > balance}
        onClick={onPlay}
      >
        {busy ? 'Sliding…' : `Bet ${formatMoney(betAmount)}`}
      </button>

      <p className="hint">
        Place a bet — boxes slide past the pin. When they stop, the box under the
        pin pays that multiplier.
      </p>
    </aside>
  )
}
