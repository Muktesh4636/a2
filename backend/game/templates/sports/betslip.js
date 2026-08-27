/* Floating bet slip — place sports/cricket bets via Gundu wallet JWT */
(function (global) {
  const STAKES = [50, 100, 200, 500, 1000];
  const state = { pick: null, stake: 100, busy: false, openBets: [], betsUrl: '', cashOutBusy: null };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function token() {
    return global.GunduSportsAuth && GunduSportsAuth.getAccessToken
      ? GunduSportsAuth.getAccessToken()
      : '';
  }

  function injectStyles() {
    if (document.getElementById('gundu-betslip-style')) return;
    const s = document.createElement('style');
    s.id = 'gundu-betslip-style';
    s.textContent = `
      .betslip-panel {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 200;
        max-width: 480px; margin: 0 auto;
        background: #161b22; border-top: 1px solid #3a4556;
        box-shadow: 0 -12px 32px rgba(0,0,0,.55);
        border-radius: 16px 16px 0 0;
        padding: 12px 14px calc(12px + env(safe-area-inset-bottom, 0px));
        transform: translateY(110%);
        transition: transform .22s ease;
        pointer-events: auto;
      }
      .betslip-panel.open { transform: translateY(0); }
      .betslip-backdrop {
        position: fixed; inset: 0; z-index: 199;
        background: rgba(0, 0, 0, 0.45);
        opacity: 0; pointer-events: none;
        transition: opacity .2s ease;
      }
      .betslip-backdrop.open { opacity: 1; pointer-events: auto; }
      body.betslip-open { padding-bottom: 210px; }
      .betslip-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .betslip-head h3 { margin: 0; font-size: 15px; color: #d4af37; letter-spacing: .04em; }
      .betslip-close { border: 0; background: none; color: #9aa3af; font-size: 22px; cursor: pointer; line-height: 1; }
      .betslip-pick { font-size: 13px; line-height: 1.35; color: #e8edf3; margin-bottom: 8px; }
      .betslip-pick .muted { color: #9aa3af; font-size: 12px; }
      .betslip-odds { color: #76c7ed; font-weight: 800; font-size: 18px; margin-bottom: 10px; }
      .betslip-chips { display: flex; gap: 8px; overflow-x: auto; margin-bottom: 10px; }
      .betslip-chips::-webkit-scrollbar { display: none; }
      .betslip-chip {
        flex: 0 0 auto; border: 1px solid #3a4556; background: #1c222e; color: #fff;
        border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer;
      }
      .betslip-chip.on { border-color: #d4af37; color: #d4af37; background: #2a2418; }
      .betslip-stake-row { display: flex; gap: 8px; margin-bottom: 10px; }
      .betslip-stake-row input {
        flex: 1; border: 1px solid #3a4556; background: #0d1117; color: #fff;
        border-radius: 10px; padding: 10px 12px; font-size: 15px; font-weight: 700;
      }
      .betslip-return { font-size: 12px; color: #9aa3af; margin-bottom: 10px; }
      .betslip-return strong { color: #81c784; }
      .betslip-place {
        width: 100%; border: 0; border-radius: 12px; padding: 14px;
        background: linear-gradient(180deg, #ffd54f, #d4af37); color: #111;
        font-size: 15px; font-weight: 800; cursor: pointer;
      }
      .betslip-place:disabled { opacity: .55; cursor: not-allowed; }
      .betslip-msg { font-size: 12px; color: #e57373; min-height: 16px; margin-bottom: 6px; }
      .betslip-sheet {
        position: fixed; inset: 0; z-index: 210; background: rgba(0,0,0,.55);
        display: none; align-items: flex-end; justify-content: center;
      }
      .betslip-sheet.open { display: flex; }
      .betslip-sheet-body {
        width: 100%; max-width: 480px; max-height: 70vh; overflow: auto;
        background: #161b22; border-radius: 16px 16px 0 0; padding: 14px;
      }
      .betslip-bet-row {
        border: 1px solid #2a3340; border-radius: 10px; padding: 10px; margin-bottom: 8px;
        font-size: 12px; line-height: 1.35;
      }
      .betslip-bet-row .status { font-weight: 800; }
      .betslip-bet-row .status.PENDING { color: #d4af37; }
      .betslip-bet-row .status.WON { color: #81c784; }
      .betslip-bet-row .status.LOST { color: #e57373; }
      .betslip-bet-row .status.CASHED_OUT { color: #76c7ed; }
      .odd-btn.selected { outline: 2px solid #d4af37; outline-offset: 2px; }
      .market-head {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 10px; margin-bottom: 4px;
      }
      .market-head h4 { margin: 0; font-size: 15px; flex: 1; min-width: 0; }
      .market-bet-tags { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
      .market-bet-tag {
        display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
        background: #1c222e; border: 1px solid #3a4556; border-radius: 8px;
        padding: 6px 8px; font-size: 11px; line-height: 1.2;
      }
      .market-bet-tag .bet-out { color: #9aa3af; max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .market-bet-tag .bet-stake { color: #fff; font-weight: 800; }
      .market-bet-tag .bet-pnl { font-weight: 800; }
      .market-bet-tag .bet-pnl.pos { color: #81c784; }
      .market-bet-tag .bet-pnl.neg { color: #e57373; }
      .bet-cashout-btn {
        border: 0; border-radius: 6px; padding: 5px 8px; cursor: pointer;
        background: #2a2418; color: #d4af37; font-size: 10px; font-weight: 800;
      }
      .bet-cashout-btn:disabled { opacity: .55; cursor: not-allowed; }
    `;
    document.head.appendChild(s);
  }

  function backdrop() {
    injectStyles();
    let el = document.getElementById('betslipBackdrop');
    if (!el) {
      el = document.createElement('div');
      el.id = 'betslipBackdrop';
      el.className = 'betslip-backdrop';
      el.setAttribute('aria-hidden', 'true');
      el.onclick = () => close();
      document.body.appendChild(el);
    }
    return el;
  }

  function panel() {
    injectStyles();
    let el = document.getElementById('betslipPanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'betslipPanel';
      el.className = 'betslip-panel';
      el.innerHTML = `
        <div class="betslip-head">
          <h3>BET SLIP</h3>
          <button type="button" class="betslip-close" id="betslipClose" aria-label="Close">×</button>
        </div>
        <div class="betslip-pick" id="betslipPick"></div>
        <div class="betslip-odds" id="betslipOdds"></div>
        <div class="betslip-chips" id="betslipChips"></div>
        <div class="betslip-stake-row">
          <input type="number" id="betslipStake" min="1" step="1" inputmode="numeric" placeholder="Stake ₹" />
        </div>
        <div class="betslip-return" id="betslipReturn"></div>
        <div class="betslip-msg" id="betslipMsg"></div>
        <button type="button" class="betslip-place" id="betslipPlace">Place bet</button>`;
      document.body.appendChild(el);
      el.querySelector('#betslipClose').onclick = () => close();
      el.querySelector('#betslipPlace').onclick = () => placeBet();
      const stakeInput = el.querySelector('#betslipStake');
      stakeInput.addEventListener('input', () => {
        state.stake = Math.max(1, parseInt(stakeInput.value, 10) || 0);
        render();
      });
      const chips = el.querySelector('#betslipChips');
      chips.innerHTML = STAKES.map(amt => `<button type="button" class="betslip-chip" data-amt="${amt}">₹${amt}</button>`).join('');
      chips.querySelectorAll('.betslip-chip').forEach(btn => {
        btn.onclick = () => {
          state.stake = Number(btn.dataset.amt);
          render();
        };
      });
    }
    return el;
  }

  function parseOdds(raw) {
    const s = String(raw || '').trim();
    if (!s || s === '-') return null;
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      return Number.isFinite(n) && n > 1 ? n : null;
    }
    const ratio = s.match(/^(\d+)\s*:\s*(\d+)$/);
    if (ratio) {
      const left = Number(ratio[1]);
      const right = Number(ratio[2]);
      if (left > 0 && right >= 0) {
        if (left === right) return 2;
        if (left === 1) return 1 + right / 100;
        return 1 + right / left;
      }
    }
    const n = Number(s.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n > 1 ? n : null;
  }

  function cashOutAmount(stake, betOdds, currentOdds) {
    const s = Number(stake);
    const b = Number(betOdds);
    const c = Number(currentOdds);
    if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(b) || b <= 1 || !Number.isFinite(c) || c <= 1) {
      return 0;
    }
    return Math.max(0, Math.floor(s * b / c));
  }

  function cashOutPnl(stake, betOdds, currentOdds) {
    return cashOutAmount(stake, betOdds, currentOdds) - Number(stake || 0);
  }

  function currentOddsFor(outcomes, outcomeId) {
    const o = (outcomes || []).find(x =>
      Number(x.id) === Number(outcomeId) || Number(x.outcome_id) === Number(outcomeId)
    );
    if (!o) return null;
    const d = Number(o.price_decimal || o.decimal);
    if (Number.isFinite(d) && d > 1) return d;
    return parseOdds(o.price_formatted || o.price_format);
  }

  function cashOutUrl(betsUrl, betId) {
    const base = (betsUrl || state.betsUrl || '/api/cricket/bets/').replace(/\/?$/, '/');
    return base.replace(/bets\/$/, `bet/${betId}/cashout/`);
  }

  function notifyBetsChanged() {
    global.dispatchEvent(new CustomEvent('gundu:bets-changed'));
  }

  async function loadOpenBets(opts) {
    opts = opts || {};
    const auth = token();
    if (!auth) {
      state.openBets = [];
      return [];
    }
    const betsUrl = opts.betsUrl || state.betsUrl || document.body.dataset.betsUrl || '/api/cricket/bets/';
    state.betsUrl = betsUrl;
    const url = new URL(betsUrl, window.location.origin);
    if (opts.eventId) url.searchParams.set('event_id', String(opts.eventId));
    url.searchParams.set('status', 'PENDING');
    try {
      const r = await fetch(url.toString(), {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + auth },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Could not load bets');
      state.openBets = data.bets || [];
      return state.openBets;
    } catch (e) {
      state.openBets = [];
      return [];
    }
  }

  function aggregateBetsByOutcome(bets) {
    const map = new Map();
    for (const b of bets) {
      const key = Number(b.outcome_id);
      if (!map.has(key)) {
        map.set(key, {
          outcome_id: b.outcome_id,
          outcome_name: b.outcome_name,
          bets: [],
          totalStake: 0,
        });
      }
      const g = map.get(key);
      g.bets.push(b);
      g.totalStake += Number(b.stake) || 0;
    }
    return [...map.values()];
  }

  /** Two-sided markets: net stakes (Mumbai ₹400 − Chennai ₹100 → Mumbai ₹300). */
  function netMarketPositions(aggregates) {
    if (aggregates.length !== 2) return aggregates;
    const [a, b] = aggregates;
    const net = a.totalStake - b.totalStake;
    if (net === 0) return [];
    if (net > 0) {
      return [{
        ...a,
        totalStake: net,
        bets: [...a.bets, ...b.bets],
        isNet: true,
      }];
    }
    return [{
      ...b,
      totalStake: -net,
      bets: [...a.bets, ...b.bets],
      isNet: true,
    }];
  }

  function groupCashOutSummary(bets, outcomes) {
    let totalCo = 0;
    let totalStake = 0;
    let hasOdds = false;
    for (const b of bets) {
      const s = Number(b.stake) || 0;
      totalStake += s;
      const cur = currentOddsFor(outcomes, b.outcome_id);
      if (cur) {
        hasOdds = true;
        totalCo += cashOutAmount(b.stake, b.odds, cur);
      }
    }
    if (!hasOdds) return { totalCo: null, pnl: null };
    return { totalCo, pnl: totalCo - totalStake };
  }

  function marketBetsHtml(marketId, outcomes) {
    const bets = state.openBets.filter(b => Number(b.market_id) === Number(marketId) && b.status === 'PENDING');
    if (!bets.length) return '';
    const groups = netMarketPositions(aggregateBetsByOutcome(bets));
    if (!groups.length) return '';
    const tags = groups.map(g => {
      const { totalCo, pnl } = groupCashOutSummary(g.bets, outcomes);
      const pnlCls = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '';
      const pnlTxt = pnl == null ? '' : (pnl >= 0 ? `+₹${pnl}` : `-₹${Math.abs(pnl)}`);
      const betIds = g.bets.map(b => b.id).join(',');
      const busy = g.bets.some(b => state.cashOutBusy === b.id);
      const stakeLabel = g.isNet ? `₹${g.totalStake} net` : `₹${g.totalStake}`;
      return `<div class="market-bet-tag" data-bet-ids="${esc(betIds)}">
        <span class="bet-out" title="${esc(g.outcome_name)}">${esc(g.outcome_name)}</span>
        <span class="bet-stake">${stakeLabel}</span>
        ${pnlTxt ? `<span class="bet-pnl ${pnlCls}">${pnlTxt}</span>` : ''}
        ${totalCo != null ? `<button type="button" class="bet-cashout-btn" data-bet-ids="${esc(betIds)}" data-amount="${totalCo}" ${busy ? 'disabled' : ''}>Cancel · ₹${totalCo}</button>` : ''}
      </div>`;
    }).join('');
    return `<div class="market-bet-tags">${tags}</div>`;
  }

  function marketHeadHtml(title, marketId, outcomes) {
    const tags = marketBetsHtml(marketId, outcomes);
    if (!tags) return `<h4>${esc(title)}</h4>`;
    return `<div class="market-head"><h4>${esc(title)}</h4>${tags}</div>`;
  }

  async function cashOutBets(betIds, opts) {
    opts = opts || {};
    const ids = (betIds || []).filter(id => id != null && id !== '');
    if (!ids.length) return null;
    const amount = Number(opts.amount || 0);
    const label = amount > 0
      ? `Cancel ${ids.length > 1 ? ids.length + ' bets' : 'bet'} for ₹${amount}?`
      : `Cancel ${ids.length > 1 ? ids.length + ' bets' : 'this bet'}?`;
    if (!global.confirm(label)) return null;
    let total = 0;
    let last = null;
    for (const betId of ids) {
      last = await cashOutBet(betId, { ...opts, skipConfirm: true, quiet: true });
      if (!last) break;
      total += Number(last.cash_out_amount || 0);
    }
    if (last) {
      toast(`Cashed out · ₹${total || amount}`);
      if (global.GunduSportsAuth && GunduSportsAuth.loadWalletBalance) {
        GunduSportsAuth.loadWalletBalance('wallet');
      }
      await loadOpenBets({ betsUrl: opts.betsUrl, eventId: opts.eventId });
      notifyBetsChanged();
    }
    return last;
  }

  async function cashOutBet(betId, opts) {
    opts = opts || {};
    const auth = token();
    if (!auth) { toast('Login required'); return null; }
    if (state.cashOutBusy) return null;
    const amount = Number(opts.amount || 0);
    if (!opts.skipConfirm) {
      const label = amount > 0 ? `Cancel bet for ₹${amount}?` : 'Cancel this bet?';
      if (!global.confirm(label)) return null;
    }
    state.cashOutBusy = betId;
    try {
      const r = await fetch(cashOutUrl(opts.betsUrl, betId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'Bearer ' + auth,
        },
        body: '{}',
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || data.detail || `Cash out failed (${r.status})`);
      if (!opts.quiet) {
        toast(`Cashed out · ₹${data.cash_out_amount}`);
        if (global.GunduSportsAuth && GunduSportsAuth.loadWalletBalance) {
          GunduSportsAuth.loadWalletBalance('wallet');
        }
        await loadOpenBets({ betsUrl: opts.betsUrl, eventId: opts.eventId });
        notifyBetsChanged();
      }
      return data;
    } catch (e) {
      toast(e.message || 'Could not cash out');
      return null;
    } finally {
      state.cashOutBusy = null;
    }
  }

  function idsOk(pick) {
    return pick && Number.isFinite(pick.eventId) && pick.eventId > 0
      && Number.isFinite(pick.marketId) && pick.marketId > 0
      && Number.isFinite(pick.outcomeId) && pick.outcomeId > 0;
  }

  function render() {
    const el = panel();
    const pick = state.pick;
    if (!pick) return;
    el.classList.add('open');
    backdrop().classList.add('open');
    document.body.classList.add('betslip-open');
    document.getElementById('betslipPick').innerHTML = `
      <div>${esc(pick.outcomeName || 'Selection')}</div>
      <div class="muted">${esc(pick.marketName || '')}${pick.eventName ? ' · ' + esc(pick.eventName) : ''}</div>`;
    document.getElementById('betslipOdds').textContent = `@ ${pick.oddsDisplay || pick.odds || '—'}`;
    document.getElementById('betslipStake').value = state.stake || '';
    el.querySelectorAll('.betslip-chip').forEach(c => {
      c.classList.toggle('on', Number(c.dataset.amt) === state.stake);
    });
    const odds = parseOdds(pick.oddsDisplay || pick.odds);
    const ret = odds ? Math.round(state.stake * odds) : '—';
    document.getElementById('betslipReturn').innerHTML = `Potential return: <strong>₹${ret}</strong>`;
    const msgEl = document.getElementById('betslipMsg');
    const placeBtn = document.getElementById('betslipPlace');
    if (!idsOk(pick)) {
      msgEl.textContent = 'Open the full match page to place this bet.';
      placeBtn.disabled = true;
    } else if (!pick.betUrl) {
      msgEl.textContent = 'Betting API not configured for this page.';
      placeBtn.disabled = true;
    } else if (!token()) {
      msgEl.textContent = 'Login required to place bets.';
      placeBtn.disabled = false;
    } else {
      msgEl.textContent = '';
      placeBtn.disabled = state.busy;
    }
  }

  function pickFromButton(btn) {
    const scope = btn.closest('[data-bet-url]') || document.body;
    return {
      sport: btn.dataset.sport || scope.dataset.betSport || '',
      eventId: Number(btn.dataset.eventId || scope.dataset.eventId || 0),
      eventName: btn.dataset.eventName || scope.dataset.eventName || '',
      marketId: Number(btn.dataset.marketId || 0),
      marketName: btn.dataset.marketName || '',
      outcomeId: Number(btn.dataset.outcomeId || 0),
      outcomeName: btn.dataset.name || '',
      oddsDisplay: btn.dataset.price || '',
      betUrl: btn.dataset.betUrl || scope.dataset.betUrl || '',
      buttonEl: btn,
    };
  }

  function open(pick) {
    state.pick = pick || null;
    if (!state.stake) state.stake = 100;
    document.querySelectorAll('.odd-btn.selected').forEach(b => b.classList.remove('selected'));
    if (pick && pick.buttonEl) pick.buttonEl.classList.add('selected');
    render();
  }

  function close() {
    const el = document.getElementById('betslipPanel');
    const bd = document.getElementById('betslipBackdrop');
    if (el) el.classList.remove('open');
    if (bd) bd.classList.remove('open');
    document.body.classList.remove('betslip-open');
    document.querySelectorAll('.odd-btn.selected').forEach(b => b.classList.remove('selected'));
    state.pick = null;
    state.busy = false;
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) {
      const el = panel();
      el.classList.add('open');
      document.getElementById('betslipMsg').textContent = msg;
      return;
    }
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.style.display = 'none'; }, 2400);
  }

  async function placeBet() {
    const pick = state.pick;
    if (!pick || state.busy) return;
    if (!idsOk(pick)) {
      toast('Open the match page to place this bet');
      return;
    }
    const auth = token();
    if (!auth) {
      document.getElementById('betslipMsg').textContent = 'Login required to place bets';
      return;
    }
    const stake = Math.max(1, parseInt(String(state.stake), 10) || 0);
    state.busy = true;
    render();
    try {
      const r = await fetch(pick.betUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'Bearer ' + auth,
        },
        body: JSON.stringify({
          event_id: pick.eventId,
          market_id: pick.marketId,
          outcome_id: pick.outcomeId,
          stake,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || data.detail || `Bet failed (${r.status})`);
      toast(`Bet placed · ₹${stake} @ ${data.odds || pick.oddsDisplay}`);
      if (global.GunduSportsAuth && GunduSportsAuth.loadWalletBalance) {
        GunduSportsAuth.loadWalletBalance('wallet');
      }
      await loadOpenBets({ betsUrl: pick.betUrl && pick.betUrl.replace(/bet\/?$/, 'bets/'), eventId: pick.eventId });
      notifyBetsChanged();
      close();
    } catch (e) {
      document.getElementById('betslipMsg').textContent = e.message || 'Could not place bet';
      state.busy = false;
      render();
    }
  }

  async function showMyBets(opts) {
    opts = opts || {};
    const auth = token();
    if (!auth) { toast('Login required'); return; }
    injectStyles();
    let sheet = document.getElementById('betslipSheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'betslipSheet';
      sheet.className = 'betslip-sheet';
      sheet.innerHTML = `<div class="betslip-sheet-body" id="betslipSheetBody"></div>`;
      sheet.onclick = (e) => { if (e.target === sheet) sheet.classList.remove('open'); };
      document.body.appendChild(sheet);
    }
    const body = document.getElementById('betslipSheetBody');
    body.innerHTML = '<div class="muted">Loading bets…</div>';
    sheet.classList.add('open');
    try {
      const r = await fetch(opts.betsUrl || document.body.dataset.betsUrl || '/api/cricket/bets/', {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + auth },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Could not load bets');
      const bets = data.bets || [];
      body.innerHTML = `
        <div class="betslip-head"><h3>MY BETS</h3><button type="button" class="betslip-close" id="betslipSheetClose">×</button></div>
        ${bets.length ? bets.map(b => `
          <div class="betslip-bet-row">
            <div class="status ${esc(b.status)}">${esc(b.status)}</div>
            <div><strong>${esc(b.outcome_name)}</strong> @ ${esc(b.odds)}</div>
            <div class="muted">${esc(b.event_name)} · ${esc(b.market_name)}</div>
            <div>Stake ₹${esc(b.stake)} · Return ₹${esc(b.potential_payout)}</div>
          </div>`).join('') : '<div class="muted">No bets yet.</div>'}`;
      body.querySelector('#betslipSheetClose').onclick = () => sheet.classList.remove('open');
    } catch (e) {
      body.innerHTML = `<div class="muted">${esc(e.message)}</div>`;
    }
  }

  function bindOddButtons(root, defaults) {
    defaults = defaults || {};
    const scope = root || document.getElementById('app') || document.body;
    if (defaults.betUrl) scope.dataset.betUrl = defaults.betUrl;
    if (defaults.betsUrl) scope.dataset.betsUrl = defaults.betsUrl;
    if (defaults.sport) scope.dataset.betSport = defaults.sport;
    if (defaults.eventId) scope.dataset.eventId = String(defaults.eventId);
    if (defaults.eventName) scope.dataset.eventName = defaults.eventName;
    scope.querySelectorAll('.odd-btn').forEach(btn => {
      if (defaults.betUrl) btn.dataset.betUrl = defaults.betUrl;
      if (defaults.sport) btn.dataset.sport = defaults.sport;
    });
  }

  function installClickHandler() {
    if (document.documentElement.dataset.betslipClick) return;
    document.documentElement.dataset.betslipClick = '1';
    document.addEventListener('click', (ev) => {
      const cashBtn = ev.target.closest('.bet-cashout-btn');
      if (cashBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const scope = cashBtn.closest('[data-bets-url]') || document.body;
        const idsRaw = cashBtn.dataset.betIds || cashBtn.dataset.betId || '';
        const betIds = idsRaw.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
        const opts = {
          amount: Number(cashBtn.dataset.amount || 0),
          betsUrl: scope.dataset.betsUrl || state.betsUrl,
          eventId: scope.dataset.eventId,
        };
        if (betIds.length > 1) cashOutBets(betIds, opts);
        else if (betIds.length === 1) cashOutBet(betIds[0], opts);
        return;
      }
      const btn = ev.target.closest('.odd-btn');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      open(pickFromButton(btn));
    }, true);
  }

  installClickHandler();
  global.GunduBetslip = {
    open, close, placeBet, showMyBets, bindOddButtons, toast, pickFromButton,
    loadOpenBets, marketBetsHtml, marketHeadHtml, cashOutBet, cashOutBets, cashOutAmount, cashOutPnl,
  };
})(window);
