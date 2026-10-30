// The notebook world on starhermit:scene, as the browser build's js/render.js
// drew it with three.js r160: the orthographic near-tabletop camera, the ruled
// paper page (fibre bump on High/Ultra), the dashed pencil slot outlines, the
// rounded bevelled number tokens (each with its own material so selection and
// legal-target glows never leak), soft blob shadows when the shadow map is
// off, the grounded selection ring, the path preview line and dots, the
// pooled spark bursts, the drifting dust motes and the desk-lamp shimmer, the
// idle bob, the springs every token rides (critically damped, interruption
// safe), the low camera shake per event tier, the warm key light with PCF
// shadows fitted to the board, the theme-tinted hemisphere fill and the
// room environment's reflections. The board is fitted into the part of the
// window the top bar, rails, HUD pill, lesson banner and tray leave free
// (the old canvas sat between the rails, its HUD over it), so the camera spans
// the window and its frustum is offset to centre the board there.
//
// From three.js r160 (physically based lights): colours as written, the
// punctual lights' intensities ÷ π (the engine takes three's legacy units). r160's composer drew the scene in linear half floats, bloomed it
// (UnrealBloomPass 0.5 / 0.4 / threshold 0.9), tone-mapped it (ACES at 2.3),
// then graded it in display space (GradeShader) and anti-aliased it; the
// runtime's renderer.ao / bloom / grade ("display") / antialias do the same in
// that order. Adaptive resolution, the pixel-ratio cap and the frame-rate
// readout are the runtime's. Rendering never touches the rules state.
import {
  ACESFilmicToneMapping, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, DirectionalLight, DoubleSide,
  ExtrudeGeometry, Group, HemisphereLight, InstancedMesh, Line, LineBasicMaterial, Matrix4, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, OrthographicCamera, PlaneGeometry, PMREMGenerator, Points,
  PointsMaterial, Raycaster, RepeatWrapping, RingGeometry, RoomEnvironment, SRGBColorSpace, Shape, Vector3, pointerToNdc,
  renderer, scene, type Texture,
} from "starhermit:scene";
import { files } from "starhermit:engine";
import { FontFace, OffscreenCanvas, fonts, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { Content, type Check, type GameEvent, type State, type Theme } from "./game.ts";
import { MOTE_MAX, moteCount, sparkCap, type Look } from "./quality.ts";

/** render.js FRAMING: authored framing constants. */
export const FRAMING = {
  cellSize: 1.0, tokenHeight: 0.22, tokenScale: 0.86, cameraTilt: 0.62, cameraDistance: 14,
  marginX: 0.8, marginY: 1.0, shakeAmplitude: 0.05,
};
/** render.js LIGHT: authored low and lifted by exposure so the lit page stays below the bloom threshold. */
// From engine.minor 23 punctual lights follow three r155+, so the r160 intensities are used as the page set them.
const LIGHT = { exposure: 2.3, key: 0.77, hemi: 0.23, env: 0.14 };
const UNLIT = 1 / LIGHT.exposure;

// ---------------------------------------------------------------- the fixed parts
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const raycaster = new Raycaster();
const keyLight = new DirectionalLight(0xfff4e6, LIGHT.key);
keyLight.position.set(4, 10, 5);
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
keyLight.shadow.radius = 3;
const fill = new HemisphereLight(0xfff6e0, 0x8a87a0, LIGHT.hemi);
scene.add(keyLight, keyLight.target, fill);
const tokenGroup = new Group();
scene.add(tokenGroup);

let look: Look | null = null;
let theme: Theme = Content.THEMES[0]!;
/** Colour-vision palette (Settings › Color palette): the selection, legal-target and hint colours. */
let palette = "default";
let reducedMotion = false;
let state: State | null = null;
let selection: number | null = null;
let legalTargets: number[] = [];
let animTime = 0;
let shake = 0;

/** Settings › Color palette: colour-safe selection / legal-target pairs (blue–orange). */
const PALETTE_COLORS: Record<string, { select: string; legal: string }> = {
  deuteranopia: { select: "#0072b2", legal: "#e69f00" },
  protanopia: { select: "#0072b2", legal: "#e69f00" },
  tritanopia: { select: "#d55e00", legal: "#009e73" },
};
const selectColor = (): string => PALETTE_COLORS[palette]?.select ?? theme.select;
const legalColor = (): string => PALETTE_COLORS[palette]?.legal ?? theme.legal;

// ---------------------------------------------------------------- procedural textures (render.js, unchanged drawing)
// The digits' bold serif: the generic serif draws as sans-serif on the web runtime's canvases (reported), so
// the package carries Liberation Serif Bold (SIL OFL 1.1, assets/fonts/), metric-compatible with Times New Roman.
let digitFont = "serif";
const FONT_PATH = "assets/fonts/LiberationSerif-Bold.ttf";
files.fetch(FONT_PATH).then(() => {
  const face = new FontFace("Pair Serif", FONT_PATH, { weight: "700" });
  fonts.add(face);
  return face.load();
}).then(() => {
  digitFont = "'Pair Serif', serif";
  if (look) { rebuildDigitTextures(); for (const v of tokens.values()) v.mat.map = digitTextures[v.digit] ?? null; }
}, (e: unknown) => console.warn(`font: ${e instanceof Error ? e.message : String(e)}`));
type Ctx = OffscreenCanvasRenderingContext2D;
function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function canvasTexture(cv: OffscreenCanvas, srgb = true): CanvasTexture {
  const t = new CanvasTexture(cv);
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}
/** makeDigitTexture: authored on a 256 px grid, drawn at the budget's size. */
function makeDigitTexture(digit: number, size: number): Texture {
  const S = 256;
  const cv = new OffscreenCanvas(size, size);
  const g = cv.getContext("2d")!;
  g.scale(size / S, size / S);
  g.fillStyle = theme.tokenEdge;
  g.fillRect(0, 0, S, S);
  const pad = 12;
  g.fillStyle = theme.token;
  roundRect(g, pad, pad, S - pad * 2, S - pad * 2, 30);
  g.fill();
  const grad = g.createLinearGradient(0, pad, 0, S - pad);
  grad.addColorStop(0, "rgba(255,255,255,0.32)");
  grad.addColorStop(0.55, "rgba(255,255,255,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.08)");
  g.fillStyle = grad;
  roundRect(g, pad, pad, S - pad * 2, S - pad * 2, 30);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "rgba(0,0,0,0.10)";
  roundRect(g, 34, 36, S - 68, S - 68, 22);
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.45)";
  roundRect(g, 34, 34, S - 68, S - 68, 22);
  g.stroke();
  g.font = `700 ${S * 0.54}px ${digitFont}`; // render.js: Georgia, 'Times New Roman', serif
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillText(String(digit), S / 2, S / 2 + S * 0.03 + 2);
  g.fillStyle = theme.ink;
  g.fillText(String(digit), S / 2, S / 2 + S * 0.03);
  const t = canvasTexture(cv);
  t.anisotropy = 4;
  return t;
}
/** makeSpriteTexture: the soft round sprite of sparks, motes and blob shadows. */
const spriteTex = ((): Texture => {
  const S = 64, cv = new OffscreenCanvas(S, S), g = cv.getContext("2d")!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.8)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return canvasTexture(cv);
})();
/** makeSlotTexture: the faint dashed pencil outline of every cell slot. */
function makeSlotTexture(): Texture {
  const S = 128, cv = new OffscreenCanvas(S, S), g = cv.getContext("2d")!;
  g.strokeStyle = theme.rule;
  g.globalAlpha = 0.75;
  g.lineWidth = 4;
  g.setLineDash([10, 7]);
  roundRect(g, 10, 10, S - 20, S - 20, 16);
  g.stroke();
  return canvasTexture(cv);
}
/** makeGrainTexture: the seeded paper-fibre height field (bump map). */
let grainTex: Texture | null = null;
function makeGrainTexture(): Texture {
  const S = 256, cv = new OffscreenCanvas(S, S), g = cv.getContext("2d")!;
  const img = g.createImageData(S, S);
  let s = 424242;
  for (let i = 0; i < S * S; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = 118 + (s % 21);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = "rgba(160,160,160,0.5)";
  g.lineWidth = 1;
  for (let k = 0; k < 60; k++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const x = s % S; s = (s * 1103515245 + 12345) & 0x7fffffff;
    const y = s % S; s = (s * 1103515245 + 12345) & 0x7fffffff;
    const a = (s % 628) / 100;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); g.stroke();
  }
  const t = canvasTexture(cv, false);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(14, 14);
  return t;
}
/** makePaperTexture: authored on a 1024 px grid, drawn at the budget's size. */
function makePaperTexture(size: number): Texture {
  const S = 1024, cv = new OffscreenCanvas(size, size), g = cv.getContext("2d")!;
  g.scale(size / S, size / S);
  g.fillStyle = theme.paper;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = theme.rule;
  g.globalAlpha = 0.55;
  g.lineWidth = 2;
  for (let y = 64; y < S; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  g.globalAlpha = 0.7;
  g.strokeStyle = theme.margin;
  g.beginPath(); g.moveTo(96, 0); g.lineTo(96, S); g.stroke();
  g.globalAlpha = 1;
  let s = 1234567;
  for (let i = 0; i < 900; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const x = s % S;
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const y = s % S;
    g.fillStyle = `rgba(0,0,0,${0.015 + (s % 10) / 2000})`;
    g.fillRect(x, y, 2, 2);
  }
  const t = canvasTexture(cv);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

// ---------------------------------------------------------------- the token geometry
/** BufferGeometryUtils.mergeVertices: welds vertices with the same position and uv (index rebuilt). */
function weld(geo: BufferGeometry, tol = 1e-4): BufferGeometry {
  const pos = geo.getAttribute("position")!, uv = geo.getAttribute("uv")!;
  const idx = geo.index;
  const count = idx ? idx.count : pos.count;
  const map = new Map<string, number>();
  const outPos: number[] = [], outUv: number[] = [], outIdx: number[] = [];
  const q = (v: number): number => Math.round(v / tol);
  for (let k = 0; k < count; k++) {
    const i = idx ? idx.getX(k) : k;
    const key = `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))},${q(uv.getX(i))},${q(uv.getY(i))}`;
    let n = map.get(key);
    if (n === undefined) {
      n = outPos.length / 3;
      map.set(key, n);
      outPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      outUv.push(uv.getX(i), uv.getY(i));
    }
    outIdx.push(n);
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(new Float32Array(outPos), 3));
  out.setAttribute("uv", new BufferAttribute(new Float32Array(outUv), 2));
  out.setIndex(outIdx);
  out.computeVertexNormals();
  return out;
}
/** makeTokenGeometry: the rounded bevelled token; the top cap's UVs span the digit texture, the sides sample its outer band. */
function makeTokenGeometry(detailed: boolean, curve: number, bevelSegs: number): BufferGeometry {
  const t = FRAMING.tokenScale * FRAMING.cellSize;
  const bevel = detailed ? 0.045 : 0.03;
  const inner = t / 2 - bevel;
  const r = detailed ? 0.1 : 0.06;
  const shape = new Shape();
  shape.moveTo(-inner + r, -inner);
  shape.lineTo(inner - r, -inner);
  shape.quadraticCurveTo(inner, -inner, inner, -inner + r);
  shape.lineTo(inner, inner - r);
  shape.quadraticCurveTo(inner, inner, inner - r, inner);
  shape.lineTo(-inner + r, inner);
  shape.quadraticCurveTo(-inner, inner, -inner, inner - r);
  shape.lineTo(-inner, -inner + r);
  shape.quadraticCurveTo(-inner, -inner, -inner + r, -inner);
  const depth = Math.max(0.02, FRAMING.tokenHeight - bevel * 2);
  const geo = new ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: detailed ? bevelSegs : 1, curveSegments: detailed ? curve : 2,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -depth / 2, 0);
  const pos = geo.getAttribute("position")!, uv = geo.getAttribute("uv")!;
  const g0 = geo.groups[0];
  const capEnd = g0 ? g0.start + g0.count : 0;
  const index = geo.index;
  const capVerts = new Set<number>();
  for (let i = 0; i < capEnd; i++) capVerts.add(index ? index.getX(i) : i);
  for (let i = 0; i < pos.count; i++) {
    if (capVerts.has(i)) uv.setXY(i, (pos.getX(i) + t / 2) / t, (t / 2 - pos.getZ(i)) / t);
    else uv.setXY(i, 0.018, 0.5);
  }
  uv.needsUpdate = true;
  const welded = weld(geo);
  geo.dispose();
  return welded;
}

// ---------------------------------------------------------------- the page, slots, blobs, markers
let envTex: Texture | null = null;
function envMap(): Texture | null {
  if (!envTex) {
    try { const pageRoom = new RoomEnvironment(renderer); pageRoom.position.y = 0; /* the page's three r160 (pre-r183) builds the room at the origin */ envTex = new PMREMGenerator(renderer).fromScene(pageRoom, 0.04).texture; }
    catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return envTex;
}
let paper: Mesh | null = null;
let paperTex: Texture | null = null;
let slots: InstancedMesh | null = null;
let slotKey = "";
const blobs = new InstancedMesh(new PlaneGeometry(1.05, 1.05),
  new MeshBasicMaterial({ map: spriteTex, color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }), 512);
blobs.count = 0;
blobs.frustumCulled = false;
scene.add(blobs);

/** buildEnvironment: the page (Lambert on Low; the fibre bump where the budget allows), the background and the fill's tint. */
function buildEnvironment(): void {
  if (paper) { scene.remove(paper); paper.geometry.dispose(); (paper.material as MeshStandardMaterial).dispose(); }
  paperTex?.dispose();
  paperTex = makePaperTexture(look!.budget.paper);
  if (look!.detailed && look!.budget.paperBump && !grainTex) grainTex = makeGrainTexture();
  const mat = look!.budget.material === "lambert"
    ? new MeshLambertMaterial({ map: paperTex })
    : new MeshStandardMaterial({
      map: paperTex, roughness: 0.95, metalness: 0, envMap: envMap(), envMapIntensity: LIGHT.env,
      ...(look!.detailed && look!.budget.paperBump && grainTex ? { bumpMap: grainTex, bumpScale: 0.6 } : {}),
    });
  paper = new Mesh(new PlaneGeometry(60, 60), mat);
  paper.rotation.x = -Math.PI / 2;
  paper.position.y = -FRAMING.tokenHeight / 2 - 0.01;
  paper.receiveShadow = true;
  scene.add(paper);
  scene.background = new Color(theme.sky);
  fill.color.set(theme.paper);
  fill.groundColor.set(theme.rule);
  buildSlots();
}
function buildSlots(): void {
  if (slots) {
    scene.remove(slots);
    const m = slots.material as MeshStandardMaterial;
    m.map?.dispose();
    m.dispose();
    slots.geometry.dispose();
  }
  slots = new InstancedMesh(new PlaneGeometry(0.94, 0.94), new MeshStandardMaterial({
    map: makeSlotTexture(), transparent: true, depthWrite: false, roughness: 1, metalness: 0, envMap: envMap(), envMapIntensity: LIGHT.env,
  }), 512);
  slots.count = 0;
  slots.receiveShadow = true;
  slots.visible = look!.detailed;
  slotKey = "";
  scene.add(slots);
  updateSlots();
}
function updateSlots(): void {
  if (!slots || !state) return;
  const k = `${state.cols}:${state.cells.length}`;
  if (k === slotKey) return;
  slotKey = k;
  const m = new Matrix4();
  const n = Math.min(512, state.cells.length);
  for (let i = 0; i < n; i++) {
    const p = cellToWorld(i);
    m.makeRotationX(-Math.PI / 2);
    m.setPosition(p.x, -FRAMING.tokenHeight / 2 - 0.006, p.z);
    slots.setMatrixAt(i, m);
  }
  slots.count = n;
  slots.instanceMatrix.needsUpdate = true;
}

const ringGeo = new RingGeometry(0.42, 0.52, 40);
const ring = new Mesh(ringGeo, new MeshBasicMaterial({ color: new Color(theme.select), transparent: true, opacity: 0.9, side: DoubleSide }));
ring.rotation.x = -Math.PI / 2;
ring.visible = false;
scene.add(ring);
const pathGeo = new BufferGeometry();
pathGeo.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
const pathLine = new Line(pathGeo, new LineBasicMaterial({ color: new Color(theme.legal), transparent: true, opacity: 0.85 }));
pathLine.visible = false;
scene.add(pathLine);
const pathDots = new InstancedMesh(new CircleGeometry(0.09, 16),
  new MeshBasicMaterial({ color: new Color(theme.legal), transparent: true, opacity: 0.6, side: DoubleSide }), 128);
pathDots.count = 0;
scene.add(pathDots);

/** applyMarkerColors: unlit markers in display terms (÷ exposure); pushed above 1 with bloom so only they glow. */
function applyMarkerColors(): void {
  const bloom = !!look?.bloom;
  (ring.material as MeshBasicMaterial).color.set(selectColor()).multiplyScalar(UNLIT * (bloom ? 1.6 : 1));
  (pathLine.material as LineBasicMaterial).color.set(legalColor()).multiplyScalar(UNLIT);
  (pathDots.material as MeshBasicMaterial).color.set(legalColor()).multiplyScalar(UNLIT);
  if (points) points.material.color.set(theme.accent).multiplyScalar(bloom ? 3 : UNLIT);
}

// ---------------------------------------------------------------- particles and motes
let points: Points | null = null;
let particleCap = 0, particleAlive = 0;
let particleData = new Float32Array(0);
function buildParticles(): void {
  const cap = sparkCap(look!);
  if (points && cap === particleCap) return;
  if (points) { points.geometry.dispose(); points.material.dispose(); scene.remove(points); }
  particleCap = cap;
  particleData = new Float32Array(cap * 8); // x, y, z, vx, vy, vz, life, size
  particleAlive = 0;
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(cap * 3), 3));
  geo.setDrawRange(0, 0);
  points = new Points(geo, new PointsMaterial({
    color: new Color(theme.accent), size: look!.particles === "high" ? 11 : 8, map: spriteTex, transparent: true, opacity: 0.95,
    sizeAttenuation: true, depthWrite: false,
  }));
  points.frustumCulled = false;
  scene.add(points);
  applyMarkerColors();
}
function spawnBurst(x: number, y: number, z: number, n: number): void {
  if (reducedMotion || !points) return;
  if (look!.particles === "high") n = Math.round(n * 1.6);
  const d = particleData;
  for (let k = 0; k < n && particleAlive < particleCap; k++) {
    const i = particleAlive++;
    const a = Math.random() * Math.PI * 2;
    const sp = 1 + Math.random() * 2;
    d[i * 8] = x; d[i * 8 + 1] = y + 0.15; d[i * 8 + 2] = z;
    d[i * 8 + 3] = Math.cos(a) * sp; d[i * 8 + 4] = 1.5 + Math.random() * 2; d[i * 8 + 5] = Math.sin(a) * sp;
    d[i * 8 + 6] = 0.6 + Math.random() * 0.4; d[i * 8 + 7] = 1;
  }
}
function updateParticles(dt: number): void {
  if (!points || !particleAlive) return;
  const d = particleData;
  const pos = points.geometry.getAttribute("position")!;
  let alive = particleAlive;
  for (let i = 0; i < alive; i++) {
    d[i * 8 + 6]! -= dt;
    if (d[i * 8 + 6]! <= 0) {
      alive--;
      for (let k = 0; k < 8; k++) d[i * 8 + k] = d[alive * 8 + k]!;
      i--;
      continue;
    }
    d[i * 8 + 4]! -= 6 * dt;
    d[i * 8]! += d[i * 8 + 3]! * dt;
    d[i * 8 + 1]! += d[i * 8 + 4]! * dt;
    d[i * 8 + 2]! += d[i * 8 + 5]! * dt;
    pos.setXYZ(i, d[i * 8]!, d[i * 8 + 1]!, d[i * 8 + 2]!);
  }
  particleAlive = alive;
  points.geometry.setDrawRange(0, alive);
  pos.needsUpdate = true;
}
const moteSeed = new Float32Array(MOTE_MAX * 4);
{
  let s = 97531;
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < MOTE_MAX; i++) {
    moteSeed[i * 4] = (rnd() - 0.5) * 16;
    moteSeed[i * 4 + 1] = 0.4 + rnd() * 2.6;
    moteSeed[i * 4 + 2] = (rnd() - 0.5) * 14;
    moteSeed[i * 4 + 3] = rnd() * Math.PI * 2;
  }
}
const moteGeo = new BufferGeometry();
moteGeo.setAttribute("position", new BufferAttribute(new Float32Array(MOTE_MAX * 3), 3));
const motes = new Points(moteGeo, new PointsMaterial({
  color: new Color(0xfff3d6).multiplyScalar(UNLIT * 1.2), size: 3, map: spriteTex, transparent: true, opacity: 0.28,
  sizeAttenuation: true, depthWrite: false,
}));
motes.frustumCulled = false;
motes.visible = false;
scene.add(motes);
const ambientOn = (): boolean => !!look?.ambient && !reducedMotion;
/** updateMotes + updateAmbient: drifting motes, the lamp shimmer and drift; frozen by reduced motion. */
function updateAmbient(): void {
  const on = ambientOn();
  const t = animTime;
  keyLight.intensity = LIGHT.key * (on ? 1 + 0.025 * Math.sin(t * 0.7) + 0.012 * Math.sin(t * 1.9) : 1);
  keyLight.position.x = 4 + (on ? Math.sin(t * 0.13) * 0.35 : 0);
  motes.visible = on;
  if (!on) return;
  const n = Math.min(MOTE_MAX, moteCount(look!));
  const pos = moteGeo.getAttribute("position")!;
  for (let i = 0; i < n; i++) {
    const ph = moteSeed[i * 4 + 3]!;
    pos.setXYZ(i, moteSeed[i * 4]! + Math.sin(t * 0.11 + ph) * 1.2, moteSeed[i * 4 + 1]! + Math.sin(t * 0.23 + ph * 1.7) * 0.35, moteSeed[i * 4 + 2]! + Math.cos(t * 0.09 + ph) * 1.0);
  }
  moteGeo.setDrawRange(0, n);
  pos.needsUpdate = true;
}

// ---------------------------------------------------------------- tokens
interface View {
  mesh: Mesh; mat: MeshStandardMaterial | MeshLambertMaterial; digit: number; target: Vector3; vel: Vector3;
  scale: number; scaleV: number; targetScale: number; dying: boolean; liftTarget: number; emissiveTarget: number; pulse: number; phase: number;
}
const tokens = new Map<number, View>();
let tokenGeo: BufferGeometry | null = null;
let digitTextures: (Texture | null)[] = [null];
let builtKey = "";

function rebuildDigitTextures(): void {
  for (const t of digitTextures) t?.dispose();
  digitTextures = [null];
  for (let d = 1; d <= 9; d++) digitTextures.push(makeDigitTexture(d, look!.budget.digit));
}
/** makeTokenMaterial: Lambert on Low, Standard on Balanced, clear-coated Physical on High/Ultra (Detailed). */
function makeTokenMaterial(digit: number): MeshStandardMaterial | MeshLambertMaterial {
  const map = digitTextures[digit] ?? digitTextures[1]!;
  const emissive = new Color(selectColor());
  const tier = look!.budget.material;
  if (tier === "lambert") return new MeshLambertMaterial({ map, emissive, emissiveIntensity: 0 });
  const common = { map, metalness: 0, envMap: envMap(), envMapIntensity: LIGHT.env, emissive, emissiveIntensity: 0 };
  return look!.detailed && tier === "physical"
    ? new MeshPhysicalMaterial({ ...common, roughness: 0.48, clearcoat: 0.65, clearcoatRoughness: 0.28 })
    : new MeshStandardMaterial({ ...common, roughness: 0.55, metalness: 0.05 });
}
export function cellToWorld(index: number): Vector3 {
  const cols = state?.cols || 9;
  const rows = Math.max(1, Math.ceil((state?.cells.length || cols) / cols));
  const r = Math.floor(index / cols), c = index % cols;
  const w = cols * FRAMING.cellSize, h = rows * FRAMING.cellSize;
  return new Vector3(c * FRAMING.cellSize - w / 2 + FRAMING.cellSize / 2, 0, r * FRAMING.cellSize - h / 2 + FRAMING.cellSize / 2);
}
function spawnToken(index: number, digit: number): View {
  const mat = makeTokenMaterial(digit);
  const mesh = new Mesh(tokenGeo!, mat);
  mesh.castShadow = look!.shadows > 0;
  mesh.userData.cell = index;
  const pos = cellToWorld(index);
  mesh.position.copy(pos);
  tokenGroup.add(mesh);
  const view: View = {
    mesh, mat, digit, target: pos.clone(), vel: new Vector3(), scale: 1, scaleV: 0, targetScale: 1, dying: false,
    liftTarget: 0, emissiveTarget: 0, pulse: 0, phase: index * 0.73,
  };
  tokens.set(index, view);
  return view;
}
function killToken(view: View): void {
  view.dying = true;
  view.targetScale = 0.01;
  view.target = view.mesh.position.clone();
  view.target.y = 1.4;
  spawnBurst(view.mesh.position.x, view.mesh.position.y, view.mesh.position.z, 10);
}
function releaseToken(index: number): void {
  const view = tokens.get(index);
  if (!view) return;
  tokenGroup.remove(view.mesh);
  view.mat.dispose();
  tokens.delete(index);
}
/** Removes every token (back to the title). */
export function clearBoard(): void {
  for (const i of [...tokens.keys()]) releaseToken(i);
  state = null;
  selection = null;
  legalTargets = [];
  ring.visible = false;
  previewPath(null);
  if (slots) slots.count = 0;
  slotKey = "";
  blobs.count = 0;
}

/** syncState: views follow an immutable snapshot; new tokens of added rows slide in from below the board. */
export function syncState(next: State, sel: number | null, targets: number[], force = false): void {
  const prevCells = state?.cells;
  state = next;
  selection = sel;
  legalTargets = targets;
  frameKey = "";
  if (!look) return;
  const seen = new Set<number>();
  for (let i = 0; i < next.cells.length; i++) {
    const digit = next.cells[i]!;
    if (digit === 0) continue;
    seen.add(i);
    let view = tokens.get(i);
    if (!view) {
      view = spawnToken(i, digit);
      if (prevCells && !reducedMotion && !force) {
        const t = cellToWorld(i);
        view.mesh.position.set(t.x, -1.2, t.z + 2);
      }
    } else {
      // A refilled slot (undo) revives a token still playing its pop-out, so the cell stays tappable at once.
      if (view.dying) { view.dying = false; view.targetScale = 1; }
      if (view.digit !== digit) { view.digit = digit; view.mat.map = digitTextures[digit] ?? null; }
    }
    view.target = cellToWorld(i);
    view.target.y = 0;
  }
  for (const [i, view] of tokens) {
    if (!seen.has(i) && !view.dying) {
      if (force || reducedMotion) releaseToken(i);
      else killToken(view);
    }
  }
  updateSlots();
  updateHighlights();
}
/** setSelection: the selected cell (lift, rim and ring) and its legal targets (soft legal tint and a small lift). */
export function setSelection(sel: number | null, targets: number[]): void {
  selection = sel;
  legalTargets = targets;
  updateHighlights();
}
function updateHighlights(): void {
  const legal = new Set(legalTargets);
  for (const [i, view] of tokens) {
    const isSel = i === selection, isLegal = legal.has(i);
    view.liftTarget = isSel ? 0.32 : isLegal ? 0.12 : 0;
    if (isSel) { view.mat.emissive.set(selectColor()); view.emissiveTarget = 0.32; }
    else if (isLegal) { view.mat.emissive.set(legalColor()); view.emissiveTarget = 0.22; }
    else view.emissiveTarget = 0;
  }
}
/** setHint: the hinted pair pulses for 1.2 s. */
export function setHint(a: number | null, b: number | null): void {
  if (a == null || b == null) return;
  for (const idx of [a, b]) {
    const v = tokens.get(idx);
    if (v) { v.pulse = 1.2; v.mat.emissive.set(selectColor()); }
  }
}
/** previewPath: a would-be connection from the selection (hover / cursor), or null to clear. */
export function previewPath(check: Check | null): void {
  if (!check || !check.ok || selection == null || check.a == null || check.b == null) {
    pathLine.visible = false;
    pathDots.count = 0;
    return;
  }
  const a = cellToWorld(selection), b = cellToWorld(selection === check.a ? check.b : check.a);
  const arr = pathGeo.getAttribute("position")!;
  arr.setXYZ(0, a.x, 0.12, a.z);
  arr.setXYZ(1, b.x, 0.12, b.z);
  arr.needsUpdate = true;
  pathLine.visible = true;
  const m = new Matrix4();
  let n = 0;
  for (const idx of check.path ?? []) {
    if (n >= 128) break;
    const p = cellToWorld(idx);
    m.makeRotationX(-Math.PI / 2);
    m.setPosition(p.x, 0.02, p.z);
    pathDots.setMatrixAt(n++, m);
  }
  pathDots.count = n;
  pathDots.instanceMatrix.needsUpdate = true;
}
function shakeCamera(strength: number): void {
  if (reducedMotion) return;
  shake = Math.max(shake, Math.min(1, strength) * FRAMING.shakeAmplitude);
}
/** onGameEvent: bursts and shakes by event tier (input < legal move < combo < round completion). */
export function onGameEvent(e: GameEvent): void {
  if (e.type === "clear" && e.a != null) {
    const p = cellToWorld(e.a);
    spawnBurst(p.x, p.y, p.z, (e.chain ?? 1) >= 3 ? 26 : 12);
    if ((e.chain ?? 1) >= 4) shakeCamera(0.5);
  } else if (e.type === "collapse") shakeCamera(0.3);
  else if (e.type === "invalid") shakeCamera(0.25);
  else if (e.type === "win") {
    for (let i = 0; i < 5; i++) spawnBurst((Math.random() - 0.5) * 4, 0.5, (Math.random() - 0.5) * 4, 30);
    shakeCamera(0.6);
  }
}

/** Critically damped spring (render.js spring). */
function spring(current: number, target: number, velocity: number, smoothTime: number, dt: number): [number, number] {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * dt;
  return [target + (change + temp) * exp, (velocity - omega * temp) * exp];
}
const bm = new Matrix4();
function updateTokens(dt: number): void {
  const smooth = reducedMotion ? 0.02 : 0.14;
  const bob = ambientOn();
  const useBlobs = !look || look.shadows === 0;
  let nb = 0;
  for (const [i, view] of tokens) {
    const m = view.mesh;
    const idle = bob && !view.dying ? 0.012 * Math.sin(animTime * 1.7 + view.phase) : 0;
    const ty = view.target.y + view.liftTarget + idle;
    let v: number;
    [m.position.x, v] = spring(m.position.x, view.target.x, view.vel.x, smooth, dt); view.vel.x = v;
    [m.position.y, v] = spring(m.position.y, ty, view.vel.y, smooth, dt); view.vel.y = v;
    [m.position.z, v] = spring(m.position.z, view.target.z, view.vel.z, smooth, dt); view.vel.z = v;
    [view.scale, view.scaleV] = spring(view.scale, view.targetScale, view.scaleV, smooth, dt);
    m.scale.setScalar(Math.max(0.01, view.scale));
    const targetE = view.pulse > 0 ? 0.35 + 0.3 * Math.sin(animTime * 10) : view.emissiveTarget;
    view.mat.emissiveIntensity += (targetE * UNLIT - view.mat.emissiveIntensity) * Math.min(1, dt * 12);
    if (view.pulse > 0) {
      view.pulse -= dt;
      if (view.pulse <= 0) { view.mat.emissive.set(selectColor()); updateHighlights(); }
    }
    if (useBlobs && nb < 512) {
      const k = Math.max(0.01, view.scale) * (1 - Math.min(0.35, m.position.y * 0.8));
      bm.makeRotationX(-Math.PI / 2);
      bm.scale(new Vector3(k, k, 1));
      bm.setPosition(m.position.x + 0.05, -FRAMING.tokenHeight / 2 - 0.004, m.position.z + 0.06);
      blobs.setMatrixAt(nb++, bm);
    }
    if (view.dying && view.scale < 0.05) releaseToken(i);
  }
  blobs.count = nb;
  blobs.visible = useBlobs;
  if (nb) blobs.instanceMatrix.needsUpdate = true;
  if (selection != null && tokens.has(selection)) {
    const p = tokens.get(selection)!.mesh.position;
    ring.position.set(p.x, -FRAMING.tokenHeight / 2 + 0.005, p.z);
    ring.visible = true;
    ring.scale.setScalar(reducedMotion ? 1 : 1 + 0.06 * Math.sin(animTime * 5));
  } else ring.visible = false;
}

// ---------------------------------------------------------------- camera
export interface Rect { x: number; y: number; width: number; height: number }
let win = { w: 1, h: 1 };
let free: Rect = { x: 0, y: 0, width: 1, height: 1 };
let frameKey = "";
/** fitCamera: the board (plus margins) fitted into the free part of the window; the ortho frustum is offset to centre it there. */
function fitCamera(): void {
  const cols = state?.cols || 9;
  const rows = Math.max(3, Math.ceil((state?.cells.length || cols * 4) / cols));
  const halfW = (cols * FRAMING.cellSize) / 2 + FRAMING.marginX;
  const halfH = (rows * FRAMING.cellSize) / 2 + FRAMING.marginY;
  const W = win.w, H = win.h, aspect = W / H;
  const ins = { l: free.x / W, t: free.y / H, r: 1 - (free.x + free.width) / W, b: 1 - (free.y + free.height) / H };
  const freeW = Math.max(0.2, 1 - ins.l - ins.r), freeH = Math.max(0.2, 1 - ins.t - ins.b);
  let vw = halfW / freeW;
  let vh = vw / aspect;
  if (vh * freeH < halfH) { vh = halfH / freeH; vw = vh * aspect; }
  // render.js offset the frustum by (l − r, b − t), which moved the board away from the free area's centre (a
  // sign slip, barely visible with its small insets); the frustum is offset the other way so the board is centred there.
  const cx = (ins.r - ins.l) * vw, cy = (ins.t - ins.b) * vh;
  camera.left = -vw + cx;
  camera.right = vw + cx;
  camera.top = vh + cy;
  camera.bottom = -vh + cy;
  baseCamera();
  camera.updateProjectionMatrix();
  // Shadow frustum fitted tightly around the board (plus lift headroom), as render.js did.
  const sc = keyLight.shadow.camera as OrthographicCamera;
  const ext = Math.max(halfW, halfH) + 0.6;
  if (sc.right !== ext) {
    Object.assign(sc, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 30 });
    sc.updateProjectionMatrix();
  }
}
function baseCamera(): void {
  const tilt = FRAMING.cameraTilt, d = FRAMING.cameraDistance;
  camera.position.set(0, Math.cos(tilt) * d, Math.sin(tilt) * d);
  camera.lookAt(0, 0, 0.4);
}
/** The camera reset key: the authored framing again (shake settled). */
export function resetCamera(): void { shake = 0; frameKey = ""; }
function updateShake(dt: number): void {
  const tilt = FRAMING.cameraTilt, d = FRAMING.cameraDistance;
  const baseY = Math.cos(tilt) * d, baseZ = Math.sin(tilt) * d;
  if (shake > 0.001) {
    const t = animTime * 60;
    camera.position.set(Math.sin(t * 1.3) * shake, baseY + Math.cos(t * 1.7) * shake * 0.4, baseZ);
    camera.lookAt(0, 0, 0.4);
    shake *= Math.exp(-6 * dt);
  } else if (camera.position.x !== 0 || camera.position.y !== baseY) {
    shake = 0;
    baseCamera();
  }
}

// ---------------------------------------------------------------- picking and screen rectangles
/** pickCell: window pixels → the cell of the token under them (dying tokens excluded). */
export function pickCell(x: number, y: number): number | null {
  if (!renderer.camera || !state) return null;
  raycaster.setFromCamera(pointerToNdc(x, y), camera);
  const hits = raycaster.intersectObjects(tokenGroup.children, false);
  for (const h of hits) {
    const view = tokens.get(h.object.userData.cell as number);
    if (view && !view.dying) return h.object.userData.cell as number;
  }
  return null;
}
function toScreen(x: number, y: number, z: number): { x: number; y: number } {
  const v = new Vector3(x, y, z).project(camera);
  return { x: ((v.x + 1) / 2) * win.w, y: ((1 - v.y) / 2) * win.h };
}
/** A cell's token footprint in window pixels (its top face; for named targets and the keyboard cursor). */
export function cellRect(index: number): Rect | null {
  if (!renderer.camera || !state) return null;
  const p = cellToWorld(index);
  const h = (FRAMING.tokenScale * FRAMING.cellSize) / 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [dx, dy, dz] of [[-h, 0.11, -h], [h, 0.11, -h], [h, 0.11, h], [-h, 0.11, h], [-h, -0.11, h], [h, -0.11, h]] as const) {
    const s = toScreen(p.x + dx, dy, p.z + dz);
    x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ---------------------------------------------------------------- the look, theme, palette
function rebuildAll(): void {
  rebuildDigitTextures();
  const old = tokenGeo;
  tokenGeo = makeTokenGeometry(look!.detailed, look!.budget.curve, look!.budget.bevel);
  for (const view of tokens.values()) {
    const em = view.mat.emissive.clone(), ei = view.mat.emissiveIntensity;
    view.mat.dispose();
    view.mat = makeTokenMaterial(view.digit);
    view.mat.emissive.copy(em);
    view.mat.emissiveIntensity = ei;
    view.mesh.geometry = tokenGeo;
    view.mesh.material = view.mat;
    view.mesh.castShadow = look!.shadows > 0;
  }
  old?.dispose();
  buildEnvironment();
  buildParticles();
  applyMarkerColors();
  updateHighlights();
}
/** setGraphics: the runtime's quality tier applied live (no reload). */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  look = next;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = LIGHT.exposure;
  renderer.shadowMap.enabled = next.shadows > 0;
  keyLight.castShadow = next.shadows > 0;
  if (next.shadows > 0) keyLight.shadow.mapSize = next.shadows;
  // UnrealBloomPass(0.5, 0.4, 0.9) on r160's linear composer target (before the tone mapping, as here).
  // three r160 page: bloom model "r160" with the page's strength 0.5 (engine.minor 30).
  renderer.bloom = next.bloom ? { model: "r160", strength: 0.5, radius: 0.4, threshold: 0.9, resolution: next.budget.bloomRes } : null;
  // GTAOPass: radius 0.45, distance exponent 1.6, thickness 1.2; 16 / 8 samples and the denoise per tier.
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: next.ao === "high" ? 0.85 : 0.7, radius: 0.45, distanceExponent: 1.6, thickness: 1.2, scale: 1,
    samples: next.ao === "high" ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // GradeShader after the OutputPass (display space): an 0.18 S-curve, +7 % saturation, cool shadows / warm
  // highlights by a smoothstep of luma from 0.2 to 0.85, a 0.16 vignette from 0.38 to 0.85.
  renderer.grade = next.grade ? {
    space: "display", contrastCurve: "s", contrast: 0.18, saturation: 1.07, split: [0.2, 0.85], shadows: [0.97, 0.985, 1.04], highlights: [1.025, 1.0, 0.97],
    vignette: { amount: 0.16, inner: 0.38, outer: 0.85, scale: [1, 0.9] },
  } : null;
  renderer.antialias = next.antialias;
  const k = `${next.detailed}|${next.budget.material}|${next.budget.digit}|${next.budget.paper}|${next.budget.curve}|${next.budget.bevel}|${next.budget.paperBump}`;
  if (k !== builtKey) { builtKey = k; rebuildAll(); }
  else { buildParticles(); applyMarkerColors(); for (const v of tokens.values()) v.mesh.castShadow = next.shadows > 0; }
  if (slots) slots.visible = next.detailed;
}
/** The notebook theme (Settings › Theme). */
export function setTheme(id: string): void {
  const t = Content.getTheme(id);
  if (t === theme) return;
  theme = t;
  if (!look) return;
  rebuildDigitTextures();
  for (const view of tokens.values()) { view.mat.map = digitTextures[view.digit] ?? null; }
  buildEnvironment();
  if (points) points.material.color.set(theme.accent);
  applyMarkerColors();
  updateHighlights();
}
export function setPalette(p: string): void {
  if (p === palette) return;
  palette = p;
  applyMarkerColors();
  updateHighlights();
}
export function setReducedMotion(on: boolean): void { reducedMotion = on; }
/** Whether the board draws (full-page screens cover the window). */
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }
setActive(true);

/** Each frame: the framing for the window and the free rectangle (window px), springs, sparks, motes, shake. */
export function update(dt: number, w: number, h: number, rect: Rect): void {
  const fk = `${w}x${h}:${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${state?.cols}:${state?.cells.length}`;
  if (w > 0 && h > 0 && rect.width > 0 && rect.height > 0 && fk !== frameKey) {
    frameKey = fk;
    win = { w, h };
    free = { ...rect };
    fitCamera();
  }
  dt = Math.min(0.05, dt);
  animTime += dt;
  updateTokens(dt);
  updateParticles(dt);
  updateShake(dt);
  updateAmbient();
}
/** Whether tokens are still settling (play-script and browser checks wait on it through the UI). */
export function busy(): boolean {
  for (const v of tokens.values()) if (v.dying || Math.abs(v.mesh.position.y - (v.target.y + v.liftTarget)) > 0.05) return true;
  return false;
}
