import { useEffect, useState } from 'react'
import { SUIT_GLYPH, type Card } from './gameConfig'

type Props = {
  card: Card | null
  flipping: boolean
  flash: 'win' | 'lose' | null
  empty?: boolean
}

export function Card3D({ card, flipping, flash, empty }: Props) {
  const [showFace, setShowFace] = useState(Boolean(card) && !empty)
  const [face, setFace] = useState<Card | null>(card)

  useEffect(() => {
    if (!card || empty) {
      setShowFace(false)
      return
    }
    if (flipping) {
      setShowFace(false)
      const t = window.setTimeout(() => {
        setFace(card)
        setShowFace(true)
      }, 280)
      return () => window.clearTimeout(t)
    }
    setFace(card)
    setShowFace(true)
  }, [card, flipping, empty])

  const display = face ?? card
  const glyph = display ? SUIT_GLYPH[display.suit] ?? '♠' : '♠'
  const red = display?.red ?? false

  return (
    <div
      className={`hl-scene${flash === 'win' ? ' win' : ''}${flash === 'lose' ? ' lose' : ''}${
        flipping ? ' dealing' : ''
      }`}
    >
      <div className="hl-shadow" aria-hidden />
      <div className={`hl-card3d${showFace ? ' flipped' : ''}`}>
        <div className="hl-face hl-back">
          <div className="hl-back-inner">
            <span className="hl-back-logo">♠</span>
            <span className="hl-back-text">HI-LO</span>
          </div>
        </div>
        <div className={`hl-face hl-front${red ? ' red' : ''}`}>
          {display && (
            <>
              <div className="hl-corner top">
                <span>{display.label}</span>
                <span>{glyph}</span>
              </div>
              <div className="hl-suit">{glyph}</div>
              <div className="hl-corner bot">
                <span>{display.label}</span>
                <span>{glyph}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
