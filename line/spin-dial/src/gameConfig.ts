export type MultiplierKey = 0 | 1.5 | 1.8 | 2 | 3 | 5 | 10

export interface Segment {
  id: string
  multiplier: MultiplierKey
  color: string
  /** Center angle on dial: 0 = left of arc, 180 = right (semicircle top) */
  angle: number
  span: number
  weight: number
}

export const OUTCOMES = [
  { id: 'lose', multiplier: 0 as const, color: '#3a4553', label: '0.00x' },
  { id: 'green', multiplier: 1.5 as const, color: '#00e701', label: '1.50x' },
  { id: 'white', multiplier: 1.8 as const, color: '#ffffff', label: '1.80x' },
  { id: 'yellow', multiplier: 2 as const, color: '#fde047', label: '2.00x' },
  { id: 'purple', multiplier: 3 as const, color: '#a855f7', label: '3.00x' },
  { id: 'cyan', multiplier: 5 as const, color: '#22d3ee', label: '5.00x' },
  { id: 'orange', multiplier: 10 as const, color: '#fb923c', label: '10.00x' },
]

/** Semicircle from 180° (left) to 0° (right), pointer at top (90°) */
export const SEGMENTS: Segment[] = [
  { id: 'g1', multiplier: 1.5, color: '#00e701', angle: 165, span: 18, weight: 14 },
  { id: 'y1', multiplier: 2, color: '#fde047', angle: 145, span: 18, weight: 10 },
  { id: 'c1', multiplier: 5, color: '#22d3ee', angle: 125, span: 18, weight: 2 },
  { id: 'w1', multiplier: 1.8, color: '#ffffff', angle: 105, span: 18, weight: 6 },
  { id: 'y2', multiplier: 2, color: '#fde047', angle: 85, span: 18, weight: 10 },
  { id: 'o1', multiplier: 10, color: '#fb923c', angle: 65, span: 18, weight: 1 },
  { id: 'g2', multiplier: 1.5, color: '#00e701', angle: 45, span: 18, weight: 14 },
  { id: 'p1', multiplier: 3, color: '#a855f7', angle: 25, span: 18, weight: 4 },
  { id: 'y3', multiplier: 2, color: '#fde047', angle: 8, span: 14, weight: 10 },
]

export const DEFAULT_BET = 10
export const ANIM_MS = 5000
