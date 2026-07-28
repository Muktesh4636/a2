import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/** European order — matches the reference photo */
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const canvas = document.getElementById("wheel-canvas");
const stageEl = document.getElementById("stage");

function stageSize() {
  const w = stageEl?.clientWidth || window.innerWidth;
  const h = stageEl?.clientHeight || Math.floor(window.innerHeight * 0.27);
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

const { w: startW, h: startH } = stageSize();

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(startW, startH, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0406);

const camera = new THREE.PerspectiveCamera(36, startW / startH, 0.05, 50);
/* Slight tilt toward the viewer — not a flat top-down */
camera.position.set(0, 3.15, 1.76);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
controls.enableRotate = false;
controls.enablePan = false;
controls.enableZoom = false;
controls.minDistance = 3.6;
controls.maxDistance = 3.6;
controls.target.set(0, 0.08, 0);
controls.update();
controls.enabled = false;

/* ——— Result zoom: physical dolly move + slight lens FOV zoom ——— */
const CAM_DEFAULT_POS = new THREE.Vector3(0, 3.15, 1.76);
const CAM_DEFAULT_TARGET = new THREE.Vector3(0, 0.08, 0);
const CAM_ZOOM_POS = new THREE.Vector3(0, 2.15, 1.18); // physically closer for the win
const CAM_DEFAULT_FOV = 36;
const CAM_ZOOM_FOV = 30; // subtle lens zoom to assist the dolly

const camZoom = {
  mix: 0, // 0 = full wheel view, 1 = zoomed on winning pocket
  dir: 0, // +1 zooming in, -1 zooming out
  inDuration: 3.8,
  outDuration: 1.4,
  holdDuration: 5,
  holdLeft: 0,
};
const _ballWorld = new THREE.Vector3();
const _camTarget = new THREE.Vector3();

function updateCamera(dt) {
  if (camZoom.dir > 0) {
    camZoom.mix = Math.min(1, camZoom.mix + dt / camZoom.inDuration);
    if (camZoom.mix >= 1) {
      camZoom.dir = 0;
      camZoom.holdLeft = camZoom.holdDuration;
    }
  } else if (camZoom.dir < 0) {
    camZoom.mix = Math.max(0, camZoom.mix - dt / camZoom.outDuration);
    if (camZoom.mix <= 0) camZoom.dir = 0;
  } else if (camZoom.mix >= 1 && camZoom.holdLeft > 0) {
    camZoom.holdLeft = Math.max(0, camZoom.holdLeft - dt);
    if (camZoom.holdLeft <= 0) {
      camZoom.dir = -1;
      hideResultBanner(); // drop the 3-number result card as the camera pulls back
    }
  }

  const m = camZoom.mix;
  const e = m <= 0 ? 0 : m < 0.5 ? 4 * m * m * m : 1 - Math.pow(-2 * m + 2, 3) / 2;

  // Physical Dolly: move the camera position in space
  camera.position.lerpVectors(CAM_DEFAULT_POS, CAM_ZOOM_POS, e);
  // Lens Zoom: subtle FOV adjustment
  camera.fov = CAM_DEFAULT_FOV + (CAM_ZOOM_FOV - CAM_DEFAULT_FOV) * e;
  camera.updateProjectionMatrix();

  if (m <= 0) {
    camera.lookAt(CAM_DEFAULT_TARGET);
    return;
  }

  // Soft pan toward the winning pocket so it stays framed while zooming
  ball.getWorldPosition(_ballWorld);
  _camTarget.lerpVectors(CAM_DEFAULT_TARGET, _ballWorld, e * 0.55);
  camera.lookAt(_camTarget);
}

/* Studio lights */
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 0.45));

const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(3, 7.5, 2.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 22;
key.shadow.camera.left = -4;
key.shadow.camera.right = 4;
key.shadow.camera.top = 4;
key.shadow.camera.bottom = -4;
key.shadow.bias = -0.00015;
key.shadow.normalBias = 0.02;
scene.add(key);

const fill = new THREE.DirectionalLight(0xffffff, 0.9);
fill.position.set(-3.5, 3, -1.5);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffffff, 0.55);
rim.position.set(0.5, 2, -3.5);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(2.2, 64),
  new THREE.ShadowMaterial({ opacity: 0.16 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
ground.receiveShadow = true;
scene.add(ground);

/* Materials */
const blackGloss = new THREE.MeshStandardMaterial({
  color: 0x0a0a0a,
  roughness: 0.18,
  metalness: 0.35,
});
const blackMatte = new THREE.MeshStandardMaterial({
  color: 0x111111,
  roughness: 0.55,
  metalness: 0.15,
});
const gold = new THREE.MeshStandardMaterial({
  color: 0xd4af37,
  roughness: 0.22,
  metalness: 0.95,
});
const goldBright = new THREE.MeshStandardMaterial({
  color: 0xe8c45a,
  roughness: 0.14,
  metalness: 1,
});
const goldSoft = new THREE.MeshStandardMaterial({
  color: 0xc9a030,
  roughness: 0.3,
  metalness: 0.9,
});
const silver = new THREE.MeshStandardMaterial({
  color: 0xe8e8e8,
  roughness: 0.25,
  metalness: 0.85,
});
const whiteBall = new THREE.MeshBasicMaterial({
  color: 0xf2f2f2,
});

const POCKET_SLICE = (Math.PI * 2) / WHEEL_ORDER.length;
const POCKET_ANGLE0 = -Math.PI / 2; // same origin as number texture / pipes

function pipeLocalAngle(i) {
  return POCKET_ANGLE0 + i * POCKET_SLICE;
}

/** Center of pocket idx — exactly halfway between stop pipes idx and idx+1 */
function pocketLocalAngle(idx) {
  return POCKET_ANGLE0 + (idx + 0.5) * POCKET_SLICE;
}

function makeSlopedRing(innerR, outerR, yInner, yOuter, seg = 160) {
  const geo = new THREE.RingGeometry(innerR, outerR, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const t = Math.min(1, Math.max(0, (r - innerR) / (outerR - innerR)));
    pos.setY(i, yInner + t * (yOuter - yInner));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Per-pocket color wedges + number labels at the SAME angles as frets. */
function buildNumberRing() {
  const group = new THREE.Group();
  const innerR = 0.535;
  const outerR = 0.78;
  const yInner = 0.078;
  const yOuter = 0.09;
  const n = WHEEL_ORDER.length;

  for (let i = 0; i < n; i++) {
    const num = WHEEL_ORDER[i];
    const a0 = pipeLocalAngle(i);
    const a1 = pipeLocalAngle(i + 1);
    const amid = pocketLocalAngle(i);

    // Color wedge (two triangles on the sloped ring)
    const color = num === 0 ? 0x1a8a3a : RED.has(num) ? 0xc01e26 : 0x0e0e0e;
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.42,
      metalness: 0.12,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.BufferGeometry();
    const yAt = (r) => {
      const t = (r - innerR) / (outerR - innerR);
      return yInner + t * (yOuter - yInner);
    };
    const v = (a, r) => [Math.cos(a) * r, yAt(r), Math.sin(a) * r];
    const p0 = v(a0, innerR);
    const p1 = v(a1, innerR);
    const p2 = v(a1, outerR);
    const p3 = v(a0, outerR);
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p0, ...p2, ...p3], 3)
    );
    geo.computeVertexNormals();
    const wedge = new THREE.Mesh(geo, mat);
    wedge.receiveShadow = true;
    group.add(wedge);

    // Number label — flat plane on the ring, top of digit pointing to wheel center
    const size = 128;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 92px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Stretch digits vertically so they read clearly from the top-down camera
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(1, 1.35);
    ctx.fillText(String(num), 0, 0);
    ctx.restore();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.105, 0.105),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    const rText = (innerR + outerR) * 0.52;
    const yText = yAt(rText) + 0.012;
    label.position.set(Math.cos(amid) * rText, yText, Math.sin(amid) * rText);
    // Lay flat (rotation.x), then spin in-plane (rotation.z) so the digit's
    // top faces the wheel center — labels now rotate together with the rotor
    label.rotation.set(-Math.PI / 2, 0, (3 * Math.PI) / 2 - amid);
    group.add(label);
  }
  return group;
}

/* Radial brushed gold texture for cone */
function makeRadialGoldTexture() {
  const size = 1024;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  ctx.fillStyle = "#c9a030";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    ctx.strokeStyle = i % 2 === 0 ? "rgba(255,230,150,0.22)" : "rgba(90,70,20,0.18)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * size * 0.5, cy + Math.sin(a) * size * 0.5);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const radialTex = makeRadialGoldTexture();

const wheel = new THREE.Group();
scene.add(wheel);

const rotor = new THREE.Group();
wheel.add(rotor);

/* ——— Black outer bowl (raised rim) ——— */
const outerRim = new THREE.Mesh(
  new THREE.TorusGeometry(1.14, 0.075, 28, 128),
  blackGloss
);
outerRim.rotation.x = Math.PI / 2;
outerRim.position.y = 0.26;
outerRim.castShadow = true;
wheel.add(outerRim);

const outerBand = new THREE.Mesh(
  new THREE.CylinderGeometry(1.19, 1.22, 0.2, 96, 1, true),
  blackGloss
);
outerBand.position.y = 0.14;
outerBand.castShadow = true;
wheel.add(outerBand);

// Black ball-track — stops at the number ring (no black band inside numbers)
// Slightly lightened + satin sheen so it separates from the numbers and rim
const slopeMat = new THREE.MeshStandardMaterial({
  color: 0x2b2b2e,
  roughness: 0.38,
  metalness: 0.3,
});
const blackSlope = new THREE.Mesh(
  makeSlopedRing(0.78, 1.14, 0.085, 0.24, 128),
  slopeMat
);
blackSlope.receiveShadow = true;
wheel.add(blackSlope);

// Soft light ring hugging the number ring's outer edge
const trackGlow = new THREE.Mesh(
  makeSlopedRing(0.785, 0.87, 0.088, 0.115, 128),
  new THREE.MeshBasicMaterial({
    color: 0x8a8a92,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  })
);
wheel.add(trackGlow);

// Diamond deflectors — each gets its own material so we can flash them on hit
const deflectorMeshes = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2 + 0.2;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    roughness: 0.18,
    metalness: 0.35,
    emissive: 0xffffff,
    emissiveIntensity: 0,
  });
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), mat);
  diamond.position.set(Math.cos(a) * 0.97, 0.175, Math.sin(a) * 0.97);
  diamond.scale.set(1, 0.45, 0.7);
  diamond.rotation.y = -a;
  diamond.castShadow = true;
  wheel.add(diamond);
  deflectorMeshes.push(diamond);
}

// Reusable point-light for hit flash (pooled — single light moved per hit)
const hitLight = new THREE.PointLight(0xffffff, 0, 0.55, 2);
hitLight.visible = false;
wheel.add(hitLight);

/* ——— Number wheel sits lower (downside / recessed in the bowl) ——— */
rotor.position.y = -0.02;

// Color wedges + labels share the exact same angles as the frets
const numberRim = buildNumberRing();
rotor.add(numberRim);

// Thin gold borders around the number ring (inner + outer)
const numberGoldOuter = new THREE.Mesh(
  new THREE.TorusGeometry(0.78, 0.006, 12, 128),
  goldBright
);
numberGoldOuter.rotation.x = Math.PI / 2;
numberGoldOuter.position.y = 0.092;
rotor.add(numberGoldOuter);

const numberGoldInner = new THREE.Mesh(
  new THREE.TorusGeometry(0.538, 0.006, 12, 128),
  goldBright
);
numberGoldInner.rotation.x = Math.PI / 2;
numberGoldInner.position.y = 0.082;
rotor.add(numberGoldInner);

/* ——— Gold ball-stop area — meets number ring (no black between) ——— */

// Continuous gold under/at the number inner edge — kills any black gap
const goldSepRing = new THREE.Mesh(
  new THREE.RingGeometry(0.48, 0.58, 128),
  goldBright
);
goldSepRing.rotation.x = -Math.PI / 2;
goldSepRing.position.y = 0.072;
goldSepRing.receiveShadow = true;
rotor.add(goldSepRing);

// Gold pocket floor (where balls rest) — extends under number inner lip
const pocketFloor = new THREE.Mesh(
  makeSlopedRing(0.32, 0.56, -0.005, 0.052, 128),
  goldSoft
);
pocketFloor.receiveShadow = true;
rotor.add(pocketFloor);

const pocketInnerWall = new THREE.Mesh(
  new THREE.CylinderGeometry(0.32, 0.34, 0.06, 64, 1, true),
  gold
);
pocketInnerWall.position.y = 0.02;
rotor.add(pocketInnerWall);

// Raised rounded gold STOP bars — meet the number border, no black gap
// Angles match number-texture separators (pocket i sits between pipe i and i+1)
const numInnerR = 0.55;
const PIPE_RADIUS = 0.0032; // thinner frets
const stopOuterR = numInnerR - 0.006; // kiss the number border (no black gap, no overshoot)
const stopInnerR = 0.38;
// Capsule total length = cylindrical length + 2*radius
const stopSpan = stopOuterR - stopInnerR;
const stopLen = Math.max(0.04, stopSpan - 2 * PIPE_RADIUS - 0.004);
const stopGeo = new THREE.CapsuleGeometry(PIPE_RADIUS, stopLen, 4, 8);

for (let i = 0; i < WHEEL_ORDER.length; i++) {
  const angle = pipeLocalAngle(i);
  const r = (stopInnerR + stopOuterR) / 2;
  const stop = new THREE.Mesh(stopGeo, goldBright);
  stop.position.set(Math.cos(angle) * r, 0.042, Math.sin(angle) * r);
  stop.rotation.order = "YXZ";
  stop.rotation.y = -angle;
  stop.rotation.z = Math.PI / 2;
  stop.castShadow = true;
  rotor.add(stop);
}

const stopOuterRing = new THREE.Mesh(
  new THREE.TorusGeometry(numInnerR - 0.002, 0.008, 14, 128),
  goldBright
);
stopOuterRing.rotation.x = Math.PI / 2;
stopOuterRing.position.y = 0.055;
stopOuterRing.castShadow = true;
rotor.add(stopOuterRing);

/* ——— Gold cone (sits with the recessed rotor) ——— */
const coneMat = new THREE.MeshStandardMaterial({
  map: radialTex,
  color: 0xffffff,
  roughness: 0.28,
  metalness: 0.85,
});
const cone = new THREE.Mesh(
  new THREE.CylinderGeometry(0.09, 0.38, 0.22, 64, 1, true),
  coneMat
);
cone.position.y = 0.12;
cone.castShadow = true;
cone.receiveShadow = true;
wheel.add(cone);

const coneFloor = new THREE.Mesh(new THREE.CircleGeometry(0.38, 64), goldSoft);
coneFloor.rotation.x = -Math.PI / 2;
coneFloor.position.y = 0.01;
wheel.add(coneFloor);

/* ——— Center spinner (locked to rotor so arms stay with numbers) ——— */
const turretBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.12, 0.16, 0.06, 48),
  goldBright
);
turretBase.position.y = 0.26;
turretBase.castShadow = true;
rotor.add(turretBase);

const turretMid = new THREE.Mesh(
  new THREE.CylinderGeometry(0.08, 0.11, 0.07, 48),
  gold
);
turretMid.position.y = 0.32;
turretMid.castShadow = true;
rotor.add(turretMid);

const turretCap = new THREE.Mesh(new THREE.SphereGeometry(0.055, 32, 24), goldBright);
turretCap.position.y = 0.38;
turretCap.castShadow = true;
rotor.add(turretCap);

const arms = new THREE.Group();
arms.position.y = 0.36;
for (let i = 0; i < 4; i++) {
  const arm = new THREE.Group();

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.018, 0.34, 16),
    goldBright
  );
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = 0.2;
  shaft.castShadow = true;
  arm.add(shaft);

  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.034, 20, 16), goldBright);
  knob.position.x = 0.38;
  knob.castShadow = true;
  arm.add(knob);

  arm.rotation.y = (i * Math.PI) / 2;
  arms.add(arm);
}
rotor.add(arms);

/* ——— White ball: races outer track, spirals in, rattles frets, settles ——— */
// Final rest: centered between two stop pipes, at the INNER end of the frets (cone side)
const BALL_R = 0.038;
const POCKET_R = stopInnerR + BALL_R + 0.012; // nestled at inner pipe tips by the cone
const POCKET_Y = () => {
  // floor height at POCKET_R on the sloped gold pocket (yInner=-0.005 @0.32 → yOuter=0.05 @0.55)
  const t = (POCKET_R - 0.32) / (0.55 - 0.32);
  const floorY = -0.005 + t * (0.05 - -0.005);
  // sit down in the trough between frets (frets sit at rotor y≈0.042)
  return rotor.position.y + floorY + BALL_R * 0.82;
};
/** Pocket Y in rotor-local space (ball parented to rotor when locked). */
const POCKET_Y_LOCAL = () => POCKET_Y() - rotor.position.y;
const TRACK_R = 1.05;
const TRACK_Y = 0.20;
const DEFLECTOR_R = 0.97;
const DEFLECTOR_COUNT = 8;
const DEFLECTOR_PHASE = 0.2;
const HOLD_SPEED = 1.85; // centrifugal hold on outer track
const POCKET_ENTRY_R = 0.58;

const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 28), whiteBall);
ball.castShadow = false;
wheel.add(ball);

const spinBtn = document.getElementById("spin-btn");
const resultEl = document.getElementById("result");

function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Bowl height from outer track down to pocket floor (continuous slope). */
function ballHeightAt(radius) {
  const py = POCKET_Y();
  const t = THREE.MathUtils.clamp((TRACK_R - radius) / (TRACK_R - POCKET_R), 0, 1);
  // hang on the outer cone longer, then ease down — like the real slope
  const e = Math.pow(t, 1.65);
  return THREE.MathUtils.lerp(TRACK_Y, py, e);
}

const ballAnim = {
  phase: "idle", // idle | racing | spiraling | landing | locked | settled
  angle: 0,
  speed: 0, // world angular velocity while racing; residual while landing
  radius: TRACK_R,
  y: TRACK_Y,
  targetIdx: 0, // server-chosen pocket index
  bounce: 0,
  lastDeflector: -1,
  lastPipe: -1,
  rattleT: 0,
  raceT: 0,
  landT: 0,
  lockT: 0,
  landExtends: 0,
  announced: false,
};

let rotorSpeed = 0;
const ROTOR_SPIN_SPEED = 1.35; // faster middle wheel (rad/s)
const RESULT_LOCK_DELAY = 1.0; // seconds after lock before announcing
const RESULT_ROTOR_MAX = 0.06; // wheel must be nearly still

function setSpinUi(busy) {
  if (!spinBtn) return;
  spinBtn.disabled = busy;
  spinBtn.textContent = busy ? "Spinning…" : "Spin";
}

function showWinMarker(num) {
  clearWinMarker();
  if (!tableEl) return;
  const key = betKey("straight", num);
  const cell = tableEl.querySelector(`.bet-cell[data-key="${key}"]`);
  if (!cell) return;
  const marker = document.createElement("span");
  marker.className = "win-marker";
  marker.innerHTML =
    '<span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>';
  cell.appendChild(marker);
}

function clearWinMarker() {
  tableEl?.querySelectorAll(".win-marker").forEach((el) => el.remove());
}

function showResultBanner(num) {
  const banner = document.getElementById("result-banner");
  if (!banner) return;
  const n = WHEEL_ORDER.length;
  const i = WHEEL_ORDER.indexOf(num);
  // Neighbors on the wheel in the same direction as placed wedges (increasing index)
  document.getElementById("rb-left").textContent = String(WHEEL_ORDER[(i - 1 + n) % n]);
  document.getElementById("rb-right").textContent = String(WHEEL_ORDER[(i + 1) % n]);
  document.getElementById("rb-num").textContent = String(num);
  const card = document.getElementById("rb-card");
  card.classList.remove("red", "black", "green");
  card.classList.add(num === 0 ? "green" : RED.has(num) ? "red" : "black");
  banner.classList.add("show");
}

function hideResultBanner() {
  document.getElementById("result-banner")?.classList.remove("show");
}

function showResult(num) {
  if (!resultEl) return;
  const color = num === 0 ? "Green" : RED.has(num) ? "Red" : "Black";
  let text = `${num} · ${color}`;
  const win = betState.lastServerWin || 0;
  if (win > 0) text += ` · Won ${fmtMoney(win)}`;
  resultEl.textContent = text;
  showWinMarker(num);
  showResultBanner(num);
  pushHistory(num);
  betState.bets.clear();
  betState.historyStack = [];
  betState.lastServerWin = 0;
  tableEl?.querySelectorAll(".stack").forEach((el) => el.remove());
  tableEl?.querySelectorAll(".win-flash").forEach((el) => el.classList.remove("win-flash"));
  refreshMoneyUi();
  window.__lastSpin = {
    num,
    idx: ballAnim.targetIdx,
    pocketNum: numberAtPocket(ballAnim.targetIdx),
    parent: ball.parent === rotor ? "rotor" : ball.parent === wheel ? "wheel" : "other",
    at: performance.now(),
  };
}

function clearResult() {
  if (resultEl) resultEl.textContent = "";
  clearWinMarker();
  hideResultBanner();
  ballAnim.announced = false;
  betState.lastServerWin = 0;
}

function isBallBusy() {
  return (
    ballAnim.phase === "racing" ||
    ballAnim.phase === "spiraling" ||
    ballAnim.phase === "landing" ||
    ballAnim.phase === "locked"
  );
}

/** Rotor-local angle of the ball (world → rotor). */
function ballLocalAngle() {
  return wrapPi(ballAnim.angle - rotor.rotation.y);
}

/** Pocket index the ball is currently inside (between pipe i and i+1). */
function pocketIndexAtLocal(localA) {
  let a = localA - POCKET_ANGLE0;
  while (a < 0) a += Math.PI * 2;
  while (a >= Math.PI * 2) a -= Math.PI * 2;
  return Math.floor(a / POCKET_SLICE) % WHEEL_ORDER.length;
}

/** Pocket whose center is nearest to this rotor-local angle. */
function nearestPocketIndex(localA) {
  const n = WHEEL_ORDER.length;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(wrapPi(localA - pocketLocalAngle(i)));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Winning number under the ball — wedges/labels share fret angles, so 1:1.
 */
function numberAtPocket(physicsIdx) {
  const n = WHEEL_ORDER.length;
  const i = ((physicsIdx % n) + n) % n;
  return WHEEL_ORDER[i];
}

/** Physics pocket index for a wheel number. */
function pocketIndexForNumber(num) {
  const idx = WHEEL_ORDER.indexOf(num);
  return idx < 0 ? 0 : idx;
}

/** Pocket index under the ball = sector between frets i and i+1. */
function pocketIndexUnderBall(localA) {
  return pocketIndexAtLocal(localA);
}

/**
 * Soft-attach ball into a rotor pocket. Only call when world angle already
 * matches the pocket — otherwise it looks like a teleport.
 */
function attachBallToPocket(idx) {
  const n = WHEEL_ORDER.length;
  const i = ((idx % n) + n) % n;
  ballAnim.targetIdx = i;
  ballAnim.radius = POCKET_R;
  ballAnim.speed = 0;
  ballAnim.bounce = 0;
  const a = pocketLocalAngle(i);
  ballAnim.angle = rotor.rotation.y + a;
  if (ball.parent !== rotor) {
    rotor.add(ball);
  }
  ball.position.set(Math.cos(a) * POCKET_R, POCKET_Y_LOCAL(), Math.sin(a) * POCKET_R);
  return numberAtPocket(i);
}

/** World-space angle of the server pocket right now (moves with the rotor). */
function targetPocketWorldAngle() {
  return rotor.rotation.y + pocketLocalAngle(ballAnim.targetIdx);
}

/** Put the ball back on the fixed bowl for racing / spiraling / rattling. */
function detachBallToWheel() {
  if (ball.parent === rotor) {
    // Preserve world position while reparenting
    ball.getWorldPosition(_ballWorld);
    wheel.add(ball);
    wheel.worldToLocal(_ballWorld);
    ball.position.copy(_ballWorld);
    ballAnim.angle = Math.atan2(ball.position.z, ball.position.x);
    ballAnim.radius = Math.hypot(ball.position.x, ball.position.z);
    ballAnim.y = ball.position.y;
  } else if (ball.parent !== wheel) {
    wheel.add(ball);
  }
}

/** Nearest stop-pipe in rotor-local space. */
function nearestPipe(localA) {
  let a = localA - POCKET_ANGLE0;
  while (a < 0) a += Math.PI * 2;
  while (a >= Math.PI * 2) a -= Math.PI * 2;
  const n = WHEEL_ORDER.length;
  let idx = Math.round(a / POCKET_SLICE) % n;
  if (idx < 0) idx += n;
  const pipeA = pipeLocalAngle(idx);
  const dist = wrapPi(localA - pipeA);
  return { idx, pipeA, dist, absDist: Math.abs(dist) };
}

/** Start ball race for the shared server number (same for every user). */
function startSharedSpin({ number, win = 0, balance, round }) {
  if (number == null || number === undefined) return;
  if (round != null && round === betState.lastAnimatedRound) return;
  if (round != null) betState.lastAnimatedRound = round;

  betState.pendingSpin = {
    number,
    win: win || 0,
    balance: typeof balance === "number" ? balance : betState.balance,
  };

  clearResult();
  camZoom.holdLeft = 0;
  camZoom.dir = -1;
  setBoardCollapsed(true);
  detachBallToWheel();
  ballAnim.targetIdx = pocketIndexForNumber(number);
  ballAnim.phase = "racing";
  ballAnim.radius = TRACK_R;
  ballAnim.y = TRACK_Y;
  ballAnim.speed = -(4.8 + Math.random() * 1.1);
  ballAnim.angle = Math.random() * Math.PI * 2;
  ballAnim.bounce = 0;
  ballAnim.lastDeflector = -1;
  ballAnim.lastPipe = -1;
  ballAnim.rattleT = 0;
  ballAnim.raceT = 0;
  ballAnim.landT = 0;
  ballAnim.lockT = 0;
  ballAnim.landExtends = 0;
  ballAnim.announced = false;
  rotorSpeed = ROTOR_SPIN_SPEED;
  setSpinUi(true);
}

/** Late join during result: snap ball into the shared pocket (no full race). */
function snapSharedResult({ number, win = 0, balance, round }) {
  if (number == null || number === undefined) return;
  if (round != null) betState.lastAnimatedRound = round;
  betState.pendingSpin = {
    number,
    win: win || 0,
    balance: typeof balance === "number" ? balance : betState.balance,
  };
  clearResult();
  setBoardCollapsed(true);
  ballAnim.targetIdx = pocketIndexForNumber(number);
  ballAnim.phase = "settled";
  ballAnim.announced = true;
  attachBallToPocket(ballAnim.targetIdx);
  rotorSpeed = 0;
  setSpinUi(false);
  camZoom.holdLeft = 0;
  camZoom.dir = 1;
  finalizeSpin(number);
}

/** Apply server settle result after the ball visually locks. */
async function finalizeSpin(num) {
  const spinData = betState.pendingSpin;
  betState.pendingSpin = null;
  if (spinData) {
    betState.balance = spinData.balance;
    betState.lastServerWin = spinData.win || 0;
    betState.bets.clear();
    tableEl?.querySelectorAll(".bet-cell").forEach((btn) => updateCellStack(btn));
    refreshMoneyUi();
    showResult(spinData.number);
  } else {
    betState.lastServerWin = 0;
    showResult(num);
  }
}

function applyDeflectorHits() {
  // Only when coming down through the diamond zone
  if (ballAnim.radius > 1.01 || ballAnim.radius < 0.8) return;

  for (let i = 0; i < DEFLECTOR_COUNT; i++) {
    const da = (i / DEFLECTOR_COUNT) * Math.PI * 2 + DEFLECTOR_PHASE;
    const dist = Math.hypot(
      Math.cos(ballAnim.angle) * ballAnim.radius - Math.cos(da) * DEFLECTOR_R,
      Math.sin(ballAnim.angle) * ballAnim.radius - Math.sin(da) * DEFLECTOR_R
    );
    if (dist < 0.05 && ballAnim.lastDeflector !== i) {
      ballAnim.lastDeflector = i;
      const dir = Math.sign(ballAnim.speed || -1);
      ballAnim.speed -= dir * (0.3 + Math.random() * 0.45);
      ballAnim.radius += 0.012 + Math.random() * 0.03;
      // Big visible hop — "eye candy" moment
      ballAnim.bounce = 0.055 + Math.random() * 0.04;

      // Flash the diamond white
      if (deflectorMeshes[i]) deflectorMeshes[i].material.emissiveIntensity = 1.8;

      // Move point light to hit position and fire it
      const da2 = (i / DEFLECTOR_COUNT) * Math.PI * 2 + DEFLECTOR_PHASE;
      hitLight.position.set(Math.cos(da2) * DEFLECTOR_R, 0.2, Math.sin(da2) * DEFLECTOR_R);
      hitLight.intensity = 2.2;
      hitLight.visible = true;
      break;
    }
    const dAng = wrapPi(ballAnim.angle - da);
    if (Math.abs(dAng) > 0.4 && ballAnim.lastDeflector === i) {
      ballAnim.lastDeflector = -1;
    }
  }
}

/**
 * Fret collisions in ROTOR-LOCAL frame (frets spin with the wheel).
 * Bounce flips relative speed — this is what makes 4rabet hops look real.
 */
function collideWithPipesLocal() {
  if (ballAnim.radius < stopInnerR - 0.01 || ballAnim.radius > stopOuterR + 0.04) {
    ballAnim.lastPipe = -1;
    return;
  }

  const localA = ballLocalAngle();
  const localSpeed = ballAnim.speed - rotorSpeed;
  const { idx, pipeA, dist, absDist } = nearestPipe(localA);
  const collideAng = (PIPE_RADIUS + BALL_R * 0.85) / Math.max(ballAnim.radius, 0.2);

  if (absDist < collideAng) {
    const side = dist === 0 ? Math.sign(localSpeed || 1) : Math.sign(dist);
    const clearedLocal = pipeA + side * collideAng * 1.08;
    ballAnim.angle = rotor.rotation.y + clearedLocal;

    const approaching =
      Math.sign(localSpeed) === -side || ballAnim.lastPipe !== idx;
    if (approaching && ballAnim.lastPipe !== idx) {
      // Lip moment — ball rides up and over the fret separator
      let newLocal = -localSpeed * (0.55 + Math.random() * 0.32);
      newLocal += -side * (0.45 + Math.random() * 0.55);
      ballAnim.speed = rotorSpeed + newLocal;
      // Push radius outward briefly — ball climbs the lip then drops back
      ballAnim.radius = Math.min(ballAnim.radius + 0.025 + Math.random() * 0.02, stopOuterR);
      ballAnim.bounce = 0.065 + Math.random() * 0.055; // big visible arc over fret
      ballAnim.radius = THREE.MathUtils.clamp(
        ballAnim.radius + (Math.random() - 0.2) * 0.04,
        stopInnerR + BALL_R,
        stopOuterR - BALL_R * 0.35
      );
      ballAnim.lastPipe = idx;
    }
  } else if (absDist > collideAng * 1.9) {
    ballAnim.lastPipe = -1;
  }

  ballAnim.radius = THREE.MathUtils.clamp(
    ballAnim.radius,
    stopInnerR + BALL_R * 0.45,
    stopOuterR + 0.025
  );
}

/**
 * Give the ball a velocity (in the rotor-local frame) so it drifts from its
 * CURRENT visual position toward the server pocket.
 * NEVER changes ballAnim.angle — no teleport.
 */
function beginLandingChase() {
  ballAnim.phase = "landing";
  ballAnim.landT = 0;
  ballAnim.lastPipe = -1;
  // landExtends is kept across re-aims (failsafe counter)

  const localA = ballLocalAngle();
  const targetLocal = pocketLocalAngle(ballAnim.targetIdx);
  const err = wrapPi(targetLocal - localA);

  // Direction: whichever way is shorter to target
  const dir = Math.sign(err) || Math.sign(ballAnim.speed - rotorSpeed) || -1;

  const tight = (ballAnim.landExtends || 0) >= 2;
  // How much relative speed to cover |err| before friction damps it to zero
  // ∫₀ᵀ rel0·e^{-f·t} dt = rel0/f·(1-e^{-fT}) ≈ |err|
  const fric = 2.15;
  const T = tight ? 0.65 : 0.95;
  const errAbs = Math.abs(err);
  const needed = (errAbs * fric) / (1 - Math.exp(-fric * T));
  const rel0 = THREE.MathUtils.clamp(needed, 0.7, tight ? 1.4 : 2.0);

  ballAnim.speed = rotorSpeed + dir * rel0;
  ballAnim.bounce = 0.025 + Math.random() * 0.02;
  // Clamp radius to fret zone — don't change angle
  ballAnim.radius = THREE.MathUtils.clamp(
    ballAnim.radius,
    stopInnerR + BALL_R * 0.5,
    stopOuterR - 0.01
  );
}

function updateBall(dt) {
  // Idle / settled / locked: ball is a child of the rotor, glued to its pocket
  if (
    ballAnim.phase === "idle" ||
    ballAnim.phase === "settled" ||
    ballAnim.phase === "locked"
  ) {
    attachBallToPocket(ballAnim.targetIdx);

    if (ballAnim.phase === "locked") {
      ballAnim.lockT += dt;
      // Hard-brake the wheel once the ball is in a pocket
      rotorSpeed = Math.max(0, rotorSpeed - dt * 0.55);
      // Announce ONLY after ball has been locked AND wheel is nearly still
      if (
        !ballAnim.announced &&
        ballAnim.lockT >= RESULT_LOCK_DELAY &&
        rotorSpeed <= RESULT_ROTOR_MAX
      ) {
        ballAnim.announced = true;
        // Number must come from the pocket the ball is glued into
        const winNum = numberAtPocket(ballAnim.targetIdx);
        ballAnim.phase = "settled";
        setSpinUi(false);
        camZoom.holdLeft = 0;
        camZoom.dir = 1; // zoom in on the winning pocket
        finalizeSpin(winNum);
      }
    }
    return;
  }

  // Moving phases live on the fixed bowl (wheel), not the rotor
  if (ball.parent !== wheel) detachBallToWheel();

  if (ballAnim.bounce > 0) {
    ballAnim.bounce = Math.max(0, ballAnim.bounce - dt * 0.045);
  }

    if (ballAnim.phase === "racing" || ballAnim.phase === "spiraling") {
    ballAnim.raceT += dt;

    const friction = ballAnim.phase === "racing" ? 0.42 : 0.55;
    ballAnim.speed += Math.sign(ballAnim.speed) * -friction * dt;
    const minSpin = ballAnim.phase === "racing" ? 1.45 : 0.55;
    if (Math.abs(ballAnim.speed) < minSpin) {
      ballAnim.speed = Math.sign(ballAnim.speed || -1) * minSpin;
    }

    // During spiraling: gently steer world speed so ball enters the pocket zone
    // near the server target. This is invisible at rim speed but lands the ball
    // 0-3 pockets from the target instead of up to 18 pockets away.
    if (ballAnim.phase === "spiraling" && ballAnim.targetIdx != null) {
      const localA = ballLocalAngle();
      const targetLocal = pocketLocalAngle(ballAnim.targetIdx);
      const err = wrapPi(targetLocal - localA);
      // Nudge: ±8% of current speed, applied very gently (sub-visual)
      const nudge = Math.sign(err) * Math.abs(ballAnim.speed) * 0.08 * dt;
      ballAnim.speed += nudge;
    }

    ballAnim.angle += ballAnim.speed * dt;

    const absSpeed = Math.abs(ballAnim.speed);

    if (
      ballAnim.phase === "racing" &&
      (absSpeed < HOLD_SPEED || ballAnim.raceT > 5.2)
    ) {
      ballAnim.phase = "spiraling";
    }

    let desiredR;
    if (ballAnim.phase === "racing") {
      desiredR = TRACK_R + Math.sin(performance.now() * 0.009) * 0.004;
    } else {
      // Speed Auto: quicker fall off the rim (snappy drop, not a long spiral)
      const spiralT = Math.max(0, ballAnim.raceT - 4.2);
      const speedFall = Math.pow(1 - THREE.MathUtils.clamp(absSpeed / HOLD_SPEED, 0, 1), 1.05);
      const timeFall = THREE.MathUtils.clamp(spiralT / 2.4, 0, 1);
      const fall = Math.max(speedFall * 0.5, timeFall);
      const ease = fall * fall * (3 - 2 * fall);
      desiredR = THREE.MathUtils.lerp(TRACK_R, POCKET_ENTRY_R - 0.02, ease);
    }

    const maxInward = (ballAnim.phase === "racing" ? 0.06 : 0.28) * dt;
    const nextR = THREE.MathUtils.lerp(ballAnim.radius, desiredR, Math.min(1, dt * 1.85));
    ballAnim.radius += THREE.MathUtils.clamp(nextR - ballAnim.radius, -maxInward, 0.28 * dt);
    ballAnim.radius = THREE.MathUtils.clamp(ballAnim.radius, POCKET_ENTRY_R - 0.02, TRACK_R + 0.02);

    applyDeflectorHits();
    ballAnim.y = ballHeightAt(ballAnim.radius) + ballAnim.bounce;

    if (ballAnim.radius <= POCKET_ENTRY_R) {
      beginLandingChase();
    }
  } else if (ballAnim.phase === "landing") {
    ballAnim.landT += dt;

    // ——— Speed Auto Roulette stop (4rabet) ———
    // Rim drop → multiple lip hops across frets → deep nest.
    const FREE_RATTLE = 1.35;  // longer free hop window = more visible lip moments
    const MAX_LAND = 3.2;
    const fretTopR  = stopOuterR - 0.012; // ball rides on top of the fret lip here
    const fretMidR  = (stopInnerR + stopOuterR) * 0.5 + 0.01;

    let localSpeed = ballAnim.speed - rotorSpeed;

    // Three zones of friction: early hops fast, mid hops slow, settle
    let fric;
    if      (ballAnim.landT < FREE_RATTLE * 0.45) fric = 0.9;  // fast hops — many pockets
    else if (ballAnim.landT < FREE_RATTLE)         fric = 2.2;  // slowing — 1-2 more hops
    else                                            fric = 4.5;  // stick

    localSpeed *= Math.exp(-fric * dt);

    // Keep minimum relative speed during free rattle so ball keeps hopping
    const minLip = ballAnim.landT < FREE_RATTLE * 0.45 ? 1.05 : 0.55;
    if (ballAnim.landT < FREE_RATTLE && Math.abs(localSpeed) < minLip) {
      localSpeed = Math.sign(localSpeed || -1) * (minLip + Math.random() * 0.22);
    }
    ballAnim.speed = rotorSpeed + localSpeed;
    ballAnim.angle += ballAnim.speed * dt;

    collideWithPipesLocal();
    if (ballAnim.radius > 0.74) applyDeflectorHits();
    localSpeed = ballAnim.speed - rotorSpeed;

    const targetLocal = pocketLocalAngle(ballAnim.targetIdx);
    const localA = ballLocalAngle();
    const err = wrapPi(targetLocal - localA);
    const under = pocketIndexUnderBall(localA);
    const inTarget = under === ballAnim.targetIdx;
    const nearCenter = Math.abs(err) < POCKET_SLICE * 0.42;

    // Radius trajectory: ride the fret top early → mid fret → sink to pocket
    let desiredR;
    if (ballAnim.landT < FREE_RATTLE * 0.45) {
      // Ball skips on top of fret lips — most dramatic hop zone
      desiredR = fretTopR;
      ballAnim.radius += (desiredR - ballAnim.radius) * Math.min(1, dt * 3.0);
    } else if (ballAnim.landT < FREE_RATTLE) {
      // Ball drops off the fret tops into the mid-fret zone
      const t = (ballAnim.landT - FREE_RATTLE * 0.45) / (FREE_RATTLE * 0.55);
      desiredR = THREE.MathUtils.lerp(fretTopR, fretMidR, t * t);
      ballAnim.radius += (desiredR - ballAnim.radius) * Math.min(1, dt * 2.2);
    } else {
      const sink = Math.min(1, (ballAnim.landT - FREE_RATTLE) / 0.75);
      const sinkEase = sink * sink * (3 - 2 * sink);
      desiredR = THREE.MathUtils.lerp(fretMidR, POCKET_R, sinkEase);
      ballAnim.radius += (desiredR - ballAnim.radius) * Math.min(1, dt * 4.5);
      if (inTarget && Math.abs(localSpeed) < 0.9) {
        localSpeed *= Math.exp(-8 * dt);
        ballAnim.speed = rotorSpeed + localSpeed;
      }
    }
    ballAnim.radius = THREE.MathUtils.clamp(
      ballAnim.radius,
      POCKET_R - 0.006,
      POCKET_ENTRY_R + 0.03
    );
    ballAnim.y = ballHeightAt(ballAnim.radius) + ballAnim.bounce;
    ballAnim.bounce = Math.max(0, ballAnim.bounce - dt * 0.065);

    rotorSpeed = Math.max(0.14, rotorSpeed - dt * 0.12);

    const relSlow = Math.abs(localSpeed) < 0.18;
    const deepEnough = ballAnim.radius <= POCKET_R + 0.022;
    const readyToLock =
      ballAnim.landT > FREE_RATTLE + 0.5 &&  // must fully complete hop phase first
      inTarget &&
      nearCenter &&
      relSlow &&
      deepEnough;

    if (readyToLock) {
      // Already visually in pocket — reparent is invisible
      ballAnim.phase = "locked";
      ballAnim.lockT = 0;
      ballAnim.speed = 0;
      attachBallToPocket(ballAnim.targetIdx);
    } else if (ballAnim.landT >= MAX_LAND) {
      // Re-aim another physical drop — never teleport across pockets mid-hop
      if ((ballAnim.landExtends || 0) < 3) {
        ballAnim.landExtends = (ballAnim.landExtends || 0) + 1;
        beginLandingChase();
      } else {
        ballAnim.phase = "locked";
        ballAnim.lockT = 0;
        ballAnim.speed = 0;
        attachBallToPocket(ballAnim.targetIdx);
      }
    }
  }

  if (
    ballAnim.phase !== "idle" &&
    ballAnim.phase !== "settled" &&
    ballAnim.phase !== "locked"
  ) {
    ball.position.set(
      Math.cos(ballAnim.angle) * ballAnim.radius,
      ballAnim.y,
      Math.sin(ballAnim.angle) * ballAnim.radius
    );
    ball.rotation.x += Math.abs(ballAnim.speed) * dt * 2.2;
    ball.rotation.z -= ballAnim.speed * dt * 1.4;
  }
}

/* ——— Animate ——— */
const clock = new THREE.Clock();

function resizeStageCanvas() {
  const { w, h } = stageSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

window.addEventListener("resize", () => {
  resizeStageCanvas();
});

/* Spins are automatic (shared server clock) — no manual spin */

/* ——— Betting board (bottom) ——— */
const COL1 = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34];
const COL2 = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35];
const COL3 = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];

const betState = {
  balance: 0,
  chip: 10,
  bets: new Map(),
  historyStack: [], // for undo (local mirror; server is source of truth)
  accessToken: null,
  apiReady: false,
  pendingRequest: false,
  lastServerWin: 0,
  pendingSpin: null,
  roundHistory: (() => {
    try {
      return JSON.parse(localStorage.getItem("roultee_history") || "[]");
    } catch { return []; }
  })(), // recent settled results — persisted in localStorage
  soundOn: localStorage.getItem("roultee_sound") !== "0",
  // Shared round clock (same game for every user)
  gamePhase: null,
  canBet: false,
  gameRound: null,
  secondsLeft: 0,
  lastAnimatedRound: null,
  pollTimer: null,
};

const betTimerEl = document.getElementById("bet-timer");
const betTimerProgress = betTimerEl?.querySelector(".bt-progress");

function updateBetTimer(game) {
  if (!betTimerEl) return;
  const phase = game?.phase;
  const left = Number(game?.seconds_left ?? 0);
  const total = Number(game?.betting_seconds ?? 7) || 7;
  const show = phase === "betting" && left > 0.05;
  betTimerEl.hidden = !show;
  if (!show || !betTimerProgress) return;
  const pct = Math.max(0, Math.min(100, (left / total) * 100));
  // Deplete ring as time runs out (pathLength=100)
  betTimerProgress.style.strokeDashoffset = String(100 - pct);
}

function applyGameClock(data) {
  if (!data || !data.phase) return;
  betState.gamePhase = data.phase;
  betState.canBet = !!data.can_bet;
  betState.gameRound = data.round ?? betState.gameRound;
  betState.secondsLeft = Number(data.seconds_left ?? 0);
  updateBetTimer(data);

  const round = data.round;
  const number = data.number;
  if (round == null || number == null) return;
  if (round === betState.lastAnimatedRound) return;

  if (data.phase === "spinning") {
    startSharedSpin({
      number,
      win: data.win || 0,
      balance: data.balance,
      round,
    });
    return;
  }

  // Joined during result window — show outcome without full race
  if (data.phase === "result" && !isBallBusy()) {
    snapSharedResult({
      number,
      win: data.win || 0,
      balance: data.balance,
      round,
    });
  }
}

async function pollGameState() {
  if (!betState.accessToken || !betState.apiReady) return;
  try {
    const data = await api("/state/");
    applyServerState(data);
    applyGameClock(data);
  } catch (e) {
    // Keep polling; brief network blips are fine
    console.warn("game state poll:", e.message || e);
  }
}

function startGameClock() {
  if (betState.pollTimer) return;
  pollGameState();
  betState.pollTimer = setInterval(pollGameState, 400);
}

/** Django API base — production uses Gundu /roulette/api → /api/roulette/ */
const API_BASE = (
  new URLSearchParams(location.search).get("api") ||
  localStorage.getItem("roultee_api") ||
  (location.hostname === "127.0.0.1" || location.hostname === "localhost"
    ? "http://127.0.0.1:8001/api/roulette"
    : `${location.origin}/roulette/api`)
).replace(/\/$/, "");

function toApiBetKey(key) {
  const [type, val] = String(key).split(":");
  if (type === "lowhigh") return val; // low | high
  if (type === "parity") return val; // even | odd
  if (type === "color") return val; // red | black
  return key;
}

function fromApiBetKey(key) {
  if (key === "low" || key === "high") return `lowhigh:${key}`;
  if (key === "even" || key === "odd") return `parity:${key}`;
  if (key === "red" || key === "black") return `color:${key}`;
  return key;
}

function readAccessToken() {
  const q = new URLSearchParams(location.search).get("token");
  if (q) {
    localStorage.setItem("gundu_access_token", q);
    return q;
  }
  return (
    localStorage.getItem("gundu_access_token") ||
    localStorage.getItem("access_token") ||
    null
  );
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (!betState.accessToken) {
    throw new Error("Login required");
  }
  headers["Authorization"] = `Bearer ${betState.accessToken}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch (e) {
    throw new Error(`Cannot reach API at ${API_BASE}`);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (res.status === 401) {
    betState.apiReady = false;
    throw new Error("Session expired — please login again");
  }
  if (!res.ok) {
    const detail = data?.detail || res.statusText || "request failed";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

function applyServerState(data) {
  if (typeof data.balance === "number") betState.balance = data.balance;
  if (Array.isArray(data.pending_bets)) {
    betState.bets.clear();
    for (const b of data.pending_bets) {
      betState.bets.set(fromApiBetKey(b.key), b.amount);
    }
    tableEl?.querySelectorAll(".bet-cell").forEach((btn) => updateCellStack(btn));
  }
  refreshMoneyUi();
}

async function restoreAuthSession() {
  betState.accessToken = readAccessToken();
  if (!betState.accessToken) {
    betState.apiReady = false;
    if (resultEl) resultEl.textContent = "Login required — open Roulette from the app";
    refreshMoneyUi();
    return;
  }
  const data = await api("/me/");
  applyServerState(data);
  if (data.game) applyGameClock({ ...data.game, balance: data.balance, win: data.game.win });
  betState.apiReady = true;
  startGameClock();
}

// Back-compat aliases (old guest-session names)
async function ensureSession() {
  if (betState.apiReady) return;
  await restoreAuthSession();
  if (!betState.apiReady) throw new Error("Login required");
}

async function restoreOrCreateSession() {
  await restoreAuthSession();
}

const historyEl = document.getElementById("history");
const tableEl = document.getElementById("bet-table");
const totalBetEl = document.getElementById("total-bet");
const balanceEl = document.getElementById("balance");
const topBalanceEl = document.getElementById("top-balance");

function fmtMoney(n) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function colorClass(num) {
  if (num === 0) return "green";
  return RED.has(num) ? "red" : "black";
}

/** Render the full history strip from betState.roundHistory (used on load + after each push). */
function renderHistoryStrip() {
  if (!historyEl) return;
  historyEl.innerHTML = "";
  if (!betState.roundHistory.length) {
    historyEl.innerHTML = `<span class="last-round-empty">—</span>`;
    return;
  }
  betState.roundHistory.slice(0, 20).forEach((entry, i) => {
    const chip = document.createElement("div");
    chip.className = `hist-chip ${entry.color}${i === 0 ? " latest" : ""}`;
    chip.textContent = String(entry.number);
    historyEl.appendChild(chip);
  });
}

function pushHistory(num) {
  betState.roundHistory.unshift({
    number: num,
    color: colorClass(num),
    win: betState.lastServerWin || 0,
    at: Date.now(),
  });
  if (betState.roundHistory.length > 50) betState.roundHistory.length = 50;

  // Persist to localStorage so it survives page reloads / app restarts
  try {
    localStorage.setItem("roultee_history", JSON.stringify(betState.roundHistory.slice(0, 50)));
  } catch {}

  renderHistoryStrip();
}

function totalBetAmount() {
  let t = 0;
  for (const v of betState.bets.values()) t += v;
  return t;
}

function refreshMoneyUi() {
  if (totalBetEl) totalBetEl.textContent = fmtMoney(totalBetAmount());
  if (balanceEl) balanceEl.textContent = fmtMoney(betState.balance);
  if (topBalanceEl) topBalanceEl.textContent = fmtMoney(betState.balance);
}

function betKey(type, value) {
  return `${type}:${value}`;
}

function chipTierForAmount(amount) {
  if (amount >= 1000) return 1000;
  if (amount >= 500) return 500;
  if (amount >= 100) return 100;
  if (amount >= 50) return 50;
  if (amount >= 20) return 20;
  return 10;
}

function updateCellStack(btn) {
  const key = btn.dataset.key;
  const amt = betState.bets.get(key) || 0;
  let stack = btn.querySelector(".stack");
  if (amt <= 0) {
    stack?.remove();
    return;
  }
  if (!stack) {
    stack = document.createElement("span");
    stack.className = "stack";
    btn.appendChild(stack);
  }
  stack.dataset.chip = String(chipTierForAmount(amt));
  stack.dataset.amount = amt >= 1000
    ? `${(amt / 1000).toFixed(amt % 1000 === 0 ? 0 : 1)}K`
    : String(amt);
  stack.textContent = "";
  stack.setAttribute("aria-label", `${fmtMoney(amt)} bet`);
}

async function placeBet(key, btn) {
  if (betState.pendingRequest) return;
  if (!betState.apiReady) {
    try {
      await restoreOrCreateSession();
    } catch (e) {
      if (resultEl) resultEl.textContent = `API error: ${e.message}`;
      return;
    }
  }
  if (!betState.canBet) {
    if (resultEl) resultEl.textContent = "Wait for next betting round";
    return;
  }
  const chip = betState.chip;
  if (betState.balance < chip) return;
  betState.pendingRequest = true;
  try {
    const data = await api("/bets/", {
      method: "POST",
      body: JSON.stringify({ key: toApiBetKey(key), amount: chip }),
    });
    applyServerState(data);
    betState.historyStack.push({ key, chip, visualChip: chip });
    if (btn) updateCellStack(btn);
  } catch (e) {
    if (resultEl) resultEl.textContent = `Bet failed: ${e.message}`;
  } finally {
    betState.pendingRequest = false;
  }
}

async function undoBet() {
  if (betState.pendingRequest) return;
  if (!betState.apiReady || !betState.canBet) return;
  betState.pendingRequest = true;
  try {
    const data = await api("/bets/undo/", { method: "POST", body: "{}" });
    applyServerState(data);
    betState.historyStack.pop();
  } catch (e) {
    if (resultEl) resultEl.textContent = `Undo failed: ${e.message}`;
  } finally {
    betState.pendingRequest = false;
  }
}

async function doubleBets() {
  if (betState.pendingRequest) return;
  if (!betState.apiReady || !betState.canBet) return;
  betState.pendingRequest = true;
  try {
    const data = await api("/bets/double/", { method: "POST", body: "{}" });
    applyServerState(data);
  } catch (e) {
    if (resultEl) resultEl.textContent = `Double failed: ${e.message}`;
  } finally {
    betState.pendingRequest = false;
  }
}

async function clearBets(refund = true) {
  if (betState.pendingRequest) return;
  if (!betState.apiReady) {
    if (refund) {
      for (const amt of betState.bets.values()) betState.balance += amt;
    }
    betState.bets.clear();
    betState.historyStack = [];
    tableEl?.querySelectorAll(".stack").forEach((el) => el.remove());
    tableEl?.querySelectorAll(".win-flash").forEach((el) => el.classList.remove("win-flash"));
    refreshMoneyUi();
    return;
  }
  if (!betState.canBet) return;
  betState.pendingRequest = true;
  try {
    const data = await api("/bets/clear/", { method: "POST", body: "{}" });
    applyServerState(data);
    betState.historyStack = [];
    tableEl?.querySelectorAll(".win-flash").forEach((el) => el.classList.remove("win-flash"));
  } catch (e) {
    if (resultEl) resultEl.textContent = `Clear failed: ${e.message}`;
  } finally {
    betState.pendingRequest = false;
  }
}

function makeCell(label, className, key) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `bet-cell ${className}`;
  btn.dataset.key = key;
  if (className.includes("diamond")) {
    btn.setAttribute("aria-label", label);
  } else {
    btn.textContent = label;
  }
  btn.addEventListener("click", () => placeBet(key, btn));
  return btn;
}

function buildBetTableV2() {
  if (!tableEl) return;
  tableEl.innerHTML = "";

  // Reference layout (5 cols):
  // [even-money] [dozens] [n1] [n2] [n3]
  // Row1: empty empty | 0 spanning 3
  // Rows 2-13: numbers 1-36
  // Row14: empty empty | 2to1 x3

  const zero = makeCell("", "zero", betKey("straight", 0));
  zero.innerHTML = '<span class="zero-label">0</span>';
  zero.style.gridColumn = "3 / 6";
  zero.style.gridRow = "1";
  tableEl.appendChild(zero);

  // Far-left even-money column (each spans 2 number rows) – vertical text like reference
  const evenMoney = [
    { html: "1-18",  key: betKey("lowhigh", "low"),  row: 2,  cls: "outside ev-vert" },
    { html: "EVEN",  key: betKey("parity", "even"),  row: 4,  cls: "outside ev-vert" },
    { html: '<span class="dmd">&#9670;</span>', key: betKey("color", "red"),   row: 6,  cls: "outside ev-vert diamond-red" },
    { html: '<span class="dmd">&#9670;</span>', key: betKey("color", "black"), row: 8,  cls: "outside ev-vert diamond-black" },
    { html: "ODD",   key: betKey("parity", "odd"),   row: 10, cls: "outside ev-vert" },
    { html: "19-36", key: betKey("lowhigh", "high"), row: 12, cls: "outside ev-vert" },
  ];
  evenMoney.forEach((b) => {
    const cell = makeCell("", b.cls, b.key);
    cell.innerHTML = b.html;
    cell.style.gridColumn = "1";
    cell.style.gridRow = `${b.row} / span 2`;
    tableEl.appendChild(cell);
  });

  // Dozens column (each spans 4 number rows) – vertical text with superscript ordinals
  [
    { html: '<span class="dozen-label">1<sup>st</sup> 12</span>', key: betKey("dozen", 1), row: 2 },
    { html: '<span class="dozen-label">2<sup>nd</sup> 12</span>', key: betKey("dozen", 2), row: 6 },
    { html: '<span class="dozen-label">3<sup>rd</sup> 12</span>', key: betKey("dozen", 3), row: 10 },
  ].forEach((b) => {
    const cell = makeCell("", "outside dozen", b.key);
    cell.innerHTML = b.html;
    cell.style.gridColumn = "2";
    cell.style.gridRow = `${b.row} / span 4`;
    tableEl.appendChild(cell);
  });

  // Number grid
  for (let r = 0; r < 12; r++) {
    const gridRow = r + 2;
    [COL1[r], COL2[r], COL3[r]].forEach((n, i) => {
      const cell = makeCell(String(n), colorClass(n), betKey("straight", n));
      cell.style.gridColumn = String(i + 3);
      cell.style.gridRow = String(gridRow);
      tableEl.appendChild(cell);
    });
  }

  // Column bets
  [1, 2, 3].forEach((c, i) => {
    const cell = makeCell("2 TO 1", "outside", betKey("column", c));
    cell.style.gridColumn = String(i + 3);
    cell.style.gridRow = "14";
    tableEl.appendChild(cell);
  });
}

function hitsBet(key, num) {
  const [type, raw] = key.split(":");
  const val = raw;
  if (type === "straight") return Number(val) === num;
  if (type === "color") {
    if (num === 0) return false;
    return val === "red" ? RED.has(num) : !RED.has(num);
  }
  if (type === "parity") {
    if (num === 0) return false;
    return val === "even" ? num % 2 === 0 : num % 2 === 1;
  }
  if (type === "lowhigh") {
    if (num === 0) return false;
    return val === "low" ? num <= 18 : num >= 19;
  }
  if (type === "dozen") {
    if (num === 0) return false;
    const d = Number(val);
    if (d === 1) return num >= 1 && num <= 12;
    if (d === 2) return num >= 13 && num <= 24;
    return num >= 25 && num <= 36;
  }
  if (type === "column") {
    if (num === 0) return false;
    const c = Number(val);
    if (c === 1) return COL1.includes(num);
    if (c === 2) return COL2.includes(num);
    return COL3.includes(num);
  }
  return false;
}

function payoutOdds(key) {
  const type = key.split(":")[0];
  if (type === "straight") return 36; // 35:1 + stake
  if (type === "column" || type === "dozen") return 3; // 2:1 + stake
  return 2; // even money + stake
}

function settleBets(num) {
  tableEl?.querySelectorAll(".win-flash").forEach((el) => el.classList.remove("win-flash"));
  let win = 0;
  for (const [key, amt] of betState.bets.entries()) {
    if (hitsBet(key, num)) {
      win += amt * payoutOdds(key);
      const btn = tableEl?.querySelector(`[data-key="${CSS.escape(key)}"]`);
      btn?.classList.add("win-flash");
    }
  }
  betState.balance += win;
  betState.bets.clear();
  betState.historyStack = [];
  tableEl?.querySelectorAll(".stack").forEach((el) => el.remove());
  refreshMoneyUi();
  if (win > 0 && resultEl) {
    resultEl.textContent += ` · Won ${fmtMoney(win)}`;
  }
}

function initBettingUi() {
  buildBetTableV2();
  refreshMoneyUi();
  initGameMenu();
  initBoardToggle();

  const chipStack = document.getElementById("chip-stack");
  document.querySelectorAll(".chip[data-chip]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) {
        const isOpen = chipStack?.classList.toggle("open") ?? false;
        chipStack?.setAttribute("aria-expanded", String(isOpen));
        return;
      }
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      betState.chip = Number(btn.dataset.chip);
      chipStack?.classList.remove("open");
      chipStack?.setAttribute("aria-expanded", "false");
    });
  });

  document.getElementById("clear-bets")?.addEventListener("click", () => {
    if (!isBallBusy()) clearBets(true);
  });
  document.getElementById("undo-bet")?.addEventListener("click", () => undoBet());
  document.getElementById("double-bet")?.addEventListener("click", () => doubleBets());
}

function setBoardCollapsed(collapsed) {
  const shell = document.getElementById("game-shell");
  const btn = document.getElementById("board-toggle");
  if (!shell) return;
  shell.classList.toggle("board-collapsed", collapsed);
  if (btn) {
    btn.setAttribute("aria-label", collapsed ? "Expand board" : "Collapse board");
    btn.title = collapsed ? "Expand board" : "Collapse board";
  }
}

function initBoardToggle() {
  const btn = document.getElementById("board-toggle");
  // Default: compact board under the wheel (not the large overlay)
  setBoardCollapsed(true);
  btn?.addEventListener("click", () => {
    const shell = document.getElementById("game-shell");
    const next = !shell?.classList.contains("board-collapsed");
    setBoardCollapsed(next);
  });
}

/* ——— Bottom hamburger menu ——— */
function goLobby() {
  try {
    if (window.AndroidBridge?.goHome) {
      window.AndroidBridge.goHome();
      return;
    }
    if (window.Android?.goHome) {
      window.Android.goHome();
      return;
    }
    if (window.ReactNativeWebView?.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "lobby", action: "home" }));
      return;
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "roultee-lobby", action: "home" }, "*");
    }
  } catch (_) {
    /* fall through */
  }
  const home =
    new URLSearchParams(location.search).get("home") ||
    localStorage.getItem("roultee_home") ||
    `${location.origin}/`;
  location.href = home;
}

function setMenuOpen(open) {
  const menu = document.getElementById("game-menu");
  const btn = document.getElementById("menu-btn");
  if (!menu) return;
  menu.classList.toggle("open", open);
  menu.setAttribute("aria-hidden", String(!open));
  btn?.setAttribute("aria-expanded", String(open));
  if (!open) hideAllMenuPanels();
}

function hideAllMenuPanels() {
  document.querySelectorAll(".menu-panel").forEach((p) => {
    p.hidden = true;
  });
  const nav = document.getElementById("menu-nav");
  if (nav) nav.hidden = false;
}

function showMenuPanel(id) {
  const nav = document.getElementById("menu-nav");
  if (nav) nav.hidden = true;
  document.querySelectorAll(".menu-panel").forEach((p) => {
    p.hidden = p.id !== id;
  });
}

function refreshSoundUi() {
  const el = document.getElementById("sound-state");
  if (el) el.textContent = betState.soundOn ? "On" : "Off";
}

function renderStatsPanel() {
  const body = document.getElementById("stats-body");
  if (!body) return;
  const list = betState.roundHistory;
  if (!list.length) {
    body.innerHTML = `<p class="menu-empty">No rounds yet — place a bet and spin.</p>`;
    return;
  }
  let red = 0;
  let black = 0;
  let green = 0;
  const counts = new Map();
  for (const r of list) {
    if (r.color === "red") red += 1;
    else if (r.color === "black") black += 1;
    else green += 1;
    counts.set(r.number, (counts.get(r.number) || 0) + 1);
  }
  const hot = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recent = list.slice(0, 12);
  body.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><span class="n">${list.length}</span><span class="l">Rounds</span></div>
      <div class="stat-card red"><span class="n">${red}</span><span class="l">Red</span></div>
      <div class="stat-card black"><span class="n">${black}</span><span class="l">Black</span></div>
      <div class="stat-card green"><span class="n">${green}</span><span class="l">Zero</span></div>
    </div>
    <h4>Recent</h4>
    <div class="hist-list">${recent
      .map((r) => `<div class="hist-chip ${r.color}">${r.number}</div>`)
      .join("")}</div>
    <h4>Hot numbers</h4>
    <div class="hist-list">${
      hot.length
        ? hot
            .map(
              ([n, c]) =>
                `<div class="hist-chip ${colorClass(n)}" title="${c}×">${n}</div>`
            )
            .join("")
        : `<span class="menu-empty">—</span>`
    }</div>
  `;
}

async function renderHistoryPanel() {
  const body = document.getElementById("history-body");
  if (!body) return;
  body.innerHTML = `<p class="menu-empty">Loading…</p>`;

  let rows = null;
  if (betState.apiReady && betState.accessToken) {
    try {
      const data = await api("/history/?limit=30");
      rows = data.results || [];
    } catch (_) {
      rows = null;
    }
  }

  if (rows && rows.length) {
    body.innerHTML = `
      <div class="hist-list" style="margin-bottom:12px">${rows
        .map(
          (r) =>
            `<div class="hist-chip ${colorClass(r.number)}" title="stake ${r.stake}">${r.number}</div>`
        )
        .join("")}</div>
      <div class="panel-body">${rows
        .slice(0, 15)
        .map((r) => {
          const net = (r.payout || 0) - (r.stake || 0);
          const sign = net >= 0 ? "+" : "";
          return `<p><strong class="${colorClass(r.number)}">${r.number}</strong>
            · stake ${fmtMoney(r.stake || 0)}
            · ${sign}${fmtMoney(net)}</p>`;
        })
        .join("")}</div>
    `;
    return;
  }

  if (!betState.roundHistory.length) {
    body.innerHTML = `<p class="menu-empty">No game history yet.</p>`;
    return;
  }
  body.innerHTML = `
    <div class="hist-list">${betState.roundHistory
      .map((r) => `<div class="hist-chip ${r.color}">${r.number}</div>`)
      .join("")}</div>
  `;
}

function initGameMenu() {
  const menuBtn = document.getElementById("menu-btn");
  const closeBtn = document.getElementById("menu-close");
  const backdrop = document.getElementById("menu-backdrop");
  const soundBtn = document.getElementById("sound-toggle");
  const lobbyBtn = document.getElementById("lobby-btn");
  const supportHome = document.getElementById("support-home-btn");

  refreshSoundUi();

  menuBtn?.addEventListener("click", () => {
    const open = !document.getElementById("game-menu")?.classList.contains("open");
    setMenuOpen(open);
  });
  closeBtn?.addEventListener("click", () => setMenuOpen(false));
  backdrop?.addEventListener("click", () => setMenuOpen(false));

  document.querySelectorAll(".menu-item[data-panel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = `panel-${btn.dataset.panel}`;
      if (btn.dataset.panel === "stats") renderStatsPanel();
      if (btn.dataset.panel === "history") renderHistoryPanel();
      showMenuPanel(id);
    });
  });

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => hideAllMenuPanels());
  });

  soundBtn?.addEventListener("click", () => {
    betState.soundOn = !betState.soundOn;
    localStorage.setItem("roultee_sound", betState.soundOn ? "1" : "0");
    refreshSoundUi();
  });

  lobbyBtn?.addEventListener("click", () => goLobby());
  supportHome?.addEventListener("click", () => goLobby());
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (ballAnim.phase === "settled" || ballAnim.phase === "idle") {
    rotorSpeed = Math.max(0, rotorSpeed - dt * 0.18);
  }
  if (rotorSpeed > 0.0001) {
    rotor.rotation.y += dt * rotorSpeed;
  }
  updateBall(dt);
  updateCamera(dt);

  // Fade deflector flash and hit light
  const fadeRate = dt * 9;
  for (const dm of deflectorMeshes) {
    if (dm.material.emissiveIntensity > 0) {
      dm.material.emissiveIntensity = Math.max(0, dm.material.emissiveIntensity - fadeRate);
    }
  }
  if (hitLight.visible) {
    hitLight.intensity = Math.max(0, hitLight.intensity - dt * 14);
    if (hitLight.intensity <= 0) hitLight.visible = false;
  }

  renderer.render(scene, camera);
}

// Start with ball parked in a pocket; user spins with the button
try {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.style.display = "none";

  initBettingUi();
  renderHistoryStrip(); // show persisted results immediately on open
  ballAnim.phase = "idle";
  ballAnim.targetIdx = pocketIndexForNumber(0);
  setSpinUi(false);
  updateBall(0);
  // fit canvas to stage after layout
  requestAnimationFrame(() => {
    const { w, h } = stageSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });
  animate();

  // Connect with real Gundu JWT (injected by APK WebView)
  restoreOrCreateSession().catch((e) => {
    console.warn("Auth failed:", e);
    if (resultEl) resultEl.textContent = e.message || "Login required";
  });
} catch (e) {
  console.error("Initialization error:", e);
  const overlay = document.getElementById("loading-overlay");
  if (overlay) {
    overlay.innerHTML = `<div style="color:#f66;padding:20px;text-align:center;">
      <h3>Error Loading Wheel</h3>
      <p>${e.message}</p>
    </div>`;
  }
}
