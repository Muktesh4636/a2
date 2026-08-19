export type MultiplierKey = 0 | 1.5 | 1.8 | 2 | 3

export interface Outcome {
  id: string
  multiplier: MultiplierKey
  color: string
  label: string
}

export interface Segment {
  id: string
  multiplier: MultiplierKey
  color: string
  /** Center angle in degrees (0 = top / 12 o'clock, clockwise) */
  angle: number
  /** Visual width of the tile along the arc, in degrees */
  span: number
}

export const OUTCOMES: Outcome[] = [
  { id: 'lose', multiplier: 0, color: '#3a4553', label: '0.00x' },
  { id: 'green', multiplier: 1.5, color: '#00e701', label: '1.50x' },
  { id: 'white', multiplier: 1.8, color: '#ffffff', label: '1.80x' },
  { id: 'yellow', multiplier: 2, color: '#fde047', label: '2.00x' },
  { id: 'purple', multiplier: 3, color: '#a855f7', label: '3.00x' },
]

/** Segment layout matching the reference: sparse colored tiles on a dark ring */
export const SEGMENTS: Segment[] = [
  { id: 'g1', multiplier: 1.5, color: '#00e701', angle: 0, span: 10 },
  { id: 'y1', multiplier: 2, color: '#fde047', angle: 38, span: 10 },
  { id: 'y2', multiplier: 2, color: '#fde047', angle: 72, span: 10 },
  { id: 'g2', multiplier: 1.5, color: '#00e701', angle: 118, span: 10 },
  { id: 'p1', multiplier: 3, color: '#a855f7', angle: 180, span: 10 },
  { id: 'w1', multiplier: 1.8, color: '#ffffff', angle: 230, span: 10 },
  { id: 'y3', multiplier: 2, color: '#fde047', angle: 278, span: 10 },
  { id: 'y4', multiplier: 2, color: '#fde047', angle: 318, span: 10 },
]

export const RING_COLOR = '#2f3847'
export const BG_COLOR = '#1a252f'
export const INITIAL_BALANCE = 1000
export const MIN_BET = 1
export const MAX_BET = 500
export const DEFAULT_BET = 10
