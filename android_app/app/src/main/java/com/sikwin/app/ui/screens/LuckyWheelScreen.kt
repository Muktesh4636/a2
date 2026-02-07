package com.sikwin.app.ui.screens

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sikwin.app.R
import com.sikwin.app.ui.theme.BlackBackground
import com.sikwin.app.ui.theme.PrimaryYellow
import com.sikwin.app.ui.theme.SurfaceColor
import com.sikwin.app.ui.viewmodels.GunduAtaViewModel
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

@Composable
fun LuckyWheelScreen(
    viewModel: GunduAtaViewModel,
    onBack: () -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    var rotationAngle by remember { mutableStateOf(0f) }
    var isSpinning by remember { mutableStateOf(false) }
    var showResultDialog by remember { mutableStateOf(false) }
    var lastResult by remember { mutableStateOf("") }

    val wheelItems = listOf(
        WheelItem("₹10", Color(0xFFFFD700)),
        WheelItem("₹50", Color(0xFFFFA500)),
        WheelItem("Better Luck", Color(0xFFC0C0C0)),
        WheelItem("₹100", Color(0xFFFF4500)),
        WheelItem("₹20", Color(0xFFFFD700)),
        WheelItem("Bonus", Color(0xFF32CD32)),
        WheelItem("₹500", Color(0xFFFF0000)),
        WheelItem("₹5", Color(0xFFFFD700))
    )

    val rotation = animateFloatAsState(
        targetValue = rotationAngle,
        animationSpec = tween(
            durationMillis = 4000,
            easing = CubicBezierEasing(0.1f, 0.0f, 0.2f, 1f)
        ),
        label = "wheel_rotation",
        finishedListener = {
            if (rotationAngle != 0f) {
                isSpinning = false
                showResultDialog = true
            }
        }
    )

    if (showResultDialog) {
        AlertDialog(
            onDismissRequest = { showResultDialog = false },
            title = { Text("Result", fontWeight = FontWeight.Bold) },
            text = { Text("Congratulations! You won $lastResult") },
            confirmButton = {
                TextButton(onClick = { showResultDialog = false }) {
                    Text("OK", color = PrimaryYellow)
                }
            },
            containerColor = SurfaceColor,
            titleContentColor = PrimaryYellow,
            textContentColor = Color.White
        )
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(BlackBackground)
    ) {
        // Decorative Background Money
        Image(
            painter = painterResource(id = R.drawable.money_decoration),
            contentDescription = null,
            modifier = Modifier
                .fillMaxSize()
                .padding(20.dp),
            contentScale = ContentScale.Inside,
            alpha = 0.4f
        )
        
        Column(modifier = Modifier.fillMaxSize()) {
            WheelHeader(onBack, viewModel.wallet?.balance ?: "0.00")
            
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    "SPIN & WIN DAILY!",
                    color = Color.White,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier.padding(bottom = 32.dp)
                )

                // The Wheel Container
                Box(
                    contentAlignment = Alignment.TopCenter,
                    modifier = Modifier.size(360.dp)
                ) {
                    // Outer Glow/Ring
                    Canvas(modifier = Modifier.size(340.dp).align(Alignment.Center)) {
                        drawCircle(
                            color = PrimaryYellow.copy(alpha = 0.2f),
                            radius = size.minDimension / 2,
                            style = Stroke(width = 20.dp.toPx())
                        )
                    }

                    // The Wheel
                    Box(modifier = Modifier.size(300.dp).align(Alignment.Center)) {
                         WheelCanvas(wheelItems, rotation.value)
                    }

                    // The Pointer (At the top)
                    Box(modifier = Modifier.padding(top = 10.dp)) {
                         WheelPointer()
                    }
                    
                    // Center Hub
                    Surface(
                        modifier = Modifier.size(50.dp).align(Alignment.Center),
                        shape = CircleShape,
                        color = SurfaceColor,
                        shadowElevation = 8.dp,
                        border = androidx.compose.foundation.BorderStroke(2.dp, PrimaryYellow)
                    ) {
                         Box(contentAlignment = Alignment.Center) {
                             Text("WIN", color = PrimaryYellow, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                         }
                    }
                }

                Spacer(modifier = Modifier.height(60.dp))

                // Spin Button
                Button(
                    onClick = {
                        if (!isSpinning) {
                            isSpinning = true
                            val extraRotations = 10 + Random.nextInt(5)
                            val targetIndex = Random.nextInt(wheelItems.size)
                            lastResult = wheelItems[targetIndex].label
                            
                            // Align target index with pointer (0 degrees)
                            // We use -90 degrees offset because Canvas drawArc starts at 3 o'clock
                            val degreesPerSegment = 360f / wheelItems.size
                            val targetAngle = 360f - (targetIndex * degreesPerSegment) + 270f // +270 to align with top pointer
                            rotationAngle += (extraRotations * 360) + (targetAngle - (rotationAngle % 360))
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(60.dp),
                    shape = RoundedCornerShape(30.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = PrimaryYellow,
                        disabledContainerColor = SurfaceColor
                    ),
                    enabled = !isSpinning
                ) {
                    Text(
                        if (isSpinning) "SPINNING..." else "SPIN NOW",
                        color = BlackBackground,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 20.sp
                    )
                }

                Spacer(modifier = Modifier.height(24.dp))
                
                Text(
                    "Collect your daily rewards now!",
                    color = Color.Gray,
                    fontSize = 14.sp
                )
            }
        }
    }
}

@Composable
fun WheelHeader(onBack: () -> Unit, balance: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = PrimaryYellow, modifier = Modifier.size(32.dp))
        }
        
        Surface(
            color = SurfaceColor,
            shape = RoundedCornerShape(20.dp)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("₹", color = PrimaryYellow, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.width(4.dp))
                Text(balance, color = Color.White, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun WheelCanvas(items: List<WheelItem>, rotation: Float) {
    Canvas(
        modifier = Modifier
            .fillMaxSize()
            .rotate(rotation)
    ) {
        val sweepAngle = 360f / items.size
        items.forEachIndexed { index, item ->
            drawArc(
                color = item.color,
                startAngle = index * sweepAngle,
                sweepAngle = sweepAngle,
                useCenter = true,
                size = Size(size.width, size.height)
            )
            
            // Outer Border for segments
            drawArc(
                color = Color.Black.copy(alpha = 0.3f),
                startAngle = index * sweepAngle,
                sweepAngle = sweepAngle,
                useCenter = true,
                style = Stroke(width = 2.dp.toPx())
            )
        }
        
        // Outer Rim
        drawCircle(
            color = Color.White,
            radius = size.minDimension / 2,
            style = Stroke(width = 4.dp.toPx())
        )
    }
}

@Composable
fun WheelPointer() {
    Canvas(modifier = Modifier.size(40.dp)) {
        val path = androidx.compose.ui.graphics.Path().apply {
            moveTo(size.width / 2, 0f)
            lineTo(size.width / 2 - 15f, 30f)
            lineTo(size.width / 2 + 15f, 30f)
            close()
        }
        drawPath(path, color = Color.Red)
    }
}

data class WheelItem(val label: String, val color: Color)
