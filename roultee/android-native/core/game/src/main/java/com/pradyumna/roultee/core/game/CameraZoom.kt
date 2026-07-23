package com.pradyumna.roultee.core.game

import kotlin.math.pow

data class CameraPose(
    val posX: Double,
    val posY: Double,
    val posZ: Double,
    val targetX: Double,
    val targetY: Double,
    val targetZ: Double,
    val fov: Double = WheelConstants.CAM_DEFAULT_FOV,
)

class CameraZoom {
    var mix: Double = 0.0
    var dir: Int = 0 // +1 in, -1 out, 0 hold/idle
    var holdLeft: Double = 0.0

    fun zoomIn() {
        holdLeft = 0.0
        dir = 1
    }

    fun zoomOut() {
        holdLeft = 0.0
        dir = -1
    }

    fun update(
        dt: Double,
        ballX: Double,
        ballY: Double,
        ballZ: Double,
    ): CameraPose {
        when {
            dir > 0 -> {
                mix = (mix + dt / WheelConstants.CAM_IN_DURATION).coerceAtMost(1.0)
                if (mix >= 1.0) {
                    dir = 0
                    holdLeft = WheelConstants.CAM_HOLD_DURATION
                }
            }
            dir < 0 -> {
                mix = (mix - dt / WheelConstants.CAM_OUT_DURATION).coerceAtLeast(0.0)
                if (mix <= 0.0) dir = 0
            }
            mix >= 1.0 && holdLeft > 0 -> {
                holdLeft = (holdLeft - dt).coerceAtLeast(0.0)
                if (holdLeft <= 0) dir = -1
            }
        }

        val m = mix
        val e = if (m <= 0) {
            0.0
        } else if (m < 0.5) {
            4 * m * m * m
        } else {
            1 - (-2 * m + 2).pow(3.0) / 2
        }

        // Camera position stays fixed — zoom with the lens (FOV), not by flying closer
        val fov = lerp(
            WheelConstants.CAM_DEFAULT_FOV,
            WheelConstants.CAM_ZOOM_FOV,
            e,
        )
        if (m <= 0) {
            return CameraPose(
                0.0, WheelConstants.CAM_DEFAULT_Y, WheelConstants.CAM_DEFAULT_Z,
                0.0, WheelConstants.CAM_TARGET_Y, 0.0,
                WheelConstants.CAM_DEFAULT_FOV,
            )
        }

        val lookBlend = e * WheelConstants.CAM_LOOK_BLEND
        return CameraPose(
            0.0, WheelConstants.CAM_DEFAULT_Y, WheelConstants.CAM_DEFAULT_Z,
            lerp(0.0, ballX, lookBlend),
            lerp(WheelConstants.CAM_TARGET_Y, ballY, lookBlend),
            lerp(0.0, ballZ, lookBlend),
            fov,
        )
    }

    private fun lerp(a: Double, b: Double, t: Double) = a + (b - a) * t
}
