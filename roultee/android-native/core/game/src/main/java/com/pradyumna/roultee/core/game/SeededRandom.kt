package com.pradyumna.roultee.core.game

import kotlin.random.Random

/** Thin wrapper so simulation can be deterministic in tests. */
class SeededRandom(seed: Long? = null) {
    private val rng = if (seed == null) Random.Default else Random(seed)

    fun nextDouble(): Double = rng.nextDouble()
    fun nextDouble(from: Double, until: Double): Double = rng.nextDouble(from, until)
    fun nextFloat(): Float = rng.nextFloat()
}
