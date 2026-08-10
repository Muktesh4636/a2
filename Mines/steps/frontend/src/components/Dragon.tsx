export function Dragon() {
  return (
    <svg className="dragon" viewBox="0 0 200 90" aria-hidden>
      <defs>
        <linearGradient id="stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9AA6B2" />
          <stop offset="100%" stopColor="#5C6B78" />
        </linearGradient>
        <radialGradient id="eye" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#E8FFD8" />
          <stop offset="40%" stopColor="#7CFF6B" />
          <stop offset="100%" stopColor="#00E701" />
        </radialGradient>
      </defs>
      {/* Wings */}
      <path d="M70 48 C40 30, 18 38, 12 55 C28 48, 48 52, 62 62 Z" fill="url(#stone)" />
      <path d="M130 48 C160 30, 182 38, 188 55 C172 48, 152 52, 138 62 Z" fill="url(#stone)" />
      {/* Head */}
      <ellipse cx="100" cy="52" rx="38" ry="28" fill="url(#stone)" />
      {/* Horns */}
      <path d="M78 34 L72 12 L86 30 Z" fill="#7A8794" />
      <path d="M122 34 L128 12 L114 30 Z" fill="#7A8794" />
      {/* Crest flame */}
      <path d="M100 8 C96 18, 104 18, 100 28 C108 18, 104 10, 100 8 Z" fill="#00E701" />
      {/* Snout */}
      <ellipse cx="100" cy="62" rx="18" ry="12" fill="#6B7885" />
      {/* Eyes */}
      <circle cx="86" cy="48" r="6" fill="url(#eye)" />
      <circle cx="114" cy="48" r="6" fill="url(#eye)" />
      <circle cx="86" cy="48" r="2.2" fill="#06240A" />
      <circle cx="114" cy="48" r="2.2" fill="#06240A" />
      {/* Mouth glow */}
      <ellipse cx="100" cy="68" rx="8" ry="3" fill="#00E701" opacity="0.85" />
      {/* Nostrils */}
      <circle cx="94" cy="64" r="1.5" fill="#2A3340" />
      <circle cx="106" cy="64" r="1.5" fill="#2A3340" />
    </svg>
  )
}
