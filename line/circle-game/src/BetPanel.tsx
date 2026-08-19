interface BetPanelProps {
  balance: number
  bet: number
  spinning: boolean
  onBetChange: (value: number) => void
  onSpin: () => void
  lastPayout: number | null
  lastMultiplier: number | null
}

function formatMoney(n: number) {
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function BetPanel({
  balance,
  bet,
  spinning,
  onBetChange,
  onSpin,
  lastPayout,
  lastMultiplier,
}: BetPanelProps) {
  const clampBet = (v: number) =>
    onBetChange(Math.min(balance, Math.max(1, Math.round(v * 100) / 100)))

  return (
    <div className="bet-panel">
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Balance</span>
          <span className="stat-value">₹{formatMoney(balance)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Last win</span>
          <span
            className={`stat-value${lastPayout && lastPayout > 0 ? ' win' : ''}`}
          >
            {lastMultiplier === null
              ? '—'
              : lastPayout && lastPayout > 0
                ? `+₹${formatMoney(lastPayout)}`
                : `${lastMultiplier.toFixed(2)}x`}
          </span>
        </div>
      </div>

      <div className="bet-controls">
        <label className="bet-label" htmlFor="bet-amount">
          Bet amount
        </label>
        <div className="bet-input-row">
          <button
            type="button"
            className="chip"
            disabled={spinning}
            onClick={() => clampBet(bet / 2)}
          >
            ½
          </button>
          <div className="bet-field">
            <span className="bet-currency" aria-hidden>
              ₹
            </span>
            <input
              id="bet-amount"
              type="number"
              min={1}
              step={1}
              value={bet}
              disabled={spinning}
              onChange={(e) => clampBet(Number(e.target.value) || 1)}
            />
          </div>
          <button
            type="button"
            className="chip"
            disabled={spinning}
            onClick={() => clampBet(bet * 2)}
          >
            2×
          </button>
        </div>
      </div>

      <button
        type="button"
        className="spin-btn"
        disabled={spinning || bet > balance || bet < 1}
        onClick={onSpin}
      >
        {spinning ? 'Spinning…' : 'Bet'}
      </button>
    </div>
  )
}
