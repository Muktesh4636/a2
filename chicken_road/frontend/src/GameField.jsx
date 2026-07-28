import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import {
  Application,
  Assets,
  Container,
  Sprite,
  Text,
  AnimatedSprite,
  Texture,
  Rectangle,
} from 'pixi.js'
import objectsAtlas from './atlases/objects.json'
import wallsAtlas from './atlases/walls.json'
import decorsAtlas from './atlases/decors.json'
import chickenIdleAtlas from './atlases/chicken_idle.json'
import chickenGoAtlas from './atlases/chicken_go.json'
import chickenJumpAtlas from './atlases/chicken_jump.json'
import miniFireAtlas from './atlases/mini_fire.json'

// Layout matched from chicken-road-97.inout.games (__PIXI_APP__)
const COL_GAP = 155
const COL_START = 232.5
const COL_Y = 400
const TOTAL = 24
const S = 0.25
const CS = 0.5
const START_X = 77.5
const CHICKEN_Y = 309 // center-anchored idle sprite
const DEAD_Y = CHICKEN_Y + 74
// Ground where the hen stands (dead sprite is bottom-anchored here)
const LAND_Y = DEAD_Y - COL_Y // column-local Y for fire base on the walking land
const FRONT_Y = 365
const START_DEC = { x: 128, y: 394 }
const BIG_FIRE_Y = 87
const MOVE_MS = 480
const DESIGN_W = 560
const BIG_FIRE_FRAMES = 21 // fire_0 .. fire_20

function stepX(step) {
  return step <= 0 ? START_X : COL_START + (step - 1) * COL_GAP
}

function slice(sheetTex, atlas) {
  const base = sheetTex.baseTexture
  const out = {}
  for (const [name, data] of Object.entries(atlas.frames)) {
    const f = data.frame
    out[name] = new Texture(base, new Rectangle(f.x, f.y, f.w, f.h))
  }
  return out
}

function frames(map, prefix, n) {
  const list = []
  for (let i = 0; i < n; i++) {
    const t = map[`${prefix}_${i}`]
    if (t) list.push(t)
  }
  return list
}

/** Solid color panel like the original game's lane/start fills */
function colorPanel(hex, w, h) {
  const s = new Sprite(Texture.WHITE)
  s.tint = hex
  s.anchor.set(0.5)
  s.width = w
  s.height = h
  return s
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function cancelMove(move) {
  if (move.raf) {
    cancelAnimationFrame(move.raf)
    move.raf = 0
  }
  if (move.timer) {
    clearInterval(move.timer)
    move.timer = 0
  }
  move.active = false
  move.last = 0
}

function placeChicken(s, x, y = CHICKEN_Y) {
  s.chicken.x = x
  s.chicken.y = y
  s.deadSpr.x = x
  s.deadSpr.y = DEAD_Y + (y - CHICKEN_Y)
}

function startMove(s, targetX, targetField) {
  const { chicken, field, move } = s
  cancelMove(move)

  if (Math.abs(chicken.x - targetX) < 2 && Math.abs(field.x - targetField) < 2) {
    placeChicken(s, targetX, CHICKEN_Y)
    field.x = targetField
    return
  }

  move.fromX = chicken.x
  move.toX = targetX
  move.fromField = field.x
  move.toField = targetField
  move.elapsed = 0
  move.active = true

  const apply = (t) => {
    const e = easeInOut(t)
    const x = move.fromX + (move.toX - move.fromX) * e
    const arc = Math.sin(Math.PI * e) * 55
    placeChicken(s, x, CHICKEN_Y - arc)
    field.x = move.fromField + (move.toField - move.fromField) * e
  }

  const tickMs = 16
  move.timer = setInterval(() => {
    if (!move.active) {
      cancelMove(move)
      return
    }
    move.elapsed += tickMs
    let t = move.elapsed / move.dur
    if (t >= 1) {
      placeChicken(s, move.toX, CHICKEN_Y)
      field.x = move.toField
      cancelMove(move)
      return
    }
    apply(t)
  }, tickMs)
}

function snapTo(s, targetX, targetField) {
  cancelMove(s.move)
  placeChicken(s, targetX, CHICKEN_Y)
  s.field.x = targetField
}

function clearTease(c) {
  if (c?._teaseTimeout) {
    clearTimeout(c._teaseTimeout)
    c._teaseTimeout = 0
  }
}

function hideTeaseFire(c) {
  if (!c?.fire || c.fire._burnLocked) return
  stopSpriteAnim(c.fire)
  c.fire.visible = false
  c.fire.gotoAndStop(0)
  try { c.fire.scale.set(0.25) } catch (_) {}
}

function stopTeaseFires(s) {
  if (!s) return
  s._teaseRunning = false
  if (s._teaseLoop) {
    clearTimeout(s._teaseLoop)
    s._teaseLoop = 0
  }
  if (s._teaseHide) {
    clearTimeout(s._teaseHide)
    s._teaseHide = 0
  }
  const prev = s._teaseCol
  s._teaseCol = -1
  if (prev >= 0) hideTeaseFire(s.columns?.[prev])
  s.columns?.forEach((c) => {
    if (!c?.fire?._burnLocked) hideTeaseFire(c)
  })
}

/** Next 3–4 empty routes ahead of the hen (on-screen lines) */
function visibleAheadIndexes(s) {
  const road = s.getRoad?.() || []
  const step = Math.max(0, s.getStep?.() ?? 0)
  const out = []
  for (let i = step; i < road.length && out.length < 4; i++) {
    if (road[i] && !road[i].revealed) out.push(i)
  }
  return out
}

function showTeaseOn(s, colIdx) {
  const c = s.columns?.[colIdx]
  if (!c?.fire) return false
  s._teaseCol = colIdx
  c.fire._burnLocked = false
  try { c.fire.scale.set(0.34) } catch (_) {}
  runSpriteAnim(c.fire, { speed: 0.55, loop: true, from: 0 })
  c.fire.visible = true
  return true
}

/**
 * Walk fire across the next 3–4 visible lines, one after another:
 * line1 → disappear → line2 → line3 → line4 → line1 …
 * Each line gets a turn about every 7 seconds.
 */
function scheduleTeaseLoop(s) {
  if (!s) return
  stopTeaseFires(s)
  s._teaseRunning = true
  s._teaseSeq = 0

  const hideCurrent = () => {
    if (s._teaseHide) {
      clearTimeout(s._teaseHide)
      s._teaseHide = 0
    }
    const prev = s._teaseCol
    s._teaseCol = -1
    if (prev >= 0) hideTeaseFire(s.columns?.[prev])
  }

  const runOnce = () => {
    if (!s._teaseRunning || !s.isPlaying?.()) {
      hideCurrent()
      s._teaseRunning = false
      s._teaseLoop = 0
      return
    }

    hideCurrent()

    const lanes = visibleAheadIndexes(s)
    if (!lanes.length) {
      s._teaseLoop = setTimeout(runOnce, 2000)
      return
    }

    if (s._teaseSeq >= lanes.length) s._teaseSeq = 0
    const colIdx = lanes[s._teaseSeq]
    s._teaseSeq += 1

    if (!showTeaseOn(s, colIdx)) {
      s._teaseLoop = setTimeout(runOnce, 500)
      return
    }

    const n = Math.max(1, lanes.length)
    const slotMs = Math.floor(7000 / n) // ~7s before the same line fires again
    const showMs = Math.max(900, Math.min(slotMs - 300, Math.floor(slotMs * 0.7)))

    // Hide when this line's turn is done (does not control the clock)
    s._teaseHide = setTimeout(() => {
      s._teaseHide = 0
      if (s._teaseCol === colIdx) {
        s._teaseCol = -1
        hideTeaseFire(s.columns?.[colIdx])
      }
    }, showMs)

    // Next line starts exactly one slot after this line started
    s._teaseLoop = setTimeout(runOnce, slotMs)
  }

  // First visible line immediately
  s._teaseLoop = setTimeout(runOnce, 150)
}

function syncTeaseFires(s, _road, playing) {
  if (!s?.columns) return
  if (!playing) {
    stopTeaseFires(s)
    return
  }
  if (!s._teaseRunning) scheduleTeaseLoop(s)
}

function applyLaneState(s, road, playing = false) {
  road?.forEach((oven, i) => {
    const c = s.columns[i]
    if (!c) return
    c.lukeDefault.visible = !oven.revealed
    c.lukeGreen.visible = !!(oven.revealed && oven.safe)
    c.lukeRed.visible = !!(oven.revealed && !oven.safe)
    c.mult.visible = !(oven.revealed && !oven.safe)
    const m = Number(oven.mult)
    c.mult.text = m >= 1000 ? `${(m / 1000).toFixed(1)}kx` : `${m.toFixed(2)}x`

    const burned = !!(oven.revealed && !oven.safe)
    const isTease = !!(playing && s._teaseCol === i && !oven.revealed)
    c.fire._burnLocked = burned

    if (burned) {
      if (s._teaseCol === i) s._teaseCol = -1
      try { c.fire.scale.set(0.25) } catch (_) {}
      if (!c.fire.visible || !c.fire._animTimer) {
        runSpriteAnim(c.fire, { speed: 0.5, loop: true, from: 0 })
      }
    } else if (isTease) {
      // sequential campfire owns this sprite
    } else {
      if (s._teaseCol === i) s._teaseCol = -1
      hideTeaseFire(c)
    }
  })
  syncTeaseFires(s, road, playing)
}

function stopSpriteAnim(spr) {
  if (spr?._animTimer) {
    clearInterval(spr._animTimer)
    spr._animTimer = 0
  }
}

/**
 * Manually step AnimatedSprite frames (Pixi shared ticker is unreliable here).
 * speed ≈ Pixi animationSpeed (frames per tick at 60fps).
 */
function runSpriteAnim(spr, { speed = 0.3, loop = false, from = 0, onDone } = {}) {
  if (!spr?.textures?.length) return
  stopSpriteAnim(spr)
  // Disable Pixi auto ticker so we fully own the playback
  try {
    spr.stop()
    spr.autoUpdate = false
  } catch (_) {}

  let frame = from
  spr.gotoAndStop(frame)
  spr.visible = true

  // animationSpeed 0.3 @ 60fps ⇒ ~18 fps ⇒ ~55ms/frame
  const ms = Math.max(16, Math.round(1000 / (60 * speed)))
  spr._animTimer = setInterval(() => {
    frame += 1
    if (frame >= spr.textures.length) {
      if (loop) {
        frame = 0
        spr.gotoAndStop(frame)
      } else {
        stopSpriteAnim(spr)
        onDone?.(spr)
      }
      return
    }
    spr.gotoAndStop(frame)
  }, ms)
}

function playDeathFire(s, step) {
  if (!s?.bigFire) return
  const x = stepX(step)
  s.bigFire.position.set(x, BIG_FIRE_Y)
  s.bigFire.alpha = 1
  s.bigFire.scale.set(0.5)

  // Tall fire spike: shoots up through frames, then disappears (same as InOut)
  runSpriteAnim(s.bigFire, {
    speed: 0.35,
    loop: false,
    from: 0,
    onDone: (spr) => {
      spr.visible = false
      spr.gotoAndStop(0)
    },
  })

  // Mini fire on the burned oven grate — keeps flickering
  const colIdx = Math.max(0, step - 1)
  const col = s.columns[colIdx]
  if (col?.fire) {
    runSpriteAnim(col.fire, { speed: 0.5, loop: true, from: 0 })
  }
}

function hideDeathFire(s) {
  if (!s?.bigFire) return
  stopSpriteAnim(s.bigFire)
  s.bigFire.visible = false
  s.bigFire.gotoAndStop(0)
  s.columns?.forEach((c) => {
    if (!c?.fire) return
    // leave mini fire looping if that oven stays burned; only stop big burst
  })
}

function applyAnim(s, anim) {
  const { chicken, deadSpr, idleF, goF, jumpF } = s
  if (anim === 'dead') {
    chicken.visible = false
    deadSpr.visible = true
    deadSpr.x = chicken.x
    deadSpr.y = DEAD_Y
    return
  }
  hideDeathFire(s)
  chicken.visible = true
  deadSpr.visible = false
  const f = anim === 'jump' ? jumpF : anim === 'go' ? goF : idleF
  if (f?.length && chicken.textures !== f) {
    chicken.textures = f
    chicken.animationSpeed = anim === 'jump' ? 0.45 : anim === 'go' ? 0.4 : 0.3
    chicken.gotoAndPlay(0)
  }
}

function applyVisual(s, { road, step, anim, playing }, { animate = true } = {}) {
  if (!s?.columns) return

  applyLaneState(s, road, playing)
  // Front arch only covers the hen while she's still in the start doorway
  if (s.front) s.front.visible = step === 0 && anim !== 'dead'

  const targetX = stepX(step)
  const targetField = -Math.max(0, targetX - START_X)
  const needsMove = Math.abs(s.chicken.x - targetX) > 2

  if (anim === 'dead') {
    snapTo(s, targetX, targetField)
    applyAnim(s, anim)
    // Burst the tall fire once when the hen gets burned
    if (s.lastDeathStep !== step) {
      s.lastDeathStep = step
      playDeathFire(s, step)
    }
    s.prevStep = step
    return
  }

  s.lastDeathStep = null

  if (needsMove && animate && step !== s.prevStep) {
    if (!(s.move.active && Math.abs(s.move.toX - targetX) < 1)) {
      startMove(s, targetX, targetField)
    }
  } else if (needsMove && animate && (anim === 'jump' || anim === 'go')) {
    if (!(s.move.active && Math.abs(s.move.toX - targetX) < 1)) {
      startMove(s, targetX, targetField)
    }
  } else if (!s.move.active && needsMove) {
    snapTo(s, targetX, targetField)
  } else if (!s.move.active && !needsMove) {
    placeChicken(s, targetX, CHICKEN_Y)
  }

  applyAnim(s, anim)
  s.prevStep = step
}

const BRICK_Y = { brick1: -140, brick2: -370, brick0: -342 }

const GameField = forwardRef(function GameField({ road, step, anim, playing = false, onReady }, ref) {
  const hostRef = useRef(null)
  const st = useRef(null)
  const propsRef = useRef({ road, step, anim, playing })
  propsRef.current = { road, step, anim, playing }

  useImperativeHandle(ref, () => ({
    moveToStep(nextStep) {
      const s = st.current
      if (!s?.ready) return
      const targetX = stepX(nextStep)
      const targetField = -Math.max(0, targetX - START_X)
      startMove(s, targetX, targetField)
      s.prevStep = nextStep
    },
    playDeathFire(step) {
      const s = st.current
      if (!s?.ready) return
      s.lastDeathStep = step
      playDeathFire(s, step)
    },
  }))

  useEffect(() => {
    let dead = false
    let app
    let ro
    let onVis

    ;(async () => {
      const host = hostRef.current
      if (!host) return

      try {
        app = new Application({
          backgroundColor: 0x161824,
          antialias: true,
          preserveDrawingBuffer: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
          width: host.clientWidth || 390,
          height: host.clientHeight || 420,
        })
        if (dead) {
          app.destroy(true)
          return
        }
        host.replaceChildren(app.view)
        window.__pixiApp = app

        const [objectsImg, wallsImg, decorsImg, idleImg, goImg, jumpImg, fireImg, deadImg, ...bigFireImgs] =
          await Promise.all([
            Assets.load(`${import.meta.env.BASE_URL}assets/sprites/objects.png`),
            Assets.load(`${import.meta.env.BASE_URL}assets/sprites/walls.png`),
            Assets.load(`${import.meta.env.BASE_URL}assets/sprites/decors.png`),
            Assets.load(`${import.meta.env.BASE_URL}assets/sprites/chicken_idle.png`),
            Assets.load(`${import.meta.env.BASE_URL}assets/sprites/chicken_go.png`),
            Assets.load(`${import.meta.env.BASE_URL}assets/sprites/chicken_jump.png`),
            Assets.load(`${import.meta.env.BASE_URL}assets/sprites/mini_fire.png`),
            Assets.load(`${import.meta.env.BASE_URL}assets/sprites/chicken_dead.png`),
            ...Array.from({ length: BIG_FIRE_FRAMES }, (_, i) =>
              Assets.load(`${import.meta.env.BASE_URL}assets/sprites/fire_${i}.png`),
            ),
          ])
        if (dead) return

        const obj = slice(objectsImg, objectsAtlas)
        const wall = slice(wallsImg, wallsAtlas)
        const decor = slice(decorsImg, decorsAtlas)
        const idleMap = slice(idleImg, chickenIdleAtlas)
        const goMap = slice(goImg, chickenGoAtlas)
        const jumpMap = slice(jumpImg, chickenJumpAtlas)
        const fireMap = slice(fireImg, miniFireAtlas)
        const bigFireTextures = bigFireImgs.filter(Boolean)

        const root = new Container()
        app.stage.addChild(root)
        const field = new Container()
        field.sortableChildren = true
        root.addChild(field)

        // Exact original order: wall fill → brick boxes → start arch → road
        // Tall fill behind the two brick boxes above the hen (#2d324d)
        const startFill = colorPanel(0x2d324d, 160, 570)
        startFill.position.set(80, 92.5)
        startFill.zIndex = 0
        field.addChild(startFill)

        // Two dark brick boxes above the hen
        ;[[80, 60], [20, 0]].forEach(([x, y]) => {
          const b = new Sprite(decor.brick_dark)
          b.scale.set(S)
          b.position.set(x, y)
          b.zIndex = 1
          field.addChild(b)
        })

        // Start tunnel (behind hen) — anchor bottom-right like original
        const startDec = new Sprite(wall.start_decoration)
        startDec.anchor.set(1, 1)
        startDec.scale.set(S)
        startDec.position.set(START_DEC.x, START_DEC.y)
        startDec.zIndex = 2
        field.addChild(startDec)

        // Start road strip under the doorway
        const startRoad = new Sprite(decor.bottomRect0)
        startRoad.anchor.set(0, 1)
        startRoad.scale.set(S)
        startRoad.position.set(0, COL_Y)
        startRoad.zIndex = 2
        field.addChild(startRoad)

        const columns = []
        const brickCycle = ['brick1', 'brick2', 'brick0']

        for (let i = 0; i < TOTAL; i++) {
          const col = new Container()
          const cx = COL_START + i * COL_GAP
          col.position.set(cx, COL_Y)
          col.zIndex = 3
          field.addChild(col)

          // Lane background fill (original #3e4464)
          const laneFill = colorPanel(0x3e4464, 155, 570)
          laneFill.position.set(0, -307.5)
          col.addChild(laneFill)

          ;[-173, -450.5].forEach((yy) => {
            const d = new Sprite(wall.dash_line)
            d.anchor.set(0.5, 0.5)
            d.scale.set(S)
            d.position.set(75.5, yy)
            col.addChild(d)
          })

          const grate = new Sprite(decor.road_decor)
          grate.anchor.set(0.5, 0.5)
          grate.scale.set(S)
          grate.position.set(0, -55)
          col.addChild(grate)

          const bn = brickCycle[i % 3]
          const brick = new Sprite(decor[bn])
          brick.anchor.set(0, 0)
          brick.scale.set(S)
          brick.position.set(-56, BRICK_Y[bn])
          col.addChild(brick)

          const lukeBox = new Container()
          lukeBox.y = -220
          col.addChild(lukeBox)

          const lukeEmpty = new Sprite(obj.luke_empty)
          lukeEmpty.anchor.set(0.5)
          lukeEmpty.scale.set(S)
          lukeEmpty.alpha = 0.5
          lukeBox.addChild(lukeEmpty)

          const lukeDefault = new Sprite(obj.luke_default)
          lukeDefault.anchor.set(0.5)
          lukeDefault.scale.set(S)
          lukeBox.addChild(lukeDefault)

          const lukeGreen = new Sprite(obj.luke_green)
          lukeGreen.anchor.set(0.5)
          lukeGreen.scale.set(S)
          lukeGreen.visible = false
          lukeBox.addChild(lukeGreen)

          const lukeRed = new Sprite(obj.luke_red)
          lukeRed.anchor.set(0.5)
          lukeRed.scale.set(S)
          lukeRed.visible = false
          lukeBox.addChild(lukeRed)

          const mult = new Text('1.03x', {
            fontFamily: 'Montserrat, Arial, sans-serif',
            fontSize: 48,
            fontWeight: '700',
            fill: 0xc8d0e4,
          })
          mult.anchor.set(0.5)
          mult.scale.set(0.42)
          const initM = propsRef.current.road?.[i]?.mult
          if (initM) mult.text = `${Number(initM).toFixed(2)}x`
          lukeBox.addChild(mult)

          // Small ledge under the multiplier (original buttonRect)
          if (decor.whiteRect) {
            const buttonRect = new Sprite(decor.whiteRect)
            buttonRect.anchor.set(0.5, 1)
            buttonRect.scale.set(S)
            buttonRect.position.set(-1, -22)
            col.addChild(buttonRect)
          }

          const bottom = new Sprite(decor[i % 2 ? 'bottomRect0' : 'bottomRect1'])
          bottom.anchor.set(0.5, 1)
          bottom.scale.set(S)
          bottom.position.set(0, 0)
          col.addChild(bottom)

          // Fire sits on the same ground the hen stands on (bottom-anchored at land level)
          const fireList = frames(fireMap, 'mini_fire', 11)
          const fire = new AnimatedSprite(fireList.length ? fireList : [obj.luke_red])
          fire.anchor.set(0.5, 1)
          fire.scale.set(S)
          fire.position.set(0, LAND_Y)
          fire.animationSpeed = 0.5
          fire.loop = true
          fire.autoUpdate = false
          fire.visible = false
          fire.gotoAndStop(0)
          col.addChild(fire)

          columns.push({ lukeDefault, lukeGreen, lukeRed, mult, fire, x: cx, _teaseTimeout: 0 })
        }

        const exit = new Sprite(wall.exit_decoration)
        exit.anchor.set(0.5, 1)
        exit.scale.set(S)
        exit.position.set(COL_START + TOTAL * COL_GAP + 30, COL_Y - 25)
        exit.zIndex = 3
        field.addChild(exit)

        const idleF = frames(idleMap, 'chicken_idle', 23)
        const goF = frames(goMap, 'chicken_go', 16)
        const jumpF = frames(jumpMap, 'chicken_jump', 10)

        // Hen — center anchor so she sits inside the doorway like 4rabet
        const chicken = new AnimatedSprite(idleF)
        chicken.anchor.set(0.5, 0.5)
        chicken.scale.set(CS)
        chicken.position.set(START_X, CHICKEN_Y)
        chicken.animationSpeed = 0.3
        chicken.zIndex = 4
        chicken.play()
        field.addChild(chicken)

        const deadSpr = new Sprite(deadImg)
        deadSpr.anchor.set(0.5, 1)
        deadSpr.scale.set(0.3)
        deadSpr.position.set(START_X, DEAD_Y)
        deadSpr.visible = false
        deadSpr.zIndex = 4
        field.addChild(deadSpr)

        // Tall death fire burst (fire_0..fire_20) — plays once when hen is burned
        const bigFire = new AnimatedSprite(
          bigFireTextures.length ? bigFireTextures : [Texture.WHITE],
        )
        bigFire.anchor.set(0.5, 0.5)
        bigFire.scale.set(0.5)
        bigFire.position.set(START_X, BIG_FIRE_Y)
        bigFire.animationSpeed = 0.3
        bigFire.loop = false
        bigFire.autoUpdate = false
        bigFire.visible = false
        bigFire.zIndex = 6
        field.addChild(bigFire)

        // Front arch drawn ON TOP of the hen so only her head peeks out
        const front = new Sprite(wall.start_front_decoration)
        front.anchor.set(1, 1)
        front.scale.set(S)
        front.position.set(START_X, FRONT_Y)
        front.zIndex = 5
        field.addChild(front)

        const move = {
          active: false,
          fromX: START_X,
          toX: START_X,
          fromField: 0,
          toField: 0,
          elapsed: 0,
          last: 0,
          dur: MOVE_MS,
          raf: 0,
          timer: 0,
        }

        const fit = () => {
          const w = host.clientWidth || 390
          const h = host.clientHeight || 420
          app.renderer.resize(w, h)
          const scale = w / DESIGN_W
          root.scale.set(scale)
          root.x = 0
          // Pin road (y=400) to the bottom of the playfield
          root.y = h - COL_Y * scale
        }
        fit()
        ro = new ResizeObserver(fit)
        ro.observe(host)

        app.ticker.start()
        onVis = () => {
          if (document.visibilityState === 'visible') app.ticker.start()
        }
        document.addEventListener('visibilitychange', onVis)

        st.current = {
          app,
          field,
          columns,
          chicken,
          deadSpr,
          bigFire,
          idleF,
          goF,
          jumpF,
          front,
          move,
          ready: true,
          prevStep: propsRef.current.step ?? 0,
          lastDeathStep: null,
          getRoad: () => propsRef.current.road,
          getStep: () => propsRef.current.step ?? 0,
          isPlaying: () => !!propsRef.current.playing,
          _teaseLoop: 0,
          _teaseHide: 0,
          _teaseWatch: 0,
          _teaseCol: -1,
          _lastTeaseCol: -1,
          _teaseSeq: 0,
          _teaseRunning: false,
          playDeathFire: (step) => playDeathFire(st.current, step),
        }
        window.__gf = st.current
        window.__playDeathFire = (step = 1) => playDeathFire(st.current, step)

        applyVisual(st.current, propsRef.current, { animate: false })
        onReady?.()
      } catch (err) {
        console.error('[GameField] boot failed', err)
        window.__pixiErr = String(err?.stack || err)
      }
    })()

    return () => {
      dead = true
      ro?.disconnect()
      if (onVis) document.removeEventListener('visibilitychange', onVis)
      cancelMove(st.current?.move || { raf: 0, active: false })
      stopSpriteAnim(st.current?.bigFire)
      stopTeaseFires(st.current)
      st.current?.columns?.forEach((c) => stopSpriteAnim(c?.fire))
      try {
        app?.destroy(true, { children: true })
      } catch (_) {}
    }
  }, [])

  useEffect(() => {
    applyVisual(st.current, { road, step, anim, playing }, { animate: true })
  }, [road, step, anim, playing])

  return <div ref={hostRef} className="game-canvas" />
})

export default GameField
