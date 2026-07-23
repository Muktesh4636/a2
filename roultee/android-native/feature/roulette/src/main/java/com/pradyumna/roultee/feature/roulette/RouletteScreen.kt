package com.pradyumna.roultee.feature.roulette

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.pradyumna.roultee.core.game.formatMoney
import com.pradyumna.roultee.core.game.pocketColor
import com.pradyumna.roultee.feature.roulette.components.BettingBoard
import com.pradyumna.roultee.feature.roulette.components.ChipSelector
import com.pradyumna.roultee.feature.roulette.components.ResultBanner

@Composable
fun RouletteRoute(
    viewModel: RouletteViewModel = viewModel(),
) {
    val state by viewModel.ui.collectAsStateWithLifecycle()
    RouletteScreen(
        state = state,
        onAction = viewModel::onAction,
        onFrame = viewModel::onFrame,
    )
}

@Composable
fun RouletteScreen(
    state: RouletteUiState,
    onAction: (RouletteAction) -> Unit,
    onFrame: (Double) -> com.pradyumna.roultee.core.game.WheelPose,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF120408)),
    ) {
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(Color.Black),
        ) {
            RouletteSurface(
                modifier = Modifier.fillMaxSize(),
                onFrame = onFrame,
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "ROULETTE",
                    color = Color(0xFFFFE9A0),
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 15.sp,
                    letterSpacing = 1.sp,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    text = "Balance ",
                    color = Color(0xFFE0B84A),
                    fontSize = 12.sp,
                )
                Text(
                    text = formatMoney(state.balance),
                    color = Color(0xFFFFE9A0),
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 12.sp,
                )
            }

            Button(
                onClick = { onAction(RouletteAction.Spin) },
                enabled = !state.spinBusy,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(10.dp),
                shape = RoundedCornerShape(999.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFFE8C45A),
                    contentColor = Color(0xFF1A1408),
                    disabledContainerColor = Color(0xFFE8C45A).copy(alpha = 0.45f),
                ),
            ) {
                Text(
                    text = if (state.spinBusy) "SPINNING…" else "SPIN",
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 11.sp,
                )
            }

            if (state.resultText.isNotEmpty()) {
                Text(
                    text = state.resultText,
                    color = Color(0xFFF5E6A8),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 90.dp, bottom = 14.dp),
                )
            }

            if (state.showBanner &&
                state.resultNumber != null &&
                state.resultLeft != null &&
                state.resultRight != null &&
                state.resultColor != null
            ) {
                ResultBanner(
                    left = state.resultLeft,
                    number = state.resultNumber,
                    right = state.resultRight,
                    color = state.resultColor,
                    modifier = Modifier.align(Alignment.Center),
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF0C0406)),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, end = 54.dp, top = 6.dp, bottom = 4.dp),
            ) {
                BettingBoard(
                    bets = state.bets,
                    winningKeys = state.winningKeys,
                    winStraight = state.resultNumber,
                    enabled = !state.spinBusy,
                    onPlace = { onAction(RouletteAction.PlaceBet(it)) },
                    modifier = Modifier.align(Alignment.TopCenter),
                )

                Column(
                    modifier = Modifier.align(Alignment.CenterEnd),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("UNDO", color = Color(0xFFE0B84A), fontSize = 9.sp)
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .background(Color(0xFF1A2438), CircleShape)
                            .clickable(enabled = !state.spinBusy) { onAction(RouletteAction.Undo) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("↺", color = Color.White, fontSize = 20.sp)
                    }
                    Spacer(Modifier.height(8.dp))
                    ChipSelector(
                        selected = state.selectedChip,
                        open = state.chipSelectorOpen,
                        onToggle = { onAction(RouletteAction.ToggleChipSelector) },
                        onSelect = { onAction(RouletteAction.SelectChip(it)) },
                    )
                    Spacer(Modifier.height(8.dp))
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .background(Color(0xFF1A2438), CircleShape)
                            .clickable(enabled = !state.spinBusy) { onAction(RouletteAction.Double) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("×2", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                    Text("DOUBLE", color = Color(0xFFE0B84A), fontSize = 9.sp)
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(42.dp)
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Last round is ",
                    color = Color(0xFFE0B84A),
                    fontSize = 12.sp,
                )
                if (state.lastRound != null) {
                    val c = pocketColor(state.lastRound)
                    val bg = when (c) {
                        com.pradyumna.roultee.core.game.PocketColor.RED -> Color(0xFFC41E26)
                        com.pradyumna.roultee.core.game.PocketColor.BLACK -> Color(0xFF1A1A1A)
                        com.pradyumna.roultee.core.game.PocketColor.GREEN -> Color(0xFF1A7A3A)
                    }
                    Text(
                        text = state.lastRound.toString(),
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                        modifier = Modifier
                            .background(bg, RoundedCornerShape(4.dp))
                            .padding(horizontal = 6.dp, vertical = 4.dp),
                    )
                } else {
                    Text("—", color = Color(0xFFE0B84A), fontSize = 12.sp)
                }
            }
        }
    }
}
