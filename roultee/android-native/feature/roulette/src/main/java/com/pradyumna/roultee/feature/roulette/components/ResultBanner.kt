package com.pradyumna.roultee.feature.roulette.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pradyumna.roultee.core.game.PocketColor

private val TrapezoidShape = object : Shape {
    override fun createOutline(
        size: Size,
        layoutDirection: LayoutDirection,
        density: Density,
    ): Outline {
        val path = Path().apply {
            moveTo(0f, 0f)
            lineTo(size.width, 0f)
            lineTo(size.width * 0.90f, size.height)
            lineTo(size.width * 0.10f, size.height)
            close()
        }
        return Outline.Generic(path)
    }
}

@Composable
fun ResultBanner(
    left: Int,
    number: Int,
    right: Int,
    color: PocketColor,
    modifier: Modifier = Modifier,
) {
    val fill = when (color) {
        PocketColor.RED -> Color(0xFFD21A1A)
        PocketColor.BLACK -> Color(0xFF17171F)
        PocketColor.GREEN -> Color(0xFF2D8C5F)
    }
    Row(
        modifier = modifier
            .background(Color.White.copy(alpha = 0.13f), RoundedCornerShape(4.dp))
            .border(
                width = 1.dp,
                color = Color.White.copy(alpha = 0.22f),
                shape = RoundedCornerShape(4.dp),
            )
            .padding(horizontal = 28.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        Text(
            text = left.toString(),
            color = Color.White.copy(alpha = 0.92f),
            fontSize = 40.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.widthIn(min = 52.dp),
            textAlign = TextAlign.Center,
        )
        Box(
            modifier = Modifier
                .size(86.dp, 90.dp)
                .shadow(8.dp, TrapezoidShape, clip = false)
                .clip(TrapezoidShape)
                .background(Color(0xFFF7E08A))
                .padding(3.5.dp),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .matchParentSize()
                    .clip(TrapezoidShape)
                    .background(fill),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = number.toString(),
                    color = Color.White,
                    fontSize = 46.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
        Text(
            text = right.toString(),
            color = Color.White.copy(alpha = 0.92f),
            fontSize = 40.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.widthIn(min = 52.dp),
            textAlign = TextAlign.Center,
        )
    }
}
