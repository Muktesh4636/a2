import { EggIcon } from './EggIcon'
import { SkullIcon } from './SkullIcon'
import type { ApiCell } from '../api/client'

type Props = {
  cell: ApiCell
  disabled: boolean
  onClick: () => void
}

export function StepCell({ cell, disabled, onClick }: Props) {
  const classes = ['step-cell']
  if (cell.active) classes.push('is-active')
  if (cell.chosen) classes.push('is-chosen')
  if (cell.triggered) classes.push('is-triggered')
  if (cell.state === 'revealed') classes.push('is-revealed')
  if (cell.content === 'danger' && cell.state === 'revealed') classes.push('is-danger')
  if (disabled && !cell.active) classes.push('is-locked')

  const showEgg = cell.content === 'egg' && cell.state === 'revealed'
  const showSkull = cell.content === 'danger' && cell.state === 'revealed'
  const dimmed = showEgg && !cell.chosen && !cell.active

  const canClick = !disabled && cell.active

  return (
    <button
      type="button"
      className={classes.join(' ')}
      disabled={!canClick}
      onClick={(e) => {
        e.preventDefault()
        if (!canClick) return
        onClick()
      }}
      aria-label={
        showSkull ? 'Danger' : showEgg ? 'Egg' : cell.active ? 'Choose step' : 'Locked step'
      }
    >
      {showEgg && <EggIcon size={34} dimmed={dimmed} glow={cell.chosen} />}
      {showSkull && (
        <SkullIcon
          size={cell.triggered ? 52 : 34}
          burning={cell.triggered}
          dimmed={!cell.triggered}
        />
      )}
    </button>
  )
}
