import { Tile } from './Tile'
import type { Cell, GameStatus } from '../game/logic'
import { unlockGameAudio } from '../gameSounds'

type Props = {
  board: Cell[]
  status: GameStatus
  triggeredMine: number | null
  onReveal: (index: number) => void
}

export function Board({ board, status, triggeredMine, onReveal }: Props) {
  const playing = status === 'playing'
  const gameOver = status === 'lost' || status === 'won' || status === 'cashed'

  return (
    <div
      className="board-wrap"
      onPointerDown={unlockGameAudio}
      onTouchStart={unlockGameAudio}
    >
      <div className="board" role="grid" aria-label="Mines board">
        {board.map((cell, index) => (
          <Tile
            key={index}
            cell={cell}
            index={index}
            disabled={!playing}
            gameOver={gameOver}
            wasTriggeredMine={triggeredMine === index}
            onClick={onReveal}
          />
        ))}
      </div>
    </div>
  )
}
