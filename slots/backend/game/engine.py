"""
Shared slot spin engine.

Modes:
  - lines   : classic paylines left-to-right (most games)
  - ways    : all-ways (jackpot-plunder)
  - cluster : cluster pays with cascade (sugar-rush-spins)

Grid layout is always column-major: grid[col][row].
"""

from __future__ import annotations

import json
import random
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Any

CONFIG_DIR = Path(__file__).resolve().parent / 'configs'


def money(v) -> Decimal:
    return Decimal(str(v)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


@lru_cache(maxsize=64)
def load_config(game_id: str) -> dict:
    path = CONFIG_DIR / f'{game_id}.json'
    if not path.exists():
        raise KeyError(f'Unknown slot game: {game_id}')
    return json.loads(path.read_text())


def list_games() -> list[str]:
    index = CONFIG_DIR / '_index.json'
    if index.exists():
        return json.loads(index.read_text())
    return sorted(p.stem for p in CONFIG_DIR.glob('*.json') if not p.name.startswith('_'))


def public_config(game_id: str) -> dict:
    """Client-safe config (no need to hide weights for demo; still useful)."""
    cfg = load_config(game_id)
    return {
        'id': cfg['id'],
        'title': cfg['title'],
        'cols': cfg['cols'],
        'rows': cfg['rows'],
        'bets': cfg['bets'],
        'mode': cfg['mode'],
        'symbols': [
            {
                'id': s['id'],
                'wild': bool(s.get('wild')),
                'scatter': bool(s.get('scatter')),
                'expand': bool(s.get('expand')),
                'pearl': bool(s.get('pearl')),
                'weight': s.get('weight', 1),
                'pays': s.get('pays'),
            }
            for s in cfg['symbols']
        ],
        'lines': cfg.get('lines') or [],
        'free_spins_award': cfg.get('free_spins_award') or 0,
        'pearl_goal': cfg.get('pearl_goal') or 0,
        'scatter_trigger': cfg.get('scatter_trigger'),
        'cluster_pays': cfg.get('cluster_pays'),
    }


def _by_id(cfg: dict) -> dict[str, dict]:
    return {s['id']: s for s in cfg['symbols']}


def _pick(cfg: dict) -> str:
    symbols = cfg['symbols']
    weights = [max(1, int(s.get('weight', 1))) for s in symbols]
    return random.choices(symbols, weights=weights, k=1)[0]['id']


def _build_grid(cfg: dict) -> list[list[str]]:
    cols, rows = cfg['cols'], cfg['rows']
    return [[_pick(cfg) for _ in range(rows)] for _ in range(cols)]


def _expand_columns(grid: list[list[str]], by_id: dict[str, dict]) -> list[list[str]]:
    """Atlantis-style: if any expand symbol lands in a column, fill column with wild."""
    out = [col[:] for col in grid]
    wild_id = next((s['id'] for s in by_id.values() if s.get('wild')), 'wild')
    for c, col in enumerate(out):
        if any(by_id.get(id, {}).get('expand') for id in col):
            out[c] = [wild_id] * len(col)
    return out


def _pay_for_count(sym: dict, count: int) -> Decimal:
    pays = sym.get('pays')
    if pays is None:
        return Decimal('0')
    if isinstance(pays, dict):
        # vegas style: {"2": 2, "3": 6}
        return money(pays.get(str(count), pays.get(count, 0)))
    # array indexed by count-1: [0,0,3,10,40]
    if count - 1 < 0 or count - 1 >= len(pays):
        return Decimal('0')
    return money(pays[count - 1])


def _line_pay(
    grid: list[list[str]],
    line: list[int],
    by_id: dict[str, dict],
    bet: Decimal,
) -> dict[str, Any]:
    ids = [grid[col][row] for col, row in enumerate(line)]
    # pearl symbols break a line (atlantis) unless wild
    base = next((i for i in ids if not by_id[i].get('wild') and not by_id[i].get('pearl')), None)
    if base is None:
        base = next((i for i in ids if by_id[i].get('wild')), ids[0])

    count = 0
    for sid in ids:
        s = by_id[sid]
        if s.get('pearl') and not s.get('wild'):
            break
        if s.get('scatter') and not s.get('wild') and sid != base:
            break
        if s.get('wild') or sid == base:
            count += 1
        else:
            break

    if count < 2:
        return {'win': money(0), 'cells': [], 'symbol': base, 'count': count}

    mult = _pay_for_count(by_id[base], count)
    # Some games (vegas) allow 2-oak; others need >=3. If mult is 0 for count 2, ignore.
    if mult <= 0:
        return {'win': money(0), 'cells': [], 'symbol': base, 'count': count}

    cells = [{'col': c, 'row': line[c]} for c in range(count)]
    return {
        'win': money(bet * mult),
        'cells': cells,
        'symbol': base,
        'count': count,
        'multiplier': mult,
    }


def evaluate_lines(cfg: dict, grid: list[list[str]], bet: Decimal) -> dict:
    by_id = _by_id(cfg)
    lines = cfg.get('lines') or []
    total = money(0)
    win_cells: set[tuple[int, int]] = set()
    line_wins = []
    for idx, line in enumerate(lines):
        res = _line_pay(grid, line, by_id, bet)
        if res['win'] > 0:
            total += res['win']
            for cell in res['cells']:
                win_cells.add((cell['col'], cell['row']))
            line_wins.append({'line': idx, **res})
    return {
        'payout': money(total),
        'win_cells': [{'col': c, 'row': r} for c, r in sorted(win_cells)],
        'line_wins': line_wins,
    }


def evaluate_ways(cfg: dict, grid: list[list[str]], bet: Decimal) -> dict:
    by_id = _by_id(cfg)
    cols, rows = cfg['cols'], cfg['rows']
    divisor = Decimal(str(cfg.get('ways_bet_divisor') or 10))
    unit = money(bet / divisor)
    total = money(0)
    win_cells: set[tuple[int, int]] = set()
    ways_wins = []

    pay_symbols = [s for s in cfg['symbols'] if not s.get('scatter')]
    for sym in pay_symbols:
        matches: list[list[int]] = []
        for c in range(cols):
            rows_hit = []
            for r in range(rows):
                sid = grid[c][r]
                if sid == sym['id'] or by_id[sid].get('wild'):
                    rows_hit.append(r)
            if not rows_hit:
                break
            matches.append(rows_hit)
        if len(matches) < 3:
            continue
        ways = 1
        for rows_hit in matches:
            ways *= len(rows_hit)
        mult = _pay_for_count(sym, len(matches))
        win = money(ways * mult * unit)
        if win <= 0:
            continue
        total += win
        for c, rows_hit in enumerate(matches):
            for r in rows_hit:
                win_cells.add((c, r))
        ways_wins.append({
            'symbol': sym['id'],
            'count': len(matches),
            'ways': ways,
            'multiplier': mult,
            'win': win,
        })

    # Scatter pays (e.g. chests)
    scatter_id = cfg.get('scatter_id') or next(
        (s['id'] for s in cfg['symbols'] if s.get('scatter')), None
    )
    scatter_count = 0
    scatter_cells = []
    if scatter_id:
        for c in range(cols):
            for r in range(rows):
                if grid[c][r] == scatter_id:
                    scatter_count += 1
                    scatter_cells.append({'col': c, 'row': r})
        trigger = cfg.get('scatter_trigger') or 3
        if scatter_count >= trigger:
            mult = _pay_for_count(by_id[scatter_id], scatter_count)
            win = money(mult * bet)
            if win > 0:
                total += win
                for cell in scatter_cells:
                    win_cells.add((cell['col'], cell['row']))
                ways_wins.append({
                    'symbol': scatter_id,
                    'count': scatter_count,
                    'ways': 1,
                    'multiplier': mult,
                    'win': win,
                    'scatter': True,
                })

    # Optional pick-bonus prize (server picks randomly when scatter triggers)
    bonus = money(0)
    if scatter_count >= (cfg.get('scatter_trigger') or 3) and cfg.get('bonus_prizes'):
        prize_mult = random.choice(cfg['bonus_prizes'])
        bonus = money(Decimal(str(prize_mult)) * bet)
        total += bonus

    return {
        'payout': money(total),
        'win_cells': [{'col': c, 'row': r} for c, r in sorted(win_cells)],
        'ways_wins': ways_wins,
        'scatter_count': scatter_count,
        'bonus': bonus,
    }


def _neighbors(c: int, r: int, cols: int, rows: int):
    for nc, nr in ((c - 1, r), (c + 1, r), (c, r - 1), (c, r + 1)):
        if 0 <= nc < cols and 0 <= nr < rows:
            yield nc, nr


def _find_clusters(grid: list[list[str]], cols: int, rows: int) -> list[dict]:
    seen: set[tuple[int, int]] = set()
    clusters = []
    for c in range(cols):
        for r in range(rows):
            if (c, r) in seen:
                continue
            sid = grid[c][r]
            stack = [(c, r)]
            group = []
            seen.add((c, r))
            while stack:
                x, y = stack.pop()
                group.append((x, y))
                for nx, ny in _neighbors(x, y, cols, rows):
                    if (nx, ny) not in seen and grid[nx][ny] == sid:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            if len(group) >= 5:
                clusters.append({'id': sid, 'cells': group})
    return clusters


def _cluster_mult(cfg: dict, size: int) -> Decimal:
    pays = cfg.get('cluster_pays') or {}
    if size >= 12 and '12' in pays:
        return money(pays['12'])
    return money(pays.get(str(size), 0))


def _drop_fill(cfg: dict, grid: list[list[str]], remove: set[tuple[int, int]]) -> list[list[str]]:
    cols, rows = cfg['cols'], cfg['rows']
    out = [col[:] for col in grid]
    for c in range(cols):
        remaining = [out[c][r] for r in range(rows) if (c, r) not in remove]
        fill = [_pick(cfg) for _ in range(rows - len(remaining))]
        out[c] = fill + remaining  # new symbols fall from top
    return out


def evaluate_cluster(cfg: dict, grid: list[list[str]], bet: Decimal, max_cascades: int = 20) -> dict:
    cols, rows = cfg['cols'], cfg['rows']
    working = [col[:] for col in grid]
    total = money(0)
    cascades = []
    all_win_cells: set[tuple[int, int]] = set()

    for _ in range(max_cascades):
        clusters = _find_clusters(working, cols, rows)
        if not clusters:
            break
        round_pay = money(0)
        remove: set[tuple[int, int]] = set()
        cascade_cells = []
        for cl in clusters:
            mult = _cluster_mult(cfg, len(cl['cells']))
            win = money(mult * bet)
            round_pay += win
            for c, r in cl['cells']:
                remove.add((c, r))
                all_win_cells.add((c, r))
                cascade_cells.append({'col': c, 'row': r, 'symbol': cl['id']})
        total += round_pay
        cascades.append({
            'payout': round_pay,
            'clusters': [
                {
                    'symbol': cl['id'],
                    'size': len(cl['cells']),
                    'cells': [{'col': c, 'row': r} for c, r in cl['cells']],
                }
                for cl in clusters
            ],
            'grid_before_drop': working,
        })
        working = _drop_fill(cfg, working, remove)

    return {
        'payout': money(total),
        'win_cells': [{'col': c, 'row': r} for c, r in sorted(all_win_cells)],
        'cascades': cascades,
        'final_grid': working,
    }


def _count_feature(grid: list[list[str]], by_id: dict, key: str) -> int:
    n = 0
    for col in grid:
        for sid in col:
            if by_id.get(sid, {}).get(key):
                n += 1
    return n


def resolve_spin(
    game_id: str,
    bet: Decimal,
    *,
    free_spins_left: int = 0,
    pearls: int = 0,
) -> dict:
    """
    Server-authoritative spin.

    Returns grid + payout + feature state updates.
    Free-spin spins do not deduct bet (caller handles wallet).
    """
    cfg = load_config(game_id)
    allowed = [money(b) for b in cfg['bets']]
    bet = money(bet)
    if bet not in allowed:
        raise ValueError(f'Bet must be one of {cfg["bets"]}')

    using_free = free_spins_left > 0
    by_id = _by_id(cfg)

    grid = _build_grid(cfg)

    # Expand wilds (atlantis mermaid columns)
    if any(s.get('expand') for s in cfg['symbols']):
        grid = _expand_columns(grid, by_id)

    mode = cfg.get('mode') or 'lines'
    if mode == 'ways':
        ev = evaluate_ways(cfg, grid, bet)
        final_grid = grid
    elif mode == 'cluster':
        ev = evaluate_cluster(cfg, grid, bet)
        final_grid = ev.get('final_grid') or grid
    else:
        ev = evaluate_lines(cfg, grid, bet)
        final_grid = grid

    # Pearl meter → free spins (atlantis)
    pearls_after = pearls
    free_awarded = 0
    free_after = free_spins_left
    if using_free:
        free_after = max(0, free_spins_left - 1)

    if cfg.get('pearl_goal'):
        gained = _count_feature(grid, by_id, 'pearl')
        pearls_after = min(cfg['pearl_goal'], pearls + gained)
        if pearls_after >= cfg['pearl_goal']:
            pearls_after = 0
            award = int(cfg.get('free_spins_award') or 0)
            free_awarded += award
            free_after += award

    # Scatter → free spins (generic)
    scatter_count = _count_feature(grid, by_id, 'scatter')
    trigger = cfg.get('scatter_trigger')
    if trigger and scatter_count >= int(trigger) and cfg.get('free_spins_award'):
        # Only if game uses free spins from scatter (not just scatter pays)
        if cfg.get('free_spins_award') and mode != 'ways':
            award = int(cfg['free_spins_award'])
            free_awarded += award
            free_after += award

    payout = money(ev['payout'])
    return {
        'game_id': game_id,
        'mode': mode,
        'bet': bet,
        'used_free_spin': using_free,
        'grid': grid,  # landing grid (before cluster drops)
        'final_grid': final_grid,
        'payout': payout,
        'win_cells': ev.get('win_cells') or [],
        'line_wins': ev.get('line_wins') or [],
        'ways_wins': ev.get('ways_wins') or [],
        'cascades': ev.get('cascades') or [],
        'bonus': money(ev.get('bonus') or 0),
        'scatter_count': scatter_count if 'scatter_count' not in ev else ev['scatter_count'],
        'pearls': pearls_after,
        'free_spins': free_after,
        'free_spins_awarded': free_awarded,
    }
