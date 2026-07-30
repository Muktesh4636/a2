/**
 * Vortex rings / board canvas
 * Owns pipe-ring drawing, white gaps, bonus labels, fill progress.
 */
export const START = -Math.PI * 0.72;

export const RINGS = {
  water: {
    color: "#1e88e5",
    glow: "#42a5f5",
    icon: "🌊",
    mults: [1.6, 5, 10],
    radius: 182,
    label: "Water",
    bonusText: "BONUS UP TO",
    bonusMax: 10,
  },
  earth: {
    color: "#00c853",
    glow: "#69f0ae",
    icon: "🍀",
    mults: [2.5, 7.7, 16, 28, 45],
    radius: 241,
    label: "Earth",
    bonusText: "BONUS UP TO",
    bonusMax: 50,
  },
  fire: {
    color: "#ff1744",
    glow: "#ff8a80",
    icon: "🔥",
    mults: [4, 15, 30, 55, 88, 133, 200],
    radius: 300,
    label: "Fire",
    bonusText: "BONUS UP TO",
    bonusMax: 799,
  },
};

const DEPTH = {
  center: { drop: 0, sy: 0.98, thick: 5 },
  water: { drop: 0, sy: 0.97, thick: 6 },
  earth: { drop: 0, sy: 0.96, thick: 7 },
  fire: { drop: 0, sy: 0.95, thick: 8 },
};

const BASE_CX = 360;
const BASE_CY = 360;
const LW = 40;
const CENTER_R = 100;

export function createRingBoard(canvas) {
  const ctx = canvas.getContext("2d");
  let visual = { water: 0, earth: 0, fire: 0 };

  const earthImg = new Image();
  earthImg.src = new URL("../images/earth-flower.png", import.meta.url).href;
  const waterImg = new Image();
  waterImg.src = new URL("../images/water-wave.png", import.meta.url).href;
  const fireImg = new Image();
  fireImg.src = new URL("../images/fire-flame.png", import.meta.url).href;

  earthImg.onload = () => drawBoard();
  waterImg.onload = () => drawBoard();
  fireImg.onload = () => drawBoard();

  canvas.width = 720;
  canvas.height = 720;

  function withDepth(level, fn) {
    const d = DEPTH[level];
    ctx.save();
    ctx.translate(BASE_CX, BASE_CY);
    ctx.scale(1, d.sy);
    fn(0, 0, d);
    ctx.restore();
    return { cx: BASE_CX, cy: BASE_CY, sy: d.sy, thick: d.thick };
  }

  function drawBonusBadge(key, ring) {
    const a = START - 0.06;
    const x = Math.cos(a) * ring.radius;
    const y = Math.sin(a) * ring.radius;
    const sy = DEPTH[key].sy;
    const dark = document.body.classList.contains("theme-dark");

    const asset =
      key === "earth" && earthImg.complete && earthImg.naturalWidth ? earthImg :
      key === "water" && waterImg.complete && waterImg.naturalWidth ? waterImg :
      key === "fire" && fireImg.complete && fireImg.naturalWidth ? fireImg :
      null;

    const label = `${ring.bonusMax}X`;
    const iconR = 22;
    const solid = { fire: "#FF1744", earth: "#00C853", water: "#2979FF" };
    const color = solid[key] || solid.fire;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 1 / sy);
    ctx.rotate(a + Math.PI / 2);
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.globalAlpha = 1;

    ctx.font = "italic 900 28px Poppins, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width;
    const gap = 4;
    const pairW = tw + gap + iconR * 2;
    const textX = -pairW / 2 + tw;
    const iconX = textX + gap + iconR;

    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    // Light theme: white outline. Dark theme: deep outline (no white halo).
    ctx.lineWidth = dark ? 5 : 6;
    ctx.strokeStyle = dark ? "rgba(6, 12, 22, 0.95)" : "#ffffff";
    ctx.strokeText(label, textX, 0);
    ctx.fillStyle = color;
    ctx.fillText(label, textX, 0);

    if (asset) {
      const s = iconR * 2.2;
      // Crop away the baked-in white ring on both themes; use a colored rim
      const r = s * 0.42;
      ctx.save();
      ctx.beginPath();
      ctx.arc(iconX, 0, r, 0, Math.PI * 2);
      ctx.clip();
      const zoom = 1.22;
      const zs = s * zoom;
      ctx.drawImage(asset, iconX - zs / 2, -zs / 2, zs, zs);
      ctx.restore();

      ctx.beginPath();
      ctx.arc(iconX, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = dark ? 3.2 : 2.8;
      ctx.shadowColor = color;
      ctx.shadowBlur = dark ? 12 : 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(iconX, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.1;
      ctx.stroke();
    } else {
      ctx.font = "14px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText(ring.icon, iconX, 1);
    }
    ctx.restore();
  }

  function drawRingSideWall(radius, thick, dark) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = thick; i >= 1; i--) {
      ctx.beginPath();
      ctx.ellipse(0, i * 0.9, radius, radius, 0, 0, Math.PI * 2);
      ctx.strokeStyle = dark
        ? `rgba(20,28,40,${0.18 * (i / thick)})`
        : `rgba(120,132,148,${0.12 * (i / thick)})`;
      ctx.lineWidth = LW + 2;
      ctx.stroke();
    }
  }

  function draw3DRingTrack(radius, dark, thick) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawRingSideWall(radius, thick, dark);

    ctx.beginPath();
    ctx.arc(0, thick + 4, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = LW + 6;
    ctx.stroke();

    // Light ash pipe layers (no pure white)
    const layers = dark
      ? [
          { o: 0.48, w: 0.22, c: "#2a3648" },
          { o: 0.32, w: 0.28, c: "#344456" },
          { o: 0.12, w: 0.34, c: "#3e5064" },
          { o: 0.0, w: 0.42, c: "#4a5c70" },
          { o: -0.12, w: 0.34, c: "#3e5064" },
          { o: -0.28, w: 0.28, c: "#344456" },
          { o: -0.44, w: 0.2, c: "#2a3648" },
        ]
      : [
          { o: 0.48, w: 0.22, c: "#c8ced6" },
          { o: 0.34, w: 0.3, c: "#d2d7de" },
          { o: 0.18, w: 0.36, c: "#d9dee5" },
          { o: 0.02, w: 0.44, c: "#e0e4ea" },
          { o: -0.12, w: 0.34, c: "#d4dae2" },
          { o: -0.28, w: 0.3, c: "#caced6" },
          { o: -0.44, w: 0.22, c: "#c0c6d0" },
        ];

    layers.forEach((L) => {
      ctx.beginPath();
      ctx.arc(0, 0, radius + L.o * LW, 0, Math.PI * 2);
      ctx.strokeStyle = L.c;
      ctx.lineWidth = Math.max(4, LW * L.w);
      ctx.stroke();
    });

    // Soft light-ash groove
    ctx.beginPath();
    ctx.arc(0, 0, radius - LW * 0.02, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? "rgba(0,0,0,0.22)" : "rgba(150,160,175,0.16)";
    ctx.lineWidth = Math.max(6, LW * 0.22);
    ctx.stroke();
  }

  function drawRing(key) {
    const ring = RINGS[key];
    const sectors = ring.mults.length + 1;
    const filled = visual[key];
    const dark = document.body.classList.contains("theme-dark");
    const sectorAngle = (Math.PI * 2) / sectors;
    const d = DEPTH[key];

    withDepth(key, () => {
      draw3DRingTrack(ring.radius, dark, d.thick);

      for (let i = 0; i < sectors; i++) {
        const a = START + i * sectorAngle;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(cos * (ring.radius - LW / 2 + 4), sin * (ring.radius - LW / 2 + 4));
        ctx.lineTo(cos * (ring.radius + LW / 2 - 4), sin * (ring.radius + LW / 2 - 4));
        ctx.strokeStyle = dark ? "rgba(0,0,0,0.28)" : "rgba(100,115,135,0.28)";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.stroke();
      }

      if (filled > 0.01) {
        const progress = Math.min(filled, sectors);
        const end = START + progress * sectorAngle;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, ring.radius + LW, START, end, false);
        ctx.closePath();
        ctx.clip();

        ctx.beginPath();
        ctx.arc(0, 0, ring.radius, START, end, false);
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = LW - 10;
        ctx.lineCap = "butt";
        ctx.globalAlpha = 0.92;
        ctx.stroke();
        ctx.globalAlpha = 1;

        const grad = ctx.createLinearGradient(
          Math.cos(START) * ring.radius,
          Math.sin(START) * ring.radius,
          Math.cos(end) * ring.radius,
          Math.sin(end) * ring.radius
        );
        grad.addColorStop(0, ring.glow);
        grad.addColorStop(0.35, ring.color);
        grad.addColorStop(1, ring.color);
        ctx.beginPath();
        ctx.arc(0, 0, ring.radius, START, end, false);
        ctx.strokeStyle = grad;
        ctx.lineWidth = LW - 18;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, ring.radius, START, end, false);
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = LW - 6;
        ctx.shadowColor = ring.color;
        ctx.shadowBlur = 16;
        ctx.globalAlpha = 0.35;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      ring.mults.forEach((v, i) => {
        const a = START + (i + 0.5) * sectorAngle;
        const x = Math.cos(a) * ring.radius;
        const y = Math.sin(a) * ring.radius;
        const isActive = filled >= i + 1 && filled < i + 2;
        const isPassed = filled >= i + 1;

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, 1 / d.sy);
        ctx.rotate(a + Math.PI / 2);
        const size = isActive ? 26 : 22;
        ctx.font = `800 ${size}px Poppins, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.shadowBlur = 0;
        const label = `${v}X`;

        if (isActive) {
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(255,255,255,0.75)";
          ctx.strokeText(label, 0, 0);
          ctx.fillStyle = "#121820";
          ctx.fillText(label, 0, 0);
        } else if (isPassed) {
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = "rgba(255,255,255,0.6)";
          ctx.strokeText(label, 0, 0);
          ctx.fillStyle = dark ? "#e8f5e9" : "#1b5e20";
          ctx.fillText(label, 0, 0);
        } else {
          ctx.lineWidth = 2;
          ctx.strokeStyle = dark ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.45)";
          ctx.strokeText(label, 0, 0);
          ctx.fillStyle = dark ? "#c5d0e0" : "#3d4654";
          ctx.fillText(label, 0, 0);
        }
        ctx.restore();
      });
    });
  }

  function drawGreyValley(innerR, outerR, levelInner, levelOuter, dark, shade) {
    const dOut = DEPTH[levelOuter] || DEPTH[levelInner];
    const sy = dOut.sy;
    ctx.save();
    ctx.translate(BASE_CX, BASE_CY);
    ctx.scale(1, sy);
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.arc(0, 0, Math.max(0, innerR), 0, Math.PI * 2, true);
    ctx.fillStyle = dark ? shade.dark : shade.light;
    ctx.fill();
    ctx.restore();
  }

  function drawCenterWell(dark) {
    withDepth("center", (_x, _y, d) => {
      ctx.beginPath();
      ctx.arc(0, d.thick + 3, CENTER_R, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.14)";
      ctx.fill();

      const well = ctx.createRadialGradient(-22, -26, 8, 0, 0, CENTER_R - 2);
      well.addColorStop(0, dark ? "rgba(80,110,150,0.55)" : "rgba(255,255,255,0.98)");
      well.addColorStop(0.45, dark ? "rgba(30,45,65,0.55)" : "rgba(225,232,240,0.7)");
      well.addColorStop(1, dark ? "rgba(10,16,24,0.4)" : "rgba(150,165,185,0.45)");
      ctx.beginPath();
      ctx.arc(0, 0, CENTER_R - 4, 0, Math.PI * 2);
      ctx.fillStyle = well;
      ctx.fill();
    });
  }

  function drawBoard() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const dark = document.body.classList.contains("theme-dark");
    const half = LW / 2;

    drawGreyValley(RINGS.earth.radius + half, RINGS.fire.radius - half, "earth", "fire", dark, {
      light: "#ffffff", dark: "#1a2433",
    });
    drawGreyValley(RINGS.water.radius + half, RINGS.earth.radius - half, "water", "earth", dark, {
      light: "#ffffff", dark: "#152030",
    });
    drawGreyValley(CENTER_R, RINGS.water.radius - half, "center", "water", dark, {
      light: "#ffffff", dark: "#1a2433",
    });

    drawRing("fire");
    drawRing("earth");
    drawRing("water");
    drawCenterWell(dark);

    ["fire", "earth", "water"].forEach((key) => {
      withDepth(key, () => drawBonusBadge(key, RINGS[key]));
    });
  }

  async function animateFillTo(key, target, { turbo = false } = {}) {
    const from = visual[key];
    const frames = turbo ? 8 : 18;
    for (let i = 1; i <= frames; i++) {
      visual[key] = from + (target - from) * (i / frames);
      drawBoard();
      await new Promise((r) => setTimeout(r, turbo ? 7 : 16));
    }
    visual[key] = target;
    drawBoard();
  }

  return {
    drawBoard,
    animateFillTo,
    getVisual: () => ({ ...visual }),
    setVisual: (next) => {
      visual = { ...visual, ...next };
      drawBoard();
    },
  };
}
