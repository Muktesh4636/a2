package com.pradyumna.roultee.feature.roulette.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.pradyumna.roultee.core.game.CHIP_DENOMS
import com.pradyumna.roultee.feature.roulette.R

private fun chipDrawable(value: Int): Int = when (value) {
    10 -> R.drawable.chip_10
    20 -> R.drawable.chip_20
    50 -> R.drawable.chip_50
    100 -> R.drawable.chip_100
    500 -> R.drawable.chip_500
    1000 -> R.drawable.chip_1000
    else -> R.drawable.chip_10
}

@Composable
fun ChipSelector(
    selected: Int,
    open: Boolean,
    onToggle: () -> Unit,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val chips = if (open) CHIP_DENOMS else listOf(selected)
        chips.forEach { value ->
            val active = value == selected
            Image(
                painter = painterResource(chipDrawable(value)),
                contentDescription = "₹$value chip",
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .size(40.dp)
                    .scale(if (active) 1.12f else 1f)
                    .then(
                        if (active) {
                            Modifier.border(1.dp, Color.White, CircleShape)
                        } else {
                            Modifier
                        },
                    )
                    .clickable {
                        if (active) onToggle() else onSelect(value)
                    },
            )
        }
    }
}

@Composable
fun ChipBadge(
    tier: Int,
    amountLabel: String,
    modifier: Modifier = Modifier,
) {
    BoxWithChip(tier = tier, label = amountLabel, modifier = modifier)
}

@Composable
private fun BoxWithChip(tier: Int, label: String, modifier: Modifier) {
    androidx.compose.foundation.layout.Box(
        modifier = modifier.size(27.dp),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painter = painterResource(chipDrawable(tier)),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(27.dp),
        )
        androidx.compose.material3.Text(
            text = label,
            color = Color.White,
            fontSize = androidx.compose.ui.unit.TextUnit(7.5f, androidx.compose.ui.unit.TextUnitType.Sp),
            fontWeight = androidx.compose.ui.text.font.FontWeight.Black,
        )
    }
}
