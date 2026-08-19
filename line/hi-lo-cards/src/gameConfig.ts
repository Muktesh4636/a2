export const DEFAULT_BET = 100
export const DEFAULT_AUTO = 5

export type Card = {
  rank: number
  suit: string
  label: string
  red: boolean
}

export const SUIT_GLYPH: Record<string, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
}
