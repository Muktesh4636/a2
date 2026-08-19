export const DEFAULT_BET = 10
export const ANIM_MS = 3500
export const VISIBLE_ROWS = 5
/** Center row index in the visible window (0-based) */
export const PAYLINE_ROW = 2

export const COLORS = [
  { id: 'green', color: '#22c55e', label: '1.50x', multiplier: 1.5, weight: 14 },
  { id: 'yellow', color: '#eab308', label: '2.00x', multiplier: 2, weight: 10 },
  { id: 'purple', color: '#a855f7', label: '3.00x', multiplier: 3, weight: 4 },
  { id: 'blue', color: '#3b82f6', label: '2.50x', multiplier: 2.5, weight: 5 },
  { id: 'cyan', color: '#22d3ee', label: '5.00x', multiplier: 5, weight: 2 },
  { id: 'white', color: '#f8fafc', label: '1.80x', multiplier: 1.8, weight: 6 },
  { id: 'orange', color: '#f97316', label: '10.00x', multiplier: 10, weight: 1 },
] as const

export type ColorId = (typeof COLORS)[number]['id']

export const TWO_MATCH_MULT = 1.5

export function colorOf(id: string): string {
  return COLORS.find((c) => c.id === id)?.color ?? '#334155'
}

export function randomColorId(): ColorId {
  return COLORS[Math.floor(Math.random() * COLORS.length)].id
}

/** Build a tall strip with winning color centered in the final visible window. */
export function buildReelStrip(centerId: ColorId, length = 30): ColorId[] {
  const strip: ColorId[] = []
  for (let i = 0; i < length - 5; i++) strip.push(randomColorId())
  strip.push(randomColorId(), randomColorId(), centerId, randomColorId(), randomColorId())
  return strip
}
