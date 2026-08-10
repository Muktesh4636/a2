import { Dice } from './Dice'
import { PlayIcon } from './PlayIcon'
import { SnakeIcon } from './SnakeIcon'
import type { TrackTile } from '../api/client'
import { formatMultiplier } from '../game/format'

const GRID_POS: Array<[number, number]> = [
  [0, 0],
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
  [3, 2],
  [3, 1],
  [3, 0],
  [2, 0],
  [1, 0],
]

type Props = {
  track: TrackTile[]
  die1: number
  die2: number
  rolling: boolean
  markerIndex: number | null
  resultMultiplier: number | null
  lost: boolean
}

export function Board({
  track,
  die1,
  die2,
  rolling,
  markerIndex,
  resultMultiplier,
  lost,
}: Props) {
  return (
    <div className="board-wrap">
      <div className="board-stage">
        <div className="board-grid">
          {track.map((tile) => {
            const [row, col] = GRID_POS[tile.index] ?? [0, 0]
            const active = markerIndex === tile.index
            const classes = ['track-tile']
            if (active) classes.push('is-active')
            if (tile.type === 'snake') classes.push('is-snake')
            if (tile.type === 'start') classes.push('is-start')

            return (
              <div
                key={tile.index}
                className={classes.join(' ')}
                style={{ gridRow: row + 1, gridColumn: col + 1 }}
              >
                <div className="tile-3d">
                  <div className="tile-top">
                    {tile.type === 'start' && <PlayIcon />}
                    {tile.type === 'snake' && <SnakeIcon size={active ? 38 : 32} />}
                    {tile.type === 'mult' && tile.multiplier && (
                      <span>{Number(tile.multiplier).toFixed(2)}x</span>
                    )}
                  </div>
                  <div className="tile-side tile-side-front" />
                  <div className="tile-side tile-side-right" />
                  <div className="tile-side tile-side-left" />
                </div>
              </div>
            )
          })}

          <div className="center-panel">
            <div className="center-panel-inner">
              <div className="dice-row">
                <Dice value={die1} rolling={rolling} delay={0} />
                <Dice value={die2} rolling={rolling} delay={120} />
              </div>
              {!rolling && (
                <div className="dice-sum" aria-live="polite">
                  {die1} + {die2} = {die1 + die2}
                </div>
              )}
              <div
                className={`result-box ${lost ? 'is-lost' : ''} ${
                  resultMultiplier && resultMultiplier > 1 ? 'is-win' : ''
                }`}
              >
                {lost ? 'Snake!' : formatMultiplier(resultMultiplier ?? 1)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
