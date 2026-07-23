package com.pradyumna.roultee.feature.roulette

import androidx.lifecycle.ViewModel
import com.pradyumna.roultee.core.game.BetKey
import com.pradyumna.roultee.core.game.BetRules
import com.pradyumna.roultee.core.game.BetState
import com.pradyumna.roultee.core.game.SpinPhase
import com.pradyumna.roultee.core.game.WheelSimulation
import com.pradyumna.roultee.core.game.WheelPose
import com.pradyumna.roultee.core.game.formatMoney
import com.pradyumna.roultee.core.game.neighborNumbers
import com.pradyumna.roultee.core.game.pocketColor
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class RouletteViewModel(
    private val simulation: WheelSimulation = WheelSimulation(),
) : ViewModel() {
    private var betState = BetState()

    private val _ui = MutableStateFlow(RouletteUiState())
    val ui: StateFlow<RouletteUiState> = _ui.asStateFlow()

    fun simulation(): WheelSimulation = simulation

    fun onAction(action: RouletteAction) {
        when (action) {
            is RouletteAction.SelectChip -> {
                betState = betState.copy(chip = action.value)
                _ui.update {
                    it.copy(selectedChip = action.value, chipSelectorOpen = false)
                }
            }
            RouletteAction.ToggleChipSelector -> {
                _ui.update { it.copy(chipSelectorOpen = !it.chipSelectorOpen) }
            }
            is RouletteAction.PlaceBet -> placeBet(action.key)
            RouletteAction.Undo -> undo()
            RouletteAction.Double -> doubleBets()
            RouletteAction.Spin -> spin()
        }
    }

    /** Called every frame from the renderer. */
    fun onFrame(dt: Double): WheelPose {
        val win = simulation.update(dt)
        simulation.updateCamera(dt)
        val pose = simulation.pose()
        if (win != null) {
            onResult(win)
        }
        // Drop the 3-number result card as soon as the camera starts pulling back
        if (_ui.value.showBanner && simulation.camera.dir < 0) {
            _ui.update { it.copy(showBanner = false) }
        }
        val busy = simulation.isBusy()
        if (_ui.value.spinBusy != busy || _ui.value.spinPhase != pose.phase) {
            _ui.update { it.copy(spinBusy = busy, spinPhase = pose.phase) }
        }
        return pose
    }

    private fun placeBet(key: BetKey) {
        if (simulation.isBusy()) return
        betState = BetRules.placeBet(betState, key)
        publishBets()
    }

    private fun undo() {
        if (simulation.isBusy()) return
        betState = BetRules.undoBet(betState)
        publishBets()
    }

    private fun doubleBets() {
        if (simulation.isBusy()) return
        betState = BetRules.doubleBets(betState)
        publishBets()
    }

    private fun spin() {
        if (simulation.isBusy()) return
        _ui.update {
            it.copy(
                showBanner = false,
                resultNumber = null,
                resultText = "",
                winAmount = 0,
                winningKeys = emptySet(),
            )
        }
        simulation.launch()
        _ui.update { it.copy(spinBusy = true, spinPhase = SpinPhase.RACING) }
    }

    private fun onResult(num: Int) {
        val settled = BetRules.settle(betState, num)
        betState = settled.state
        val (left, right) = neighborNumbers(num)
        val color = pocketColor(num)
        val colorName = when (color) {
            com.pradyumna.roultee.core.game.PocketColor.GREEN -> "Green"
            com.pradyumna.roultee.core.game.PocketColor.RED -> "Red"
            com.pradyumna.roultee.core.game.PocketColor.BLACK -> "Black"
        }
        var text = "$num · $colorName"
        if (settled.win > 0) text += " · Won ${formatMoney(settled.win)}"
        _ui.update {
            it.copy(
                balance = betState.balance,
                bets = emptyMap(),
                resultNumber = num,
                resultColor = color,
                resultLeft = left,
                resultRight = right,
                resultText = text,
                lastRound = num,
                winAmount = settled.win,
                winningKeys = settled.winningKeys,
                showBanner = true,
                spinBusy = false,
                spinPhase = SpinPhase.SETTLED,
            )
        }
    }

    private fun publishBets() {
        _ui.update {
            it.copy(
                balance = betState.balance,
                selectedChip = betState.chip,
                bets = betState.bets,
            )
        }
    }
}
