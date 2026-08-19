export const DEFAULT_BET = 100
export const ANIM_MS = 5200

export type Mult = 1.2 | 1.5 | 2 | 2.5 | 3 | 4 | 5 | 10 | 100

export interface Pocket {
  id: string
  multiplier: Mult
  label: string
  color: string
  /** start angle deg, clockwise from top (pointer at 0°) */
  start: number
  span: number
  weight: number
}

const PURPLE = '#7c3aed'
const BLUE = '#1d4ed8'
const GREEN = '#16a34a'
const GOLD = '#eab308'
const RED = '#dc2626'

/** 15-pocket layout — two crowded duplicates removed for clearer labels. */
const DEFS: Array<{ id: string; multiplier: Mult; color: string; weight: number }> = [
  { id: 'p100', multiplier: 100, color: PURPLE, weight: 1 },
  { id: 'b2a', multiplier: 2, color: BLUE, weight: 12 },
  { id: 'g5a', multiplier: 5, color: GREEN, weight: 4 },
  { id: 'y15a', multiplier: 1.5, color: GOLD, weight: 14 },
  { id: 'r3a', multiplier: 3, color: RED, weight: 7 },
  { id: 'b2b', multiplier: 2, color: BLUE, weight: 12 },
  { id: 'p10', multiplier: 10, color: PURPLE, weight: 2 },
  { id: 'y15b', multiplier: 1.5, color: GOLD, weight: 14 },
  { id: 'g25a', multiplier: 2.5, color: GREEN, weight: 8 },
  { id: 'r4', multiplier: 4, color: RED, weight: 5 },
  { id: 'b2c', multiplier: 2, color: BLUE, weight: 12 },
  { id: 'p12', multiplier: 1.2, color: PURPLE, weight: 16 },
  { id: 'y3', multiplier: 3, color: GOLD, weight: 7 },
  { id: 'g5b', multiplier: 5, color: GREEN, weight: 4 },
  { id: 'r15', multiplier: 1.5, color: RED, weight: 14 },
]

const STEP = 360 / DEFS.length

export const POCKETS: Pocket[] = DEFS.map((d, i) => ({
  ...d,
  label: formatMult(d.multiplier),
  start: i * STEP,
  span: STEP,
}))

export const MAX_MULT = 100

function formatMult(m: number): string {
  return Number.isInteger(m) ? `${m}x` : `${m}x`
}
