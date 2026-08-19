import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { createRace, finishRace as finishRaceApi, placeBet as placeBetApi } from "./api.js";
import { fetchGunduWalletBalance } from "./gunduWallet.js";

/** Public assets live under Vite base (/horse-racing/ in prod). */
const assetUrl = (path) => {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${String(path).replace(/^\//, "")}`;
};

const TOTAL_LAPS = 3;
const HORSE_COUNT = 6;
const SHOW_JOCKEYS = false; // temporary: hide riders
const STARTING_BANKROLL = 1000;
const ODDS_BY_NUMBER = {
  1: 3.5,
  2: 4.0,
  3: 4.5,
  4: 5.0,
  5: 5.5,
  6: 6.0,
};
const TRACK = {
  radiusX: 30,
  radiusZ: 18,
  width: 9.2,
};

/** Six racehorses — tinted fur maps + shared hide normals on the animated rig */
const FIELD = [
  {
    name: "#1 Chestnut",
    silk: 0xc62828,
    cloth: 0xc62828,
    coat: 0xaa5f34,
    mane: 0x462a1c,
    furMap: assetUrl("textures/horses/skins/01-chestnut-fur.jpg?v=3"),
  },
  {
    name: "#2 Bay",
    silk: 0x1565c0,
    cloth: 0x1565c0,
    coat: 0x583a28,
    mane: 0x120c0a,
    furMap: assetUrl("textures/horses/skins/02-bay-fur.jpg?v=3"),
  },
  {
    name: "#3 Black",
    silk: 0x2e7d32,
    cloth: 0x2e7d32,
    coat: 0x201c1a,
    mane: 0x0c0a0a,
    furMap: assetUrl("textures/horses/skins/03-black-fur.jpg?v=3"),
  },
  {
    name: "#4 Grey",
    silk: 0xf9a825,
    cloth: 0xf9a825,
    coat: 0xa8a5a0,
    mane: 0x5a5854,
    furMap: assetUrl("textures/horses/skins/04-grey-fur.jpg?v=3"),
  },
  {
    name: "#5 Palomino",
    silk: 0x6a1b9a,
    cloth: 0x6a1b9a,
    coat: 0xd2a55f,
    mane: 0xebe1cd,
    furMap: assetUrl("textures/horses/skins/05-palomino-fur.jpg?v=3"),
  },
  {
    name: "#6 Pinto",
    silk: 0x00838f,
    cloth: 0x00838f,
    coat: 0x694830,
    mane: 0x1e1814,
    furMap: assetUrl("textures/horses/skins/06-pinto-fur.jpg?v=3"),
  },
];

const canvas = document.getElementById("scene");
const lapEl = document.getElementById("lap");
const speedEl = document.getElementById("speed");
const timerEl = document.getElementById("timer");
const leaderEl = document.getElementById("leader");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const finishBanner = document.getElementById("finishBanner");
const finishTimeEl = document.getElementById("finishTime");
const finishBetEl = document.getElementById("finishBet");
const horsePicksEl = document.getElementById("horsePicks");
const betAmountEl = document.getElementById("betAmount");
const placeBetBtn = document.getElementById("placeBetBtn");
const bankrollEl = document.getElementById("bankroll");
const betStatusEl = document.getElementById("betStatus");
const openBetsEl = document.getElementById("openBets");
const stageEl = document.querySelector(".stage");

function loadBankroll() {
  const raw = localStorage.getItem("gallop_bankroll");
  const value = raw == null ? STARTING_BANKROLL : Number(raw);
  return Number.isFinite(value) ? value : STARTING_BANKROLL;
}

const betting = {
  bankroll: loadBankroll(),
  selectedNumber: 1,
  bets: [],
  settled: false,
};

function getStageSize() {
  const w = stageEl?.clientWidth || window.innerWidth;
  const h = stageEl?.clientHeight || Math.round(window.innerHeight * 0.68);
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

function resizeRenderer() {
  const { w, h } = getStageSize();
  if (typeof camera !== "undefined" && camera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  renderer.setSize(w, h, false);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const _stage0 = getStageSize();
renderer.setSize(_stage0.w, _stage0.h, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec4e8);
scene.fog = new THREE.Fog(0x8ec4e8, 35, 90);

const camera = new THREE.PerspectiveCamera(
  48,
  getStageSize().w / getStageSize().h,
  0.1,
  220
);
camera.position.set(42, 8, 12);

// Warm outdoor sun — hard side light so muscle normals read
const sun = new THREE.DirectionalLight(0xfff2e0, 4.4);
sun.position.set(22, 16, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 120;
sun.shadow.camera.left = -50;
sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50;
sun.shadow.camera.bottom = -50;
sun.shadow.bias = -0.0005;
scene.add(sun);

scene.add(new THREE.AmbientLight(0xd8e8ff, 0.32));
scene.add(new THREE.HemisphereLight(0xb8d8ff, 0x6b8f4e, 0.7));

const fill = new THREE.DirectionalLight(0xcfe0ff, 0.55);
fill.position.set(-18, 12, -8);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffe6c8, 1.15);
rim.position.set(-8, 10, 16);
scene.add(rim);

// Outdoor HDR for natural coat reflections
new RGBELoader().load(assetUrl("env.hdr"), (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = texture;
});

/** Option-A natural grass: world-space color (no tile seams) + 3D blades */
const grassUniforms = {
  uTime: { value: 0 },
  uMap: { value: null },
  uSunDir: { value: new THREE.Vector3(12, 28, 18).normalize() },
};

function hash2(p) {
  return `
    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float noise21(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * noise21(p);
        p = p * 2.03 + vec2(17.1, 9.7);
        a *= 0.5;
      }
      return v;
    }
  `;
}

function createGrassGroundMaterial(map) {
  grassUniforms.uMap.value = map;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...grassUniforms,
      uColorDeep: { value: new THREE.Color(0x2f6b22) },
      uColorMid: { value: new THREE.Color(0x458c2e) },
      uColorLit: { value: new THREE.Color(0x5fa83a) },
      uColorSoil: { value: new THREE.Color(0x5a4a28) },
    },
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform vec3 uColorDeep;
      uniform vec3 uColorMid;
      uniform vec3 uColorLit;
      uniform vec3 uColorSoil;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      ${hash2()}
      // Anti-tile: 3 rotated world samples blended by noise (no duplicate seams)
      vec3 sampleGrass(vec2 wp) {
        float n = noise21(wp * 0.035);
        float a0 = n * 6.2831853;
        float a1 = a0 + 2.094;
        float a2 = a0 + 4.189;
        mat2 r0 = mat2(cos(a0), -sin(a0), sin(a0), cos(a0));
        mat2 r1 = mat2(cos(a1), -sin(a1), sin(a1), cos(a1));
        mat2 r2 = mat2(cos(a2), -sin(a2), sin(a2), cos(a2));
        vec3 s0 = texture2D(uMap, r0 * wp * 0.04 + 0.17).rgb;
        vec3 s1 = texture2D(uMap, r1 * wp * 0.048 + 0.53).rgb;
        vec3 s2 = texture2D(uMap, r2 * wp * 0.033 + 0.29).rgb;
        float w0 = noise21(wp * 0.07 + 1.7);
        float w1 = noise21(wp * 0.07 + 8.3);
        float w2 = noise21(wp * 0.07 + 15.9);
        float sum = w0 + w1 + w2 + 1e-4;
        return (s0 * w0 + s1 * w1 + s2 * w2) / sum;
      }
      void main() {
        vec2 wp = vWorldPos.xz;
        float macro = fbm(wp * 0.07);
        float clumps = fbm(wp * 0.25 + 3.1);
        float blades = fbm(wp * 1.8 + 9.0);
        float micro = noise21(wp * 7.2);

        vec3 tex = sampleGrass(wp);
        // Kill washed-out / white highlights from the photo map — keep only green
        float luma = dot(tex, vec3(0.299, 0.587, 0.114));
        tex = mix(tex, vec3(0.22, 0.48, 0.14), smoothstep(0.55, 0.85, luma));
        float greenBias = smoothstep(0.08, 0.35, tex.g - tex.r * 0.35);
        tex = mix(vec3(0.22, 0.46, 0.14), tex, greenBias);
        tex = clamp(tex, vec3(0.12, 0.28, 0.08), vec3(0.45, 0.7, 0.28));

        vec3 col = mix(uColorDeep, uColorMid, smoothstep(0.2, 0.75, macro));
        col = mix(col, uColorLit, smoothstep(0.5, 0.95, clumps) * 0.45);
        col = mix(col, uColorSoil, (1.0 - clumps) * 0.05 * (0.35 + micro));
        col = mix(col, tex, 0.28);
        col += (blades - 0.45) * vec3(0.04, 0.07, 0.02);
        col = clamp(col, vec3(0.1, 0.25, 0.06), vec3(0.5, 0.72, 0.28));

        float ndl = max(0.0, dot(normalize(vNormalW), uSunDir));
        float shade = 0.78 + 0.28 * ndl;
        float ao = mix(0.85, 1.02, clumps);
        col *= shade * ao;

        float fogFactor = smoothstep(40.0, 95.0, length(vWorldPos - cameraPosition));
        col = mix(col, vec3(0.557, 0.769, 0.910), fogFactor);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function createBladeGeometry() {
  // Soft tapered crossed quads — dense lawn feel from race camera
  const geo = new THREE.BufferGeometry();
  const w = 0.09;
  const tip = 0.012;
  const h = 0.42;
  const positions = [
    -w, 0, 0, w, 0, 0, tip, h, 0,
    -w, 0, 0, tip, h, 0, -tip, h, 0,
    0, 0, -w, 0, 0, w, 0, h, tip,
    0, 0, -w, 0, h, tip, 0, h, -tip,
  ];
  // Only green — no pale/white tips
  const base = [0.18, 0.48, 0.12];
  const tipC = [0.32, 0.62, 0.16];
  const colors = [];
  for (let c = 0; c < 2; c++) {
    colors.push(...base, ...base, ...tipC, ...base, ...tipC, ...tipC);
  }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function createGrassBladeMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0,
    color: 0x4a9a32,
    envMapIntensity: 0.15,
  });
}

function isOnDirtTrack(x, z) {
  const outerX = TRACK.radiusX + TRACK.width / 2 + 0.15;
  const outerZ = TRACK.radiusZ + TRACK.width / 2 + 0.15;
  const innerX = TRACK.radiusX - TRACK.width / 2 - 0.15;
  const innerZ = TRACK.radiusZ - TRACK.width / 2 - 0.15;
  const ox = x / outerX;
  const oz = z / outerZ;
  const ix = x / innerX;
  const iz = z / innerZ;
  const outsideInner = ix * ix + iz * iz >= 1;
  const insideOuter = ox * ox + oz * oz <= 1;
  return outsideInner && insideOuter;
}

function createGrassBlades() {
  const count = 52000;
  const geo = createBladeGeometry();
  const mat = createGrassBladeMaterial();
  const instanced = new THREE.InstancedMesh(geo, mat, count);
  instanced.castShadow = false;
  instanced.receiveShadow = true;
  instanced.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let placed = 0;
  let attempts = 0;
  const maxAttempts = count * 12;

  while (placed < count && attempts < maxAttempts) {
    attempts++;
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 62;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r * 0.72;
    if (isOnDirtTrack(x, z)) continue;

    const nx = x / (TRACK.radiusX + TRACK.width / 2);
    const nz = z / (TRACK.radiusZ + TRACK.width / 2);
    const radial = Math.sqrt(nx * nx + nz * nz);
    // Pack densest along the rails (race camera view)
    const nearRail = Math.abs(radial - 1) < 0.55 || radial < 1.0;
    if (!nearRail && Math.random() > 0.35) continue;

    const hScale = 0.55 + Math.random() * 0.95;
    const wScale = 0.9 + Math.random() * 0.9;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(
      (Math.random() - 0.5) * 0.35,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.3
    );
    dummy.scale.set(wScale, hScale, wScale);
    dummy.updateMatrix();
    instanced.setMatrixAt(placed, dummy.matrix);

    const lit = Math.random();
    if (lit > 0.65) tint.setRGB(0.28 + Math.random() * 0.12, 0.58 + Math.random() * 0.14, 0.14 + Math.random() * 0.06);
    else if (lit > 0.3) tint.setRGB(0.18 + Math.random() * 0.1, 0.48 + Math.random() * 0.12, 0.1 + Math.random() * 0.05);
    else tint.setRGB(0.12 + Math.random() * 0.08, 0.36 + Math.random() * 0.1, 0.08 + Math.random() * 0.04);
    instanced.setColorAt(placed, tint);
    placed++;
  }

  instanced.count = placed;
  instanced.instanceMatrix.needsUpdate = true;
  if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
  instanced.computeBoundingSphere();
  scene.add(instanced);
  return { mesh: instanced, material: mat };
}

function createGround() {
  const loader = new THREE.TextureLoader();
  const map = loader.load(assetUrl("textures/grass/natural-albedo.png"));
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const groundMat = createGrassGroundMaterial(map);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(72, 128), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = "grassGround";
  scene.add(ground);

  createGrassBlades();
}

function buildOvalShape(rx, rz, segments = 128) {
  const shape = new THREE.Shape();
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const z = Math.sin(t) * rz;
    if (i === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  }
  return shape;
}

function applyTrackDirtUVs(geometry) {
  const pos = geometry.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    // World XZ tiling across the oval surface
    uvs[i * 2] = pos.getX(i) * 0.12;
    uvs[i * 2 + 1] = pos.getZ(i) * 0.12;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  try {
    geometry.computeTangents();
  } catch {
    /* ignore if non-indexed */
  }
}

function createTrack() {
  const outer = buildOvalShape(
    TRACK.radiusX + TRACK.width / 2,
    TRACK.radiusZ + TRACK.width / 2
  );
  const inner = buildOvalShape(
    TRACK.radiusX - TRACK.width / 2,
    TRACK.radiusZ - TRACK.width / 2
  );
  outer.holes.push(inner);

  const trackGeo = new THREE.ExtrudeGeometry(outer, {
    depth: 0.18,
    bevelEnabled: false,
    curveSegments: 128,
  });
  trackGeo.rotateX(-Math.PI / 2);
  applyTrackDirtUVs(trackGeo);

  const trackMat = new THREE.MeshStandardMaterial({
    color: 0xc4a06a,
    roughness: 0.95,
    metalness: 0.02,
  });

  const track = new THREE.Mesh(trackGeo, trackMat);
  track.receiveShadow = true;
  track.castShadow = true;
  track.name = "dirtTrack";
  scene.add(track);

  // Load realistic soil maps onto the track surface
  Promise.all([
    loadTexture(assetUrl("textures/dirt/dirt_diff.jpg"), { repeat: true }),
    loadTexture(assetUrl("textures/dirt/dirt_nor.jpg"), {
      repeat: true,
      colorSpace: THREE.NoColorSpace,
    }),
    loadTexture(assetUrl("textures/dirt/dirt_rough.jpg"), {
      repeat: true,
      colorSpace: THREE.NoColorSpace,
    }),
  ])
    .then(([diff, nor, rough]) => {
      for (const tex of [diff, nor, rough]) {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(1, 1);
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        tex.needsUpdate = true;
      }
      trackMat.map = diff;
      trackMat.normalMap = nor;
      trackMat.normalScale.set(1.35, 1.35);
      trackMat.roughnessMap = rough;
      trackMat.color.set(0xffffff);
      trackMat.roughness = 1;
      trackMat.metalness = 0.02;
      trackMat.envMapIntensity = 0.15;
      trackMat.needsUpdate = true;
    })
    .catch((err) => console.warn("Dirt textures failed", err));

  // Inner backdrop so side camera sees sky/wall instead of the whole oval
  const wallPoints = [];
  for (let i = 0; i <= 96; i++) {
    const t = (i / 96) * Math.PI * 2;
    wallPoints.push(
      new THREE.Vector3(
        Math.cos(t) * (TRACK.radiusX - TRACK.width / 2 - 1.2),
        0,
        Math.sin(t) * (TRACK.radiusZ - TRACK.width / 2 - 1.2)
      )
    );
  }
  const wallCurve = new THREE.CatmullRomCurve3(wallPoints, true);
  const wall = new THREE.Mesh(
    new THREE.TubeGeometry(wallCurve, 96, 0.01, 3, true),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  scene.add(wall);

  const backdrop = new THREE.Mesh(
    new THREE.CylinderGeometry(
      TRACK.radiusX - TRACK.width / 2 - 0.8,
      TRACK.radiusX - TRACK.width / 2 - 0.8,
      8,
      64,
      1,
      true
    ),
    new THREE.MeshStandardMaterial({
      color: 0x7eb6d9,
      side: THREE.BackSide,
      roughness: 1,
      metalness: 0,
    })
  );
  backdrop.position.y = 4;
  // Oval-ish: scale Z to match track ellipse
  backdrop.scale.set(1, 1, TRACK.radiusZ / TRACK.radiusX);
  scene.add(backdrop);

  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xf0e6d2,
    roughness: 0.8,
  });
  for (const offset of [-2.4, -0.8, 0.8, 2.4]) {
    const points = [];
    for (let i = 0; i <= 160; i++) {
      const t = (i / 160) * Math.PI * 2;
      points.push(
        new THREE.Vector3(
          Math.cos(t) * (TRACK.radiusX + offset),
          0.2,
          Math.sin(t) * (TRACK.radiusZ + offset)
        )
      );
    }
    const curve = new THREE.CatmullRomCurve3(points, true);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.04, 6, true), lineMat));
  }

  const finish = new THREE.Mesh(
    new THREE.BoxGeometry(TRACK.width + 0.4, 0.05, 0.55),
    new THREE.MeshStandardMaterial({ color: 0xf5f0e8 })
  );
  finish.position.set(TRACK.radiusX, 0.22, 0);
  scene.add(finish);

  const railMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  for (const side of [
    [TRACK.radiusX + TRACK.width / 2 + 0.25, TRACK.radiusZ + TRACK.width / 2 + 0.25],
    [TRACK.radiusX - TRACK.width / 2 - 0.25, TRACK.radiusZ - TRACK.width / 2 - 0.25],
  ]) {
    const points = [];
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(t) * side[0], 0.55, Math.sin(t) * side[1]));
    }
    const curve = new THREE.CatmullRomCurve3(points, true);
    const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.08, 8, true), railMat);
    rail.castShadow = true;
    scene.add(rail);
  }

  const standMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.85 });
  for (let i = -2; i <= 2; i++) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 2.2), standMat);
    stand.position.set(i * 7, 1.6, -TRACK.radiusZ - 8);
    stand.castShadow = true;
    stand.receiveShadow = true;
    scene.add(stand);
  }
}

function trackPoint(progress) {
  const t = progress * Math.PI * 2;
  return new THREE.Vector3(
    Math.cos(t) * TRACK.radiusX,
    0,
    Math.sin(t) * TRACK.radiusZ
  );
}

function trackTangent(progress) {
  const t = progress * Math.PI * 2;
  const dx = -Math.sin(t) * TRACK.radiusX;
  const dz = Math.cos(t) * TRACK.radiusZ;
  return new THREE.Vector3(dx, 0, dz).normalize();
}

function addMesh(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Build a jockey in a racing crouch */
function createJockey(silkColor = 0x7b1e3a, clothColor = 0xc62828) {
  const jockey = new THREE.Group();
  jockey.name = "jockey";

  const skin = new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.65 });
  const silk = new THREE.MeshStandardMaterial({ color: silkColor, roughness: 0.55 });
  const silkWhite = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 });
  const pants = new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.7 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.75 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.35 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.8 });
  const cloth = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.85 });

  addMesh(jockey, new THREE.BoxGeometry(0.5, 0.06, 0.55), cloth, 0, 0.02, 0.05);
  addMesh(jockey, new THREE.BoxGeometry(0.38, 0.08, 0.35), leather, 0, 0.08, 0.02);

  const body = new THREE.Group();
  body.position.set(0, 0.35, 0.05);
  body.rotation.x = 1.15;
  jockey.add(body);

  const torso = addMesh(body, new THREE.BoxGeometry(0.38, 0.55, 0.28), silk, 0, 0.28, 0);
  addMesh(torso, new THREE.BoxGeometry(0.4, 0.18, 0.3), silkWhite, 0, -0.05, 0);
  addMesh(torso, new THREE.BoxGeometry(0.12, 0.16, 0.32), silk, 0.2, 0.05, 0);

  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.02);
  head.rotation.x = -0.35;
  body.add(head);
  addMesh(head, new THREE.SphereGeometry(0.13, 12, 12), skin, 0, 0, 0);
  addMesh(head, new THREE.SphereGeometry(0.155, 12, 12), helmetMat, 0, 0.02, 0);
  addMesh(head, new THREE.CylinderGeometry(0.155, 0.17, 0.05, 12), helmetMat, 0, -0.08, 0);
  addMesh(
    head,
    new THREE.BoxGeometry(0.18, 0.06, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3, metalness: 0.4 }),
    0,
    0.02,
    0.12
  );

  const armL = new THREE.Group();
  armL.position.set(-0.22, 0.35, 0.05);
  body.add(armL);
  addMesh(armL, new THREE.CapsuleGeometry(0.055, 0.32, 4, 8), silk, 0, 0.2, 0.08, 0.35, 0, 0.25);
  addMesh(armL, new THREE.SphereGeometry(0.05, 10, 10), skin, 0.02, 0.42, 0.18);

  const armR = new THREE.Group();
  armR.position.set(0.22, 0.35, 0.05);
  body.add(armR);
  addMesh(armR, new THREE.CapsuleGeometry(0.055, 0.32, 4, 8), silk, 0, 0.2, 0.08, 0.35, 0, -0.25);
  addMesh(armR, new THREE.SphereGeometry(0.05, 10, 10), skin, -0.02, 0.42, 0.18);

  const legL = new THREE.Group();
  legL.position.set(-0.14, 0.12, 0.08);
  jockey.add(legL);
  addMesh(legL, new THREE.CapsuleGeometry(0.07, 0.28, 4, 8), pants, 0, 0.05, 0.18, -0.85, 0, 0.2);
  addMesh(legL, new THREE.CapsuleGeometry(0.055, 0.22, 4, 8), pants, 0.02, -0.18, 0.22, 0.55, 0, 0.1);
  addMesh(legL, new THREE.BoxGeometry(0.11, 0.2, 0.16), boot, 0.02, -0.38, 0.28, 0.15, 0, 0);

  const legR = new THREE.Group();
  legR.position.set(0.14, 0.12, 0.08);
  jockey.add(legR);
  addMesh(legR, new THREE.CapsuleGeometry(0.07, 0.28, 4, 8), pants, 0, 0.05, 0.18, -0.85, 0, -0.2);
  addMesh(legR, new THREE.CapsuleGeometry(0.055, 0.22, 4, 8), pants, -0.02, -0.18, 0.22, 0.55, 0, -0.1);
  addMesh(legR, new THREE.BoxGeometry(0.11, 0.2, 0.16), boot, -0.02, -0.38, 0.28, 0.15, 0, 0);

  jockey.userData.body = body;
  jockey.userData.armL = armL;
  jockey.userData.armR = armR;
  return jockey;
}

/** Soft anatomy tints only — coat texture carries the natural color. */
function paintCoatMask(mesh, entry) {
  const pos = mesh.geometry.getAttribute("position");
  const colors = [];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const sizeX = maxX - minX || 1;
  const sizeY = maxY - minY || 1;
  const sizeZ = maxZ - minZ || 1;

  const maneCol = new THREE.Color(entry.mane);
  const pattern = entry.pattern || "none";

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = (x - minX) / sizeX - 0.5;
    const ny = (y - minY) / sizeY;
    const towardNose = (z - minZ) / sizeZ;

    const isMane = ny > 0.7 && towardNose > 0.38 && towardNose < 0.8 && Math.abs(nx) < 0.2;
    const isTail = towardNose < 0.2 && ny > 0.32;
    const isFace = towardNose > 0.87 && ny > 0.5;
    const isMuzzle = towardNose > 0.91 && ny < 0.5;
    const isLowerLeg = ny < 0.2;
    const isPoint = isLowerLeg || (ny < 0.32 && towardNose < 0.32);

    // Soft volume shading (belly a bit darker)
    let r = 0.92 + ny * 0.1;
    let g = r;
    let b = r;

    if (isMane || isTail) {
      r = maneCol.r * 0.7 + 0.3;
      g = maneCol.g * 0.7 + 0.3;
      b = maneCol.b * 0.7 + 0.3;
    } else if (isMuzzle) {
      r = 0.55; g = 0.48; b = 0.42;
    } else if (isFace && pattern === "blaze" && Math.abs(nx) < 0.09) {
      r = 1.22; g = 1.2; b = 1.16;
    } else if (isFace && pattern === "star" && Math.abs(nx) < 0.1 && ny > 0.64 && ny < 0.82) {
      r = 1.22; g = 1.2; b = 1.16;
    } else if (pattern === "bay" && isPoint) {
      r *= 0.55; g *= 0.5; b *= 0.48;
    } else if (isLowerLeg && entry.socks) {
      r = 1.18; g = 1.16; b = 1.12;
    } else if (pattern === "dapple") {
      const d = Math.sin(x * 0.14) * Math.sin(z * 0.12) * Math.sin(y * 0.15);
      if (d > 0.35) {
        r *= 1.08; g *= 1.07; b *= 1.06;
      } else if (d < -0.35) {
        r *= 0.92; g *= 0.92; b *= 0.93;
      }
    }
    // Pinto / coat color come from the photo-sampled hide texture

    colors.push(r, g, b);
  }

  mesh.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  mesh.geometry.computeVertexNormals();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

function imageToTexture(img, { repeat = false, colorSpace = THREE.SRGBColorSpace } = {}) {
  const tex = new THREE.Texture(img);
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.6, 1.6);
  } else {
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  return tex;
}

let sharedCoatMaps = null;
const coatCache = new Map();
const textureLoader = new THREE.TextureLoader();

function loadTexture(url, { repeat = false, colorSpace = THREE.SRGBColorSpace, flipY = true } = {}) {
  return new Promise((resolve, reject) => {
    textureLoader.load(
      url,
      (tex) => {
        tex.colorSpace = colorSpace;
        tex.flipY = flipY;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        if (repeat) {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(1.6, 1.6);
        }
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      () => reject(new Error(`Failed to load texture ${url}`))
    );
  });
}

function loadSharedCoatMaps() {
  return loadTexture(assetUrl("textures/coat_nor.jpg"), {
    repeat: true,
    colorSpace: THREE.LinearSRGBColorSpace,
  }).then((nor) => {
    sharedCoatMaps = { nor };
    return sharedCoatMaps;
  });
}

async function loadHorseCoat(entry) {
  if (coatCache.has(entry.coatMap)) return coatCache.get(entry.coatMap);
  const tex = await loadTexture(entry.coatMap, { repeat: true });
  coatCache.set(entry.coatMap, tex);
  return tex;
}

function createRealisticHorseMaterial(entry, albedo) {
  // Soft satin hide — not plastic, not matte rubber
  const sheenCol = new THREE.Color(entry.coat).offsetHSL(0.02, -0.05, 0.08);
  return new THREE.MeshPhysicalMaterial({
    map: albedo,
    normalMap: sharedCoatMaps.nor,
    normalScale: new THREE.Vector2(0.35, 0.35),
    color: new THREE.Color(0xffffff),
    roughness: 0.72,
    metalness: 0.0,
    vertexColors: true,
    flatShading: false,
    sheen: 0.55,
    sheenRoughness: 0.45,
    sheenColor: sheenCol,
    clearcoat: 0.08,
    clearcoatRoughness: 0.7,
    envMapIntensity: 0.28,
  });
}

/** Soft draped race cloth — thin fabric sheet over the mid-back. */
function createDrapedClothGeometry() {
  const alongSegs = 14;
  const aroundSegs = 20;
  const halfLen = 0.34;
  // Thin sheet: hug the barrel closely (just outside the hide)
  const radiusX = 0.33;
  const radiusY = 0.29;
  const a0 = -Math.PI * 0.62;
  const a1 = Math.PI * 0.62;

  const positions = [];
  const uvs = [];
  const indices = [];

  for (let j = 0; j <= aroundSegs; j++) {
    const v = j / aroundSegs;
    const ang = a0 + (a1 - a0) * v;
    for (let i = 0; i <= alongSegs; i++) {
      const u = i / alongSegs;
      const z = -halfLen + u * halfLen * 2;

      let x = Math.sin(ang) * radiusX;
      let y = Math.cos(ang) * radiusY;

      const side = Math.abs(ang) / (Math.PI * 0.62);
      const hang = Math.max(0, side - 0.4) / 0.6;
      // Light drape only — keeps the cloth looking thin
      y -= hang * hang * 0.1;
      x *= 1 + hang * 0.04;

      const end = Math.abs(z) / halfLen;
      y -= end * end * 0.02;
      const wrinkle =
        Math.sin(u * Math.PI * 5.5) * 0.004 * (0.25 + hang) +
        Math.sin(v * Math.PI * 3.2 + u * 2.1) * 0.003;
      x += wrinkle * Math.sign(x || 1) * 0.35;
      y += wrinkle;

      // Tiny lift so it sits as a thin sheet above the hide
      positions.push(x, y + 0.015, z);
      uvs.push(u, v);
    }
  }

  const cols = alongSegs + 1;
  for (let j = 0; j < aroundSegs; j++) {
    for (let i = 0; i < alongSegs; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeSideNumberTexture(clothColor, number) {
  const w = 256;
  const h = 320;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const light = new THREE.Color(clothColor).offsetHSL(0, -0.2, 0.28);
  ctx.fillStyle = `#${light.getHexString()}`;
  ctx.fillRect(0, 0, w, h);

  const label = String(number);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 200px Bebas Neue, Arial Black, sans-serif";
  ctx.lineWidth = 14;
  ctx.strokeStyle = "rgba(20,20,20,0.5)";
  ctx.strokeText(label, w / 2, h / 2 + 8);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, w / 2, h / 2 + 8);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

function createSaddleCloth(clothColor = 0xc62828, number = 1) {
  const cloth = new THREE.Group();
  cloth.name = "saddleCloth";

  const lightCloth = new THREE.Color(clothColor).offsetHSL(0, -0.2, 0.28);

  // Main cloth — plain light fabric, no number on top
  const clothMat = new THREE.MeshPhysicalMaterial({
    color: lightCloth,
    roughness: 0.92,
    metalness: 0,
    sheen: 0.25,
    sheenRoughness: 0.8,
    sheenColor: lightCloth.clone().offsetHSL(0, -0.05, 0.1),
    side: THREE.DoubleSide,
    flatShading: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    depthWrite: true,
    depthTest: true,
  });

  const mesh = new THREE.Mesh(createDrapedClothGeometry(), clothMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 3;
  cloth.add(mesh);

  // Side number plates — outward facing so digits read correctly (not mirrored)
  const numTex = makeSideNumberTexture(clothColor, number);
  const numMat = new THREE.MeshStandardMaterial({
    map: numTex,
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -5,
    polygonOffsetUnits: -5,
    depthWrite: true,
    depthTest: true,
  });

  const plateGeo = new THREE.PlaneGeometry(0.38, 0.48);

  // Left flank — face outward (-X)
  const left = new THREE.Mesh(plateGeo, numMat);
  left.position.set(-0.36, -0.06, 0.02);
  left.rotation.y = -Math.PI / 2;
  left.rotation.z = 0.12;
  left.renderOrder = 4;
  cloth.add(left);

  // Right flank — face outward (+X), same unmirrored texture
  const right = new THREE.Mesh(plateGeo, numMat.clone());
  right.position.set(0.36, -0.06, 0.02);
  right.rotation.y = Math.PI / 2;
  right.rotation.z = -0.12;
  right.renderOrder = 4;
  cloth.add(right);

  cloth.renderOrder = 3;
  return cloth;
}

function findSpineBone(model) {
  const found = {};
  model.traverse((o) => {
    if (o.isBone) found[o.name] = o;
  });
  for (const name of ["Torso2", "Torso", "Torso3", "Body", "Back"]) {
    if (found[name]) return found[name];
  }
  return null;
}

const _clothWorld = new THREE.Vector3();

/** Keep cloth on the mid-back while the gallop skeleton moves. */
function syncSaddleCloth(racer) {
  const cloth = racer.saddleCloth;
  const bone = racer.spineBone;
  if (!cloth || !bone) return;

  bone.updateWorldMatrix(true, false);
  _clothWorld.setFromMatrixPosition(bone.matrixWorld);
  // Lift in WORLD up so it stays above the hide — critical for top camera
  _clothWorld.y += 0.2;
  racer.root.worldToLocal(_clothWorld);
  cloth.position.copy(_clothWorld);
  // Keep sheet upright so top-down always sees the cloth face
  cloth.rotation.set(0, 0, 0);
}

function createHorseTack(clothColor = 0xc62828) {
  const tack = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.55 });
  const red = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.7 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x4e342e, roughness: 0.75 });
  const wrap = new THREE.MeshStandardMaterial({ color: 0xc4a882, roughness: 0.85 });

  addMesh(tack, new THREE.BoxGeometry(0.55, 0.05, 0.7), red, 0, 1.72, 0.15);
  addMesh(tack, new THREE.BoxGeometry(0.35, 0.08, 0.4), leather, 0, 1.78, 0.1);
  addMesh(tack, new THREE.TorusGeometry(0.2, 0.022, 8, 20), white, 0, 2.05, 2.15, Math.PI / 2, 0, 0);
  addMesh(tack, new THREE.BoxGeometry(0.05, 0.05, 0.5), white, 0, 1.9, 1.7);
  addMesh(tack, new THREE.BoxGeometry(0.025, 0.025, 1.1), leather, -0.14, 1.85, 1.0, 0.2, 0, 0);
  addMesh(tack, new THREE.BoxGeometry(0.025, 0.025, 1.1), leather, 0.14, 1.85, 1.0, 0.2, 0, 0);

  const wrapGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.32, 10);
  addMesh(tack, wrapGeo, wrap, -0.25, 0.42, 0.7);
  addMesh(tack, wrapGeo, wrap, 0.25, 0.42, 0.7);
  addMesh(tack, wrapGeo, wrap, -0.25, 0.42, -0.65);
  addMesh(tack, wrapGeo, wrap, 0.25, 0.42, -0.65);
  return tack;
}

function laneOffset(index) {
  // Spread 6 horses across the track width (inner → outer)
  const t = HORSE_COUNT === 1 ? 0.5 : index / (HORSE_COUNT - 1);
  return (t - 0.5) * (TRACK.width - 1.4);
}

function trackPointAt(progress, lane) {
  const t = progress * Math.PI * 2;
  const rx = TRACK.radiusX + lane;
  const rz = TRACK.radiusZ + lane * (TRACK.radiusZ / TRACK.radiusX);
  return new THREE.Vector3(Math.cos(t) * rx, 0, Math.sin(t) * rz);
}

createGround();
createTrack();

const racers = [];
let fieldReady = false;
let sharedHideMaps = null; // { nor, rough }

/** Quaternius AnimalArmature horse faces +Z. */
const HORSE_MODEL_YAW = 0;

function fitModelToGround(model, targetHeight = 2.85) {
  model.rotation.y = HORSE_MODEL_YAW;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = targetHeight / Math.max(size.y, 0.001);
  model.scale.multiplyScalar(s);
  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model);
  model.position.x += -((box2.min.x + box2.max.x) * 0.5);
  model.position.y += -box2.min.y;
  model.position.z += -((box2.min.z + box2.max.z) * 0.5);
}

/** HorseRun has no UVs — project cylindrical + length UVs for fur/normal maps. */
function ensureCoatUVs(geometry) {
  if (geometry.getAttribute("uv")) return geometry;
  const geo = geometry.index ? geometry : geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const pos = geo.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  const sx = Math.max(bb.max.x - bb.min.x, 1e-4);
  const sy = Math.max(bb.max.y - bb.min.y, 1e-4);
  const sz = Math.max(bb.max.z - bb.min.z, 1e-4);
  const cx = (bb.min.x + bb.max.x) * 0.5;
  const cz = (bb.min.z + bb.max.z) * 0.5;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Wrap around the body + stretch along the spine
    const ang = Math.atan2(x - cx, z - cz);
    const uWrap = ang / (Math.PI * 2) + 0.5;
    const uLen = (z - bb.min.z) / sz;
    const v = (y - bb.min.y) / sy;
    uvs[i * 2] = uWrap * 0.65 + uLen * 0.35;
    uvs[i * 2 + 1] = v * 0.85 + ((x - bb.min.x) / sx) * 0.15;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  try {
    geo.computeTangents();
  } catch {
    // non-indexed or degenerate — normal map still helps a bit without tangents
  }
  return geo;
}

function makeCoatMaterial(entry, furMap, kind) {
  const coat = new THREE.Color(entry.coat);
  const mane = new THREE.Color(entry.mane);
  const dark = new THREE.Color(0xbbbbbb);
  const light = new THREE.Color(0xffffff);

  if (kind === "hair") {
    return new THREE.MeshStandardMaterial({
      map: furMap,
      color: mane,
      roughness: 0.94,
      metalness: 0,
      envMapIntensity: 0.22,
    });
  }
  if (kind === "muzzle") {
    return new THREE.MeshStandardMaterial({
      color: 0x3a2a20,
      roughness: 0.88,
      metalness: 0.02,
    });
  }
  if (kind === "hooves") {
    return new THREE.MeshStandardMaterial({
      color: 0x1a1410,
      roughness: 0.6,
      metalness: 0.12,
    });
  }
  if (kind === "eye_black") {
    return new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.25, metalness: 0.35 });
  }
  if (kind === "eye_white") {
    return new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.45, metalness: 0.04 });
  }

  // Fur map is already coat-colored — only nudge dark/light zones
  let tint = new THREE.Color(0xffffff);
  if (kind === "main_dark") tint = dark;
  else if (kind === "main_light") tint = light;

  return new THREE.MeshPhysicalMaterial({
    map: furMap,
    color: tint,
    roughness: 0.8,
    metalness: 0.0,
    sheen: 0.15,
    sheenRoughness: 0.8,
    sheenColor: coat.clone().offsetHSL(0.01, -0.1, 0.06),
    envMapIntensity: 0.3,
  });
}

function classifyMatName(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("hair")) return "hair";
  if (n.includes("muzzle")) return "muzzle";
  if (n.includes("hoof")) return "hooves";
  if (n.includes("eye_black") || n === "eye_black") return "eye_black";
  if (n.includes("eye_white") || n === "eye_white") return "eye_white";
  if (n.includes("main_dark")) return "main_dark";
  if (n.includes("main_light")) return "main_light";
  return "main";
}

function applyNaturalCoatGraphics(model, entry, furMap) {
  model.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;

    // Own geometry so UV projection does not leak across clones
    child.geometry = ensureCoatUVs(child.geometry.clone());

    const srcMats = Array.isArray(child.material) ? child.material : [child.material];
    const next = srcMats.map((src) => {
      const kind = classifyMatName(src?.name);
      return makeCoatMaterial(entry, furMap, kind);
    });
    child.material = next.length === 1 ? next[0] : next;
  });
}

function findClip(animations, names) {
  for (const name of names) {
    const hit =
      animations.find((a) => a.name === name) ||
      animations.find((a) => a.name === `AnimalArmature|${name}`) ||
      animations.find((a) => a.name.endsWith(`|${name}`));
    if (hit) return hit;
  }
  return null;
}

/** Crossfade between walk / idle / gallop clips. */
function setHorseGait(racer, gait, fade = 0.4) {
  if (!racer.actions) return;
  if (racer.gait === gait) return;
  const next = racer.actions[gait];
  const prev = racer.gait ? racer.actions[racer.gait] : null;
  if (!next) return;

  next.enabled = true;
  next.reset();
  next.setEffectiveWeight(1);
  next.fadeIn(fade);
  next.play();
  if (gait === "walk") next.setEffectiveTimeScale(1.05);
  else if (gait === "gallop") next.setEffectiveTimeScale(0.9);
  else next.setEffectiveTimeScale(1);

  if (prev && prev !== next) prev.fadeOut(fade);
  racer.gait = gait;
  racer.action = next;
}

/** Behind the start line — horses walk forward to progress 0. */
const PARADE_BEHIND = 0.065;

function buildRacerFromTemplate(gltf, entry, index, furMap) {
  const root = new THREE.Group();
  const model = SkeletonUtils.clone(gltf.scene);
  applyNaturalCoatGraphics(model, entry, furMap);
  fitModelToGround(model, 2.85);
  root.add(model);

  // Soft draped cloth — follows spine bone so it stays visible while galloping
  const saddleCloth = createSaddleCloth(entry.cloth, index + 1);
  const spineBone = findSpineBone(model);
  root.add(saddleCloth);

  let jockey = null;
  if (SHOW_JOCKEYS) {
    jockey = createJockey(entry.silk, entry.cloth);
    jockey.scale.setScalar(0.72);
    jockey.position.set(0, 2.05, 0.35);
    root.add(jockey);
  }

  const mixer = new THREE.AnimationMixer(model);
  const anims = gltf.animations || [];
  const walkClip = findClip(anims, ["Walk"]);
  const idleClip = findClip(anims, ["Idle", "Idle_2"]);
  const gallopClip =
    findClip(anims, ["Gallop"]) ||
    anims.find((a) => /gallop/i.test(a.name) && !/jump/i.test(a.name)) ||
    anims[0];

  const actions = {
    walk: walkClip ? mixer.clipAction(walkClip) : null,
    idle: idleClip ? mixer.clipAction(idleClip) : null,
    gallop: gallopClip ? mixer.clipAction(gallopClip) : null,
  };
  for (const act of Object.values(actions)) {
    if (!act) continue;
    act.setLoop(THREE.LoopRepeat, Infinity);
    act.clampWhenFinished = false;
    act.enabled = true;
    act.setEffectiveWeight(0);
  }

  scene.add(root);

  const racer = {
    name: entry.name,
    root,
    model,
    saddleCloth,
    spineBone,
    jockey,
    mixer,
    actions,
    action: null,
    gait: null,
    lane: laneOffset(index),
    progress: 0,
    speed: 0,
    targetSpeed: 0.08 + Math.random() * 0.025,
    lap: 1,
    lastProgress: 0,
    phase: Math.random() * Math.PI * 2,
    gallopTime: Math.random() * 10,
  };
  setHorseGait(racer, "walk", 0);
  model.updateMatrixWorld(true);
  if (spineBone) {
    syncSaddleCloth(racer);
  } else {
    const horseBox = new THREE.Box3().setFromObject(model);
    const horseCenter = horseBox.getCenter(new THREE.Vector3());
    const horseSize = horseBox.getSize(new THREE.Vector3());
    saddleCloth.position.set(
      horseCenter.x,
      horseBox.min.y + horseSize.y * 0.62,
      horseCenter.z
    );
  }
  return racer;
}

const loader = new GLTFLoader();
window.__raceLoad = { step: "start" };
Promise.all([
  new Promise((resolve, reject) => {
    loader.load(
      assetUrl("HorseRun.glb"),
      (g) => {
        window.__raceLoad.step = "glb";
        window.__raceLoad.anims = (g.animations || []).map((a) => a.name);
        resolve(g);
      },
      undefined,
      reject
    );
  }),
  ...FIELD.map((e) =>
    loadTexture(e.furMap, {
      repeat: true,
      flipY: true,
    })
  ),
])
  .then(([gltf, ...furMaps]) => {
    sharedHideMaps = null;
    for (const fur of furMaps) {
      fur.wrapS = fur.wrapT = THREE.RepeatWrapping;
      fur.repeat.set(1.1, 1.1);
      fur.needsUpdate = true;
    }

    window.__raceLoad.step = "building";
    window.__raceLoad.model = "HorseRun";
    for (let i = 0; i < HORSE_COUNT; i++) {
      window.__raceLoad.step = `horse-${i}`;
      racers.push(buildRacerFromTemplate(gltf, FIELD[i], i, furMaps[i]));
    }
    fieldReady = true;
    beginParade();
    window.__raceLoad.step = "ready";
    window.__raceLoad.count = racers.length;
    window.__raceLoad.names = racers.map((r) => r.name);
    window.__raceLoad.clip = racers[0]?.actions?.gallop?.getClip()?.name || null;
    window.__raceLoad.graphics = true;
    updateHud();
  })
  .catch((err) => {
    console.error("Failed to load race assets", err);
    window.__raceError = String(err?.message || err);
    window.__raceLoad.step = "error";
  });

const dust = new THREE.Group();
scene.add(dust);
const dustParticles = [];
for (let i = 0; i < 60; i++) {
  const p = new THREE.Mesh(
    new THREE.SphereGeometry(0.08 + Math.random() * 0.08, 6, 6),
    new THREE.MeshStandardMaterial({
      color: 0xc4a574,
      transparent: true,
      opacity: 0,
      roughness: 1,
    })
  );
  dust.add(p);
  dustParticles.push({ mesh: p, life: 0, vel: new THREE.Vector3() });
}

const state = {
  /** "parade" walk-in | "ready" lined up | "racing" | "finished" */
  phase: "parade",
  racing: false,
  finished: false,
  elapsed: 0,
  leaderSpeed: 0,
  /** Backend race id while a session is active */
  raceId: null,
};

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

function getLeader() {
  let best = racers[0];
  for (const r of racers) {
    const score = (r.lap - 1) + r.progress;
    const bestScore = (best.lap - 1) + best.progress;
    if (score > bestScore) best = r;
  }
  return best;
}

function updateHud() {
  if (!racers.length) return;
  const leader = getLeader();
  leaderEl.textContent = leader.name;
  lapEl.textContent = `${Math.min(leader.lap, TOTAL_LAPS)} / ${TOTAL_LAPS}`;
  speedEl.textContent = `${Math.round(leader.speed * 420)} mph`;
  timerEl.textContent = formatTime(state.elapsed);
}

function spawnDust(origin, strength) {
  for (const particle of dustParticles) {
    if (particle.life > 0) continue;
    particle.life = 0.5 + Math.random() * 0.4;
    particle.mesh.position.copy(origin);
    particle.mesh.position.x += (Math.random() - 0.5) * 0.6;
    particle.mesh.position.y = 0.1;
    particle.mesh.position.z += (Math.random() - 0.5) * 0.6;
    particle.vel.set(
      (Math.random() - 0.5) * 0.8,
      0.4 + Math.random() * 0.6,
      (Math.random() - 0.5) * 0.8 - strength
    );
    particle.mesh.material.opacity = 0.5;
    break;
  }
}

function placeRacer(racer) {
  const pos = trackPointAt(racer.progress, racer.lane);
  const tangent = trackTangent(racer.progress);
  racer.root.position.x = pos.x;
  racer.root.position.z = pos.z;
  racer.root.position.y = 0.02;
  racer.root.rotation.order = "YXZ";
  racer.root.rotation.x = 0;
  racer.root.rotation.z = 0;
  racer.root.rotation.y = Math.atan2(tangent.x, tangent.z);
}

function placeAllHorses() {
  for (const r of racers) placeRacer(r);
}

function animateRacer(racer, dt = 0.016) {
  if (racer.action && racer.gait === "gallop") {
    const scale = state.racing
      ? 0.85 + racer.speed * 8
      : state.finished
        ? 0.25
        : 0.9;
    racer.action.setEffectiveTimeScale(scale);
  } else if (racer.action && racer.gait === "walk") {
    racer.action.setEffectiveTimeScale(0.95 + racer.speed * 12);
  }

  syncSaddleCloth(racer);

  if (racer.jockey) {
    const stride = (racer.mixer ? racer.mixer.time : 0) * 6.5 + racer.phase;
    const body = racer.jockey.userData.body;
    body.rotation.x = (state.racing ? 1.2 : 1.05) + Math.sin(stride) * 0.03;
    racer.jockey.userData.armL.rotation.x = Math.sin(stride) * 0.06;
    racer.jockey.userData.armR.rotation.x = Math.sin(stride + 0.35) * 0.06;
    racer.jockey.position.y = 2.05 + Math.abs(Math.sin(stride)) * (state.racing ? 0.035 : 0.01);
  }
}

function packCenter() {
  const c = new THREE.Vector3();
  for (const r of racers) c.add(r.root.position);
  if (racers.length) c.multiplyScalar(1 / racers.length);
  return c;
}

function getRaceCameraPose() {
  const leader = getLeader() || racers[0];
  const progress = leader ? leader.progress : 0;
  const tangent = trackTangent(progress);
  const center = packCenter();

  let side = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
  const fromCenter = center.clone().setY(0);
  if (fromCenter.lengthSq() > 0.001) {
    fromCenter.normalize();
    if (side.dot(fromCenter) < 0) side.negate();
  }

  // Elevated angled view (~50° down)
  const camPos = center
    .clone()
    .addScaledVector(side, 10)
    .addScaledVector(tangent, -6);
  camPos.y = 16;

  const look = center.clone();
  look.y = 0.4;
  return { camPos, look, up: new THREE.Vector3(0, 1, 0) };
}

function snapRaceCamera() {
  if (!racers.length) return;
  const { camPos, look, up } = getRaceCameraPose();
  camera.position.copy(camPos);
  camera.up.copy(up || new THREE.Vector3(0, 1, 0));
  camera.lookAt(look);
}

function updateCamera(dt) {
  if (!racers.length || window.__freezeCam) return;
  const { camPos, look, up } = getRaceCameraPose();
  camera.up.copy(up || new THREE.Vector3(0, 1, 0));
  camera.position.lerp(camPos, 1 - Math.exp(-3.2 * dt));
  camera.lookAt(look);
}

function money(n) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function hexColor(n) {
  return `#${n.toString(16).padStart(6, "0")}`;
}

function saveBankroll() {
  localStorage.setItem("gallop_bankroll", String(betting.bankroll));
}

function canBet() {
  return state.phase === "parade" || state.phase === "ready";
}

function renderBankroll() {
  bankrollEl.textContent = money(betting.bankroll);
}

function renderOpenBets() {
  openBetsEl.innerHTML = "";
  if (!betting.bets.length) return;
  for (const bet of betting.bets) {
    const li = document.createElement("li");
    if (bet.status === "won") li.classList.add("won");
    if (bet.status === "lost") li.classList.add("lost");
    const label =
      bet.status === "won"
        ? `Won ${money(bet.payout)} on ${bet.name}`
        : bet.status === "lost"
          ? `Lost ${money(bet.amount)} on ${bet.name}`
          : `${bet.name} · ${money(bet.amount)} @ ${bet.odds.toFixed(1)}x`;
    li.textContent = label;
    openBetsEl.appendChild(li);
  }
}

function setBetStatus(msg) {
  betStatusEl.textContent = msg;
}

function updateBettingControls() {
  const open = canBet();
  placeBetBtn.disabled = !open || betting.bankroll < 1;
  betAmountEl.disabled = !open;
  horsePicksEl.querySelectorAll(".horse-pick").forEach((btn) => {
    btn.disabled = !open;
  });
}

function buildHorsePicks() {
  horsePicksEl.innerHTML = "";
  FIELD.forEach((entry, index) => {
    const number = index + 1;
    const odds = ODDS_BY_NUMBER[number] || 4;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "horse-pick";
    btn.dataset.number = String(number);
    btn.setAttribute("role", "option");
    btn.innerHTML = `
      <span class="horse-pick-top">
        <span class="horse-swatch" style="background:${hexColor(entry.silk)}"></span>
        <span class="horse-odds">${odds.toFixed(1)}x</span>
      </span>
      <span class="horse-name">${entry.name}</span>
      <span class="horse-meta">Win bet</span>
    `;
    btn.addEventListener("click", () => selectHorse(number));
    horsePicksEl.appendChild(btn);
  });
  selectHorse(betting.selectedNumber);
}

function selectHorse(number) {
  betting.selectedNumber = number;
  horsePicksEl.querySelectorAll(".horse-pick").forEach((btn) => {
    btn.classList.toggle("is-selected", Number(btn.dataset.number) === number);
  });
  const entry = FIELD[number - 1];
  const odds = ODDS_BY_NUMBER[number] || 4;
  if (canBet()) {
    setBetStatus(`Selected ${entry.name} at ${odds.toFixed(1)}x — enter amount and place bet`);
  }
}

function placeBet() {
  if (!canBet()) {
    setBetStatus("Betting is closed while the race is running");
    return;
  }
  const amount = Math.floor(Number(betAmountEl.value));
  if (!Number.isFinite(amount) || amount < 1) {
    setBetStatus("Enter a valid bet amount");
    return;
  }
  if (amount > betting.bankroll) {
    setBetStatus(`Not enough bankroll — you have ${money(betting.bankroll)}`);
    return;
  }

  const number = betting.selectedNumber;
  const entry = FIELD[number - 1];
  const odds = ODDS_BY_NUMBER[number] || 4;

  betting.bankroll -= amount;
  saveBankroll();
  betting.bets.push({
    number,
    name: entry.name,
    amount,
    odds,
    status: "open",
    payout: 0,
    synced: false,
  });
  renderBankroll();
  renderOpenBets();
  updateBettingControls();
  setBetStatus(`Bet ${money(amount)} on ${entry.name} @ ${odds.toFixed(1)}x`);

  if (state.raceId) {
    syncPendingBets();
  }
}

function syncPendingBets() {
  if (!state.raceId) return;
  for (const bet of betting.bets) {
    if (bet.synced || bet.status !== "open") continue;
    placeBetApi(state.raceId, {
      horse_number: bet.number,
      amount: bet.amount,
      odds: bet.odds,
    })
      .then(() => {
        bet.synced = true;
      })
      .catch((err) => {
        console.warn("Could not sync bet:", err);
      });
  }
}

function settleBets(winner) {
  if (betting.settled) return { net: 0, message: "" };
  betting.settled = true;
  let won = 0;
  let lost = 0;
  for (const bet of betting.bets) {
    if (bet.status !== "open") continue;
    if (bet.number === winner.number || bet.name === winner.name) {
      bet.status = "won";
      bet.payout = Math.round(bet.amount * bet.odds);
      betting.bankroll += bet.payout;
      won += bet.payout;
    } else {
      bet.status = "lost";
      bet.payout = 0;
      lost += bet.amount;
    }
  }
  saveBankroll();
  renderBankroll();
  renderOpenBets();
  updateBettingControls();

  if (!betting.bets.length) {
    return { net: 0, message: "No bets this race" };
  }
  const net = won - lost;
  if (won > 0 && lost === 0) {
    return { net, message: `You won ${money(won)}` };
  }
  if (won > 0) {
    return { net, message: `Payout ${money(won)} · stakes lost ${money(lost)}` };
  }
  return { net, message: `Bets lost · ${money(lost)}` };
}

function resetBetsForNewRace() {
  betting.bets = [];
  betting.settled = false;
  renderOpenBets();
  updateBettingControls();
  setBetStatus("Pick a horse and stake to place a bet");
  selectHorse(betting.selectedNumber);
}

function horseNumberFromName(name) {
  const m = String(name).match(/#(\d+)/);
  return m ? Number(m[1]) : null;
}

function beginParade() {
  if (!fieldReady) return;
  state.phase = "parade";
  state.racing = false;
  state.finished = false;
  state.elapsed = 0;
  state.raceId = null;
  finishBanner.classList.remove("is-visible");
  finishBanner.hidden = true;
  if (finishBetEl) finishBetEl.textContent = "";
  startBtn.hidden = true;
  resetBtn.hidden = true;
  resetBetsForNewRace();

  for (let i = 0; i < racers.length; i++) {
    const r = racers[i];
    // Stagger behind the start line so they walk in as a loose group
    r.progress = -(PARADE_BEHIND + i * 0.006 + Math.random() * 0.012);
    r.speed = 0;
    r.targetSpeed = 0.014 + Math.random() * 0.005;
    r.lap = 1;
    r.lastProgress = r.progress;
    setHorseGait(r, "walk", 0.2);
  }
  placeAllHorses();
  snapRaceCamera();
  updateHud();
  updateBettingControls();
}

function onLinedUp() {
  state.phase = "ready";
  for (const r of racers) {
    r.progress = 0;
    r.speed = 0;
    r.targetSpeed = 0;
    setHorseGait(r, "idle", 0.35);
  }
  placeAllHorses();
  startBtn.hidden = false;
  startBtn.textContent = "Start Race";
  updateHud();
  updateBettingControls();
  setBetStatus(
    betting.bets.length
      ? `${betting.bets.length} bet(s) locked in — start when ready`
      : "Horses are at the line — place bets, then start"
  );
}

function startRace() {
  if (!fieldReady || state.phase !== "ready") return;
  state.phase = "racing";
  state.racing = true;
  state.finished = false;
  state.elapsed = 0;
  state.raceId = null;
  finishBanner.classList.remove("is-visible");
  finishBanner.hidden = true;
  startBtn.hidden = true;
  resetBtn.hidden = true;
  updateBettingControls();
  setBetStatus("Race on — bets are locked");

  for (const r of racers) {
    r.progress = 0;
    r.speed = 0;
    r.targetSpeed = 0.075 + Math.random() * 0.035;
    r.lap = 1;
    r.lastProgress = 0;
    setHorseGait(r, "gallop", 0.2);
  }
  placeAllHorses();
  snapRaceCamera();
  updateHud();

  createRace(TOTAL_LAPS)
    .then((race) => {
      state.raceId = race.id;
      syncPendingBets();
    })
    .catch((err) => {
      console.warn("Could not create race on backend:", err);
    });
}

function finishRace() {
  state.racing = false;
  state.finished = true;
  state.phase = "finished";
  const leader = getLeader();
  const winnerNumber = horseNumberFromName(leader.name);
  const settlement = settleBets({
    name: leader.name,
    number: winnerNumber,
  });
  finishTimeEl.textContent = `${leader.name} wins · ${formatTime(state.elapsed)}`;
  if (finishBetEl) finishBetEl.textContent = settlement.message;
  finishBanner.hidden = false;
  finishBanner.classList.add("is-visible");
  resetBtn.hidden = false;
  for (const r of racers) {
    setHorseGait(r, "idle", 0.5);
  }
  setBetStatus(settlement.message);
  updateBettingControls();
  persistRaceResult(leader);
}

function persistRaceResult(leader) {
  if (!state.raceId) return;

  const ranked = [...racers].sort((a, b) => {
    const scoreA = a.lap - 1 + a.progress;
    const scoreB = b.lap - 1 + b.progress;
    return scoreB - scoreA;
  });

  const payload = {
    duration_seconds: Number(state.elapsed.toFixed(3)),
    winner_name: leader.name,
    winner_number: horseNumberFromName(leader.name),
    results: ranked.map((r, index) => ({
      horse_number: horseNumberFromName(r.name),
      name: r.name,
      finish_position: index + 1,
      finish_time_seconds: Number(state.elapsed.toFixed(3)),
      laps_completed: Math.min(r.lap, TOTAL_LAPS),
    })),
  };

  finishRaceApi(state.raceId, payload).catch((err) => {
    console.warn("Could not save race result:", err);
  });
}

startBtn.addEventListener("click", startRace);
resetBtn.addEventListener("click", beginParade);
placeBetBtn.addEventListener("click", placeBet);
document.querySelectorAll(".quick-amounts button").forEach((btn) => {
  btn.addEventListener("click", () => {
    betAmountEl.value = btn.dataset.amount;
  });
});

buildHorsePicks();
renderBankroll();
renderOpenBets();
updateBettingControls();

async function loadGunduWallet() {
  const bal = await fetchGunduWalletBalance();
  if (bal == null) return;
  betting.bankroll = Math.max(0, Math.floor(bal));
  saveBankroll();
  renderBankroll();
  updateBettingControls();
  if (bankrollEl) bankrollEl.title = "Your Gundu wallet";
}

loadGunduWallet();
setTimeout(loadGunduWallet, 400);
setTimeout(loadGunduWallet, 1200);

function onStageResize() {
  resizeRenderer();
}

window.addEventListener("resize", onStageResize);
if (typeof ResizeObserver !== "undefined" && stageEl) {
  new ResizeObserver(onStageResize).observe(stageEl);
}

window.__race = { camera, racers, scene, state, startRace, betting };

const clock = new THREE.Clock();
let dustTimer = 0;

function tick() {
  requestAnimationFrame(tick);
  try {
    const dt = Math.min(clock.getDelta(), 0.05);

    for (const r of racers) {
      if (r.mixer) r.mixer.update(dt);
    }

    if (state.phase === "parade") {
      let allReady = true;
      for (const r of racers) {
        r.speed += (r.targetSpeed - r.speed) * Math.min(1, dt * 3);
        r.progress += r.speed * dt;
        if (r.progress >= 0) {
          r.progress = 0;
          r.speed = 0;
          if (r.gait !== "idle") setHorseGait(r, "idle", 0.3);
        } else {
          allReady = false;
        }
      }
      if (allReady) onLinedUp();
    } else if (state.racing) {
      state.elapsed += dt;
      let anyFinished = false;

      for (const r of racers) {
        // Pace varies — pack racing feel
        r.targetSpeed = 0.072 + 0.028 * (0.55 + 0.45 * Math.sin(state.elapsed * 0.9 + r.phase));
        r.speed += (r.targetSpeed - r.speed) * Math.min(1, dt * 2.2);
        r.progress = (r.progress + r.speed * dt) % 1;

        if (r.progress < r.lastProgress) {
          r.lap += 1;
          if (r.lap > TOTAL_LAPS) anyFinished = true;
        }
        r.lastProgress = r.progress;
      }

      if (anyFinished) {
        // Snap winner to finish and end
        for (const r of racers) {
          if (r.lap > TOTAL_LAPS) {
            r.progress = 0;
            r.lap = TOTAL_LAPS;
          }
        }
        finishRace();
      }

      dustTimer += dt;
      if (dustTimer > 0.06) {
        dustTimer = 0;
        const leader = getLeader();
        if (leader && leader.speed > 0.02) {
          const behind = leader.root.position
            .clone()
            .add(trackTangent(leader.progress).multiplyScalar(-1.5));
          spawnDust(behind, leader.speed * 4);
        }
      }
    } else if (state.finished) {
      for (const r of racers) r.speed += (0 - r.speed) * Math.min(1, dt * 2);
    } else {
      for (const r of racers) r.speed = 0;
    }

    for (const r of racers) {
      placeRacer(r);
      animateRacer(r, dt);
    }

    for (const particle of dustParticles) {
      if (particle.life <= 0) {
        particle.mesh.material.opacity = 0;
        continue;
      }
      particle.life -= dt;
      particle.mesh.position.addScaledVector(particle.vel, dt);
      particle.vel.y -= 1.2 * dt;
      particle.mesh.material.opacity = Math.max(0, particle.life);
    }

    grassUniforms.uTime.value = clock.elapsedTime;
    updateCamera(dt);
    updateHud();
    renderer.render(scene, camera);
  } catch (err) {
    console.error("tick error", err);
    window.__raceError = String(err?.message || err);
  }
}

tick();

