package com.pradyumna.roultee.core.game

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WheelSimulationTest {
    @Test
    fun pocketAnglesCoverFullCircle() {
        assertEquals(37, WHEEL_ORDER.size)
        val a0 = pipeLocalAngle(0)
        val a1 = pipeLocalAngle(1)
        assertEquals(POCKET_SLICE, a1 - a0, 1e-9)
        assertEquals(0, pocketIndexForNumber(0))
        assertEquals(5, numberAtPocket(pocketIndexForNumber(5)))
    }

    @Test
    fun seededSpinEventuallySettles() {
        val sim = WheelSimulation(SeededRandom(42L))
        sim.launch()
        assertTrue(sim.isBusy())
        var winner: Int? = null
        // Simulate up to 60s
        repeat(60 * 60) {
            val w = sim.update(1.0 / 60.0)
            sim.updateCamera(1.0 / 60.0)
            if (w != null) winner = w
        }
        assertNotNull(winner)
        assertTrue(winner!! in 0..36)
        assertEquals(SpinPhase.SETTLED, sim.phase)
        assertEquals(winner, sim.pose().winningNumber)
    }
}
