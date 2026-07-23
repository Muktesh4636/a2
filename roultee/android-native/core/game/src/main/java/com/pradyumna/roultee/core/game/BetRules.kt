package com.pradyumna.roultee.core.game

object BetRules {
    fun hits(key: BetKey, num: Int): Boolean = when (val v = key.value) {
        is BetValue.Number -> v.n == num
        is BetValue.Color -> {
            if (num == 0) false
            else if (v.red) num in RED_NUMBERS else num !in RED_NUMBERS
        }
        is BetValue.Parity -> {
            if (num == 0) false
            else if (v.even) num % 2 == 0 else num % 2 == 1
        }
        is BetValue.LowHigh -> {
            if (num == 0) false
            else if (v.low) num in 1..18 else num in 19..36
        }
        is BetValue.Dozen -> {
            if (num == 0) false
            else when (v.dozen) {
                1 -> num in 1..12
                2 -> num in 13..24
                else -> num in 25..36
            }
        }
        is BetValue.Column -> {
            if (num == 0) false
            else when (v.column) {
                1 -> num in COL1
                2 -> num in COL2
                else -> num in COL3
            }
        }
    }

    /** Gross return multiplier (includes stake). */
    fun payoutOdds(key: BetKey): Int = when (key.type) {
        BetType.STRAIGHT -> 36
        BetType.COLUMN, BetType.DOZEN -> 3
        else -> 2
    }

    fun placeBet(state: BetState, key: BetKey): BetState {
        val chip = state.chip
        if (state.balance < chip) return state
        val prev = state.bets[key] ?: 0
        return state.copy(
            balance = state.balance - chip,
            bets = state.bets + (key to prev + chip),
            historyStack = state.historyStack + UndoEntry(key, chip, chip),
        )
    }

    fun undoBet(state: BetState): BetState {
        val last = state.historyStack.lastOrNull() ?: return state
        val cur = state.bets[last.key] ?: 0
        val next = cur - last.chip
        val bets = if (next <= 0) state.bets - last.key else state.bets + (last.key to next)
        return state.copy(
            balance = state.balance + last.chip,
            bets = bets,
            historyStack = state.historyStack.dropLast(1),
        )
    }

    fun doubleBets(state: BetState): BetState {
        val need = state.totalBet()
        if (need <= 0 || state.balance < need) return state
        var balance = state.balance - need
        val bets = state.bets.toMutableMap()
        val stack = state.historyStack.toMutableList()
        for ((key, amt) in state.bets) {
            val previousVisual = stack.asReversed().firstOrNull { it.key == key }?.visualChip
                ?: state.chip
            bets[key] = amt * 2
            stack += UndoEntry(key, amt, previousVisual)
        }
        return state.copy(balance = balance, bets = bets, historyStack = stack)
    }

    data class Settlement(val state: BetState, val win: Int, val winningKeys: Set<BetKey>)

    fun settle(state: BetState, num: Int): Settlement {
        var win = 0
        val winning = mutableSetOf<BetKey>()
        for ((key, amt) in state.bets) {
            if (hits(key, num)) {
                win += amt * payoutOdds(key)
                winning += key
            }
        }
        return Settlement(
            state = state.copy(
                balance = state.balance + win,
                bets = emptyMap(),
                historyStack = emptyList(),
            ),
            win = win,
            winningKeys = winning,
        )
    }
}
