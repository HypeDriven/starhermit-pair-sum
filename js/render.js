// Pair Sum — Three.js render module.
// Notebook world with dimensional number tokens. Orthographic near-tabletop
// camera, procedural geometry/textures only, pooled effects, explicit disposal.
// Rendering consumes immutable rules snapshots; it never mutates rules state.

import * as THREE from '../vendor/three.module.js';
import { getTheme } from './content.js';

// Authored framing constants (no magic offsets elsewhere).
export const FRAMING = {
  cellSize: 1.0,          // world units per board cell
  tokenHeight: 0.22,
  tokenScale: 0.86,       // token footprint within a cell
  cameraTilt: 0.62,       // radians from vertical (near-tabletop)
  cameraDistance: 14,
  marginX: 1.6,           // board margin in world units
  marginY: 2.2,
  shakeAmplitude: 0.05,   // low amplitude, event-tiered
};

export const QUALITY_TIERS = {
  low:    { pixelRatio: 1,   shadows: false, particleCap: 500,  antialias: false, envDetail: 0 },
  medium: { pixelRatio: 1.5, shadows: false, particleCap: 2000, antialias: true,  envDetail: 1 },
  high:   { pixelRatio: 2,   shadows: true,  particleCap: 5000, antialias: true,  envDetail: 2 },
};

const LAYER_ENV = 0;      // default layer: environment
const LAYER_PICK = 1;     // explicit interaction layer (only tokens)

// --- procedural textures -----------------------------------------------------

function makeDigitTexture(theme, digit) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  // Token body: padded solid edge so box sides stretch into a clean rim.
  g.fillStyle = theme.tokenEdge;
  g.fillRect(0, 0, S, S);
  const pad = 22;
  g.fillStyle = theme.token;
  roundRect(g, pad, pad, S - pad * 2, S - pad * 2, 26);
  g.fill();
  // Subtle top-light gradient for a dimensional read without post effects.
  const grad = g.createLinearGradient(0, pad, 0, S - pad);
  grad.addColorStop(0, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = grad;
  roundRect(g, pad, pad, S - pad * 2, S - pad * 2, 26);
  g.fill();
  // Digit
  g.fillStyle = theme.ink;
  g.font = `700 ${S * 0.52}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(digit), S / 2, S / 2 + S * 0.03);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
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
    this.tierName = opts.quality || 'medium';
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

    const tier = QUALITY_TIERS[this.tierName];
    this.renderer = new THREE.WebGLRenderer({
      antialias: tier.antialias, alpha: false, powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.pixelRatio));
    this.renderer.shadowMap.enabled = tier.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

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

    this.buildLights();
    this.buildEnvironment();
    this.buildMarkers();
    this.buildParticles(tier.particleCap);
    this.rebuildDigitTextures();

    // Shared geometry for all tokens (one draw-call-friendly box).
    const t = FRAMING.tokenScale * FRAMING.cellSize;
    this.tokenGeo = new THREE.BoxGeometry(t, FRAMING.tokenHeight, t);

    this.clock = new THREE.Clock();
    this.running = false;
    this.resize();
  }

  // --- scene construction ---------------------------------------------------

  buildLights() {
    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    this.keyLight.position.set(4, 10, 5);
    this.keyLight.castShadow = QUALITY_TIERS[this.tierName].shadows;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.keyLight);
    this.fill = new THREE.HemisphereLight(0xfff6e0, 0x8a87a0, 0.9);
    this.scene.add(this.fill);
  }

  buildEnvironment() {
    if (this.paper) {
      this.paper.geometry.dispose();
      this.scene.remove(this.paper);
    }
    if (this.paperTex) this.paperTex.dispose();
    this.paperTex = makePaperTexture(this.theme);
    this.paperTex.repeat.set(3, 3);
    const mat = new THREE.MeshStandardMaterial({ map: this.paperTex, roughness: 0.95, metalness: 0 });
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat);
    this.paper.rotation.x = -Math.PI / 2;
    this.paper.position.y = -FRAMING.tokenHeight / 2 - 0.01;
    this.paper.receiveShadow = true;
    this.paper.layers.set(LAYER_ENV);
    this.scene.add(this.paper);
    this.scene.background = new THREE.Color(this.theme.sky);
    this.fill.color.set(this.theme.paper);
    this.fill.groundColor.set(this.theme.rule);
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

  buildParticles(cap) {
    if (this.points) {
      this.points.geometry.dispose();
      this.scene.remove(this.points);
    }
    this.particleCap = cap;
    this.particleData = new Float32Array(cap * 8); // x,y,z,vx,vy,vz,life,size
    this.particleAlive = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: this.theme.accent, size: 0.09, transparent: true, opacity: 0.9,
      sizeAttenuation: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.layers.set(LAYER_ENV); // cosmetic particles never intercept raycasts
    this.scene.add(this.points);
  }

  rebuildDigitTextures() {
    for (const t of this.digitTextures) t.dispose();
    this.digitTextures = [];
    this.tokenMaterials = [];
    for (let d = 1; d <= 9; d++) {
      const tex = makeDigitTexture(this.theme, d);
      this.digitTextures.push(tex);
      this.tokenMaterials[d] = new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.55, metalness: 0.05,
        emissive: new THREE.Color(this.theme.select), emissiveIntensity: 0,
      });
    }
  }

  rebuildGpuResources() {
    // Context recovery: rebuild GPU resources from retained CPU descriptors.
    this.rebuildDigitTextures();
    this.buildEnvironment();
    if (this.state) this.syncState(this.state, this.selection, true);
  }

  setTheme(themeId) {
    this.theme = getTheme(themeId);
    this.rebuildDigitTextures();
    this.buildEnvironment();
    this.ring.material.color.set(this.theme.select);
    this.pathLine.material.color.set(this.theme.legal);
    this.pathDots.material.color.set(this.theme.legal);
    this.points.material.color.set(this.theme.accent);
    for (const view of this.tokens.values()) {
      view.mesh.material = this.tokenMaterials[view.digit] || this.tokenMaterials[1];
    }
  }

  setQuality(tierName) {
    this.tierName = tierName in QUALITY_TIERS ? tierName : 'medium';
    const tier = QUALITY_TIERS[this.tierName];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.pixelRatio));
    this.keyLight.castShadow = tier.shadows;
    this.renderer.shadowMap.enabled = tier.shadows;
    this.buildParticles(tier.particleCap);
    this.resize();
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
    this.renderer.setSize(w, h);
    this.fitCamera(w / h);
  }

  fitCamera(aspect) {
    const cols = this.state?.cols || 9;
    const rows = Math.max(3, Math.ceil((this.state?.cells.length || cols * 4) / cols));
    const halfW = (cols * FRAMING.cellSize) / 2 + FRAMING.marginX;
    const halfH = (rows * FRAMING.cellSize) / 2 + FRAMING.marginY;
    let vw = halfW;
    let vh = halfW / aspect;
    if (vh < halfH) { vh = halfH; vw = halfH * aspect; }
    this.camera.left = -vw;
    this.camera.right = vw;
    this.camera.top = vh;
    this.camera.bottom = -vh;
    const tilt = FRAMING.cameraTilt;
    const d = FRAMING.cameraDistance;
    this.camera.position.set(0, Math.cos(tilt) * d, Math.sin(tilt) * d);
    this.camera.lookAt(0, 0, 0.4);
    this.camera.updateProjectionMatrix();
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
      } else if (view.digit !== digit) {
        view.digit = digit;
        view.mesh.material = this.tokenMaterials[digit];
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
    this.updateLegalHighlights();
    this.updateSelectionVisuals();
  }

  spawnToken(index, digit) {
    const mesh = new THREE.Mesh(this.tokenGeo, this.tokenMaterials[digit]);
    mesh.castShadow = QUALITY_TIERS[this.tierName].shadows;
    mesh.layers.set(LAYER_PICK);
    mesh.userData.cell = index;
    const pos = this.cellToWorld(index);
    mesh.position.copy(pos);
    this.tokenGroup.add(mesh);
    const view = {
      mesh, digit, index, target: pos.clone(),
      vel: new THREE.Vector3(), scaleV: 0, scale: 1, targetScale: 1,
      dying: false, lift: 0, pulse: 0,
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
    this.tokens.delete(index);
  }

  spawnBurst(pos, n) {
    if (this.reducedMotion) return;
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
      if (isSel) { mat.emissive.set(this.theme.select); view.emissiveTarget = 0.45; }
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
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  frame() {
    if (this.contextLost) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    this.animTime += dt;
    this.updateTokens(dt);
    this.updateParticles(dt);
    this.updateCameraShake(dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateTokens(dt) {
    const smooth = this.reducedMotion ? 0.02 : 0.14;
    for (const [i, view] of this.tokens) {
      const m = view.mesh;
      const ty = (view.target?.y ?? 0) + (view.liftTarget || 0);
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
      mat.emissiveIntensity += (targetE - ei) * Math.min(1, dt * 12);
      if (view.pulse > 0) {
        view.pulse -= dt;
        if (view.pulse <= 0) mat.emissive.set(this.theme.select);
      }
      if (view.dying && view.scale < 0.05) this.releaseToken(i);
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
    for (const t of this.digitTextures) t.dispose();
    this.paperTex?.dispose();
    this.tokenGeo?.dispose();
    for (const m of this.tokenMaterials || []) m?.dispose();
    this.points?.geometry.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
