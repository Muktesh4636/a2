import { useId } from 'react'

type Props = {
  size?: number
  dimmed?: boolean
  className?: string
}

/**
 * Classic brilliant-cut diamond silhouette (Stake-style):
 * flat table → wide girdle → pointed pavilion.
 */
export function GemIcon({ size = 48, dimmed = false, className = '' }: Props) {
  const uid = useId().replace(/:/g, '')
  const g = (name: string) => `${uid}-${name}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      className={`gem-icon ${dimmed ? 'is-dimmed' : ''} ${className}`}
      aria-hidden
    >
      <defs>
        <linearGradient id={g('table')} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#C8FFB0" />
          <stop offset="100%" stopColor="#5EFF4A" />
        </linearGradient>
        <linearGradient id={g('bevelL')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3EE83A" />
          <stop offset="100%" stopColor="#16A81C" />
        </linearGradient>
        <linearGradient id={g('bevelR')} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6AFF55" />
          <stop offset="100%" stopColor="#1EBE24" />
        </linearGradient>
        <linearGradient id={g('girdle')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4AF03A" />
          <stop offset="100%" stopColor="#22C928" />
        </linearGradient>
        <linearGradient id={g('pavL')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#28D632" />
          <stop offset="100%" stopColor="#0A7A12" />
        </linearGradient>
        <linearGradient id={g('pavR')} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1EB824" />
          <stop offset="100%" stopColor="#086010" />
        </linearGradient>
        <linearGradient id={g('pavC')} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#3EE844" />
          <stop offset="55%" stopColor="#16A81C" />
          <stop offset="100%" stopColor="#0A7010" />
        </linearGradient>
      </defs>

      {/* Pavilion (bottom point) — drawn first so crown sits on top */}
      <polygon points="8,30 28,34 40,72" fill={`url(#${g('pavL')})`} />
      <polygon points="72,30 52,34 40,72" fill={`url(#${g('pavR')})`} />
      <polygon points="28,34 52,34 40,72" fill={`url(#${g('pavC')})`} />
      <polygon points="8,30 28,34 40,72 8,30" fill="#14A81E" opacity="0.35" />

      {/* Crown bevels from table corners to girdle tips */}
      <polygon points="24,12 8,30 28,34" fill={`url(#${g('bevelL')})`} />
      <polygon points="56,12 72,30 52,34" fill={`url(#${g('bevelR')})`} />
      <polygon points="24,12 28,34 40,30 40,12" fill="#5EFF4A" />
      <polygon points="56,12 52,34 40,30 40,12" fill="#3EE83A" />

      {/* Flat table (top face) */}
      <polygon points="24,12 56,12 52,22 28,22" fill={`url(#${g('table')})`} />

      {/* Girdle band across the widest part */}
      <polygon points="8,30 28,34 52,34 72,30 56,26 24,26" fill={`url(#${g('girdle')})`} opacity="0.9" />
      <polygon points="24,26 56,26 52,34 28,34" fill="#4AF03A" />

      {/* Facet lines */}
      <g stroke="#064A0A" strokeWidth="0.75" strokeOpacity="0.28" fill="none" strokeLinejoin="round">
        <polyline points="24,12 8,30 40,72 72,30 56,12" />
        <line x1="24" y1="12" x2="56" y2="12" />
        <line x1="8" y1="30" x2="72" y2="30" />
        <line x1="28" y1="34" x2="40" y2="72" />
        <line x1="52" y1="34" x2="40" y2="72" />
        <line x1="40" y1="12" x2="40" y2="30" />
        <line x1="28" y1="22" x2="28" y2="34" />
        <line x1="52" y1="22" x2="52" y2="34" />
      </g>

      {/* Specular highlight on table */}
      <polygon points="28,14 50,14 48,20 30,20" fill="#F0FFE8" opacity="0.5" />
    </svg>
  )
}
