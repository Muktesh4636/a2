import * as THREE from "three";

const canvas = document.getElementById("tableCanvas");
const sceneRoot = document.querySelector(".table-scene");
if (!canvas || !sceneRoot) throw new Error("Table canvas missing");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setClearColor(0x000000, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
const TOP_CAM = {
  position: new THREE.Vector3(0, 9.2, 0.01),
  target: new THREE.Vector3(0, 0, 0),
  fov: 26,
};
camera.position.copy(TOP_CAM.position);
camera.fov = TOP_CAM.fov;
camera.lookAt(TOP_CAM.target);
sceneRoot.dataset.camera = "top";

function makeTableTexture(size = 2048) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;

  // Transparent / black outside — clear so material alpha kills it
  ctx.clearRect(0, 0, size, size);

  // Oval proportions matching a casino table
  const ox = size * 0.47; // outer wood
  const oy = size * 0.31;
  const wx = size * 0.408; // wood inner (wide espresso rail)
  const wy = size * 0.268;
  // Felt fills all the way to the frame — no black gap
  const fx = wx - size * 0.002;
  const fy = wy - size * 0.0015;

  // Black seal just outside the rail — kills green AA bleed into the void
  ctx.beginPath();
  ctx.ellipse(cx, cy, ox + size * 0.006, oy + size * 0.006, 0, 0, Math.PI * 2);
  ctx.ellipse(cx, cy, ox - 1, oy - 1, 0, 0, Math.PI * 2, true);
  ctx.fillStyle = "#000000";
  ctx.fill();

  // Full green underlay first — wood sits on top, so no black gap at the join
  ctx.beginPath();
  ctx.ellipse(cx, cy, wx + size * 0.012, wy + size * 0.01, 0, 0, Math.PI * 2);
  const underFelt = ctx.createRadialGradient(cx, cy * 0.92, size * 0.02, cx, cy, fx);
  underFelt.addColorStop(0, "#2f7a4e");
  underFelt.addColorStop(0.55, "#1f5c3a");
  underFelt.addColorStop(1, "#1a4a30");
  ctx.fillStyle = underFelt;
  ctx.fill();

  // ——— Espresso wood rail ———
  ctx.beginPath();
  ctx.ellipse(cx, cy, ox, oy, 0, 0, Math.PI * 2);
  ctx.ellipse(cx, cy, wx, wy, 0, 0, Math.PI * 2, true);
  const woodGrad = ctx.createRadialGradient(cx, cy * 0.9, fy, cx, cy, ox);
  woodGrad.addColorStop(0, "#3a2214");
  woodGrad.addColorStop(0.35, "#24140c");
  woodGrad.addColorStop(0.65, "#4a2c18");
  woodGrad.addColorStop(1, "#1a0e08");
  ctx.fillStyle = woodGrad;
  ctx.fill();

  // Circumferential grain
  for (let i = 0; i < 55; i += 1) {
    const t = i / 55;
    const rx = wx + (ox - wx) * t;
    const ry = wy + (oy - wy) * t;
    ctx.strokeStyle = `rgba(8,4,0,${0.18 + (i % 4) * 0.07})`;
    ctx.lineWidth = size * 0.0012;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 35; i += 1) {
    const t = 0.1 + Math.random() * 0.8;
    const rx = wx + (ox - wx) * t;
    const ry = wy + (oy - wy) * t;
    const a0 = Math.random() * Math.PI * 2;
    ctx.strokeStyle = `rgba(140, 88, 48, ${0.1 + Math.random() * 0.12})`;
    ctx.lineWidth = size * 0.001;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, a0, a0 + 0.35 + Math.random() * 0.7);
    ctx.stroke();
  }

  // Soft polish on wood
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, ox, oy, 0, 0, Math.PI * 2);
  ctx.ellipse(cx, cy, wx, wy, 0, 0, Math.PI * 2, true);
  ctx.clip();
  const gloss = ctx.createLinearGradient(0, cy - oy, 0, cy + oy * 0.15);
  gloss.addColorStop(0, "rgba(200,140,80,0.22)");
  gloss.addColorStop(0.4, "rgba(200,140,80,0.06)");
  gloss.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // Outer edge shadow (finished lip)
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.lineWidth = size * 0.004;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ox - 1, oy - 1, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Thin brass inlays (finishing lines, not the whole rail)
  const brassG = ctx.createLinearGradient(cx - ox, cy, cx + ox, cy);
  brassG.addColorStop(0, "#6e5220");
  brassG.addColorStop(0.35, "#d4a84a");
  brassG.addColorStop(0.55, "#8a6828");
  brassG.addColorStop(0.8, "#e0b85a");
  brassG.addColorStop(1, "#6e5220");

  // Outer brass hairline
  ctx.beginPath();
  ctx.ellipse(cx, cy, ox - size * 0.004, oy - size * 0.003, 0, 0, Math.PI * 2);
  ctx.ellipse(cx, cy, ox - size * 0.01, oy - size * 0.007, 0, 0, Math.PI * 2, true);
  ctx.fillStyle = brassG;
  ctx.fill();

  // ——— Felt fills to the frame (covers former black gap) ———
  ctx.beginPath();
  ctx.ellipse(cx, cy, fx, fy, 0, 0, Math.PI * 2);
  ctx.save();
  ctx.clip();
  const feltG = ctx.createRadialGradient(cx, cy * 0.92, size * 0.02, cx, cy, fx);
  feltG.addColorStop(0, "#2f7a4e");
  feltG.addColorStop(0.55, "#1f5c3a");
  feltG.addColorStop(1, "#1a4a30");
  ctx.fillStyle = feltG;
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 200) continue;
    // Only noise green-ish felt pixels
    if (img.data[i + 1] < img.data[i] + 10) continue;
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n * 0.5;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.4;
  }
  ctx.putImageData(img, 0, 0);

  ctx.strokeStyle = "rgba(210,170,90,0.4)";
  ctx.lineWidth = size * 0.003;
  ctx.beginPath();
  ctx.ellipse(cx, cy, fx * 0.55, fy * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(220,175,90,0.2)";
  ctx.font = `700 ${Math.round(size * 0.055)}px Bebas Neue, Impact, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("TEEN PATTI", cx, cy + size * 0.004);
  ctx.restore();

  // Thin brass line where wood meets felt
  ctx.beginPath();
  ctx.ellipse(cx, cy, wx + size * 0.001, wy + size * 0.001, 0, 0, Math.PI * 2);
  ctx.ellipse(cx, cy, fx - size * 0.003, fy - size * 0.002, 0, 0, Math.PI * 2, true);
  ctx.fillStyle = brassG;
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const tableMap = makeTableTexture(2048);

const tableMat = new THREE.MeshBasicMaterial({
  map: tableMap,
  transparent: true,
  alphaTest: 0.15,
  depthWrite: true,
  toneMapped: false,
});

const table = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 4.22), tableMat);
table.rotation.x = -Math.PI / 2;
table.position.y = 0;
scene.add(table);

// Soft key light not needed for MeshBasic — keep a tiny ambient for future 3d bits
scene.add(new THREE.AmbientLight(0xffffff, 0.01));

function resize() {
  const { clientWidth: w, clientHeight: h } = sceneRoot;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

(function loop() {
  camera.position.copy(TOP_CAM.position);
  camera.lookAt(TOP_CAM.target);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
})();
