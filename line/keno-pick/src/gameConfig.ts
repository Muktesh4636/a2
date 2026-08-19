export const POOL = 40
export const MAX_PICKS = 10
export const MIN_PICKS = 1
export const DEFAULT_BET = 10

export const FALLBACK_TABLE: Record<number, number[]> = {
  1: [0, 3.5],
  2: [0, 1, 9],
  3: [0, 0, 2, 20],
  4: [0, 0, 1, 5, 50],
  5: [0, 0, 0.5, 2, 12, 100],
  6: [0, 0, 0, 1.5, 4, 10, 20],
  7: [0, 0, 0, 1, 3, 8, 25, 80],
  8: [0, 0, 0, 0.5, 2, 5, 15, 50, 200],
  9: [0, 0, 0, 0, 1.5, 4, 10, 30, 100, 500],
  10: [0, 0, 0, 0, 1, 2.5, 8, 25, 100, 1000, 10000],
}

export function tableFor(picks: number) {
  const row = FALLBACK_TABLE[picks] ?? FALLBACK_TABLE[6]
  return row.map((multiplier, hits) => ({ hits, multiplier }))
}
