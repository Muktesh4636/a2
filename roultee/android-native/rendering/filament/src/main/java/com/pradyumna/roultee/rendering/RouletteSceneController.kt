package com.pradyumna.roultee.rendering

import android.content.Context
import android.view.Surface
import com.google.android.filament.Box
import com.google.android.filament.Camera
import com.google.android.filament.Colors
import com.google.android.filament.Engine
import com.google.android.filament.EntityManager
import com.google.android.filament.IndirectLight
import com.google.android.filament.LightManager
import com.google.android.filament.Material
import com.google.android.filament.MaterialInstance
import com.google.android.filament.RenderableManager
import com.google.android.filament.Renderer
import com.google.android.filament.Scene
import com.google.android.filament.SwapChain
import com.google.android.filament.Texture
import com.google.android.filament.TextureSampler
import com.google.android.filament.View
import com.google.android.filament.Viewport
import com.google.android.filament.utils.Utils
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import com.pradyumna.roultee.core.game.CameraPose
import com.pradyumna.roultee.core.game.POCKET_ANGLE0
import com.pradyumna.roultee.core.game.POCKET_SLICE
import com.pradyumna.roultee.core.game.PocketColor
import com.pradyumna.roultee.core.game.WHEEL_ORDER
import com.pradyumna.roultee.core.game.WheelConstants
import com.pradyumna.roultee.core.game.WheelPose
import com.pradyumna.roultee.core.game.pipeLocalAngle
import com.pradyumna.roultee.core.game.pocketColor
import com.pradyumna.roultee.core.game.pocketLocalAngle
import java.nio.ByteBuffer
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

class RouletteSceneController(private val context: Context) {
    private var engine: Engine? = null
    private var renderer: Renderer? = null
    private var scene: Scene? = null
    private var view: View? = null
    private var camera: Camera? = null
    private var swapChain: SwapChain? = null
    private var indirectLight: IndirectLight? = null

    private var rotorEntity: Int = 0
    private var ballEntity: Int = 0
    private var cameraEntity: Int = 0
    private var viewportWidth: Int = 1
    private var viewportHeight: Int = 1
    private var currentFov: Double = 38.0

    private val materials = mutableListOf<Material>()
    private val instances = mutableListOf<MaterialInstance>()
    private val meshes = mutableListOf<MeshData>()
    private val entities = mutableListOf<Int>()
    private val textures = mutableListOf<Texture>()
    private var litMaterial: Material? = null
    private var litTextureMaterial: Material? = null
    private var textureMaterial: Material? = null

    fun initialize() {
        if (engine != null) return
        Utils.init()
        val eng = Engine.create()
        engine = eng
        renderer = eng.createRenderer().also {
            it.clearOptions = Renderer.ClearOptions().apply {
                clear = true
                clearColor = floatArrayOf(0f, 0f, 0f, 1f)
            }
        }
        scene = eng.createScene()
        view = eng.createView().also { v ->
            v.scene = scene
            v.isPostProcessingEnabled = true
        }
        cameraEntity = EntityManager.get().create()
        camera = eng.createCamera(cameraEntity).also { cam ->
            cam.setProjection(38.0, 1.0, 0.05, 50.0, Camera.Fov.VERTICAL)
            view?.camera = cam
        }

        // Soft studio ambient so metals aren't pitch black without a full IBL cubemap.
        indirectLight = IndirectLight.Builder()
            .irradiance(
                1,
                floatArrayOf(
                    0.85f, 0.78f, 0.65f,
                ),
            )
            .intensity(40_000f)
            .build(eng)
        scene?.indirectLight = indirectLight

        litMaterial = loadMaterial(eng, "materials/lit_color.filamat")
        litTextureMaterial = loadMaterial(eng, "materials/lit_texture.filamat")
        textureMaterial = loadMaterial(eng, "materials/unlit_texture.filamat")
        buildScene(eng)
    }

    fun attachSurface(surface: Surface, width: Int, height: Int) {
        val eng = engine ?: return
        swapChain?.let { eng.destroySwapChain(it) }
        swapChain = eng.createSwapChain(surface)
        resize(width, height)
    }

    fun resize(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        viewportWidth = width
        viewportHeight = height
        view?.viewport = Viewport(0, 0, width, height)
        camera?.setProjection(
            currentFov,
            width.toDouble() / height,
            0.05,
            50.0,
            Camera.Fov.VERTICAL,
        )
    }

    fun applyPose(pose: WheelPose) {
        val eng = engine ?: return
        val tcm = eng.transformManager
        if (rotorEntity != 0 && tcm.hasComponent(rotorEntity)) {
            val ti = tcm.getInstance(rotorEntity)
            val m = FloatArray(16)
            // Match web: rotor.position.y = -0.02, then rotate around Y
            rotationY(pose.rotorAngle.toFloat(), m)
            m[13] = -0.02f
            tcm.setTransform(ti, m)
        }
        if (ballEntity != 0 && tcm.hasComponent(ballEntity)) {
            val ti = tcm.getInstance(ballEntity)
            val m = FloatArray(16)
            translation(pose.ballX.toFloat(), pose.ballY.toFloat(), pose.ballZ.toFloat(), m)
            tcm.setTransform(ti, m)
        }
        applyCamera(pose.camera)
    }

    fun applyCamera(camPose: CameraPose) {
        if (camPose.fov != currentFov && viewportWidth > 0 && viewportHeight > 0) {
            currentFov = camPose.fov
            camera?.setProjection(
                currentFov,
                viewportWidth.toDouble() / viewportHeight,
                0.05,
                50.0,
                Camera.Fov.VERTICAL,
            )
        }
        camera?.lookAt(
            camPose.posX, camPose.posY, camPose.posZ,
            camPose.targetX, camPose.targetY, camPose.targetZ,
            0.0, 1.0, 0.0,
        )
    }

    fun render(frameTimeNanos: Long = System.nanoTime()) {
        val r = renderer ?: return
        val sc = swapChain ?: return
        val v = view ?: return
        if (r.beginFrame(sc, frameTimeNanos)) {
            r.render(v)
            r.endFrame()
        }
    }

    fun destroy() {
        val eng = engine ?: return
        swapChain?.let { eng.destroySwapChain(it); swapChain = null }
        entities.forEach { EntityManager.get().destroy(it) }
        entities.clear()
        instances.forEach { eng.destroyMaterialInstance(it) }
        instances.clear()
        materials.forEach { eng.destroyMaterial(it) }
        materials.clear()
        litMaterial = null
        litTextureMaterial = null
        textureMaterial = null
        textures.forEach { eng.destroyTexture(it) }
        textures.clear()
        meshes.forEach {
            eng.destroyVertexBuffer(it.vertexBuffer)
            eng.destroyIndexBuffer(it.indexBuffer)
        }
        meshes.clear()
        view?.let { eng.destroyView(it) }
        scene?.let { eng.destroyScene(it) }
        renderer?.let { eng.destroyRenderer(it) }
        indirectLight?.let { eng.destroyIndirectLight(it); indirectLight = null }
        if (cameraEntity != 0) {
            eng.destroyCameraComponent(cameraEntity)
            EntityManager.get().destroy(cameraEntity)
            cameraEntity = 0
        }
        eng.destroy()
        engine = null
    }

    private fun loadMaterial(eng: Engine, assetPath: String): Material {
        val bytes = context.assets.open(assetPath).use { it.readBytes() }
        val buf = ByteBuffer.allocateDirect(bytes.size).put(bytes).also { it.flip() }
        val mat = Material.Builder().payload(buf, buf.remaining()).build(eng)
        materials += mat
        return mat
    }

    private fun lit(
        r: Float, g: Float, b: Float,
        roughness: Float,
        metallic: Float,
    ): MaterialInstance {
        val base = litMaterial ?: error("lit material missing")
        val mi = base.createInstance()
        instances += mi
        mi.setParameter("baseColor", Colors.RgbaType.SRGB, r, g, b, 1f)
        mi.setParameter("roughness", roughness)
        mi.setParameter("metallic", metallic)
        return mi
    }

    private fun litTexture(
        eng: Engine,
        bitmap: Bitmap,
        roughness: Float,
        metallic: Float,
    ): MaterialInstance {
        val base = litTextureMaterial ?: error("lit texture material missing")
        val size = bitmap.width
        val tex = Texture.Builder()
            .width(size)
            .height(size)
            .levels(1)
            .sampler(Texture.Sampler.SAMPLER_2D)
            .format(Texture.InternalFormat.RGBA8)
            .build(eng)
        textures += tex
        val pixels = IntArray(size * size)
        bitmap.getPixels(pixels, 0, size, 0, 0, size, size)
        val buf = ByteBuffer.allocateDirect(size * size * 4)
        for (p in pixels) {
            buf.put(((p shr 16) and 0xFF).toByte())
            buf.put(((p shr 8) and 0xFF).toByte())
            buf.put((p and 0xFF).toByte())
            buf.put(((p ushr 24) and 0xFF).toByte())
        }
        buf.flip()
        tex.setImage(
            eng,
            0,
            Texture.PixelBufferDescriptor(buf, Texture.Format.RGBA, Texture.Type.UBYTE),
        )
        bitmap.recycle()
        val mi = base.createInstance()
        instances += mi
        mi.setParameter(
            "baseMap",
            tex,
            TextureSampler(
                TextureSampler.MinFilter.LINEAR,
                TextureSampler.MagFilter.LINEAR,
                TextureSampler.WrapMode.CLAMP_TO_EDGE,
            ),
        )
        mi.setParameter("roughness", roughness)
        mi.setParameter("metallic", metallic)
        return mi
    }

    private fun makeRadialGoldBitmap(size: Int = 512): Bitmap {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(android.graphics.Color.parseColor("#a8811f"))
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            strokeWidth = 1.2f
            style = Paint.Style.STROKE
        }
        val cx = size / 2f
        val cy = size / 2f
        for (i in 0 until 180) {
            val a = (i / 180.0) * Math.PI * 2.0
            paint.color = if (i % 2 == 0) {
                android.graphics.Color.argb(56, 255, 230, 150)
            } else {
                android.graphics.Color.argb(46, 90, 70, 20)
            }
            canvas.drawLine(
                cx,
                cy,
                (cx + cos(a) * size * 0.5).toFloat(),
                (cy + sin(a) * size * 0.5).toFloat(),
                paint,
            )
        }
        return bitmap
    }

    private fun buildScene(eng: Engine) {
        val sc = scene ?: return

        // Key / fill / rim — same directions as the web app
        addDirectional(eng, sc, 2.2f, 3f, 7.5f, 2.5f)
        addDirectional(eng, sc, 0.9f, -3.5f, 3f, -1.5f)
        addDirectional(eng, sc, 0.55f, 0.5f, 2f, -3.5f)

        // Metals kept low so lit color survives without a specular IBL cubemap
        val blackGloss = lit(0.13f, 0.13f, 0.15f, 0.28f, 0.0f)
        val blackMatte = lit(0.12f, 0.12f, 0.13f, 0.5f, 0.0f)
        val gold = lit(0.80f, 0.63f, 0.20f, 0.35f, 0.35f)
        val goldBright = lit(0.93f, 0.76f, 0.30f, 0.28f, 0.3f)
        val goldSoft = lit(0.72f, 0.55f, 0.16f, 0.4f, 0.3f)
        // Flat matte white — no specular "spark" highlight
        val whiteBall = lit(0.94f, 0.94f, 0.94f, 1.0f, 0.0f)
        val red = lit(0.62f, 0.075f, 0.10f, 0.5f, 0.0f)
        val blackPocket = lit(0.05f, 0.05f, 0.05f, 0.5f, 0.0f)
        val green = lit(0.08f, 0.47f, 0.19f, 0.5f, 0.0f)

        // Outer bowl (fixed — does not spin with rotor)
        // Torus is already horizontal in XZ (unlike Three.js, which needs rotX).
        addMesh(
            eng, sc,
            MeshFactory.createTorus(eng, 1.14f, 0.075f, 96, 20),
            blackGloss,
            ty = 0.26f,
        )
        addMesh(
            eng, sc,
            MeshFactory.createCylinder(eng, 1.19f, 1.22f, 0.2f, 96),
            blackGloss,
            ty = 0.14f,
        )
        // Ball track slightly lightened so it separates from numbers and rim
        val slopeSheen = lit(0.19f, 0.19f, 0.21f, 0.38f, 0.2f)
        addMesh(
            eng, sc,
            MeshFactory.createSlopedRing(eng, 0.78f, 1.14f, 0.085f, 0.24f, 128),
            slopeSheen,
        )
        // Soft light ring hugging the number ring's outer edge
        val trackGlow = lit(0.32f, 0.32f, 0.34f, 0.5f, 0.0f)
        addMesh(
            eng, sc,
            MeshFactory.createSlopedRing(eng, 0.785f, 0.87f, 0.088f, 0.115f, 128),
            trackGlow,
        )

        // Diamond deflectors on the upper slope
        val diamondMesh = MeshFactory.createOctahedron(eng, 0.035f)
        meshes += diamondMesh
        for (i in 0 until 8) {
            val a = (i / 8.0) * PI * 2.0 + 0.2
            addMesh(
                eng, sc, diamondMesh, blackGloss,
                tx = (cos(a) * 0.97).toFloat(),
                ty = 0.175f,
                tz = (sin(a) * 0.97).toFloat(),
                rotY = (-a).toFloat(),
                sx = 1f, sy = 0.45f, sz = 0.7f,
                trackMesh = false,
            )
        }

        // Rotor group (spins)
        rotorEntity = EntityManager.get().create()
        entities += rotorEntity
        eng.transformManager.create(rotorEntity)
        sc.addEntity(rotorEntity)

        val innerR = 0.535f
        val outerR = 0.78f
        val yInner = 0.078f
        val yOuter = 0.09f

        for (i in WHEEL_ORDER.indices) {
            val num = WHEEL_ORDER[i]
            val a0 = pipeLocalAngle(i).toFloat()
            val a1 = pipeLocalAngle(i + 1).toFloat()
            val color = when (pocketColor(num)) {
                PocketColor.RED -> red
                PocketColor.BLACK -> blackPocket
                PocketColor.GREEN -> green
            }
            val mesh = MeshFactory.createWedge(eng, innerR, outerR, yInner, yOuter, a0, a1)
            addMesh(eng, sc, mesh, color, parent = rotorEntity)
        }

        // Number labels
        val labelQuad = MeshFactory.createQuad(eng, 0.105f, 0.105f)
        meshes += labelQuad
        val texMat = textureMaterial ?: error("texture material missing")
        for (i in WHEEL_ORDER.indices) {
            val num = WHEEL_ORDER[i]
            val amid = pocketLocalAngle(i)
            val rText = (innerR + outerR) * 0.52f
            val t = (rText - innerR) / (outerR - innerR)
            val yText = yInner + t * (yOuter - yInner) + 0.012f
            val tex = NumberLabelTextures.create(eng, num)
            textures += tex
            val mi = texMat.createInstance()
            instances += mi
            mi.setParameter("baseMap", tex, NumberLabelTextures.sampler)
            // Web: rotation.set(-PI/2, 0, 3*PI/2 - amid) on a PlaneGeometry in XY.
            // Our quad already lies in XZ facing +Y, so only in-plane spin around Y:
            // digit top toward center ≈ -(amid) adjusted by 3π/2 vs π/2 convention.
            val rotY = (3 * PI / 2 - amid).toFloat()
            addMesh(
                eng, sc, labelQuad, mi,
                parent = rotorEntity,
                tx = (cos(amid) * rText).toFloat(),
                ty = yText,
                tz = (sin(amid) * rText).toFloat(),
                rotY = rotY,
                trackMesh = false,
            )
        }

        // Thin gold borders around the number ring
        addMesh(
            eng, sc,
            MeshFactory.createTorus(eng, 0.78f, 0.006f, 96, 12),
            goldBright,
            parent = rotorEntity,
            ty = 0.092f,
        )
        addMesh(
            eng, sc,
            MeshFactory.createTorus(eng, 0.538f, 0.006f, 96, 12),
            goldBright,
            parent = rotorEntity,
            ty = 0.082f,
        )

        // Gold separator + pocket floor
        addMesh(
            eng, sc,
            MeshFactory.createRing(eng, 0.48f, 0.58f, 128),
            goldBright,
            parent = rotorEntity,
            ty = 0.072f,
        )
        addMesh(
            eng, sc,
            MeshFactory.createSlopedRing(eng, 0.32f, 0.56f, -0.005f, 0.052f, 128),
            goldSoft,
            parent = rotorEntity,
        )
        addMesh(
            eng, sc,
            MeshFactory.createCylinder(eng, 0.32f, 0.34f, 0.06f, 64),
            gold,
            parent = rotorEntity,
            ty = 0.02f,
        )

        // Stop frets (radial gold bars)
        val numInnerR = 0.55
        val pipeR = WheelConstants.PIPE_RADIUS.toFloat()
        val stopOuterR = numInnerR - 0.006
        val stopInnerR = WheelConstants.STOP_INNER_R
        val stopSpan = stopOuterR - stopInnerR
        val stopLen = (stopSpan - 2 * WheelConstants.PIPE_RADIUS - 0.004).coerceAtLeast(0.04)
        val fretMesh = MeshFactory.createCylinder(eng, pipeR, pipeR, stopLen.toFloat(), 10, capped = true)
        meshes += fretMesh
        for (i in WHEEL_ORDER.indices) {
            val a = pipeLocalAngle(i)
            val r = ((stopInnerR + stopOuterR) / 2).toFloat()
            // Capsule along radial axis: cylinder is Y-up, rotate to lie in XZ radial
            addMesh(
                eng, sc, fretMesh, goldBright,
                parent = rotorEntity,
                tx = (cos(a) * r).toFloat(),
                ty = 0.042f,
                tz = (sin(a) * r).toFloat(),
                rotY = (-a).toFloat(),
                rotZ = PI.toFloat() / 2f,
                trackMesh = false,
            )
        }

        addMesh(
            eng, sc,
            MeshFactory.createTorus(eng, (numInnerR - 0.002).toFloat(), 0.008f, 96, 14),
            goldBright,
            parent = rotorEntity,
            ty = 0.055f,
        )

        // Gold cone (fixed to wheel, not rotor — matches web `wheel.add(cone)`)
        val coneMat = litTexture(eng, makeRadialGoldBitmap(), 0.35f, 0.4f)
        addMesh(
            eng, sc,
            MeshFactory.createCylinder(eng, 0.09f, 0.38f, 0.22f, 64),
            coneMat,
            ty = 0.12f,
        )
        addMesh(
            eng, sc,
            MeshFactory.createDisk(eng, 0.38f, 64),
            goldSoft,
            ty = 0.01f,
        )
        // Dark hub at the cone mouth — mimics the web wheel's shadowed center
        val darkHub = lit(0.04f, 0.035f, 0.03f, 0.6f, 0.0f)
        addMesh(
            eng, sc,
            MeshFactory.createDisk(eng, 0.175f, 48),
            darkHub,
            ty = 0.232f,
        )

        // Center turret + 4 arms (on rotor)
        addMesh(
            eng, sc,
            MeshFactory.createCylinder(eng, 0.12f, 0.16f, 0.06f, 48, capped = true),
            goldBright,
            parent = rotorEntity,
            ty = 0.26f,
        )
        addMesh(
            eng, sc,
            MeshFactory.createCylinder(eng, 0.08f, 0.11f, 0.07f, 48, capped = true),
            gold,
            parent = rotorEntity,
            ty = 0.32f,
        )
        addMesh(
            eng, sc,
            MeshFactory.createSphere(eng, 0.055f, 24, 16),
            goldBright,
            parent = rotorEntity,
            ty = 0.38f,
        )

        val armShaft = MeshFactory.createCylinder(eng, 0.014f, 0.018f, 0.34f, 16, capped = true)
        val armKnob = MeshFactory.createSphere(eng, 0.034f, 16, 12)
        meshes += armShaft
        meshes += armKnob
        for (i in 0 until 4) {
            val a = (i * PI / 2).toFloat()
            // Shaft along local X: cylinder Y-up → rotZ 90°, then rotate group by a around Y
            addMesh(
                eng, sc, armShaft, goldBright,
                parent = rotorEntity,
                tx = cos(a) * 0.2f,
                ty = 0.36f,
                tz = sin(a) * 0.2f,
                rotY = -a,
                rotZ = PI.toFloat() / 2f,
                trackMesh = false,
            )
            addMesh(
                eng, sc, armKnob, goldBright,
                parent = rotorEntity,
                tx = cos(a) * 0.38f,
                ty = 0.36f,
                tz = sin(a) * 0.38f,
                trackMesh = false,
            )
        }

        val ballMesh = MeshFactory.createSphere(eng, WheelConstants.BALL_R.toFloat(), 28, 20)
        ballEntity = addMesh(
            eng, sc, ballMesh, whiteBall,
            ty = WheelConstants.TRACK_Y.toFloat(),
            tx = WheelConstants.TRACK_R.toFloat(),
        )
    }

    private fun addDirectional(
        eng: Engine,
        sc: Scene,
        intensity: Float,
        px: Float,
        py: Float,
        pz: Float,
    ) {
        val sun = EntityManager.get().create()
        entities += sun
        val len = kotlin.math.sqrt(px * px + py * py + pz * pz).coerceAtLeast(1e-3f)
        LightManager.Builder(LightManager.Type.DIRECTIONAL)
            .color(1f, 1f, 1f)
            .intensity(intensity * 40_000f)
            .direction(-px / len, -py / len, -pz / len)
            .build(eng, sun)
        sc.addEntity(sun)
    }

    private fun addMesh(
        eng: Engine,
        sc: Scene,
        mesh: MeshData,
        material: MaterialInstance,
        parent: Int = 0,
        tx: Float = 0f,
        ty: Float = 0f,
        tz: Float = 0f,
        rotX: Float = 0f,
        rotY: Float = 0f,
        rotZ: Float = 0f,
        sx: Float = 1f,
        sy: Float = 1f,
        sz: Float = 1f,
        trackMesh: Boolean = true,
    ): Int {
        if (trackMesh) meshes += mesh
        val entity = EntityManager.get().create()
        entities += entity
        RenderableManager.Builder(1)
            .boundingBox(Box(0f, 0f, 0f, 2f, 1f, 2f))
            .geometry(
                0,
                RenderableManager.PrimitiveType.TRIANGLES,
                mesh.vertexBuffer,
                mesh.indexBuffer,
                0,
                mesh.indexCount,
            )
            .material(0, material)
            .culling(false)
            .castShadows(false)
            .receiveShadows(false)
            .build(eng, entity)

        val tcm = eng.transformManager
        tcm.create(entity)
        val ti = tcm.getInstance(entity)
        val m = composeTransform(tx, ty, tz, rotX, rotY, rotZ, sx, sy, sz)
        tcm.setTransform(ti, m)
        if (parent != 0 && tcm.hasComponent(parent)) {
            tcm.setParent(ti, tcm.getInstance(parent))
        }
        sc.addEntity(entity)
        return entity
    }

    private fun composeTransform(
        tx: Float, ty: Float, tz: Float,
        rotX: Float, rotY: Float, rotZ: Float,
        sx: Float, sy: Float, sz: Float,
    ): FloatArray {
        // Column-major TRS: T * Ry * Rx * Rz * S  (matches typical Three.js YXZ/order needs)
        val cx = cos(rotX); val sxn = sin(rotX)
        val cy = cos(rotY); val syn = sin(rotY)
        val cz = cos(rotZ); val szn = sin(rotZ)

        // Ry * Rx * Rz
        val r00 = cy * cz + syn * sxn * szn
        val r01 = -cy * szn + syn * sxn * cz
        val r02 = syn * cx
        val r10 = cx * szn
        val r11 = cx * cz
        val r12 = -sxn
        val r20 = -syn * cz + cy * sxn * szn
        val r21 = syn * szn + cy * sxn * cz
        val r22 = cy * cx

        return floatArrayOf(
            r00 * sx, r10 * sx, r20 * sx, 0f,
            r01 * sy, r11 * sy, r21 * sy, 0f,
            r02 * sz, r12 * sz, r22 * sz, 0f,
            tx, ty, tz, 1f,
        )
    }

    private fun translation(x: Float, y: Float, z: Float, out: FloatArray) {
        out[0] = 1f; out[1] = 0f; out[2] = 0f; out[3] = 0f
        out[4] = 0f; out[5] = 1f; out[6] = 0f; out[7] = 0f
        out[8] = 0f; out[9] = 0f; out[10] = 1f; out[11] = 0f
        out[12] = x; out[13] = y; out[14] = z; out[15] = 1f
    }

    private fun rotationY(radians: Float, out: FloatArray) {
        val c = cos(radians)
        val s = sin(radians)
        out[0] = c; out[1] = 0f; out[2] = -s; out[3] = 0f
        out[4] = 0f; out[5] = 1f; out[6] = 0f; out[7] = 0f
        out[8] = s; out[9] = 0f; out[10] = c; out[11] = 0f
        out[12] = 0f; out[13] = 0f; out[14] = 0f; out[15] = 1f
    }
}
