package com.pradyumna.roultee.feature.roulette

import android.view.Choreographer
import android.view.Surface
import android.view.SurfaceView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import com.pradyumna.roultee.core.game.WheelPose
import com.pradyumna.roultee.rendering.RouletteSceneController

@Composable
fun RouletteSurface(
    modifier: Modifier = Modifier,
    onFrame: (Double) -> WheelPose,
) {
    val context = LocalContext.current
    val controller = remember { RouletteSceneController(context.applicationContext) }
    val latestOnFrame by rememberUpdatedState(onFrame)

    DisposableEffect(controller) {
        controller.initialize()
        onDispose { controller.destroy() }
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            val surfaceView = SurfaceView(ctx)
            val choreographer = Choreographer.getInstance()
            var lastNanos = 0L
            var attached = false

            val frameCallback = object : Choreographer.FrameCallback {
                override fun doFrame(frameTimeNanos: Long) {
                    if (!attached) return
                    val dt = if (lastNanos == 0L) {
                        1.0 / 60.0
                    } else {
                        ((frameTimeNanos - lastNanos) / 1_000_000_000.0).coerceIn(0.0, 0.05)
                    }
                    lastNanos = frameTimeNanos
                    val pose = latestOnFrame(dt)
                    controller.applyPose(pose)
                    controller.render(frameTimeNanos)
                    choreographer.postFrameCallback(this)
                }
            }

            surfaceView.holder.addCallback(object : android.view.SurfaceHolder.Callback {
                override fun surfaceCreated(holder: android.view.SurfaceHolder) {
                    val s: Surface = holder.surface
                    val w = surfaceView.width.coerceAtLeast(1)
                    val h = surfaceView.height.coerceAtLeast(1)
                    controller.attachSurface(s, w, h)
                    attached = true
                    lastNanos = 0L
                    choreographer.postFrameCallback(frameCallback)
                }

                override fun surfaceChanged(
                    holder: android.view.SurfaceHolder,
                    format: Int,
                    width: Int,
                    height: Int,
                ) {
                    controller.resize(width, height)
                }

                override fun surfaceDestroyed(holder: android.view.SurfaceHolder) {
                    attached = false
                    choreographer.removeFrameCallback(frameCallback)
                }
            })
            surfaceView
        },
    )
}
