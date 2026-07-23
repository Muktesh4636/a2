package com.pradyumna.roultee.feature.roulette

import com.pradyumna.roultee.core.game.BetKey
import com.pradyumna.roultee.core.game.PocketColor
import com.pradyumna.roultee.core.game.SpinPhase

data class RouletteUiState(
    val balance: Int = 10_000,
    val selectedChip: Int = 10,
    val chipSelectorOpen: Boolean = false,
    val bets: Map<BetKey, Int> = emptyMap(),
    val spinPhase: SpinPhase = SpinPhase.IDLE,
    val spinBusy: Boolean = false,
    val resultNumber: Int? = null,
    val resultColor: PocketColor? = null,
    val resultLeft: Int? = null,
    val resultRight: Int? = null,
    val resultText: String = "",
    val lastRound: Int? = null,
    val winAmount: Int = 0,
    val winningKeys: Set<BetKey> = emptySet(),
    val showBanner: Boolean = false,
)

sealed interface RouletteAction {
    data class SelectChip(val value: Int) : RouletteAction
    data object ToggleChipSelector : RouletteAction
    data class PlaceBet(val key: BetKey) : RouletteAction
    data object Undo : RouletteAction
    data object Double : RouletteAction
    data object Spin : RouletteAction
}
