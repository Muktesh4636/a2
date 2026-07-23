package com.pradyumna.roultee.rendering

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import com.google.android.filament.Engine
import com.google.android.filament.Texture
import com.google.android.filament.TextureSampler
import java.nio.ByteBuffer

object NumberLabelTextures {
    fun create(engine: Engine, number: Int, size: Int = 128): Texture {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.TRANSPARENT)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
            textSize = size * 0.72f
        }
        canvas.save()
        canvas.translate(size / 2f, size / 2f)
        // Stretch vertically so digits read clearly from the top-down camera
        canvas.scale(1f, 1.35f)
        val y = -(paint.descent() + paint.ascent()) / 2f
        canvas.drawText(number.toString(), 0f, y, paint)
        canvas.restore()

        val texture = Texture.Builder()
            .width(size)
            .height(size)
            .levels(1)
            .sampler(Texture.Sampler.SAMPLER_2D)
            .format(Texture.InternalFormat.RGBA8)
            .build(engine)

        // Pack as RGBA bytes (Android ARGB ints are little-endian BGRA in a raw buffer).
        val pixels = IntArray(size * size)
        bitmap.getPixels(pixels, 0, size, 0, 0, size, size)
        val buf = ByteBuffer.allocateDirect(size * size * 4)
        for (p in pixels) {
            buf.put(((p shr 16) and 0xFF).toByte()) // R
            buf.put(((p shr 8) and 0xFF).toByte())  // G
            buf.put((p and 0xFF).toByte())          // B
            buf.put(((p ushr 24) and 0xFF).toByte()) // A
        }
        buf.flip()
        val descriptor = Texture.PixelBufferDescriptor(
            buf,
            Texture.Format.RGBA,
            Texture.Type.UBYTE,
        )
        texture.setImage(engine, 0, descriptor)
        bitmap.recycle()
        return texture
    }

    val sampler: TextureSampler = TextureSampler(
        TextureSampler.MinFilter.LINEAR,
        TextureSampler.MagFilter.LINEAR,
        TextureSampler.WrapMode.CLAMP_TO_EDGE,
    )
}
