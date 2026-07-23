package com.pradyumna.roultee.core.game

enum class BetType {
    STRAIGHT,
    COLOR,
    PARITY,
    LOWHIGH,
    DOZEN,
    COLUMN,
}

sealed class BetValue {
    data class Number(val n: Int) : BetValue()
    data class Color(val red: Boolean) : BetValue()
    data class Parity(val even: Boolean) : BetValue()
    data class LowHigh(val low: Boolean) : BetValue()
    data class Dozen(val dozen: Int) : BetValue()
    data class Column(val column: Int) : BetValue()
}

data class BetKey(
    val type: BetType,
    val value: BetValue,
) {
    fun encode(): String = when (val v = value) {
        is BetValue.Number -> "straight:${v.n}"
        is BetValue.Color -> "color:${if (v.red) "red" else "black"}"
        is BetValue.Parity -> "parity:${if (v.even) "even" else "odd"}"
        is BetValue.LowHigh -> "lowhigh:${if (v.low) "low" else "high"}"
        is BetValue.Dozen -> "dozen:${v.dozen}"
        is BetValue.Column -> "column:${v.column}"
    }

    companion object {
        fun decode(raw: String): BetKey {
            val parts = raw.split(":", limit = 2)
            require(parts.size == 2) { "bad bet key: $raw" }
            return when (parts[0]) {
                "straight" -> BetKey(BetType.STRAIGHT, BetValue.Number(parts[1].toInt()))
                "color" -> BetKey(BetType.COLOR, BetValue.Color(parts[1] == "red"))
                "parity" -> BetKey(BetType.PARITY, BetValue.Parity(parts[1] == "even"))
                "lowhigh" -> BetKey(BetType.LOWHIGH, BetValue.LowHigh(parts[1] == "low"))
                "dozen" -> BetKey(BetType.DOZEN, BetValue.Dozen(parts[1].toInt()))
                "column" -> BetKey(BetType.COLUMN, BetValue.Column(parts[1].toInt()))
                else -> error("unknown bet type: ${parts[0]}")
            }
        }

        fun straight(n: Int) = BetKey(BetType.STRAIGHT, BetValue.Number(n))
        fun color(red: Boolean) = BetKey(BetType.COLOR, BetValue.Color(red))
        fun parity(even: Boolean) = BetKey(BetType.PARITY, BetValue.Parity(even))
        fun lowHigh(low: Boolean) = BetKey(BetType.LOWHIGH, BetValue.LowHigh(low))
        fun dozen(d: Int) = BetKey(BetType.DOZEN, BetValue.Dozen(d))
        fun column(c: Int) = BetKey(BetType.COLUMN, BetValue.Column(c))
    }
}

data class UndoEntry(
    val key: BetKey,
    val chip: Int,
    val visualChip: Int,
)

data class BetState(
    val balance: Int = 10_000,
    val chip: Int = 10,
    val bets: Map<BetKey, Int> = emptyMap(),
    val historyStack: List<UndoEntry> = emptyList(),
) {
    fun totalBet(): Int = bets.values.sum()
}

val CHIP_DENOMS = listOf(10, 20, 50, 100, 500, 1000)

fun chipTierForAmount(amount: Int): Int = when {
    amount >= 1000 -> 1000
    amount >= 500 -> 500
    amount >= 100 -> 100
    amount >= 50 -> 50
    amount >= 20 -> 20
    else -> 10
}

fun formatChipAmount(amount: Int): String =
    if (amount >= 1000) {
        val k = amount / 1000.0
        if (amount % 1000 == 0) "${amount / 1000}K" else "${"%.1f".format(k)}K"
    } else {
        amount.toString()
    }

fun formatMoney(n: Int): String = "₹%,d".format(n)
