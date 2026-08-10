import { GemIcon } from './GemIcon'
import { BombIcon } from './BombIcon'
import type { Cell } from '../game/logic'

type Props = {
  cell: Cell
  index: number
  disabled: boolean
  gameOver: boolean
  wasTriggeredMine: boolean
  onClick: (index: number) => void
}

export function Tile({
  cell,
  index,
  disabled,
  gameOver,
  wasTriggeredMine,
  onClick,
}: Props) {
  const isRevealed = cell.state === 'revealed'
  const showContent = isRevealed || gameOver
  const isGem = cell.content === 'gem'
  const dimmed = gameOver && !isRevealed && !wasTriggeredMine

  let className = 'tile'
  if (!showContent) className += ' tile--hidden'
  else className += ' tile--revealed'
  if (wasTriggeredMine) className += ' tile--exploded'
  if (dimmed) className += ' tile--dimmed'
  if (isRevealed && isGem) className += ' tile--gem'
  if (disabled && !showContent) className += ' tile--disabled'

  return (
    <button
      type="button"
      className={className}
      disabled={disabled || isRevealed}
      onClick={() => onClick(index)}
      aria-label={
        showContent
          ? isGem
            ? 'Diamond'
            : wasTriggeredMine
              ? 'Exploded mine'
              : 'Mine'
          : `Tile ${index + 1}`
      }
    >
      {showContent &&
        (isGem ? (
          <GemIcon size={wasTriggeredMine ? 36 : 44} dimmed={dimmed} />
        ) : (
          <BombIcon
            size={wasTriggeredMine ? 56 : 42}
            exploded={wasTriggeredMine}
            dimmed={dimmed && !wasTriggeredMine}
          />
        ))}
    </button>
  )
}
