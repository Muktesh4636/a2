package com.pradyumna.roultee.core.game

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BetRulesTest {
    @Test
    fun straightHitsAndPayout() {
        val key = BetKey.straight(5)
        assertTrue(BetRules.hits(key, 5))
        assertFalse(BetRules.hits(key, 6))
        assertEquals(36, BetRules.payoutOdds(key))
    }

    @Test
    fun zeroLosesOutsideBets() {
        assertFalse(BetRules.hits(BetKey.color(true), 0))
        assertFalse(BetRules.hits(BetKey.parity(true), 0))
        assertFalse(BetRules.hits(BetKey.lowHigh(true), 0))
        assertFalse(BetRules.hits(BetKey.dozen(1), 0))
        assertFalse(BetRules.hits(BetKey.column(1), 0))
        assertTrue(BetRules.hits(BetKey.straight(0), 0))
    }

    @Test
    fun placeUndoDoubleSettle() {
        var state = BetState(balance = 1000, chip = 10)
        state = BetRules.placeBet(state, BetKey.straight(22))
        assertEquals(990, state.balance)
        assertEquals(10, state.bets[BetKey.straight(22)])

        state = BetRules.doubleBets(state)
        assertEquals(980, state.balance)
        assertEquals(20, state.bets[BetKey.straight(22)])

        state = BetRules.undoBet(state)
        assertEquals(990, state.balance)
        assertEquals(10, state.bets[BetKey.straight(22)])

        val settled = BetRules.settle(state, 22)
        assertEquals(360, settled.win)
        assertEquals(990 + 360, settled.state.balance)
        assertTrue(settled.state.bets.isEmpty())
    }

    @Test
    fun chipTier() {
        assertEquals(10, chipTierForAmount(10))
        assertEquals(50, chipTierForAmount(90))
        assertEquals(100, chipTierForAmount(100))
        assertEquals(1000, chipTierForAmount(1500))
    }

    @Test
    fun neighborsMatchWheelOrder() {
        // WHEEL_ORDER: ... 10, 5, 24 ...
        val (l, r) = neighborNumbers(5)
        assertEquals(10, l)
        assertEquals(24, r)
    }
}
