export function SnakeIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className="snake-icon" aria-hidden>
      <ellipse cx="24" cy="26" rx="14" ry="12" fill="#6b7280" />
      <ellipse cx="24" cy="22" rx="11" ry="10" fill="#9ca3af" />
      <circle cx="19" cy="20" r="2.2" fill="#111827" />
      <circle cx="29" cy="20" r="2.2" fill="#111827" />
      <circle cx="18.3" cy="19.2" r="0.7" fill="#fff" />
      <circle cx="28.3" cy="19.2" r="0.7" fill="#fff" />
      <path d="M20 28 Q24 32 28 28" fill="none" stroke="#374151" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M24 30 L24 38 M24 38 L20 42 M24 38 L28 42" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 18 Q8 10 14 8" fill="none" stroke="#6b7280" strokeWidth="3" strokeLinecap="round" />
      <path d="M36 18 Q40 10 34 8" fill="none" stroke="#6b7280" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
