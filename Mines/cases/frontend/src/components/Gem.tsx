type Props = {
  tone?: string
  size?: number
}

const FILL: Record<string, [string, string]> = {
  slate: ['#94a3b8', '#64748b'],
  cyan: ['#67e8f9', '#22d3ee'],
  blue: ['#60a5fa', '#3b82f6'],
  red: ['#f87171', '#ef4444'],
  gold: ['#fbbf24', '#f59e0b'],
}

export function Gem({ tone = 'slate', size = 52 }: Props) {
  const [a, b] = FILL[tone] ?? FILL.slate
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="case-gem"
      aria-hidden
    >
      <defs>
        <linearGradient id={`gem-${tone}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={a} />
          <stop offset="100%" stopColor={b} />
        </linearGradient>
      </defs>
      <polygon
        points="32,4 52,16 58,36 44,56 20,56 6,36 12,16"
        fill={`url(#gem-${tone})`}
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="2"
      />
      <polygon
        points="32,10 46,18 50,34 40,48 24,48 14,34 18,18"
        fill="rgba(255,255,255,0.18)"
      />
    </svg>
  )
}
