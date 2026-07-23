package com.pradyumna.roultee.core.game

object WheelConstants {
    const val BALL_R = 0.038
    const val STOP_INNER_R = 0.38
    const val STOP_OUTER_R = 0.544
    const val PIPE_RADIUS = 0.0032

    /** Nestled at inner pipe tips by the cone. */
    val POCKET_R: Double = STOP_INNER_R + BALL_R + 0.012

    const val TRACK_R = 1.05
    const val TRACK_Y = 0.20
    const val DEFLECTOR_R = 0.97
    const val DEFLECTOR_COUNT = 8
    const val DEFLECTOR_PHASE = 0.2
    const val HOLD_SPEED = 1.85
    const val POCKET_ENTRY_R = 0.58
    const val ROTOR_SPIN_SPEED = 1.35
    const val RESULT_LOCK_DELAY = 1.0
    const val RESULT_ROTOR_MAX = 0.06

    // Camera — lens FOV zoom (position stays fixed)
    const val CAM_DEFAULT_Y = 3.45
    const val CAM_DEFAULT_Z = 1.93
    const val CAM_TARGET_Y = 0.08
    const val CAM_IN_DURATION = 3.8
    const val CAM_OUT_DURATION = 1.4
    const val CAM_HOLD_DURATION = 5.0
    const val CAM_DEFAULT_FOV = 38.0
    const val CAM_ZOOM_FOV = 22.0
    const val CAM_LOOK_BLEND = 0.55

    fun pocketY(rotorY: Double = 0.0): Double {
        val t = (POCKET_R - 0.32) / (0.55 - 0.32)
        val floorY = -0.005 + t * (0.05 - -0.005)
        return rotorY + floorY + BALL_R * 0.82
    }

    fun ballHeightAt(radius: Double, rotorY: Double = 0.0): Double {
        val py = pocketY(rotorY)
        val t = ((TRACK_R - radius) / (TRACK_R - POCKET_R)).coerceIn(0.0, 1.0)
        val e = Math.pow(t, 1.65)
        return TRACK_Y + (py - TRACK_Y) * e
    }
}
