import { useEffect, useRef } from 'react'

type Props = {
  value: number
  rolling?: boolean
  delay?: number
}

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [28, 28],
    [50, 50],
    [72, 72],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [28, 24],
    [72, 24],
    [28, 50],
    [72, 50],
    [28, 76],
    [72, 76],
  ],
}

/**
 * Resting rotation that puts this number on the TOP of the die
 * (how real dice are read). Aesthetic tilt on `.dice-tilt` looks down at that face.
 */
const TOP_FACE_ROT: Record<number, { x: number; y: number }> = {
  1: { x: 90, y: 0 },
  2: { x: 0, y: 0 },
  3: { x: 90, y: -90 },
  4: { x: 90, y: 90 },
  5: { x: 180, y: 0 },
  6: { x: 90, y: 180 },
}

function faceTransform(face: number, extraX = 0, extraY = 0, z = 0, yPx = 0) {
  const { x, y } = TOP_FACE_ROT[face] ?? TOP_FACE_ROT[1]
  return `translateY(${yPx}px) rotateX(${x + extraX}deg) rotateY(${y + extraY}deg) rotateZ(${z}deg)`
}

function Face({ n }: { n: number }) {
  return (
    <div className={`cube-face face-${n}`} aria-hidden>
      {(PIPS[n] ?? PIPS[1]).map(([x, y], i) => (
        <span
          key={i}
          className="pip"
          style={{ left: `${x}%`, top: `${y}%` }}
        />
      ))}
    </div>
  )
}

export function Dice({ value, rolling = false, delay = 0 }: Props) {
  const face = Math.min(6, Math.max(1, value || 1))
  const cubeRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const tumbleRef = useRef<Animation | null>(null)
  const bounceRef = useRef<Animation | null>(null)
  const settleRef = useRef<Animation | null>(null)
  const wasRolling = useRef(false)
  const shownFace = useRef(face)

  useEffect(() => {
    const cube = cubeRef.current
    const scene = sceneRef.current
    if (!cube || !scene) return

    const stopLoop = () => {
      tumbleRef.current?.cancel()
      bounceRef.current?.cancel()
      tumbleRef.current = null
      bounceRef.current = null
    }

    if (rolling) {
      settleRef.current?.cancel()
      settleRef.current = null
      wasRolling.current = true
      stopLoop()

      const seed = 40 + Math.random() * 280
      tumbleRef.current = cube.animate(
        [
          {
            transform: `translateY(0px) rotateX(${seed}deg) rotateY(${seed * 0.7}deg) rotateZ(0deg)`,
          },
          {
            transform: `translateY(-14px) rotateX(${seed + 200}deg) rotateY(${seed - 170}deg) rotateZ(80deg)`,
          },
          {
            transform: `translateY(-4px) rotateX(${seed + 400}deg) rotateY(${seed + 250}deg) rotateZ(-55deg)`,
          },
          {
            transform: `translateY(-16px) rotateX(${seed + 610}deg) rotateY(${seed - 340}deg) rotateZ(110deg)`,
          },
          {
            transform: `translateY(0px) rotateX(${seed + 720}deg) rotateY(${seed + 360}deg) rotateZ(0deg)`,
          },
        ],
        {
          duration: 620,
          iterations: Infinity,
          easing: 'linear',
          delay,
        },
      )

      bounceRef.current = scene.animate(
        [
          { transform: 'translateY(0px) scale(1)' },
          { transform: 'translateY(-7px) scale(1.03)', offset: 0.32 },
          { transform: 'translateY(2px) scale(0.98)', offset: 0.68 },
          { transform: 'translateY(0px) scale(1)' },
        ],
        {
          duration: 360,
          iterations: Infinity,
          easing: 'ease-in-out',
          delay,
        },
      )
      return () => stopLoop()
    }

    // After a throw: decelerate through spins and land on the result face
    if (wasRolling.current) {
      stopLoop()
      wasRolling.current = false
      shownFace.current = face

      const spinsX = 2 + Math.floor(Math.random() * 2)
      const spinsY = 3 + Math.floor(Math.random() * 2)
      const wobbleZ = 30 + Math.random() * 50

      settleRef.current?.cancel()
      const anim = cube.animate(
        [
          {
            transform: faceTransform(face, 360 * spinsX, 360 * spinsY, wobbleZ, -16),
            offset: 0,
          },
          {
            transform: faceTransform(face, 120, -80, wobbleZ * 0.45, -6),
            offset: 0.45,
          },
          {
            transform: faceTransform(face, -12, 10, 8, 4),
            offset: 0.72,
          },
          {
            transform: faceTransform(face, 5, -4, -3, -2),
            offset: 0.88,
          },
          {
            transform: faceTransform(face, 0, 0, 0, 0),
            offset: 1,
          },
        ],
        {
          duration: 1200 + delay * 0.25,
          easing: 'cubic-bezier(0.11, 0.75, 0.18, 1)',
          fill: 'forwards',
          delay: delay * 0.2,
        },
      )
      settleRef.current = anim

      scene.animate(
        [
          { transform: 'translateY(-8px) scale(1.07)' },
          { transform: 'translateY(5px) scale(0.93)', offset: 0.4 },
          { transform: 'translateY(-2px) scale(1.03)', offset: 0.68 },
          { transform: 'translateY(1px) scale(0.99)', offset: 0.85 },
          { transform: 'translateY(0px) scale(1)' },
        ],
        {
          duration: 780,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          delay: delay * 0.2,
        },
      )

      anim.finished
        .then(() => {
          if (settleRef.current === anim) {
            cube.style.transform = faceTransform(face)
            settleRef.current = null
          }
        })
        .catch(() => {
          /* cancelled */
        })

      return () => {
        anim.cancel()
        if (settleRef.current === anim) settleRef.current = null
      }
    }

    // Idle / face change without a roll
    if (shownFace.current !== face && !settleRef.current) {
      shownFace.current = face
      cube.style.transform = faceTransform(face)
    } else if (!settleRef.current && !cube.style.transform) {
      cube.style.transform = faceTransform(face)
    }
  }, [rolling, face, delay])

  // Initial paint
  useEffect(() => {
    const cube = cubeRef.current
    if (cube && !cube.style.transform) {
      cube.style.transform = faceTransform(face)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={sceneRef}
      className="dice-scene"
      aria-label={`Die showing ${face}`}
    >
      <div className="dice-tilt">
        <div ref={cubeRef} className="dice-cube">
          <Face n={1} />
          <Face n={2} />
          <Face n={3} />
          <Face n={4} />
          <Face n={5} />
          <Face n={6} />
        </div>
      </div>
    </div>
  )
}
