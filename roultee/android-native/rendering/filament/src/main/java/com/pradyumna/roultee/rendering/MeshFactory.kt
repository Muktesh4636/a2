package com.pradyumna.roultee.rendering

import com.google.android.filament.Engine
import com.google.android.filament.IndexBuffer
import com.google.android.filament.VertexBuffer
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

data class MeshData(
    val vertexBuffer: VertexBuffer,
    val indexBuffer: IndexBuffer,
    val indexCount: Int,
)

/**
 * Interleaved mesh builder: POSITION (3) + TANGENTS quat (4) + UV0 (2) = 9 floats / 36 bytes.
 */
object MeshFactory {
    private const val STRIDE = 36
    private const val FLOATS = 9

    fun createSphere(engine: Engine, radius: Float, slices: Int = 24, stacks: Int = 16): MeshData {
        val verts = ArrayList<Float>()
        val idx = ArrayList<Int>()
        for (i in 0..stacks) {
            val v = i.toFloat() / stacks
            val phi = v * PI.toFloat()
            val y = cos(phi)
            val r = sin(phi)
            for (j in 0..slices) {
                val u = j.toFloat() / slices
                val theta = u * PI.toFloat() * 2f
                val x = r * cos(theta)
                val z = r * sin(theta)
                addVertex(verts, x * radius, y * radius, z * radius, x, y, z, u, v)
            }
        }
        for (i in 0 until stacks) {
            for (j in 0 until slices) {
                val a = i * (slices + 1) + j
                val b = a + slices + 1
                idx += a; idx += b; idx += a + 1
                idx += b; idx += b + 1; idx += a + 1
            }
        }
        return build(engine, verts, idx)
    }

    fun createCylinder(
        engine: Engine,
        radiusTop: Float,
        radiusBottom: Float,
        height: Float,
        segments: Int = 48,
        capped: Boolean = false,
    ): MeshData {
        val verts = ArrayList<Float>()
        val idx = ArrayList<Int>()
        val y0 = -height / 2f
        val y1 = height / 2f
        val slope = (radiusBottom - radiusTop) / height.coerceAtLeast(1e-4f)

        for (i in 0..segments) {
            val u = i.toFloat() / segments
            val a = u * PI.toFloat() * 2f
            val c = cos(a)
            val s = sin(a)
            // outward normal for frustum side
            val nx = c
            val nz = s
            val ny = slope
            val nlen = sqrt(nx * nx + ny * ny + nz * nz).coerceAtLeast(1e-6f)
            addVertex(verts, c * radiusBottom, y0, s * radiusBottom, nx / nlen, ny / nlen, nz / nlen, u, 0f)
            addVertex(verts, c * radiusTop, y1, s * radiusTop, nx / nlen, ny / nlen, nz / nlen, u, 1f)
        }
        for (i in 0 until segments) {
            val a = i * 2
            idx += a; idx += a + 1; idx += a + 2
            idx += a + 1; idx += a + 3; idx += a + 2
        }

        if (capped) {
            val bottomCenter = verts.size / FLOATS
            addVertex(verts, 0f, y0, 0f, 0f, -1f, 0f, 0.5f, 0.5f)
            val bottomStart = verts.size / FLOATS
            for (i in 0..segments) {
                val a = i.toFloat() / segments * PI.toFloat() * 2f
                val c = cos(a)
                val s = sin(a)
                addVertex(verts, c * radiusBottom, y0, s * radiusBottom, 0f, -1f, 0f, 0.5f + c * 0.5f, 0.5f + s * 0.5f)
            }
            for (i in 0 until segments) {
                idx += bottomCenter; idx += bottomStart + i + 1; idx += bottomStart + i
            }

            val topCenter = verts.size / FLOATS
            addVertex(verts, 0f, y1, 0f, 0f, 1f, 0f, 0.5f, 0.5f)
            val topStart = verts.size / FLOATS
            for (i in 0..segments) {
                val a = i.toFloat() / segments * PI.toFloat() * 2f
                val c = cos(a)
                val s = sin(a)
                addVertex(verts, c * radiusTop, y1, s * radiusTop, 0f, 1f, 0f, 0.5f + c * 0.5f, 0.5f + s * 0.5f)
            }
            for (i in 0 until segments) {
                idx += topCenter; idx += topStart + i; idx += topStart + i + 1
            }
        }
        return build(engine, verts, idx)
    }

    fun createDisk(engine: Engine, radius: Float, segments: Int = 64): MeshData {
        val verts = ArrayList<Float>()
        val idx = ArrayList<Int>()
        addVertex(verts, 0f, 0f, 0f, 0f, 1f, 0f, 0.5f, 0.5f)
        for (i in 0..segments) {
            val a = i.toFloat() / segments * PI.toFloat() * 2f
            val c = cos(a)
            val s = sin(a)
            addVertex(verts, c * radius, 0f, s * radius, 0f, 1f, 0f, 0.5f + c * 0.5f, 0.5f + s * 0.5f)
        }
        for (i in 1..segments) {
            idx += 0; idx += i; idx += i + 1
        }
        return build(engine, verts, idx)
    }

    fun createRing(engine: Engine, innerR: Float, outerR: Float, segments: Int = 128): MeshData {
        val verts = ArrayList<Float>()
        val idx = ArrayList<Int>()
        for (i in 0..segments) {
            val u = i.toFloat() / segments
            val a = u * PI.toFloat() * 2f
            val c = cos(a)
            val s = sin(a)
            addVertex(verts, c * innerR, 0f, s * innerR, 0f, 1f, 0f, u, 0f)
            addVertex(verts, c * outerR, 0f, s * outerR, 0f, 1f, 0f, u, 1f)
        }
        for (i in 0 until segments) {
            val a = i * 2
            idx += a; idx += a + 1; idx += a + 2
            idx += a + 1; idx += a + 3; idx += a + 2
        }
        return build(engine, verts, idx)
    }

    fun createSlopedRing(
        engine: Engine,
        innerR: Float,
        outerR: Float,
        yInner: Float,
        yOuter: Float,
        segments: Int = 128,
    ): MeshData {
        val verts = ArrayList<Float>()
        val idx = ArrayList<Int>()
        val dr = outerR - innerR
        val dy = yOuter - yInner
        // normal from slope in radial cross-section
        val nRadial = -dy
        val nY = dr
        val nLen = sqrt(nRadial * nRadial + nY * nY).coerceAtLeast(1e-6f)

        for (i in 0..segments) {
            val u = i.toFloat() / segments
            val a = u * PI.toFloat() * 2f
            val c = cos(a)
            val s = sin(a)
            val nx = (nRadial / nLen) * c
            val ny = nY / nLen
            val nz = (nRadial / nLen) * s
            addVertex(verts, c * innerR, yInner, s * innerR, nx, ny, nz, u, 0f)
            addVertex(verts, c * outerR, yOuter, s * outerR, nx, ny, nz, u, 1f)
        }
        for (i in 0 until segments) {
            val a = i * 2
            idx += a; idx += a + 1; idx += a + 2
            idx += a + 1; idx += a + 3; idx += a + 2
        }
        return build(engine, verts, idx)
    }

    fun createTorus(
        engine: Engine,
        majorR: Float,
        minorR: Float,
        majorSeg: Int = 96,
        minorSeg: Int = 20,
    ): MeshData {
        val verts = ArrayList<Float>()
        val idx = ArrayList<Int>()
        for (i in 0..majorSeg) {
            val u = i.toFloat() / majorSeg
            val a = u * PI.toFloat() * 2f
            val ca = cos(a)
            val sa = sin(a)
            for (j in 0..minorSeg) {
                val v = j.toFloat() / minorSeg
                val b = v * PI.toFloat() * 2f
                val cb = cos(b)
                val sb = sin(b)
                val x = (majorR + minorR * cb) * ca
                val y = minorR * sb
                val z = (majorR + minorR * cb) * sa
                val nx = cb * ca
                val ny = sb
                val nz = cb * sa
                addVertex(verts, x, y, z, nx, ny, nz, u, v)
            }
        }
        val ring = minorSeg + 1
        for (i in 0 until majorSeg) {
            for (j in 0 until minorSeg) {
                val a = i * ring + j
                val b = a + ring
                idx += a; idx += b; idx += a + 1
                idx += b; idx += b + 1; idx += a + 1
            }
        }
        return build(engine, verts, idx)
    }

    fun createOctahedron(engine: Engine, radius: Float): MeshData {
        val verts = ArrayList<Float>()
        val idx = ArrayList<Int>()
        val tips = arrayOf(
            floatArrayOf(radius, 0f, 0f),
            floatArrayOf(-radius, 0f, 0f),
            floatArrayOf(0f, radius, 0f),
            floatArrayOf(0f, -radius, 0f),
            floatArrayOf(0f, 0f, radius),
            floatArrayOf(0f, 0f, -radius),
        )
        val faces = arrayOf(
            intArrayOf(0, 2, 4),
            intArrayOf(0, 4, 3),
            intArrayOf(0, 3, 5),
            intArrayOf(0, 5, 2),
            intArrayOf(1, 4, 2),
            intArrayOf(1, 3, 4),
            intArrayOf(1, 5, 3),
            intArrayOf(1, 2, 5),
        )
        for (f in faces) {
            val base = verts.size / FLOATS
            val p0 = tips[f[0]]
            val p1 = tips[f[1]]
            val p2 = tips[f[2]]
            val e1x = p1[0] - p0[0]; val e1y = p1[1] - p0[1]; val e1z = p1[2] - p0[2]
            val e2x = p2[0] - p0[0]; val e2y = p2[1] - p0[1]; val e2z = p2[2] - p0[2]
            var nx = e1y * e2z - e1z * e2y
            var ny = e1z * e2x - e1x * e2z
            var nz = e1x * e2y - e1y * e2x
            val len = sqrt(nx * nx + ny * ny + nz * nz).coerceAtLeast(1e-6f)
            nx /= len; ny /= len; nz /= len
            addVertex(verts, p0[0], p0[1], p0[2], nx, ny, nz, 0f, 0f)
            addVertex(verts, p1[0], p1[1], p1[2], nx, ny, nz, 1f, 0f)
            addVertex(verts, p2[0], p2[1], p2[2], nx, ny, nz, 0.5f, 1f)
            idx += base; idx += base + 1; idx += base + 2
        }
        return build(engine, verts, idx)
    }

    fun createWedge(
        engine: Engine,
        innerR: Float,
        outerR: Float,
        yInner: Float,
        yOuter: Float,
        a0: Float,
        a1: Float,
    ): MeshData {
        val verts = ArrayList<Float>()
        val idx = ArrayList<Int>()
        fun yAt(r: Float): Float {
            val t = (r - innerR) / (outerR - innerR)
            return yInner + t * (yOuter - yInner)
        }
        fun corner(a: Float, r: Float): FloatArray {
            val c = cos(a)
            val s = sin(a)
            return floatArrayOf(c * r, yAt(r), s * r)
        }
        val p0 = corner(a0, innerR)
        val p1 = corner(a1, innerR)
        val p2 = corner(a1, outerR)
        val p3 = corner(a0, outerR)

        val dr = outerR - innerR
        val dy = yOuter - yInner
        val nRadial = -dy
        val nY = dr
        val nLen = sqrt(nRadial * nRadial + nY * nY).coerceAtLeast(1e-6f)
        val amid = (a0 + a1) * 0.5f
        val nx = (nRadial / nLen) * cos(amid)
        val ny = nY / nLen
        val nz = (nRadial / nLen) * sin(amid)

        addVertex(verts, p0[0], p0[1], p0[2], nx, ny, nz, 0f, 0f)
        addVertex(verts, p1[0], p1[1], p1[2], nx, ny, nz, 1f, 0f)
        addVertex(verts, p2[0], p2[1], p2[2], nx, ny, nz, 1f, 1f)
        addVertex(verts, p3[0], p3[1], p3[2], nx, ny, nz, 0f, 1f)
        idx += 0; idx += 1; idx += 2
        idx += 0; idx += 2; idx += 3
        return build(engine, verts, idx)
    }

    fun createQuad(engine: Engine, width: Float, height: Float): MeshData {
        val verts = ArrayList<Float>()
        val idx = ArrayList<Int>()
        val hx = width * 0.5f
        val hy = height * 0.5f
        // Lying in XZ plane, facing +Y (like Three.js PlaneGeometry after rotX -90)
        addVertex(verts, -hx, 0f, -hy, 0f, 1f, 0f, 0f, 1f)
        addVertex(verts, hx, 0f, -hy, 0f, 1f, 0f, 1f, 1f)
        addVertex(verts, hx, 0f, hy, 0f, 1f, 0f, 1f, 0f)
        addVertex(verts, -hx, 0f, hy, 0f, 1f, 0f, 0f, 0f)
        idx += 0; idx += 1; idx += 2
        idx += 0; idx += 2; idx += 3
        return build(engine, verts, idx)
    }

    private fun addVertex(
        out: MutableList<Float>,
        x: Float, y: Float, z: Float,
        nx: Float, ny: Float, nz: Float,
        u: Float, v: Float,
    ) {
        out += x; out += y; out += z
        val q = packTangentFrame(nx, ny, nz)
        out += q[0]; out += q[1]; out += q[2]; out += q[3]
        out += u; out += v
    }

    /** Pack orthonormal TBN as Filament tangent-frame quaternion. */
    private fun packTangentFrame(nx: Float, ny: Float, nz: Float): FloatArray {
        var nnx = nx; var nny = ny; var nnz = nz
        val nlen = sqrt(nnx * nnx + nny * nny + nnz * nnz).coerceAtLeast(1e-6f)
        nnx /= nlen; nny /= nlen; nnz /= nlen

        // Pick a stable tangent
        val tx: Float
        val ty: Float
        val tz: Float
        if (abs(nny) < 0.999f) {
            // cross(N, Y)
            val cx = nnz
            val cy = 0f
            val cz = -nnx
            val cl = sqrt(cx * cx + cy * cy + cz * cz).coerceAtLeast(1e-6f)
            tx = cx / cl; ty = cy / cl; tz = cz / cl
        } else {
            // cross(N, X)
            val cx = 0f
            val cy = -nnz
            val cz = nny
            val cl = sqrt(cx * cx + cy * cy + cz * cz).coerceAtLeast(1e-6f)
            tx = cx / cl; ty = cy / cl; tz = cz / cl
        }
        // B = N × T  (Filament: columns T, B, N — actually B = cross(N,T)? )
        // Standard: B = cross(N, T) gives left-handed if T from cross(N,Y)...
        // Filament expects bitangent = cross(normal, tangent) for positive handedness.
        val bx = nny * tz - nnz * ty
        val by = nnz * tx - nnx * tz
        val bz = nnx * ty - nny * tx

        // Rotation matrix columns = T, B, N → quaternion
        return mat3ToQuat(
            tx, bx, nnx,
            ty, by, nny,
            tz, bz, nnz,
        )
    }

    private fun mat3ToQuat(
        m00: Float, m01: Float, m02: Float,
        m10: Float, m11: Float, m12: Float,
        m20: Float, m21: Float, m22: Float,
    ): FloatArray {
        val trace = m00 + m11 + m22
        var x: Float
        var y: Float
        var z: Float
        var w: Float
        if (trace > 0f) {
            val s = sqrt(trace + 1f) * 2f
            w = 0.25f * s
            x = (m21 - m12) / s
            y = (m02 - m20) / s
            z = (m10 - m01) / s
        } else if (m00 > m11 && m00 > m22) {
            val s = sqrt(1f + m00 - m11 - m22) * 2f
            w = (m21 - m12) / s
            x = 0.25f * s
            y = (m01 + m10) / s
            z = (m02 + m20) / s
        } else if (m11 > m22) {
            val s = sqrt(1f + m11 - m00 - m22) * 2f
            w = (m02 - m20) / s
            x = (m01 + m10) / s
            y = 0.25f * s
            z = (m12 + m21) / s
        } else {
            val s = sqrt(1f + m22 - m00 - m11) * 2f
            w = (m10 - m01) / s
            x = (m02 + m20) / s
            y = (m12 + m21) / s
            z = 0.25f * s
        }
        // Prefer positive w (Filament convention)
        if (w < 0f) {
            x = -x; y = -y; z = -z; w = -w
        }
        val len = sqrt(x * x + y * y + z * z + w * w).coerceAtLeast(1e-6f)
        return floatArrayOf(x / len, y / len, z / len, w / len)
    }

    private fun build(engine: Engine, floats: List<Float>, indices: List<Int>): MeshData {
        val vertexCount = floats.size / FLOATS
        val vbData = ByteBuffer.allocateDirect(vertexCount * STRIDE).order(ByteOrder.nativeOrder())
        floats.forEach { vbData.putFloat(it) }
        vbData.flip()
        val vertexBuffer = VertexBuffer.Builder()
            .vertexCount(vertexCount)
            .bufferCount(1)
            .attribute(VertexBuffer.VertexAttribute.POSITION, 0, VertexBuffer.AttributeType.FLOAT3, 0, STRIDE)
            .attribute(VertexBuffer.VertexAttribute.TANGENTS, 0, VertexBuffer.AttributeType.FLOAT4, 12, STRIDE)
            .attribute(VertexBuffer.VertexAttribute.UV0, 0, VertexBuffer.AttributeType.FLOAT2, 28, STRIDE)
            .build(engine)
        vertexBuffer.setBufferAt(engine, 0, vbData)

        val ibData = ByteBuffer.allocateDirect(indices.size * 4).order(ByteOrder.nativeOrder())
        indices.forEach { ibData.putInt(it) }
        ibData.flip()
        val indexBuffer = IndexBuffer.Builder()
            .indexCount(indices.size)
            .bufferType(IndexBuffer.Builder.IndexType.UINT)
            .build(engine)
        indexBuffer.setBuffer(engine, ibData)
        return MeshData(vertexBuffer, indexBuffer, indices.size)
    }
}
