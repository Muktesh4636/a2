export const GRID_SIZE = 25
export const GRID_COLS = 5
export const HOUSE_EDGE = 0.01

export type CellContent = 'gem' | 'mine'
export type CellState = 'hidden' | 'revealed'
export type GameStatus = 'idle' | 'playing' | 'won' | 'lost' | 'cashed'

export interface Cell {
  content: CellContent
  state: CellState
}

export function createBoard(mineCount: number): Cell[] {
  const mines = new Set<number>()
  while (mines.size < mineCount) {
    mines.add(Math.floor(Math.random() * GRID_SIZE))
  }

  return Array.from({ length: GRID_SIZE }, (_, i) => ({
    content: mines.has(i) ? 'mine' : 'gem',
    state: 'hidden' as CellState,
  }))
}

/** Fair multiplier after `gemsFound` safe picks on a board with `mineCount` mines. */
export function getMultiplier(mineCount: number, gemsFound: number): number {
  if (gemsFound <= 0) return 1

  const gems = GRID_SIZE - mineCount
  let chance = 1

  for (let i = 0; i < gemsFound; i++) {
    chance *= (gems - i) / (GRID_SIZE - i)
  }

  return (1 - HOUSE_EDGE) / chance
}

export function formatMoney(amount: number): string {
  return amount.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatMultiplier(mult: number): string {
  return `${mult.toFixed(2)}×`
}
