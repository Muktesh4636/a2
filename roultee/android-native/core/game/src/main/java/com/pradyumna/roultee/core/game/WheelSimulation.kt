package com.pradyumna.roultee.core.game

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.sign
import kotlin.math.sin

data class WheelPose(
    val rotorAngle: Double,
    val ballX: Double,
    val ballY: Double,
    val ballZ: Double,
    val ballRotX: Double,
    val ballRotZ: Double,
    val phase: SpinPhase,
    val winningNumber: Int?,
    val camera: CameraPose,
)

/**
 * Deterministic port of the web ball/rotor simulation in app.js.
 * Emits a winning number once when transitioning locked → settled.
 */
class WheelSimulation(
    private val random: SeededRandom = SeededRandom(),
) {
    var phase: SpinPhase = SpinPhase.IDLE
        private set
    var rotorAngle: Double = 0.0
        private set
    var rotorSpeed: Double = 0.0
        private set

    var angle: Double = 0.0
        private set
    var speed: Double = 0.0
        private set
    var radius: Double = WheelConstants.TRACK_R
        private set
    var y: Double = WheelConstants.TRACK_Y
        private set
    var targetIdx: Int = 0
        private set
    var bounce: Double = 0.0
        private set

    private var lastDeflector: Int = -1
    private var lastPipe: Int = -1
    private var rattleT: Double = 0.0
    private var raceT: Double = 0.0
    private var lockT: Double = 0.0
    private var announced: Boolean = false
    private var ballRotX: Double = 0.0
    private var ballRotZ: Double = 0.0
    private var raceTimeAccum: Double = 0.0

    val camera = CameraZoom()
    private var lastCamera: CameraPose = CameraPose(
        0.0, WheelConstants.CAM_DEFAULT_Y, WheelConstants.CAM_DEFAULT_Z,
        0.0, WheelConstants.CAM_TARGET_Y, 0.0,
    )

    fun isBusy(): Boolean = phase.isBusy()

    fun launch() {
        if (isBusy()) return
        announced = false
        camera.zoomOut()
        targetIdx = 0
        phase = SpinPhase.RACING
        radius = WheelConstants.TRACK_R
        y = WheelConstants.TRACK_Y
        speed = -(4.8 + random.nextDouble() * 1.1)
        angle = random.nextDouble() * PI * 2
        bounce = 0.0
        lastDeflector = -1
        lastPipe = -1
        rattleT = 0.0
        raceT = 0.0
        lockT = 0.0
        raceTimeAccum = 0.0
        rotorSpeed = WheelConstants.ROTOR_SPIN_SPEED
    }

    /**
     * Advance simulation by [dt] seconds (clamped like the web animate loop).
     * @return winning number when result is first announced, else null
     */
    fun update(dtRaw: Double): Int? {
        val dt = dtRaw.coerceAtMost(0.05)
        rotorAngle += rotorSpeed * dt

        var result: Int? = null
        val py = WheelConstants.pocketY()

        if (phase == SpinPhase.IDLE || phase == SpinPhase.SETTLED || phase == SpinPhase.LOCKED) {
            val a = rotorAngle + pocketLocalAngle(targetIdx)
            angle = a
            radius = WheelConstants.POCKET_R
            y = py
            if (phase == SpinPhase.LOCKED) {
                lockT += dt
                rotorSpeed = (rotorSpeed - dt * 0.55).coerceAtLeast(0.0)
                if (!announced &&
                    lockT >= WheelConstants.RESULT_LOCK_DELAY &&
                    rotorSpeed <= WheelConstants.RESULT_ROTOR_MAX
                ) {
                    result = numberAtPocket(targetIdx)
                    announced = true
                    phase = SpinPhase.SETTLED
                    camera.zoomIn()
                }
            }
        } else {
            if (bounce > 0) bounce = (bounce - dt * 0.045).coerceAtLeast(0.0)

            when (phase) {
                SpinPhase.RACING, SpinPhase.SPIRALING -> updateRacingOrSpiral(dt, py)
                SpinPhase.RATTLING -> updateRattling(dt, py)
                else -> Unit
            }

            if (phase != SpinPhase.LOCKED && phase != SpinPhase.SETTLED) {
                ballRotX += abs(speed) * dt * 2.2
                ballRotZ -= speed * dt * 1.4
            }
        }

        return result
    }

    fun pose(): WheelPose {
        val bx = cos(angle) * radius
        val bz = sin(angle) * radius
        return WheelPose(
            rotorAngle = rotorAngle,
            ballX = bx,
            ballY = y,
            ballZ = bz,
            ballRotX = ballRotX,
            ballRotZ = ballRotZ,
            phase = phase,
            winningNumber = if (announced) numberAtPocket(targetIdx) else null,
            camera = lastCamera,
        )
    }

    fun updateCamera(dt: Double): CameraPose {
        val bx = cos(angle) * radius
        val bz = sin(angle) * radius
        lastCamera = camera.update(dt.coerceAtMost(0.05), bx, y, bz)
        return lastCamera
    }

    private fun ballLocalAngle(): Double = wrapPi(angle - rotorAngle)

    private fun updateRacingOrSpiral(dt: Double, py: Double) {
        raceT += dt
        raceTimeAccum += dt

        val friction = if (phase == SpinPhase.RACING) 0.34 else 0.42
        speed += sign(speed) * -friction * dt
        val minSpin = if (phase == SpinPhase.RACING) 1.35 else 0.45
        if (abs(speed) < minSpin) {
            speed = sign(if (speed == 0.0) -1.0 else speed) * minSpin
        }
        angle += speed * dt

        val absSpeed = abs(speed)
        if (phase == SpinPhase.RACING && (absSpeed < WheelConstants.HOLD_SPEED || raceT > 7.5)) {
            phase = SpinPhase.SPIRALING
        }

        val desiredR = if (phase == SpinPhase.RACING) {
            WheelConstants.TRACK_R + sin(raceTimeAccum * 9.0) * 0.004
        } else {
            val spiralT = (raceT - 6.5).coerceAtLeast(0.0)
            val speedFall = (1 - (absSpeed / WheelConstants.HOLD_SPEED).coerceIn(0.0, 1.0)).let {
                Math.pow(it, 1.2)
            }
            val timeFall = (spiralT / 3.8).coerceIn(0.0, 1.0)
            val fall = maxOf(speedFall * 0.55, timeFall)
            val ease = fall * fall * (3 - 2 * fall)
            lerp(WheelConstants.TRACK_R, WheelConstants.POCKET_ENTRY_R - 0.02, ease)
        }

        val maxInward = (if (phase == SpinPhase.RACING) 0.05 else 0.18) * dt
        val nextR = lerp(radius, desiredR, minOf(1.0, dt * 1.4))
        radius += (nextR - radius).coerceIn(-maxInward, 0.18 * dt)
        radius = radius.coerceIn(WheelConstants.POCKET_ENTRY_R - 0.02, WheelConstants.TRACK_R + 0.02)

        applyDeflectorHits()
        y = WheelConstants.ballHeightAt(radius) + bounce

        if (radius <= WheelConstants.POCKET_ENTRY_R) {
            phase = SpinPhase.RATTLING
            rattleT = 0.0
            lastPipe = -1
            speed -= rotorSpeed
            if (abs(speed) < 0.6) {
                speed = sign(if (speed == 0.0) -1.0 else speed) * (0.6 + random.nextDouble() * 0.4)
            }
            bounce = 0.018
        }
    }

    private fun updateRattling(dt: Double, py: Double) {
        rattleT += dt
        angle += (rotorSpeed + speed) * dt
        collideWithPipes()
        speed *= exp(-1.8 * dt)
        radius = lerp(radius, WheelConstants.POCKET_R, minOf(1.0, dt * 2.8))
        y = lerp(
            WheelConstants.ballHeightAt(radius) + bounce,
            py + bounce,
            minOf(1.0, dt * 2.2),
        )
        rotorSpeed = maxOf(0.12, rotorSpeed - dt * 0.08)

        val localA = ballLocalAngle()
        val pocketIdx = pocketIndexAtLocal(localA)
        val pipe = nearestPipe(localA)
        val targetA = pocketLocalAngle(pocketIdx)
        val diffA = wrapPi(targetA - localA)
        angle += diffA * minOf(1.0, dt * 3.5)

        val clearOfPipe = pipe.absDist > POCKET_SLICE * 0.18
        val slowEnough = abs(speed) < 0.15
        val seated = clearOfPipe &&
            slowEnough &&
            abs(radius - WheelConstants.POCKET_R) < 0.035 &&
            rattleT > 0.6

        if (seated || rattleT > 3.5) {
            val finalIdx = pocketIndexAtLocal(ballLocalAngle())
            targetIdx = finalIdx
            val target = rotorAngle + pocketLocalAngle(finalIdx)
            phase = SpinPhase.LOCKED
            lockT = 0.0
            angle = target
            radius = WheelConstants.POCKET_R
            y = py
            speed = 0.0
            bounce = 0.0
        }
    }

    private fun applyDeflectorHits() {
        if (radius > 1.01 || radius < 0.8) return
        for (i in 0 until WheelConstants.DEFLECTOR_COUNT) {
            val da = (i.toDouble() / WheelConstants.DEFLECTOR_COUNT) * PI * 2 +
                WheelConstants.DEFLECTOR_PHASE
            val dist = hypot(
                cos(angle) * radius - cos(da) * WheelConstants.DEFLECTOR_R,
                sin(angle) * radius - sin(da) * WheelConstants.DEFLECTOR_R,
            )
            if (dist < 0.05 && lastDeflector != i) {
                lastDeflector = i
                val dir = sign(if (speed == 0.0) -1.0 else speed)
                speed -= dir * (0.25 + random.nextDouble() * 0.35)
                radius += 0.01 + random.nextDouble() * 0.025
                bounce = 0.014 + random.nextDouble() * 0.018
                break
            }
            val dAng = wrapPi(angle - da)
            if (abs(dAng) > 0.4 && lastDeflector == i) {
                lastDeflector = -1
            }
        }
    }

    private fun collideWithPipes() {
        if (radius < WheelConstants.STOP_INNER_R - 0.01 ||
            radius > WheelConstants.STOP_OUTER_R + 0.03
        ) {
            lastPipe = -1
            return
        }
        val localA = ballLocalAngle()
        val hit = nearestPipe(localA)
        val collideAng =
            (WheelConstants.PIPE_RADIUS + WheelConstants.BALL_R * 0.72) / maxOf(radius, 0.2)

        if (hit.absDist < collideAng) {
            val side = if (hit.dist == 0.0) {
                sign(if (speed == 0.0) 1.0 else speed)
            } else {
                sign(hit.dist)
            }
            val push = collideAng * 1.05
            val clearedLocal = hit.pipeA + side * push
            angle = rotorAngle + clearedLocal

            val approaching = sign(speed) == -side || lastPipe != hit.idx
            if (approaching && lastPipe != hit.idx) {
                val damp = 0.25 + random.nextDouble() * 0.25
                speed = -speed * damp
                speed += -side * (0.08 + random.nextDouble() * 0.15)
                bounce = 0.01 + random.nextDouble() * 0.015
                radius = (radius + (random.nextDouble() - 0.4) * 0.015).coerceIn(
                    WheelConstants.STOP_INNER_R + WheelConstants.BALL_R,
                    WheelConstants.STOP_OUTER_R - WheelConstants.BALL_R * 0.5,
                )
                lastPipe = hit.idx
            }
        } else if (hit.absDist > collideAng * 1.8) {
            lastPipe = -1
        }

        radius = radius.coerceIn(
            WheelConstants.STOP_INNER_R + WheelConstants.BALL_R * 0.5,
            WheelConstants.STOP_OUTER_R + 0.02,
        )
    }

    private fun lerp(a: Double, b: Double, t: Double) = a + (b - a) * t
}
