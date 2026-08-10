import { useId } from 'react'

type Props = {
  size?: number
  /** True only for the danger tile the player hit (loss). */
  burning?: boolean
  dimmed?: boolean
}

export function SkullIcon({ size = 40, burning = false, dimmed = false }: Props) {
  const uid = useId().replace(/:/g, '')
  const skullGrad = `${uid}-skull`
  const fireGrad = `${uid}-fire`
  const coreGrad = `${uid}-core`

  return (
    <svg
      width={size}
      height={size}
      viewBox={burning ? '0 0 72 72' : '0 0 56 64'}
      className={`skull-icon ${burning ? 'is-burning' : ''} ${dimmed ? 'is-dimmed' : ''}`}
      aria-hidden
    >
      <defs>
        <radialGradient id={skullGrad} cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#E8FFD8" />
          <stop offset="35%" stopColor="#7CFF6B" />
          <stop offset="100%" stopColor="#14A81E" />
        </radialGradient>
        {burning && (
          <>
            <linearGradient id={fireGrad} x1="0.5" y1="1" x2="0.5" y2="0">
              <stop offset="0%" stopColor="#00E701" stopOpacity="0.95" />
              <stop offset="45%" stopColor="#5CFF4A" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#C8FFB0" stopOpacity="0" />
            </linearGradient>
            <radialGradient id={coreGrad} cx="50%" cy="55%" r="55%">
              <stop offset="0%" stopColor="#7CFF6B" stopOpacity="0.5" />
              <stop offset="55%" stopColor="#00E701" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#0A7A12" stopOpacity="0" />
            </radialGradient>
          </>
        )}
      </defs>

      {burning && (
        <>
          {/* Glow centered on skull, not below */}
          <ellipse
            className="skull-fire-glow"
            cx="36"
            cy="34"
            rx="30"
            ry="28"
            fill={`url(#${coreGrad})`}
          />
          {/* Flames rising upward around / above the skull */}
          <g className="skull-flames skull-flames--back">
            <path
              className="flame flame-a"
              d="M10 48 C4 34, 6 18, 14 2 C8 18, 16 26, 14 38 C18 24, 22 34, 18 50 Z"
              fill={`url(#${fireGrad})`}
            />
            <path
              className="flame flame-b"
              d="M62 48 C68 32, 66 16, 58 0 C64 18, 56 26, 58 38 C54 24, 50 34, 54 50 Z"
              fill={`url(#${fireGrad})`}
            />
            <path
              className="flame flame-c"
              d="M36 28 C28 16, 30 6, 36 -4 C42 6, 44 16, 36 28 Z"
              fill={`url(#${fireGrad})`}
              opacity="0.85"
            />
            <path
              className="flame flame-a"
              d="M22 44 C16 30, 18 14, 24 0 C20 16, 26 24, 26 36 C28 24, 32 32, 28 46 Z"
              fill="#5CFF4A"
              opacity="0.6"
            />
            <path
              className="flame flame-b"
              d="M50 44 C56 28, 54 12, 48 -2 C52 16, 46 24, 46 36 C44 24, 40 32, 44 46 Z"
              fill="#7CFF6B"
              opacity="0.6"
            />
          </g>
        </>
      )}

      {burning ? (
        <g className="skull-body">
          <ellipse cx="36" cy="38" rx="18" ry="17" fill="#06240A" opacity="0.45" />
          <ellipse cx="36" cy="38" rx="16.5" ry="15.5" fill={`url(#${skullGrad})`} />
          <rect x="23" y="46" width="26" height="13" rx="4" fill="#22C928" />
          <rect
            x="23"
            y="46"
            width="26"
            height="13"
            rx="4"
            fill="none"
            stroke="#06240A"
            strokeWidth="1.2"
            opacity="0.35"
          />
          <circle cx="29" cy="36" r="5.2" fill="#041808" />
          <circle cx="43" cy="36" r="5.2" fill="#041808" />
          <circle className="eye-flame" cx="29" cy="37" r="2.6" fill="#B8FFAE" />
          <circle className="eye-flame eye-flame--delay" cx="43" cy="37" r="2.6" fill="#B8FFAE" />
          <ellipse cx="36" cy="45" rx="3.6" ry="2.8" fill="#041808" />
          <path
            d="M26 53 L26 57.5 M31 53 L31 57.5 M36 53 L36 57.5 M41 53 L41 57.5 M46 53 L46 57.5"
            stroke="#041808"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <ellipse cx="30" cy="30" rx="5" ry="3" fill="#fff" opacity="0.28" />
        </g>
      ) : (
        <g className="skull-body">
          <ellipse cx="28" cy="26" rx="14" ry="13" fill={`url(#${skullGrad})`} />
          <rect x="17" y="32" width="22" height="10" rx="3" fill="#1EB824" />
          <circle cx="22" cy="24" r="4" fill="#041808" />
          <circle cx="34" cy="24" r="4" fill="#041808" />
          <ellipse cx="28" cy="32" rx="3" ry="2.4" fill="#041808" />
          <path
            d="M19 38 L19 42 M23 38 L23 42 M28 38 L28 42 M33 38 L33 42 M37 38 L37 42"
            stroke="#041808"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>
      )}

      {burning && (
        <g className="skull-flames skull-flames--front">
          <path
            className="flame flame-d"
            d="M12 52 C8 38, 10 24, 16 12 C12 26, 18 34, 18 46 C20 36, 22 42, 20 54 Z"
            fill="#7CFF6B"
            opacity="0.7"
          />
          <path
            className="flame flame-e"
            d="M60 52 C64 36, 62 22, 56 10 C60 26, 54 34, 54 46 C52 36, 50 42, 52 54 Z"
            fill="#5CFF4A"
            opacity="0.7"
          />
          <path
            className="flame flame-f"
            d="M36 22 C30 12, 32 4, 36 -6 C40 4, 42 12, 36 22 Z"
            fill="#C8FFB0"
            opacity="0.65"
          />
        </g>
      )}
    </svg>
  )
}
