package com.pradyumna.roultee.core.game

enum class SpinPhase {
    IDLE,
    RACING,
    SPIRALING,
    RATTLING,
    LOCKED,
    SETTLED,
}

fun SpinPhase.isBusy(): Boolean = when (this) {
    SpinPhase.RACING, SpinPhase.SPIRALING, SpinPhase.RATTLING, SpinPhase.LOCKED -> true
    else -> false
}
