// Pair Sum — Three.js render module.
// Notebook world with dimensional number tokens. Orthographic near-tabletop
// camera, procedural geometry/textures only, pooled effects, explicit disposal.
// Rendering consumes immutable rules snapshots; it never mutates rules state.

import * as THREE from '../vendor/three.module.js';
// Post-processing + IBL addons vendored from the same three.js release (r160).
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from '../vendor/three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from '../vendor/three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from '../vendor/three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from '../vendor/three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { getTheme } from './content.js';
import { detectPreset, describe, resolve, SHADOW_MAP } from './gfx.js';

// Authored framing constants (no magic offsets elsewhere).
export const FRAMING = {
  cellSize: 1.0,          // world units per board cell
  tokenHeight: 0.22,
  tokenScale: 0.86,       // token footprint within a cell
  cameraTilt: 0.62,       // radians from vertical (near-tabletop)
  cameraDistance: 14,
  marginX: 0.8,           // board margin in world units
  marginY: 1.0,
  shakeAmplitude: 0.05,   // low amplitude, event-tiered
};

// Lighting is authored at a moderate level and lifted by exposure, so the lit
// page sits well below the bloom threshold and only highlights, the selection
// marker and effect sparks bloom.
const LIGHT = { exposure: 2.3, key: 0.77, hemi: 0.23, env: 0.14 };
// Unlit markers/effects are authored in display terms; divide out the exposure.
const UNLIT = 1 / LIGHT.exposure;
const PARTICLE_CAP = { low: 600, high: 3000 };
const MOTE_COUNT = { low: 36, high: 80 };

// Colour grade + vignette (display-space colours in, display-space out).
// Mild S-curve and saturation; lifted blacks keep ink digits crisp.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.16 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.07);
      s *= mix(vec3(0.97, 0.985, 1.04), vec3(1.025, 1.0, 0.97), smoothstep(0.2, 0.85, l));
      c = mix(c, s, uAmount);
      float d = length((vUv - 0.5) * vec2(1.0, 0.9));
      c *= 1.0 - uVignette * smoothstep(0.38, 0.85, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

function readGpu(renderer) {
  try {
    const gl = renderer.getContext();
    // Firefox already reports the unmasked name and warns on the extension.
    const ff = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
    const ext = ff ? null : gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    return '';
  }
}

function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
}

const LAYER_ENV = 0;      // default layer: environment
const LAYER_PICK = 1;     // explicit interaction layer (only tokens)

// --- procedural textures -----------------------------------------------------

function makeDigitTexture(theme, digit) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  // Outer band = side/bevel colour (token sides sample the corner of this).
  g.fillStyle = theme.tokenEdge;
  g.fillRect(0, 0, S, S);
  const pad = 12;
  g.fillStyle = theme.token;
  roundRect(g, pad, pad, S - pad * 2, S - pad * 2, 30);
  g.fill();
  // Soft top-light across the face for a dimensional read without post effects.
  const grad = g.createLinearGradient(0, pad, 0, S - pad);
  grad.addColorStop(0, 'rgba(255,255,255,0.32)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.08)');
  g.fillStyle = grad;
  roundRect(g, pad, pad, S - pad * 2, S - pad * 2, 30);
  g.fill();
  // Debossed inner frame (pressed card).
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,0.10)';
  roundRect(g, 34, 36, S - 68, S - 68, 22);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  roundRect(g, 34, 34, S - 68, S - 68, 22);
  g.stroke();
  // Digit with a faint pressed-ink highlight below it.
  g.font = `700 ${S * 0.54}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillText(String(digit), S / 2, S / 2 + S * 0.03 + 2);
  g.fillStyle = theme.ink;
  g.fillText(String(digit), S / 2, S / 2 + S * 0.03);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Rounded, bevelled token: top cap UVs span the whole digit texture; the
// sides sample the texture's outer band (token edge colour).
function makeTokenGeometry(detailed) {
  const t = FRAMING.tokenScale * FRAMING.cellSize;
  const bevel = detailed ? 0.045 : 0.03;
  const inner = t / 2 - bevel;
  const r = detailed ? 0.1 : 0.06;
  const shape = new THREE.Shape();
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
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: detailed ? 4 : 1, curveSegments: detailed ? 5 : 2,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -depth / 2, 0);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const capEnd = geo.groups[0] ? geo.groups[0].start + geo.groups[0].count : 0;
  const index = geo.index;
  const capVerts = new Set();
  for (let i = 0; i < capEnd; i++) capVerts.add(index ? index.getX(i) : i);
  for (let i = 0; i < pos.count; i++) {
    if (capVerts.has(i)) uv.setXY(i, (pos.getX(i) + t / 2) / t, (t / 2 - pos.getZ(i)) / t);
    else uv.setXY(i, 0.018, 0.5);
  }
  uv.needsUpdate = true;
  geo.clearGroups();
  // Weld shared positions (same uv) so the bevel shades smoothly.
  geo.deleteAttribute('normal');
  const welded = mergeVertices(geo, 1e-4);
  geo.dispose();
  welded.computeVertexNormals();
  return welded;
}

// Soft round sprite for sparks and dust motes.
function makeSpriteTexture() {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Faint pencil outline marking every cell slot (shows the grid as it empties).
function makeSlotTexture(theme) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.strokeStyle = theme.rule;
  g.globalAlpha = 0.75;
  g.lineWidth = 4;
  g.setLineDash([10, 7]);
  roundRect(g, 10, 10, S - 20, S - 20, 16);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Seeded paper-fibre height field for the page's bump map.
function makeGrainTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  let s = 424242;
  for (let i = 0; i < S * S; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = 118 + (s % 21);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // a few long fibres
  g.strokeStyle = 'rgba(160,160,160,0.5)';
  g.lineWidth = 1;
  for (let k = 0; k < 60; k++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const x = s % S; s = (s * 1103515245 + 12345) & 0x7fffffff;
    const y = s % S; s = (s * 1103515245 + 12345) & 0x7fffffff;
    const a = (s % 628) / 100;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makePaperTexture(theme) {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = theme.paper;
  g.fillRect(0, 0, S, S);
  // Ruled lines
  g.strokeStyle = theme.rule;
  g.globalAlpha = 0.55;
  g.lineWidth = 2;
  for (let y = 64; y < S; y += 64) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(S, y);
    g.stroke();
  }
  // Margin line
  g.globalAlpha = 0.7;
  g.strokeStyle = theme.margin;
  g.beginPath();
  g.moveTo(96, 0);
  g.lineTo(96, S);
  g.stroke();
  // Paper grain (seeded, deterministic)
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
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Critically damped spring (deterministic, interruption-safe).
function spring(current, target, velocity, smoothTime, dt) {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * dt;
  const newV = (velocity - omega * temp) * exp;
  const newVal = target + (change + temp) * exp;
  return [newVal, newV];
}

// -----------------------------------------------------------------------------

export class BoardRenderer {
  constructor(container, opts = {}) {
    this.container = container;
    this.emit = opts.emit || (() => {});
    this.theme = getTheme(opts.themeId);
    this.reducedMotion = false;
    // Ambient motion also honours the OS-level reduced-motion preference.
    this.osReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.state = null;
    this.selection = null;
    this.legalTargets = [];
    this.legalFromSelection = new Set();
    this.hintCells = new Set();
    this.tokens = new Map();     // slot index -> view
    this.digitTextures = [];
    this.disposed = false;
    this.animTime = 0;
    this.shake = 0;
    this.contextLost = false;
    this.size = [0, 0];
    this.pixelRatio = 0;
    this.adaptiveScale = 1;
    this._frames = [];
    this.fps = 0;
    this.composer = null;
    this.postKey = null;
    this.postFailed = false;

    // MSAA is done in the composer's multisampled target (switchable live),
    // so the canvas itself never pays for multisampling.
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, alpha: false, powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = LIGHT.exposure;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.gpu = readGpu(this.renderer);
    this.mobile = isMobileDevice();
    this.detected = detectPreset(this.gpu, this.mobile);
    this.gfxSaved = opts.graphics || {};
    this.q = resolve(this.gfxSaved, this.detected);

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.emit({ type: 'webgl-lost' });
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.rebuildGpuResources();
      this.emit({ type: 'webgl-restored' });
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.layers.enable(LAYER_PICK); // camera renders env + interaction layers
    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.set(LAYER_PICK); // raycast only the interaction layer
    this.pointerNdc = new THREE.Vector2();

    this.tokenGroup = new THREE.Group();
    this.scene.add(this.tokenGroup);
    this.spriteTex = makeSpriteTexture();

    this.buildImageLighting();
    this.buildLights();
    this.buildEnvironment();
    this.buildMarkers();
    this.buildParticles();
    this.buildMotes();
    this.rebuildDigitTextures();
    this.tokenGeo = makeTokenGeometry(this.q.detail === 'detailed');
    this.builtDetail = this.q.detail;

    this.running = false;
    this.setGraphics(this.gfxSaved);
    this.resize();
  }

  // --- scene construction ---------------------------------------------------

  // Image-based lighting: a prefiltered room environment gives PBR tokens
  // soft reflections and a gentle fill.
  buildImageLighting() {
    this.envTex?.dispose();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment(this.renderer);
    this.envTex = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTex;
  }

  buildLights() {
    this.keyLight = new THREE.DirectionalLight(0xfff4e6, LIGHT.key);
    this.keyLight.position.set(4, 10, 5);
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.02;
    this.keyLight.shadow.radius = 3;
    this.scene.add(this.keyLight);
    this.fill = new THREE.HemisphereLight(0xfff6e0, 0x8a87a0, LIGHT.hemi);
    this.scene.add(this.fill);
  }

  buildEnvironment() {
    if (this.paper) {
      this.paper.geometry.dispose();
      this.paper.material.dispose();
      this.scene.remove(this.paper);
    }
    if (this.paperTex) this.paperTex.dispose();
    this.paperTex = makePaperTexture(this.theme);
    this.paperTex.repeat.set(3, 3);
    const detailed = this.q.detail === 'detailed';
    if (detailed && !this.grainTex) {
      this.grainTex = makeGrainTexture();
      this.grainTex.repeat.set(14, 14);
    }
    const mat = new THREE.MeshStandardMaterial({
      map: this.paperTex, roughness: 0.95, metalness: 0, envMapIntensity: LIGHT.env,
      ...(detailed ? { bumpMap: this.grainTex, bumpScale: 0.6 } : {}),
    });
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat);
    this.paper.rotation.x = -Math.PI / 2;
    this.paper.position.y = -FRAMING.tokenHeight / 2 - 0.01;
    this.paper.receiveShadow = true;
    this.paper.layers.set(LAYER_ENV);
    this.scene.add(this.paper);
    this.scene.background = new THREE.Color(this.theme.sky);
    this.fill.color.set(this.theme.paper);
    this.fill.groundColor.set(this.theme.rule);
    this.buildSlots();
  }

  // Pencil slot outlines under every cell (detailed) and soft blob shadows
  // that ground tokens when the shadow map is off. One draw call each.
  buildSlots() {
    if (this.slots) {
      this.scene.remove(this.slots);
      this.slots.material.map?.dispose();
      this.slots.material.dispose();
      this.slots.geometry.dispose();
    }
    this.slots = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.94, 0.94),
      new THREE.MeshStandardMaterial({
        map: makeSlotTexture(this.theme), transparent: true, depthWrite: false,
        roughness: 1, metalness: 0, envMapIntensity: LIGHT.env,
      }),
      512,
    );
    this.slots.count = 0;
    this.slots.receiveShadow = true;
    this.slots.visible = this.q.detail === 'detailed';
    this.slots.layers.set(LAYER_ENV);
    this.slotKey = null;
    this.scene.add(this.slots);
    if (!this.blobs) {
      this.blobs = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1.05, 1.05),
        new THREE.MeshBasicMaterial({
          map: this.spriteTex, color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false,
        }),
        512,
      );
      this.blobs.count = 0;
      this.blobs.layers.set(LAYER_ENV);
      this.blobs.frustumCulled = false;
      this.scene.add(this.blobs);
    }
    if (this.state) this.updateSlots();
  }

  updateSlots() {
    if (!this.slots || !this.state) return;
    const key = `${this.state.cols}:${this.state.cells.length}`;
    if (key === this.slotKey) return;
    this.slotKey = key;
    const m = new THREE.Matrix4();
    const n = Math.min(512, this.state.cells.length);
    for (let i = 0; i < n; i++) {
      const p = this.cellToWorld(i);
      m.makeRotationX(-Math.PI / 2);
      m.setPosition(p.x, -FRAMING.tokenHeight / 2 - 0.006, p.z);
      this.slots.setMatrixAt(i, m);
    }
    this.slots.count = n;
    this.slots.instanceMatrix.needsUpdate = true;
  }

  buildMarkers() {
    // Grounded selection ring (selection = lift + rim + grounded marker).
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 40),
      new THREE.MeshBasicMaterial({ color: this.theme.select, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
    // Path preview line between selected and hovered legal target.
    this.pathLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: this.theme.legal, transparent: true, opacity: 0.85 }),
    );
    this.pathLine.visible = false;
    this.scene.add(this.pathLine);
    // Cell dots for path-through-cells preview.
    this.pathDots = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.09, 16),
      new THREE.MeshBasicMaterial({ color: this.theme.legal, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
      128,
    );
    this.pathDots.count = 0;
    this.scene.add(this.pathDots);
  }

  // Marker/effect colours; pushed above 1.0 when bloom is on so only they glow.
  applyMarkerColors() {
    const bloom = this.q.bloom === 'on';
    this.ring.material.color.set(this.theme.select).multiplyScalar(UNLIT * (bloom ? 1.6 : 1));
    this.pathLine.material.color.set(this.theme.legal).multiplyScalar(UNLIT);
    this.pathDots.material.color.set(this.theme.legal).multiplyScalar(UNLIT);
    // Sparks are pushed past the bloom threshold so they glow.
    if (this.points) this.points.material.color.set(this.theme.accent).multiplyScalar(bloom ? 3 : UNLIT);
  }

  buildParticles() {
    const cap = PARTICLE_CAP[this.q.particles] || PARTICLE_CAP.low;
    if (this.points) {
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.scene.remove(this.points);
    }
    this.builtParticles = this.q.particles;
    this.particleCap = cap;
    this.particleData = new Float32Array(cap * 8); // x,y,z,vx,vy,vz,life,size
    this.particleAlive = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      // Orthographic camera: point size is in CSS pixels (no attenuation).
      color: this.theme.accent, size: this.q.particles === 'high' ? 11 : 8,
      map: this.spriteTex, transparent: true, opacity: 0.95,
      sizeAttenuation: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.layers.set(LAYER_ENV); // cosmetic particles never intercept raycasts
    this.scene.add(this.points);
    this.applyMarkerColors();
  }

  // Ambient dust motes drifting in the desk-lamp light (background: animated).
  buildMotes() {
    if (this.motes) {
      this.motes.geometry.dispose();
      this.motes.material.dispose();
      this.scene.remove(this.motes);
    }
    const n = MOTE_COUNT[this.q.particles] || MOTE_COUNT.low;
    const pos = new Float32Array(n * 3);
    this.moteSeed = new Float32Array(n * 4);
    let s = 97531;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < n; i++) {
      this.moteSeed[i * 4] = (rnd() - 0.5) * 16;
      this.moteSeed[i * 4 + 1] = 0.4 + rnd() * 2.6;
      this.moteSeed[i * 4 + 2] = (rnd() - 0.5) * 14;
      this.moteSeed[i * 4 + 3] = rnd() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({
      color: new THREE.Color(0xfff3d6).multiplyScalar(UNLIT * 1.2), size: 3, map: this.spriteTex, transparent: true, opacity: 0.28,
      sizeAttenuation: true, depthWrite: false,
    }));
    this.motes.frustumCulled = false;
    this.motes.layers.set(LAYER_ENV);
    this.builtMotes = this.q.particles;
    this.scene.add(this.motes);
    this.updateMotes(0);
  }

  updateMotes() {
    const on = this.q.background === 'animated' && !this.reducedMotion && !this.osReducedMotion;
    this.motes.visible = on;
    if (!on) return;
    const t = this.animTime;
    const d = this.moteSeed;
    const pos = this.motes.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ph = d[i * 4 + 3];
      pos.setXYZ(i,
        d[i * 4] + Math.sin(t * 0.11 + ph) * 1.2,
        d[i * 4 + 1] + Math.sin(t * 0.23 + ph * 1.7) * 0.35,
        d[i * 4 + 2] + Math.cos(t * 0.09 + ph) * 1.0);
    }
    pos.needsUpdate = true;
  }

  rebuildDigitTextures() {
    for (const t of this.digitTextures) t?.dispose();
    this.digitTextures = [null];
    for (let d = 1; d <= 9; d++) this.digitTextures.push(makeDigitTexture(this.theme, d));
  }

  // Each token owns its material (sharing the digit texture), so selection
  // and legal-target glows never leak to other tokens with the same digit.
  makeTokenMaterial(digit) {
    const map = this.digitTextures[digit] || this.digitTextures[1];
    const common = {
      map, metalness: 0, envMapIntensity: LIGHT.env,
      emissive: new THREE.Color(this.theme.select), emissiveIntensity: 0,
    };
    return this.q.detail === 'detailed'
      ? new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.48, clearcoat: 0.65, clearcoatRoughness: 0.28 })
      : new THREE.MeshStandardMaterial({ ...common, roughness: 0.55, metalness: 0.05 });
  }

  rebuildGpuResources() {
    // Context recovery: rebuild GPU resources from retained CPU descriptors.
    this.rebuildDigitTextures();
    this.buildImageLighting();
    this.buildEnvironment();
    for (const view of this.tokens.values()) view.mesh.material.map = this.digitTextures[view.digit];
    this.postKey = null;
    if (this.state) this.syncState(this.state, this.selection, true);
  }

  setTheme(themeId) {
    this.theme = getTheme(themeId);
    this.rebuildDigitTextures();
    this.buildEnvironment();
    this.applyMarkerColors();
    for (const view of this.tokens.values()) {
      view.mesh.material.map = this.digitTextures[view.digit] || this.digitTextures[1];
    }
    this.updateLegalHighlights();
  }

  // --- graphics settings -------------------------------------------------------

  /** Apply saved graphics settings live (no reload). */
  setGraphics(saved) {
    this.gfxSaved = saved || {};
    const g = resolve(this.gfxSaved, this.detected);
    this.q = g;
    const size = SHADOW_MAP[g.shadows];
    const on = size > 0;
    const shadowChanged = this.renderer.shadowMap.enabled !== on;
    this.renderer.shadowMap.enabled = on;
    this.keyLight.castShadow = on;
    if (on && this.keyLight.shadow.mapSize.x !== size) {
      this.keyLight.shadow.mapSize.set(size, size);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
    }
    for (const view of this.tokens.values()) view.mesh.castShadow = on;
    if (this.builtDetail !== g.detail) {
      this.builtDetail = g.detail;
      const old = this.tokenGeo;
      this.tokenGeo = makeTokenGeometry(g.detail === 'detailed');
      for (const view of this.tokens.values()) {
        const em = view.mesh.material.emissive.clone();
        const ei = view.mesh.material.emissiveIntensity;
        view.mesh.material.dispose();
        view.mesh.geometry = this.tokenGeo;
        view.mesh.material = this.makeTokenMaterial(view.digit);
        view.mesh.material.emissive.copy(em);
        view.mesh.material.emissiveIntensity = ei;
      }
      old?.dispose();
      this.buildEnvironment();
    } else if (shadowChanged) {
      // Materials pick up shadow-map changes on recompile.
      for (const view of this.tokens.values()) view.mesh.material.needsUpdate = true;
      this.paper.material.needsUpdate = true;
      this.slots.material.needsUpdate = true;
    }
    if (this.builtParticles !== g.particles) this.buildParticles();
    if (this.builtMotes !== g.particles) this.buildMotes();
    this.applyMarkerColors();
    this.slots.visible = g.detail === 'detailed';
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null; // rebuild the post chain on the next frame
    this.postFailed = false;
    this.fpsVisible(g.showFps);
    this.renderer.domElement.dataset.gfxPreset = g.preset;
  }

  /** What the settings panel shows: GPU, auto choice, resolved tiers, cost, frame rate. */
  graphicsInfo(labels) {
    const w = this.size[0] || this.container.clientWidth || 1;
    const h = this.size[1] || this.container.clientHeight || 1;
    const pr = this.pixelRatio || this.currentRatio();
    const px = [Math.round(w * pr), Math.round(h * pr)];
    return {
      gpu: this.gpu || '',
      detected: this.detected,
      resolved: this.q,
      summary: describe(this.q, px, labels),
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed,
    };
  }

  fpsVisible(on) {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.className = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  currentRatio() {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    return Math.min(dpr, this.q.dprCap) * this.q.scale * this.adaptiveScale;
  }

  postKeyFor(w, h) {
    const g = this.q;
    return g.post ? [g.ao, g.bloom, g.grade, g.antialias, w, h, this.pixelRatio].join('|') : 'none';
  }

  buildPost(w, h) {
    const g = this.q;
    this.composer?.dispose();
    this.composer = null;
    if (!g.post) return;
    try {
      const pw = Math.max(1, Math.round(w * this.pixelRatio));
      const ph = Math.max(1, Math.round(h * this.pixelRatio));
      const target = new THREE.WebGLRenderTarget(pw, ph, {
        type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(this.pixelRatio);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new GTAOPass(this.scene, this.camera, pw, ph);
        // r160 sets this define under a typo'd name: fix it for the ortho camera.
        ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = this.camera.isPerspectiveCamera ? 1 : 0;
        ao.gtaoMaterial.needsUpdate = true;
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = g.ao === 'high' ? 0.85 : 0.7;
        ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: g.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === 'high' ? 6 : 4, rings: 2, samples: g.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // High threshold: only the selection marker, sparks and hot highlights bloom.
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.4, 0.9));
      }
      composer.addPass(new OutputPass());
      if (g.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      if (g.antialias === 'smaa') composer.addPass(new SMAAPass(pw, ph));
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch {
      // Post-processing is an enhancement: render directly (the settings panel says so).
      this.postFailed = true;
      this.composer = null;
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  adapt(dtMs) {
    const f = this._frames;
    f.push(dtMs);
    if (f.length < 90) return;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = typeof document !== 'undefined' && document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = `${Math.round(this.fps)} fps · ${Math.round(this.pixelRatio * 100) / 100}×`;
    if (!this.q.adaptive) { this.adaptiveScale = 1; return; }
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
  }

  setReducedMotion(on) {
    this.reducedMotion = !!on;
  }

  // --- layout -----------------------------------------------------------------

  cellToWorld(index) {
    const cols = this.state?.cols || 9;
    const rows = Math.max(1, Math.ceil((this.state?.cells.length || cols) / cols));
    const r = Math.floor(index / cols);
    const c = index % cols;
    const w = cols * FRAMING.cellSize;
    const h = rows * FRAMING.cellSize;
    return new THREE.Vector3(
      c * FRAMING.cellSize - w / 2 + FRAMING.cellSize / 2,
      0,
      r * FRAMING.cellSize - h / 2 + FRAMING.cellSize / 2,
    );
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.pixelRatio = this.currentRatio();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this.size = [w, h];
    this.fitCamera(w / h);
    // HUD chrome appears/disappears without a resize: refit when it does.
    if (!this._hudObserver && typeof MutationObserver === 'function' && typeof document !== 'undefined') {
      this._hudObserver = new MutationObserver(() => this.fitCamera((this.container.clientWidth || 1) / (this.container.clientHeight || 1)));
      for (const id of ['hud', 'lesson-banner', 'action-tray']) {
        const el = document.getElementById(id);
        if (el) this._hudObserver.observe(el, { attributes: true, childList: true, subtree: true, attributeFilter: ['hidden', 'class', 'style'] });
      }
    }
  }

  // HUD chrome overlaying the canvas (objective band, lesson banner, action
  // tray) as fractions of the canvas; the board is fitted inside the rest.
  hudInsets() {
    const ins = { l: 0, r: 0, t: 0, b: 0 };
    if (typeof document === 'undefined') return ins;
    const cr = this.container.getBoundingClientRect();
    const W = cr.width || 1, H = cr.height || 1;
    for (const id of ['hud', 'lesson-banner', 'action-tray']) {
      const el = document.getElementById(id);
      if (!el || el.hidden || !el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const e = { l: (r.left - cr.left) / W, t: (r.top - cr.top) / H, r: (r.right - cr.left) / W, b: (r.bottom - cr.top) / H };
      if (e.b <= 0.5 && e.r - e.l > 0.45) ins.t = Math.max(ins.t, e.b);
      else if (e.t >= 0.5 && e.r - e.l > 0.45) ins.b = Math.max(ins.b, 1 - e.t);
      else if (e.l >= 0.55) ins.r = Math.max(ins.r, 1 - e.l);
      else if (e.r <= 0.45) ins.l = Math.max(ins.l, e.r);
      else if (e.t >= 0.5) ins.b = Math.max(ins.b, 1 - e.t);
      else ins.t = Math.max(ins.t, e.b);
    }
    if (ins.t + ins.b > 0.65) { ins.t = Math.min(ins.t, 0.35); ins.b = Math.min(ins.b, 0.3); }
    if (ins.l + ins.r > 0.6) { ins.l = 0; ins.r = 0; }
    return ins;
  }

  fitCamera(aspect) {
    const cols = this.state?.cols || 9;
    const rows = Math.max(3, Math.ceil((this.state?.cells.length || cols * 4) / cols));
    const halfW = (cols * FRAMING.cellSize) / 2 + FRAMING.marginX;
    const halfH = (rows * FRAMING.cellSize) / 2 + FRAMING.marginY;
    // fit the board into the HUD-free part of the canvas (ortho: offset the
    // frustum so the board is centred in that area)
    const ins = this.hudInsets();
    const freeW = Math.max(0.35, 1 - ins.l - ins.r), freeH = Math.max(0.35, 1 - ins.t - ins.b);
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    let vw = halfW / freeW;
    let vh = vw / aspect;
    if (vh * freeH < halfH) { vh = halfH / freeH; vw = vh * aspect; }
    const cx = (ins.l - ins.r) * vw, cy = (ins.b - ins.t) * vh;
    this.camera.left = -vw + cx;
    this.camera.right = vw + cx;
    this.camera.top = vh + cy;
    this.camera.bottom = -vh + cy;
    const tilt = FRAMING.cameraTilt;
    const d = FRAMING.cameraDistance;
    this.camera.position.set(0, Math.cos(tilt) * d, Math.sin(tilt) * d);
    this.camera.lookAt(0, 0, 0.4);
    this.camera.updateProjectionMatrix();
    // Shadow frustum fitted tightly around the board (plus lift headroom).
    const sc = this.keyLight.shadow.camera;
    const ext = Math.max(halfW, halfH) + 0.6;
    if (sc.right !== ext) {
      Object.assign(sc, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 30 });
      sc.updateProjectionMatrix();
    }
  }

  // --- state sync ---------------------------------------------------------------

  // Full sync from an immutable snapshot; views animate toward new targets.
  syncState(state, selection, force = false) {
    const prevCells = this.state?.cells;
    this.state = state;
    this.selection = selection;
    this.fitCamera(this.container.clientWidth / Math.max(1, this.container.clientHeight));
    const seen = new Set();
    for (let i = 0; i < state.cells.length; i++) {
      const digit = state.cells[i];
      if (digit === 0) continue;
      seen.add(i);
      let view = this.tokens.get(i);
      if (!view) {
        view = this.spawnToken(i, digit);
        // Slide-in origin for added rows: from below the board.
        if (prevCells && !this.reducedMotion) {
          const target = this.cellToWorld(i);
          view.mesh.position.set(target.x, -1.2, target.z + 2);
        }
      } else {
        // A refilled slot (e.g. undo) revives a token that was still playing
        // its pop-out animation, so the cell stays tappable immediately.
        if (view.dying) { view.dying = false; view.targetScale = 1; }
        if (view.digit !== digit) {
          view.digit = digit;
          view.mesh.material.map = this.digitTextures[digit];
        }
      }
      view.target = this.cellToWorld(i);
      view.target.y = 0;
    }
    // Remove views for slots that no longer hold a digit (cleared tokens
    // finish their pop animation in the update loop before pooling).
    for (const [i, view] of this.tokens) {
      if (!seen.has(i) && !view.dying) {
        if (force || this.reducedMotion) this.releaseToken(i);
        else this.killToken(view);
      }
    }
    this.updateSlots();
    this.updateLegalHighlights();
    this.updateSelectionVisuals();
  }

  spawnToken(index, digit) {
    const mesh = new THREE.Mesh(this.tokenGeo, this.makeTokenMaterial(digit));
    mesh.castShadow = this.renderer.shadowMap.enabled;
    mesh.layers.set(LAYER_PICK);
    mesh.userData.cell = index;
    const pos = this.cellToWorld(index);
    mesh.position.copy(pos);
    this.tokenGroup.add(mesh);
    const view = {
      mesh, digit, index, target: pos.clone(),
      vel: new THREE.Vector3(), scaleV: 0, scale: 1, targetScale: 1,
      dying: false, lift: 0, pulse: 0, phase: index * 0.73,
    };
    this.tokens.set(index, view);
    return view;
  }

  killToken(view) {
    view.dying = true;
    view.targetScale = 0.01;
    view.target = view.mesh.position.clone();
    view.target.y = 1.4;
    this.spawnBurst(view.mesh.position, 10);
  }

  releaseToken(index) {
    const view = this.tokens.get(index);
    if (!view) return;
    this.tokenGroup.remove(view.mesh);
    view.mesh.material.dispose();
    this.tokens.delete(index);
  }

  spawnBurst(pos, n) {
    if (this.reducedMotion) return;
    if (this.q.particles === 'high') n = Math.round(n * 1.6);
    for (let k = 0; k < n && this.particleAlive < this.particleCap; k++) {
      const i = this.particleAlive++;
      const d = this.particleData;
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 2;
      d[i * 8 + 0] = pos.x;
      d[i * 8 + 1] = pos.y + 0.15;
      d[i * 8 + 2] = pos.z;
      d[i * 8 + 3] = Math.cos(a) * sp;
      d[i * 8 + 4] = 1.5 + Math.random() * 2;
      d[i * 8 + 5] = Math.sin(a) * sp;
      d[i * 8 + 6] = 0.6 + Math.random() * 0.4; // life
      d[i * 8 + 7] = 1;
    }
  }

  // --- interaction ------------------------------------------------------------

  pickCell(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.tokenGroup.children, false);
    for (const h of hits) {
      const view = this.tokens.get(h.object.userData.cell);
      if (view && !view.dying) return h.object.userData.cell;
    }
    return null;
  }

  setSelection(index) {
    this.selection = index;
    this.updateSelectionVisuals();
    this.updateLegalHighlights();
  }

  setHint(pairOrNull) {
    this.hintCells = new Set();
    if (pairOrNull && !pairOrNull.none) {
      this.hintCells.add(pairOrNull.a);
      this.hintCells.add(pairOrNull.b);
      for (const idx of [pairOrNull.a, pairOrNull.b]) {
        const v = this.tokens.get(idx);
        if (v) v.pulse = 1.2;
      }
    }
  }

  updateLegalHighlights() {
    this.legalFromSelection = new Set(this.legalTargets || []);
    for (const [i, view] of this.tokens) {
      const isSel = i === this.selection;
      const isLegal = this.legalFromSelection.has(i);
      const mat = view.mesh.material;
      // Selection: lift + emissive rim; legal targets: soft legal tint.
      view.liftTarget = isSel ? 0.32 : isLegal ? 0.12 : 0;
      if (isSel) { mat.emissive.set(this.theme.select); view.emissiveTarget = 0.32; }
      else if (isLegal) { mat.emissive.set(this.theme.legal); view.emissiveTarget = 0.22; }
      else view.emissiveTarget = 0;
    }
  }

  updateSelectionVisuals() {
    if (this.selection != null && this.tokens.has(this.selection)) {
      const p = this.tokens.get(this.selection).mesh.position;
      this.ring.position.set(p.x, -FRAMING.tokenHeight / 2 + 0.005, p.z);
      this.ring.visible = true;
    } else {
      this.ring.visible = false;
    }
  }

  // Preview of a would-be connection (hover/focus), or null to clear.
  previewPath(check) {
    if (!check || !check.ok || this.selection == null) {
      this.pathLine.visible = false;
      this.pathDots.count = 0;
      return;
    }
    const a = this.cellToWorld(this.selection);
    const b = this.cellToWorld(this.selection === check.a ? check.b : check.a);
    a.y = b.y = 0.12;
    this.pathLine.geometry.setFromPoints([a, b]);
    this.pathLine.visible = true;
    const m = new THREE.Matrix4();
    let n = 0;
    for (const idx of check.path) {
      if (n >= 128) break;
      const p = this.cellToWorld(idx);
      m.makeRotationX(-Math.PI / 2);
      m.setPosition(p.x, 0.02, p.z);
      this.pathDots.setMatrixAt(n++, m);
    }
    this.pathDots.count = n;
    this.pathDots.instanceMatrix.needsUpdate = true;
  }

  shakeCamera(strength) {
    if (this.reducedMotion) return;
    this.shake = Math.max(this.shake, Math.min(1, strength) * FRAMING.shakeAmplitude);
  }

  // --- event-driven effects ------------------------------------------------------

  onGameEvent(e) {
    switch (e.type) {
      case 'clear': {
        const pa = this.cellToWorld(e.a);
        this.spawnBurst(pa, e.chain >= 3 ? 26 : 12);
        if (e.chain >= 4) this.shakeCamera(0.5); // event hierarchy tiers
        break;
      }
      case 'collapse':
        this.shakeCamera(0.3);
        break;
      case 'invalid':
        this.shakeCamera(0.25);
        break;
      case 'win':
        for (let i = 0; i < 5; i++) {
          this.spawnBurst(new THREE.Vector3((Math.random() - 0.5) * 4, 0.5, (Math.random() - 0.5) * 4), 30);
        }
        this.shakeCamera(0.6);
        break;
      default:
        break;
    }
  }

  // --- main loop -----------------------------------------------------------------

  start() {
    if (this.running) return;
    this.running = true;
    this._last = 0;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  frame() {
    if (this.contextLost) return;
    const now = performance.now();
    const dtMs = this._last ? Math.min(250, now - this._last) : 16;
    this._last = now;
    const dt = Math.min(0.05, dtMs / 1000);
    this.animTime += dt;
    this.updateTokens(dt);
    this.updateParticles(dt);
    this.updateCameraShake(dt);
    this.updateAmbient();
    this.renderFrame(dtMs);
  }

  // Gentle desk-lamp shimmer + drifting motes; frozen by reduced motion.
  updateAmbient() {
    const animated = this.q.background === 'animated' && !this.reducedMotion && !this.osReducedMotion;
    const t = this.animTime;
    this.keyLight.intensity = LIGHT.key * (animated ? 1 + 0.025 * Math.sin(t * 0.7) + 0.012 * Math.sin(t * 1.9) : 1);
    this.keyLight.position.x = 4 + (animated ? Math.sin(t * 0.13) * 0.35 : 0);
    this.updateMotes();
  }

  renderFrame(dtMs) {
    this.adapt(dtMs);
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const ratio = this.currentRatio();
    if (w !== this.size[0] || h !== this.size[1] || ratio !== this.pixelRatio) {
      const sizeChanged = w !== this.size[0] || h !== this.size[1];
      this.size = [w, h];
      this.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(w, h);
      if (sizeChanged) this.fitCamera(w / h);
    }
    const key = this.postKeyFor(w, h);
    if (key !== this.postKey) {
      this.postKey = key;
      this.buildPost(w, h);
    }
    if (this.composer) this.composer.render(dtMs / 1000);
    else this.renderer.render(this.scene, this.camera);
  }

  updateTokens(dt) {
    const smooth = this.reducedMotion ? 0.02 : 0.14;
    const bob = this.q.background === 'animated' && !this.reducedMotion && !this.osReducedMotion;
    const blobs = !this.renderer.shadowMap.enabled;
    const bm = this._blobMatrix || (this._blobMatrix = new THREE.Matrix4());
    this._blobScale = this._blobScale || new THREE.Vector3();
    let nb = 0;
    for (const [i, view] of this.tokens) {
      const m = view.mesh;
      const idle = bob && !view.dying ? 0.012 * Math.sin(this.animTime * 1.7 + view.phase) : 0;
      const ty = (view.target?.y ?? 0) + (view.liftTarget || 0) + idle;
      let v;
      [m.position.x, v] = spring(m.position.x, view.target.x, view.vel.x, smooth, dt); view.vel.x = v;
      [m.position.y, v] = spring(m.position.y, ty, view.vel.y, smooth, dt); view.vel.y = v;
      [m.position.z, v] = spring(m.position.z, view.target.z, view.vel.z, smooth, dt); view.vel.z = v;
      [view.scale, view.scaleV] = spring(view.scale, view.targetScale, view.scaleV, smooth, dt);
      m.scale.setScalar(Math.max(0.01, view.scale));
      const mat = m.material;
      const ei = mat.emissiveIntensity ?? 0;
      const targetE = view.pulse > 0
        ? 0.35 + 0.3 * Math.sin(this.animTime * 10)
        : (view.emissiveTarget || 0);
      mat.emissiveIntensity += (targetE * UNLIT - ei) * Math.min(1, dt * 12);
      if (view.pulse > 0) {
        view.pulse -= dt;
        if (view.pulse <= 0) mat.emissive.set(this.theme.select);
      }
      if (blobs && nb < 512) {
        // Soft contact shadow: smaller and fainter as the token lifts.
        const k = Math.max(0.01, view.scale) * (1 - Math.min(0.35, m.position.y * 0.8));
        bm.makeRotationX(-Math.PI / 2);
        bm.scale(this._blobScale.set(k, k, 1));
        bm.setPosition(m.position.x + 0.05, -FRAMING.tokenHeight / 2 - 0.004, m.position.z + 0.06);
        this.blobs.setMatrixAt(nb++, bm);
      }
      if (view.dying && view.scale < 0.05) this.releaseToken(i);
    }
    if (this.blobs) {
      this.blobs.count = nb;
      this.blobs.visible = blobs;
      if (nb) this.blobs.instanceMatrix.needsUpdate = true;
    }
    if (this.ring.visible) {
      const s = 1 + 0.06 * Math.sin(this.animTime * 5);
      this.ring.scale.setScalar(this.reducedMotion ? 1 : s);
    }
  }

  updateParticles(dt) {
    if (!this.particleAlive) return;
    const d = this.particleData;
    const pos = this.points.geometry.attributes.position;
    let alive = this.particleAlive;
    for (let i = 0; i < alive; i++) {
      d[i * 8 + 6] -= dt;
      if (d[i * 8 + 6] <= 0) {
        // swap-with-last compaction; no per-frame allocation
        alive--;
        for (let k = 0; k < 8; k++) d[i * 8 + k] = d[alive * 8 + k];
        i--;
        continue;
      }
      d[i * 8 + 4] -= 6 * dt; // gravity
      d[i * 8 + 0] += d[i * 8 + 3] * dt;
      d[i * 8 + 1] += d[i * 8 + 4] * dt;
      d[i * 8 + 2] += d[i * 8 + 5] * dt;
      pos.setXYZ(i, d[i * 8 + 0], d[i * 8 + 1], d[i * 8 + 2]);
    }
    this.particleAlive = alive;
    this.points.geometry.setDrawRange(0, alive);
    pos.needsUpdate = true;
  }

  updateCameraShake(dt) {
    const tilt = FRAMING.cameraTilt;
    const d = FRAMING.cameraDistance;
    const baseY = Math.cos(tilt) * d;
    const baseZ = Math.sin(tilt) * d;
    if (this.shake > 0.001) {
      const t = this.animTime * 60;
      this.camera.position.set(
        Math.sin(t * 1.3) * this.shake,
        baseY + Math.cos(t * 1.7) * this.shake * 0.4,
        baseZ,
      );
      this.shake *= Math.exp(-6 * dt);
    } else if (this.camera.position.x !== 0 || this.camera.position.y !== baseY) {
      this.camera.position.set(0, baseY, baseZ);
    }
    this.camera.lookAt(0, 0, 0.4);
  }

  // Project a cell to CSS pixels for DOM label alignment.
  cellToScreen(index) {
    const p = this.cellToWorld(index);
    p.y = 0.3;
    p.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (p.x + 1) / 2 * rect.width,
      y: rect.top + (1 - p.y) / 2 * rect.height,
    };
  }

  dispose() {
    this.stop();
    this.disposed = true;
    for (const t of this.digitTextures) t?.dispose();
    this.paperTex?.dispose();
    this.grainTex?.dispose();
    this.spriteTex?.dispose();
    this.envTex?.dispose();
    this.tokenGeo?.dispose();
    for (const view of this.tokens.values()) view.mesh.material.dispose();
    this.points?.geometry.dispose();
    this.motes?.geometry.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
