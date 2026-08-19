export const DEFAULT_BET = 10
export const DEFAULT_TARGET = 50
export const MIN_TARGET = 2
export const MAX_TARGET = 98
export const ANIM_MS = 2000

/** House-edged multiplier for under / over a target (0–100 scale). */
export function calcMultiplier(target: number, side: 'under' | 'over'): number {
  const t = Math.min(MAX_TARGET, Math.max(MIN_TARGET, target))
  const chance = side === 'under' ? t : 100 - t
  const raw = 99 / chance
  return Math.round(raw * 100) / 100
}
