package com.pradyumna.roultee.feature.roulette.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pradyumna.roultee.core.game.BetKey
import com.pradyumna.roultee.core.game.COL1
import com.pradyumna.roultee.core.game.COL2
import com.pradyumna.roultee.core.game.COL3
import com.pradyumna.roultee.core.game.chipTierForAmount
import com.pradyumna.roultee.core.game.formatChipAmount
import com.pradyumna.roultee.core.game.pocketColor
import com.pradyumna.roultee.core.game.PocketColor

private val ZeroRoofShape = object : Shape {
    override fun createOutline(
        size: Size,
        layoutDirection: LayoutDirection,
        density: Density,
    ): Outline {
        val path = Path().apply {
            moveTo(0f, size.height)
            lineTo(0f, size.height * 0.42f)
            lineTo(size.width * 0.5f, 0f)
            lineTo(size.width, size.height * 0.42f)
            lineTo(size.width, size.height)
            close()
        }
        return Outline.Generic(path)
    }
}

private data class CellSpec(
    val key: BetKey,
    val label: String,
    val col: Int,
    val row: Int,
    val colSpan: Int = 1,
    val rowSpan: Int = 1,
    val kind: CellKind,
)

private enum class CellKind { ZERO, RED, BLACK, OUTSIDE, DIAMOND_RED, DIAMOND_BLACK }

@Composable
fun BettingBoard(
    bets: Map<BetKey, Int>,
    winningKeys: Set<BetKey>,
    winStraight: Int?,
    enabled: Boolean,
    onPlace: (BetKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val cells = remember { buildCells() }
    val colWs = listOf(42.dp, 52.dp, 58.dp, 58.dp, 58.dp)
    val rowHs = buildList {
        add(30.dp)
        repeat(12) { add(32.dp) }
        add(24.dp)
    }
    val gap = 1.dp
    val totalW = colWs.reduce { a, b -> a + b } + gap * 4
    val totalH = rowHs.reduce { a, b -> a + b } + gap * 13

    Box(modifier = modifier.size(totalW, totalH)) {
        cells.forEach { cell ->
            val x = colOffset(colWs, gap, cell.col)
            val y = rowOffset(rowHs, gap, cell.row)
            val w = spanSize(colWs, gap, cell.col, cell.colSpan)
            val h = spanSize(rowHs, gap, cell.row, cell.rowSpan)
            val amt = bets[cell.key] ?: 0
            BetCell(
                spec = cell,
                amount = amt,
                highlighted = cell.key in winningKeys,
                showRings = winStraight != null &&
                    cell.key == BetKey.straight(winStraight),
                enabled = enabled,
                onClick = { onPlace(cell.key) },
                modifier = Modifier
                    .offset(x, y)
                    .size(w, h),
            )
        }
    }
}

@Composable
private fun BetCell(
    spec: CellSpec,
    amount: Int,
    highlighted: Boolean,
    showRings: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier,
) {
    val bg = when (spec.kind) {
        CellKind.ZERO -> Brush.verticalGradient(
            listOf(Color(0xE62D8C5F), Color(0xE61E6E48)),
        )
        CellKind.RED -> Brush.verticalGradient(
            listOf(Color(0xFFA51A1B), Color(0xFF8E1314)),
        )
        CellKind.BLACK -> Brush.verticalGradient(
            listOf(Color(0x593C3C3C), Color(0x59191919)),
        )
        CellKind.OUTSIDE, CellKind.DIAMOND_RED, CellKind.DIAMOND_BLACK ->
            Brush.verticalGradient(
                listOf(Color(0x66202838), Color(0x66101828)),
            )
    }
    val shape = if (spec.kind == CellKind.ZERO) ZeroRoofShape else RoundedCornerShape(2.dp)
    Box(
        modifier = modifier
            .clip(shape)
            .background(bg, shape)
            .border(
                width = if (highlighted) 2.dp else 1.dp,
                color = if (highlighted) Color(0xFFFFE082) else Color.White.copy(alpha = 0.14f),
                shape = shape,
            )
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        when (spec.kind) {
            CellKind.DIAMOND_RED -> Text(
                text = "◆",
                color = Color(0xFFE53935),
                fontSize = 18.sp,
                modifier = Modifier.scale(scaleX = 1f, scaleY = 1.9f),
            )
            CellKind.DIAMOND_BLACK -> Text(
                text = "◆",
                color = Color.White,
                fontSize = 18.sp,
                modifier = Modifier.scale(scaleX = 1f, scaleY = 1.9f),
            )
            CellKind.OUTSIDE -> Text(
                text = spec.label,
                color = Color.White,
                fontSize = if (spec.label.contains("12")) 11.sp else 10.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                modifier = Modifier.rotate(90f),
                lineHeight = 12.sp,
            )
            else -> Text(
                text = spec.label,
                color = Color.White,
                fontSize = if (spec.kind == CellKind.ZERO) 16.sp else 15.sp,
                fontWeight = FontWeight.ExtraBold,
            )
        }
        if (amount > 0) {
            ChipBadge(
                tier = chipTierForAmount(amount),
                amountLabel = formatChipAmount(amount),
                modifier = Modifier.align(Alignment.Center),
            )
        }
        if (showRings) {
            WinRings(modifier = Modifier.fillMaxSize())
        }
    }
}

@Composable
private fun WinRings(modifier: Modifier = Modifier) {
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(36.dp)
                .border(3.dp, Color(0xF2FFD03C), androidx.compose.foundation.shape.CircleShape),
        )
        Box(
            Modifier
                .size(54.dp)
                .border(4.dp, Color(0xBFFFCE32), androidx.compose.foundation.shape.CircleShape),
        )
    }
}

private fun buildCells(): List<CellSpec> {
    val list = mutableListOf<CellSpec>()
    list += CellSpec(BetKey.straight(0), "0", 2, 0, colSpan = 3, kind = CellKind.ZERO)

    data class EM(val label: String, val key: BetKey, val row: Int, val kind: CellKind)
    listOf(
        EM("1-18", BetKey.lowHigh(true), 1, CellKind.OUTSIDE),
        EM("EVEN", BetKey.parity(true), 3, CellKind.OUTSIDE),
        EM("◆", BetKey.color(true), 5, CellKind.DIAMOND_RED),
        EM("◆", BetKey.color(false), 7, CellKind.DIAMOND_BLACK),
        EM("ODD", BetKey.parity(false), 9, CellKind.OUTSIDE),
        EM("19-36", BetKey.lowHigh(false), 11, CellKind.OUTSIDE),
    ).forEach {
        list += CellSpec(it.key, it.label, 0, it.row, rowSpan = 2, kind = it.kind)
    }

    listOf(
        Triple("1st 12", BetKey.dozen(1), 1),
        Triple("2nd 12", BetKey.dozen(2), 5),
        Triple("3rd 12", BetKey.dozen(3), 9),
    ).forEach { (label, key, row) ->
        list += CellSpec(key, label, 1, row, rowSpan = 4, kind = CellKind.OUTSIDE)
    }

    for (r in 0 until 12) {
        listOf(COL1[r], COL2[r], COL3[r]).forEachIndexed { i, n ->
            val kind = when (pocketColor(n)) {
                PocketColor.RED -> CellKind.RED
                PocketColor.BLACK -> CellKind.BLACK
                PocketColor.GREEN -> CellKind.ZERO
            }
            list += CellSpec(BetKey.straight(n), n.toString(), i + 2, r + 1, kind = kind)
        }
    }

    for (c in 1..3) {
        list += CellSpec(BetKey.column(c), "2 TO 1", c + 1, 13, kind = CellKind.OUTSIDE)
    }
    return list
}

private fun colOffset(widths: List<Dp>, gap: Dp, col: Int): Dp {
    var x = 0.dp
    for (i in 0 until col) x += widths[i] + gap
    return x
}

private fun rowOffset(heights: List<Dp>, gap: Dp, row: Int): Dp {
    var y = 0.dp
    for (i in 0 until row) y += heights[i] + gap
    return y
}

private fun spanSize(sizes: List<Dp>, gap: Dp, start: Int, span: Int): Dp {
    var s = 0.dp
    for (i in 0 until span) {
        s += sizes[start + i]
        if (i < span - 1) s += gap
    }
    return s
}
