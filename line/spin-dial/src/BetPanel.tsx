interface BetPanelProps {
  balance: number
  bet: number
  busy: boolean
  playing?: boolean
  onBetChange: (v: number) => void
  onPlay: () => void
  lastPayout: number | null
  lastMultiplier: number | null
}

function money(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function BetPanel({
  balance, bet, busy, playing = false, onBetChange, onPlay, lastPayout, lastMultiplier,
}: BetPanelProps) {
  const clamp = (v: number) => onBetChange(Math.min(balance, Math.max(1, Math.round(v * 100) / 100)))
  return (
    <div className="bet-panel">
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Balance</span>
          <span className="stat-value">₹{money(balance)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Last win</span>
          <span className={`stat-value${lastPayout && lastPayout > 0 ? ' win' : ''}`}>
            {lastMultiplier === null ? '—' : lastPayout && lastPayout > 0 ? `+₹${money(lastPayout)}` : `${lastMultiplier.toFixed(2)}x`}
          </span>
        </div>
      </div>
      <div className="bet-controls">
        <label className="bet-label" htmlFor="bet">Bet amount</label>
        <div className="bet-input-row">
          <button type="button" className="chip" disabled={busy} onClick={() => clamp(bet / 2)}>½</button>
          <div className="bet-field">
            <span className="bet-currency">₹</span>
            <input id="bet" type="number" min={1} value={bet} disabled={busy} onChange={(e) => clamp(Number(e.target.value) || 1)} />
          </div>
          <button type="button" className="chip" disabled={busy} onClick={() => clamp(bet * 2)}>2×</button>
        </div>
      </div>
      <button type="button" className="spin-btn" disabled={busy || bet > balance || bet < 1} onClick={onPlay}>
        {playing ? 'Spinning…' : 'Bet'}
      </button>
    </div>
  )
}
