import { useId } from 'react'

type Props = {
  size?: number
  exploded?: boolean
  dimmed?: boolean
  className?: string
}

export function BombIcon({
  size = 48,
  exploded = false,
  dimmed = false,
  className = '',
}: Props) {
  const id = useId().replace(/:/g, '')
  const body = `${id}-body`
  const spark = `${id}-spark`
  const smoke = `${id}-smoke`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 72"
      className={`bomb-icon ${exploded ? 'is-exploded' : ''} ${dimmed ? 'is-dimmed' : ''} ${className}`}
      aria-hidden
    >
      <defs>
        <radialGradient id={body} cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#FF6B5A" />
          <stop offset="55%" stopColor="#E82111" />
          <stop offset="100%" stopColor="#9B0A08" />
        </radialGradient>
        <radialGradient id={spark} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFF7C2" />
          <stop offset="40%" stopColor="#FFD84A" />
          <stop offset="100%" stopColor="#FF8A00" stopOpacity="0" />
        </radialGradient>
        {exploded && (
          <filter id={smoke} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        )}
      </defs>

      {exploded && (
        <g filter={`url(#${smoke})`} opacity="0.55">
          <ellipse cx="22" cy="48" rx="14" ry="10" fill="#5A6B78" />
          <ellipse cx="50" cy="50" rx="16" ry="11" fill="#4A5A66" />
          <ellipse cx="36" cy="56" rx="18" ry="9" fill="#3D4D58" />
          <ellipse cx="18" cy="34" rx="10" ry="8" fill="#667788" />
          <ellipse cx="54" cy="30" rx="11" ry="8" fill="#5A6B78" />
        </g>
      )}

      <path
        d="M42 22 C46 16, 50 14, 54 12"
        fill="none"
        stroke="#2A2A2A"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="56" cy="11" r={exploded ? 10 : 7} fill={`url(#${spark})`} />
      <path
        d="M56 4 L57.5 9 L63 9.2 L58.8 12.5 L60.5 18 L56 14.8 L51.5 18 L53.2 12.5 L49 9.2 L54.5 9 Z"
        fill="#FFE566"
        opacity="0.95"
      />

      <circle cx="34" cy="40" r="20" fill={`url(#${body})`} />
      <ellipse cx="27" cy="33" rx="6" ry="4" fill="#FFB0A4" opacity="0.45" />
      <rect x="28" y="18" width="12" height="7" rx="2" fill="#1E1E1E" />
    </svg>
  )
}
