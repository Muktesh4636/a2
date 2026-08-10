import { useId } from 'react'

type Props = { size?: number; dimmed?: boolean; glow?: boolean }

export function EggIcon({ size = 36, dimmed = false, glow = false }: Props) {
  const body = `${useId().replace(/:/g, '')}-egg`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 56"
      className={`egg-icon ${dimmed ? 'is-dimmed' : ''} ${glow ? 'is-glow' : ''}`}
      aria-hidden
    >
      <defs>
        <radialGradient id={body} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#E8F5E9" />
          <stop offset="45%" stopColor="#B7D4B8" />
          <stop offset="100%" stopColor="#7FA882" />
        </radialGradient>
      </defs>
      <ellipse cx="24" cy="30" rx="16" ry="22" fill={`url(#${body})`} />
      <ellipse cx="18" cy="22" rx="4" ry="3" fill="#5A8F5E" opacity="0.85" />
      <ellipse cx="28" cy="18" rx="3.5" ry="2.8" fill="#5A8F5E" opacity="0.75" />
      <ellipse cx="22" cy="34" rx="4.5" ry="3.2" fill="#4E7F52" />
      <ellipse cx="30" cy="38" rx="3.2" ry="2.5" fill="#5A8F5E" opacity="0.9" />
      <ellipse cx="16" cy="40" rx="2.8" ry="2.2" fill="#4E7F52" opacity="0.8" />
      <ellipse cx="26" cy="28" rx="2.4" ry="1.8" fill="#4E7F52" opacity="0.7" />
      <ellipse cx="19" cy="16" rx="5" ry="3" fill="#fff" opacity="0.35" />
    </svg>
  )
}
