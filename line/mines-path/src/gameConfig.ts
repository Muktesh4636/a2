export const TILE_COUNT = 8
export const MINE_COUNT = 2
export const DEFAULT_BET = 10

/** Multiplier after N safe reveals */
export const SAFE_MULTIPLIERS = [1.2, 1.55, 2.1, 2.9, 4.2, 7.0] as const

export type TileState = 'hidden' | 'safe' | 'mine'
