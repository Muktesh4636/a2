export type MultiplierKey = 0 | 1.5 | 1.8 | 2 | 3 | 5 | 10

export interface Outcome {
  id: string
  multiplier: MultiplierKey
  color: string
  label: string
}

/** Horizontal zones along the bar (start/end as % of track width) */
export interface Zone {
  id: string
  multiplier: MultiplierKey
  color: string
  start: number
  end: number
}

export const OUTCOMES: Outcome[] = [
  { id: 'lose', multiplier: 0, color: '#3a4553', label: '0.00x' },
  { id: 'green', multiplier: 1.5, color: '#00e701', label: '1.50x' },
  { id: 'white', multiplier: 1.8, color: '#ffffff', label: '1.80x' },
  { id: 'yellow', multiplier: 2, color: '#fde047', label: '2.00x' },
  { id: 'purple', multiplier: 3, color: '#a855f7', label: '3.00x' },
  { id: 'cyan', multiplier: 5, color: '#22d3ee', label: '5.00x' },
  { id: 'orange', multiplier: 10, color: '#fb923c', label: '10.00x' },
]

/** Equal tile width + equal gaps (including between loop repeats) */
const TILE = 7
const STEP = 100 / 9 // tile + gap

function zone(
  id: string,
  multiplier: MultiplierKey,
  color: string,
  index: number,
): Zone {
  const start = index * STEP
  return { id, multiplier, color, start, end: start + TILE }
}

export const ZONES: Zone[] = [
  zone('g1', 1.5, '#00e701', 0),
  zone('y1', 2, '#fde047', 1),
  zone('c1', 5, '#22d3ee', 2),
  zone('w1', 1.8, '#ffffff', 3),
  zone('y2', 2, '#fde047', 4),
  zone('o1', 10, '#fb923c', 5),
  zone('g2', 1.5, '#00e701', 6),
  zone('y3', 2, '#fde047', 7),
  zone('p1', 3, '#a855f7', 8),
]

export const INITIAL_BALANCE = 1000
export const DEFAULT_BET = 10
export const ANIM_MS = 5000
