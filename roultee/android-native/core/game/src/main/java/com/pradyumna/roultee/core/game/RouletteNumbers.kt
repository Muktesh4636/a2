package com.pradyumna.roultee.core.game

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.floor

/** European wheel order — matches the web reference. */
val WHEEL_ORDER: IntArray = intArrayOf(
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
    16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
)

val RED_NUMBERS: Set<Int> = setOf(
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
)

val COL1 = intArrayOf(1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34)
val COL2 = intArrayOf(2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35)
val COL3 = intArrayOf(3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36)

val POCKET_SLICE: Double = (PI * 2.0) / WHEEL_ORDER.size
const val POCKET_ANGLE0: Double = -PI / 2.0

enum class PocketColor { RED, BLACK, GREEN }

fun pocketColor(num: Int): PocketColor = when {
    num == 0 -> PocketColor.GREEN
    num in RED_NUMBERS -> PocketColor.RED
    else -> PocketColor.BLACK
}

fun wrapPi(a: Double): Double {
    var x = a
    while (x > PI) x -= PI * 2
    while (x < -PI) x += PI * 2
    return x
}

fun pipeLocalAngle(i: Int): Double = POCKET_ANGLE0 + i * POCKET_SLICE

fun pocketLocalAngle(idx: Int): Double = POCKET_ANGLE0 + (idx + 0.5) * POCKET_SLICE

fun pocketIndexAtLocal(localA: Double): Int {
    var a = localA - POCKET_ANGLE0
    val twoPi = PI * 2
    while (a < 0) a += twoPi
    while (a >= twoPi) a -= twoPi
    return (floor(a / POCKET_SLICE).toInt() % WHEEL_ORDER.size + WHEEL_ORDER.size) % WHEEL_ORDER.size
}

fun nearestPocketIndex(localA: Double): Int {
    var best = 0
    var bestDist = Double.POSITIVE_INFINITY
    for (i in WHEEL_ORDER.indices) {
        val d = abs(wrapPi(localA - pocketLocalAngle(i)))
        if (d < bestDist) {
            bestDist = d
            best = i
        }
    }
    return best
}

fun numberAtPocket(physicsIdx: Int): Int {
    val n = WHEEL_ORDER.size
    val i = ((physicsIdx % n) + n) % n
    return WHEEL_ORDER[i]
}

fun pocketIndexForNumber(num: Int): Int {
    val idx = WHEEL_ORDER.indexOf(num)
    return if (idx < 0) 0 else idx
}

fun neighborNumbers(num: Int): Pair<Int, Int> {
    val n = WHEEL_ORDER.size
    val i = WHEEL_ORDER.indexOf(num).coerceAtLeast(0)
    val left = WHEEL_ORDER[(i - 1 + n) % n]
    val right = WHEEL_ORDER[(i + 1) % n]
    return left to right
}

data class PipeHit(
    val idx: Int,
    val pipeA: Double,
    val dist: Double,
    val absDist: Double,
)

fun nearestPipe(localA: Double): PipeHit {
    var a = localA - POCKET_ANGLE0
    val twoPi = PI * 2
    while (a < 0) a += twoPi
    while (a >= twoPi) a -= twoPi
    val n = WHEEL_ORDER.size
    var idx = Math.round(a / POCKET_SLICE).toInt() % n
    if (idx < 0) idx += n
    val pipeA = pipeLocalAngle(idx)
    val dist = wrapPi(localA - pipeA)
    return PipeHit(idx, pipeA, dist, abs(dist))
}
