// 3D 場景：棋盤、棋子、動畫與互動
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Effects, accretionMaterial, pillarMaterial } from './effects.js';
import { BLACK, WHITE, VOID, xy } from './game.js';
import { getScientist } from './scientists.js';

const R = 0.43, H = 0.09;            // 棋子半徑 / 半厚度
const PIECE_Y = H + 0.012;
const SURFACE_Y = 0.006;
export const PLAYER_FX = { [BLACK]: '#6fd3ff', [WHITE]: '#ffd36f' };

const cellPos = (i, y = 0) => { const [x, z] = xy(i); return new THREE.Vector3(x - 3.5, y, z - 3.5); };
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInQuad = t => t * t;

export class BoardView {
  constructor(container, sfx) {
    this.container = container;
    this.sfx = sfx;
    this.tweens = [];
    this.timeScale = 1;
    this.time = 0;
    this.pieces = new Array(64).fill(null);
    this.voids = new Map();
    this.shieldFx = new Map();
    this.markers = [];
    this.highlightSet = new Set();
    this.highlightMode = 'empty';
    this.ghostColor = BLACK;
    this.hoverCell = -1;
    this.interactive = false;
    this.onCellClick = null;
    this._shakeAmt = 0;
    this._shakeOff = new THREE.Vector3();

    this._initRenderer();
    this._initLights();
    this._buildTable();
    this._buildBoard();
    this._buildBackdrop();
    this._buildPieceAssets();
    this.effects = new Effects(this.scene);
    this._initPost();
    this._initEvents();

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._loop());
  }

  // ================================================================ 初始化
  _initRenderer() {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04050a);
    this.scene.fog = new THREE.Fog(0x04050a, 30, 72);
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;

    this.viewColor = BLACK;
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 300);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.zoomSpeed = 0.65;
    this.controls.minPolarAngle = 0.28;
    this.controls.maxPolarAngle = 1.15;
    this.setViewSide(BLACK, false);
    this.controls.addEventListener('start', () => { this._camTweenId = (this._camTweenId || 0) + 1; });
  }

  _initLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x8fa6ff, 0x1a1208, 0.32));
    const spot = new THREE.SpotLight(0xfff0dc, 580, 48, 0.58, 0.7, 2);
    spot.position.set(3, 16, 5);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.bias = -0.0002;
    spot.shadow.normalBias = 0.02;
    spot.shadow.camera.near = 5; spot.shadow.camera.far = 42;
    s.add(spot, spot.target);
    const rim = new THREE.DirectionalLight(0x6c8cff, 0.75);
    rim.position.set(-8, 6, -10);
    s.add(rim);
    const warm = new THREE.PointLight(0xff9a50, 32, 30, 2);
    warm.position.set(9, 3, 8);
    s.add(warm);
  }

  _buildTable() {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(512, 512, 50, 512, 512, 720);
    g.addColorStop(0, '#1d1f27'); g.addColorStop(1, '#0a0b0f');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
    // 大理石紋
    for (let i = 0; i < 40; i++) {
      x.strokeStyle = `rgba(${150 + Math.random() * 60},${150 + Math.random() * 50},${170 + Math.random() * 60},${0.02 + Math.random() * 0.05})`;
      x.lineWidth = 0.5 + Math.random() * 2.5;
      x.beginPath();
      let px = Math.random() * 1024, py = Math.random() * 1024;
      x.moveTo(px, py);
      for (let k = 0; k < 30; k++) { px += (Math.random() - 0.3) * 60; py += (Math.random() - 0.5) * 60; x.lineTo(px, py); }
      x.stroke();
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2, 2);
    const table = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 0.4, 128),
      new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.28, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.12 }));
    table.position.y = -0.92;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  _woodTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1024, 1024);
    g.addColorStop(0, '#5b2d14'); g.addColorStop(0.5, '#3e1c0b'); g.addColorStop(1, '#552a12');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 260; i++) {
      const y0 = Math.random() * 1024;
      const dark = Math.random() < 0.6;
      x.strokeStyle = dark ? `rgba(20,8,2,${0.06 + Math.random() * 0.18})` : `rgba(160,90,45,${0.04 + Math.random() * 0.1})`;
      x.lineWidth = 0.6 + Math.random() * 3;
      x.beginPath();
      for (let px = 0; px <= 1024; px += 12) {
        const yy = y0 + Math.sin(px * 0.004 + i) * 14 + Math.sin(px * 0.021 + i * 3.1) * 3;
        px === 0 ? x.moveTo(px, yy) : x.lineTo(px, yy);
      }
      x.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  _surfaceTexture() {
    const S = 2048, U = S / 8.4, M = 0.2 * U;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.75);
    g.addColorStop(0, '#11594a'); g.addColorStop(1, '#062a22');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    // 絨布顆粒
    const img = x.getImageData(0, 0, S, S), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(img, 0, 0);
    // 每格內微暗角
    for (let cx = 0; cx < 8; cx++) for (let cy = 0; cy < 8; cy++) {
      const gx = M + cx * U + U / 2, gy = M + cy * U + U / 2;
      const rg = x.createRadialGradient(gx, gy, U * 0.1, gx, gy, U * 0.72);
      rg.addColorStop(0, 'rgba(255,255,255,0.035)'); rg.addColorStop(1, 'rgba(0,0,0,0.12)');
      x.fillStyle = rg; x.fillRect(M + cx * U, M + cy * U, U, U);
    }
    // 金色格線
    x.strokeStyle = 'rgba(222,184,92,0.85)'; x.lineWidth = 4;
    x.shadowColor = 'rgba(255,210,120,0.6)'; x.shadowBlur = 6;
    for (let k = 0; k <= 8; k++) {
      x.beginPath(); x.moveTo(M + k * U, M); x.lineTo(M + k * U, S - M); x.stroke();
      x.beginPath(); x.moveTo(M, M + k * U); x.lineTo(S - M, M + k * U); x.stroke();
    }
    x.lineWidth = 10; x.strokeRect(M - 14, M - 14, S - 2 * M + 28, S - 2 * M + 28);
    x.fillStyle = 'rgba(240,200,110,1)';
    for (const [a, b] of [[2, 2], [6, 2], [2, 6], [6, 6]]) { x.beginPath(); x.arc(M + a * U, M + b * U, 14, 0, Math.PI * 2); x.fill(); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  _labelTexture() {
    const S = 2048, W = 9.2, U = S / W;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(232,196,110,0.95)';
    x.font = `bold ${Math.round(U * 0.24)}px Georgia, serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const off = (v) => S / 2 + v * U;
    for (let k = 0; k < 8; k++) {
      const p = off(k - 3.5);
      x.fillText('ABCDEFGH'[k], p, off(-4.42)); x.fillText('ABCDEFGH'[k], p, off(4.42));
      x.fillText(String(k + 1), off(-4.42), p); x.fillText(String(k + 1), off(4.42), p);
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  _buildBoard() {
    const g = this.boardGroup = new THREE.Group();
    const gold = this.goldMat = new THREE.MeshPhysicalMaterial({ color: 0xd9a845, metalness: 1, roughness: 0.22, clearcoat: 0.4 });

    // 木框
    const frame = new THREE.Mesh(new RoundedBoxGeometry(9.6, 0.5, 9.6, 6, 0.18),
      new THREE.MeshPhysicalMaterial({ map: this._woodTexture(), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }));
    frame.position.y = -0.25; frame.castShadow = true; frame.receiveShadow = true;
    g.add(frame);

    // 底座金屬飾條
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(10.0, 0.22, 10.0, 4, 0.08), gold);
    plinth.position.y = -0.6; plinth.castShadow = true; plinth.receiveShadow = true;
    g.add(plinth);

    // 座標文字
    const labels = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 9.2),
      new THREE.MeshStandardMaterial({ map: this._labelTexture(), transparent: true, metalness: 0.8, roughness: 0.3, depthWrite: false }));
    labels.rotation.x = -Math.PI / 2; labels.position.y = 0.002;
    g.add(labels);

    // 棋盤面（漆面絨布）
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 8.4),
      new THREE.MeshPhysicalMaterial({ map: this._surfaceTexture(), roughness: 0.6, clearcoat: 0.5, clearcoatRoughness: 0.18 }));
    surf.rotation.x = -Math.PI / 2; surf.position.y = SURFACE_Y; surf.receiveShadow = true;
    g.add(surf);

    // 金色鑲邊
    const strip = (w, d, px, pz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), gold);
      m.position.set(px, SURFACE_Y + 0.012, pz); m.castShadow = true; m.receiveShadow = true; g.add(m);
    };
    strip(8.56, 0.08, 0, -4.24); strip(8.56, 0.08, 0, 4.24); strip(0.08, 8.4, -4.24, 0); strip(0.08, 8.4, 4.24, 0);
    // 四角金飾
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.06, 24), gold);
      k.position.set(sx * 4.24, SURFACE_Y + 0.02, sz * 4.24); k.castShadow = true; g.add(k);
    }
    this.scene.add(g);

    // 點擊判定平面
    this.pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PIECE_Y);

    // 最後一步標記
    this.lastMarker = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.49, 48), this._glow('#ff5577', 0.9, 2.2));
    this.lastMarker.rotation.x = -Math.PI / 2; this.lastMarker.position.y = SURFACE_Y + 0.004; this.lastMarker.visible = false;
    this.scene.add(this.lastMarker);
  }

  _buildBackdrop() {
    // 星空
    const n = 2500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 1.6 - 0.6), r = 90 + Math.random() * 40;
      pos.set([Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r, Math.sin(ph) * Math.sin(th) * r], i * 3);
      const c = new THREE.Color().setHSL(0.55 + Math.random() * 0.2, 0.5, 0.6 + Math.random() * 0.4);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.35, vertexColors: true, fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
    this.scene.add(this.stars);

    // 漂浮光塵
    const m = 260, mp = new Float32Array(m * 3);
    for (let i = 0; i < m; i++) mp.set([(Math.random() - 0.5) * 22, Math.random() * 7, (Math.random() - 0.5) * 22], i * 3);
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    const dot = document.createElement('canvas'); dot.width = dot.height = 64;
    const dx = dot.getContext('2d'), gr = dx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,230,170,1)'); gr.addColorStop(1, 'rgba(255,230,170,0)');
    dx.fillStyle = gr; dx.fillRect(0, 0, 64, 64);
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({ size: 0.12, map: new THREE.CanvasTexture(dot), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.motes);
  }

  _buildPieceAssets() {
    const prof = [[R, 0], [R, 0.026], [R - 0.006, 0.054], [R - 0.022, 0.076], [R - 0.05, H], [0.33, H], [0.322, H - 0.007], [0.3, H - 0.007], [0.292, H], [0.0001, H]];
    this.geoTop = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 72);
    this.geoBot = new THREE.LatheGeometry(prof.slice().reverse().map(([a, b]) => new THREE.Vector2(a, -b)), 72);
    this.geoSeam = new THREE.TorusGeometry(R + 0.001, 0.007, 6, 72).rotateX(Math.PI / 2);
    this.geoMark = new THREE.TorusGeometry(R + 0.012, 0.016, 8, 72).rotateX(Math.PI / 2);
    this.geoGroove = new THREE.TorusGeometry(0.311, 0.01, 6, 64).rotateX(Math.PI / 2);
    this.matBlack = new THREE.MeshPhysicalMaterial({ color: 0x0d0e12, roughness: 0.25, metalness: 0.08, clearcoat: 0.85, clearcoatRoughness: 0.06 });
    // 柔和溫潤的骨瓷／暖灰象牙色，避免高光過曝刺眼
    this.matWhite = new THREE.MeshPhysicalMaterial({ color: 0xa39d90, roughness: 0.52, metalness: 0.05, clearcoat: 0.2, clearcoatRoughness: 0.38 });
    const ghost = m => { const g = m.clone(); g.transparent = true; g.opacity = 0.42; g.depthWrite = false; return g; };
    this.ghostMats = { black: ghost(this.matBlack), white: ghost(this.matWhite) };
    this.markMats = {};
  }

  _glow(color, opacity = 1, k = 3) {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  }

  _initPost() {
    const w = window.innerWidth, h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // 提高閾值至 1.12，讓特效發光而白子與棋盤絕不過曝發亮
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.4, 1.12);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _initEvents() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
    const cellAt = e => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      if (!ray.ray.intersectPlane(this.pickPlane, hit)) return -1;
      const cx = Math.floor(hit.x + 4), cz = Math.floor(hit.z + 4);
      return cx >= 0 && cx < 8 && cz >= 0 && cz < 8 ? cz * 8 + cx : -1;
    };
    let down = null;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', e => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 14) return;
      const c = cellAt(e);
      if (this.interactive && c >= 0 && this.highlightSet.has(c)) this.onCellClick?.(c);
      else this.onEmptyClick?.(c);
    });
    el.addEventListener('dblclick', e => {
      if (cellAt(e) < 0) this.resetView(true);
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const c = this.interactive ? cellAt(e) : -1;
      if (c !== this.hoverCell) { this.hoverCell = c; this._updateHover(); }
    });
    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.camera.aspect = w / h;
      this.renderer.setSize(w, h);
      this.composer.setSize(w, h);
      this.effects.onResize();
      this.setViewSide(this.viewColor, false);
    });
  }

  // ================================================================ 棋子
  createPiece(color, mark = null, ghost = false) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(this.geoTop, ghost ? this.ghostMats.black : this.matBlack);
    const bot = new THREE.Mesh(this.geoBot, ghost ? this.ghostMats.white : this.matWhite);
    const seam = new THREE.Mesh(this.geoSeam, this.goldMat);
    for (const m of [top, bot]) { m.castShadow = !ghost; m.receiveShadow = !ghost; }
    g.add(top, bot, seam);
    g.userData.color = color;
    this._orient(g, color);
    if (mark) this._setMark(g, mark);
    return g;
  }

  _orient(p, color, yaw = p.rotation?.y || 0) {
    p.rotation.set(color === BLACK ? 0 : Math.PI, yaw, 0);
    p.userData.color = color;
  }

  _markMat(id) {
    if (!this.markMats[id]) this.markMats[id] = this._glow(getScientist(id).color, 1, 2.6);
    return this.markMats[id];
  }

  _setMark(p, id) {
    if (p.userData.mark === id) return;
    if (p.userData.markObj) { p.remove(p.userData.markObj); p.userData.markObj = null; }
    p.userData.mark = id || null;
    if (!id) return;
    const m = new THREE.Group(), mat = this._markMat(id);
    m.add(new THREE.Mesh(this.geoMark, mat));
    const gt = new THREE.Mesh(this.geoGroove, mat); gt.position.y = H - 0.004;
    const gb = new THREE.Mesh(this.geoGroove, mat); gb.position.y = -H + 0.004;
    m.add(gt, gb);
    p.add(m); p.userData.markObj = m;
  }

  _removePiece(i) {
    const p = this.pieces[i];
    if (p) { this.scene.remove(p); this.pieces[i] = null; }
  }

  // ================================================================ 補間
  tween(dur, fn, ease = t => t) {
    return new Promise(res => this.tweens.push({ t: 0, dur, fn, ease, res }));
  }
  wait(s) { return this.tween(s, () => {}); }
  shake(a) { this._shakeAmt = Math.max(this._shakeAmt, a); }

  // ================================================================ 動畫
  async animatePlace(cell, color, ability) {
    this._removePiece(cell);
    const p = this.createPiece(color, ability);
    const pos = cellPos(cell);
    const yaw0 = Math.random() * Math.PI * 2;
    p.position.set(pos.x, PIECE_Y + 4, pos.z);
    this.scene.add(p);
    this.pieces[cell] = p;
    const sc = ability ? getScientist(ability) : null;
    await this.tween(ability ? 0.5 : 0.36, k => {
      p.position.y = PIECE_Y + 4 * (1 - k);
      p.rotation.y = yaw0 + (1 - k) * (ability ? 9 : 4);
    }, easeInQuad);
    p.position.y = PIECE_Y;
    const fxColor = sc ? sc.color : PLAYER_FX[color];
    this.effects.impact(pos, fxColor, !!ability);
    this.sfx?.place(!!ability);
    this.shake(ability ? 0.22 : 0.06);
    this.lastMarker.visible = true; this.lastMarker.position.x = pos.x; this.lastMarker.position.z = pos.z;
    if (this.timeScale < 1) this.tween(0.6, k => { this.timeScale = 0.35 + 0.65 * k; }).then(() => { this.timeScale = 1; });
    await this.tween(0.16, k => { p.position.y = PIECE_Y + Math.sin(k * Math.PI) * 0.07; });
    p.position.y = PIECE_Y;
  }

  flipPiece(cell, toColor, origin, fxColor) {
    const p = this.pieces[cell];
    if (!p) return Promise.resolve();
    const pos = cellPos(cell);
    const o = origin != null && origin !== cell ? cellPos(origin) : pos.clone().add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5));
    const dir = pos.clone().sub(o); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();
    const axis = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    const q0 = p.quaternion.clone(), qa = new THREE.Quaternion();
    let sparked = false;
    this.sfx?.flip();
    return this.tween(0.52, k => {
      const e = easeInOutCubic(k);
      qa.setFromAxisAngle(axis, Math.PI * e);
      p.quaternion.copy(qa).multiply(q0);
      p.position.y = PIECE_Y + Math.sin(k * Math.PI) * 0.75;
      if (!sparked && k > 0.5) { sparked = true; this.effects.sparkle(new THREE.Vector3(pos.x, p.position.y, pos.z), fxColor, 16); }
    }).then(() => {
      p.position.y = PIECE_Y;
      this._orient(p, toColor, p.rotation.y);
      this.effects.shockwave(pos, fxColor, 0.7, 0.35, SURFACE_Y + 0.01, 0.2);
    });
  }

  flipWave(cells, origin, toColor, fxColor, stagger = 0.07) {
    const o = origin != null ? cellPos(origin) : null;
    return Promise.all(cells.map(c => {
      const d = o ? cellPos(c).distanceTo(o) : 0;
      return this.wait(d * stagger).then(() => this.flipPiece(c, toColor, origin, fxColor));
    }));
  }

  async playResult(res) {
    const color = res.color;
    const sc = res.ability ? getScientist(res.ability) : null;
    const fx = sc ? sc.color : PLAYER_FX[color];
    for (const st of res.steps) {
      const pos = st.origin != null ? cellPos(st.origin) : st.cell != null ? cellPos(st.cell) : null;
      switch (st.kind) {
        case 'place':
          await this.animatePlace(st.cell, st.color, st.ability);
          break;

        case 'flip': {
          const sty = st.style ? getScientist(st.style).color : PLAYER_FX[color];
          await this.flipWave(st.cells, st.origin, color, sty);
          break;
        }

        case 'gravity':
          this.effects.gravityWell(pos, fx);
          this.sfx?.ability('newton');
          await this.wait(0.8);
          break;

        case 'timewarp':
          this.sfx?.ability('einstein');
          this.effects.timeWarp(pos, fx, 1.4);
          this.timeScale = 0.35;
          await this.wait(0.3);
          break;

        case 'radiation':
          this.sfx?.ability('curie');
          this.effects.radiation(pos, fx, st.cells.map(c => cellPos(c)));
          st.cells.forEach(c => this.effects.pillar(cellPos(c), fx, 0.9));
          await this.wait(0.7);
          break;

        case 'lightning': {
          this.sfx?.ability('tesla');
          const flips = [];
          for (let k = 0; k + 1 < st.path.length; k++) {
            const a = cellPos(st.path[k], 0.35), b = cellPos(st.path[k + 1], 0.35);
            this.effects.lightning(a, b, fx);
            this.sfx?.zap();
            this.shake(0.12);
            flips.push(this.flipPiece(st.path[k + 1], color, st.path[k], fx));
            await this.wait(0.3);
          }
          if (st.path.length < 2) { this.effects.burst(pos, fx, 80, { speed: 4 }); this.sfx?.zap(); }
          await Promise.all(flips);
          break;
        }

        case 'shield':
          this.sfx?.ability('faraday');
          this.effects.cage(pos, fx);
          await this.wait(1.0);
          break;

        case 'blackhole': {
          this.sfx?.ability('hawking');
          this.effects.blackHole(pos);
          this.shake(0.25);
          await this.wait(0.9);
          this._addVoid(st.cell, true);
          break;
        }

        case 'remove': {
          const center = cellPos(st.origin, 0.5);
          await Promise.all(st.cells.map((c, n) => {
            const p = this.pieces[c];
            if (!p) return Promise.resolve();
            const start = p.position.clone();
            const a0 = Math.atan2(start.z - center.z, start.x - center.x), r0 = Math.hypot(start.x - center.x, start.z - center.z);
            return this.wait(n * 0.05).then(() => this.tween(0.8, k => {
              const r = r0 * (1 - k), a = a0 + k * 5;
              p.position.set(center.x + Math.cos(a) * r, PIECE_Y + (center.y - PIECE_Y) * k, center.z + Math.sin(a) * r);
              p.scale.setScalar(Math.max(0.01, 1 - k));
              p.rotation.z += 0.3; p.rotation.x += 0.2;
            }, easeInQuad)).then(() => { if (this.pieces[c] === p) this._removePiece(c); });
          }));
          await this.wait(0.3);
          break;
        }

        case 'decode': {
          this.sfx?.ability('turing');
          this.effects.binary(pos);
          const p = this.pieces[st.cell];
          if (p) {
            const base = p.position.clone();
            await this.tween(0.9, () => {
              p.visible = Math.random() > 0.25;
              p.position.set(base.x + (Math.random() - 0.5) * 0.06, base.y + Math.random() * 0.05, base.z + (Math.random() - 0.5) * 0.06);
            });
            p.visible = true; p.position.copy(base);
            this._setMark(p, 'turing');
            await this.flipPiece(st.cell, st.color, null, fx);
            this.effects.impact(pos, fx, true);
            this.lastMarker.visible = true; this.lastMarker.position.x = pos.x; this.lastMarker.position.z = pos.z;
          }
          break;
        }

        case 'quantum': {
          this.sfx?.ability('schrodinger');
          this._removePiece(st.cell);
          const ghost = this.createPiece(BLACK, null, true);
          ghost.position.set(pos.x, 0.7, pos.z);
          this.scene.add(ghost);
          this.effects.quantum(pos, 1.6);
          await this.tween(1.5, k => {
            ghost.rotation.x = k * 30 + Math.sin(k * 40) * 0.5;
            ghost.rotation.y = k * 6;
            ghost.position.y = 0.7 + Math.sin(k * 20) * 0.08;
            ghost.visible = Math.random() > 0.15;
            ghost.scale.setScalar(1 + Math.sin(k * 50) * 0.06);
          });
          this.scene.remove(ghost);
          const p = this.createPiece(st.color, 'schrodinger');
          p.position.set(pos.x, PIECE_Y, pos.z);
          this.scene.add(p); this.pieces[st.cell] = p;
          this.effects.impact(pos, st.alive ? fx : '#888899', true);
          this.effects.shockwave(pos, '#ffffff', 4, 0.6, 0.05, 0.03);
          this.sfx?.place(true);
          this.shake(0.2);
          this.lastMarker.visible = true; this.lastMarker.position.x = pos.x; this.lastMarker.position.z = pos.z;
          await this.wait(0.4);
          break;
        }

        case 'evolve':
          this.sfx?.ability('darwin');
          this.effects.helix(pos, fx);
          await this.wait(0.8);
          st.cells.forEach(c => this.effects.pillar(cellPos(c), fx, 0.8));
          await this.wait(0.25);
          break;

        case 'fivewhip': {
          this.sfx?.ability('mabaoguo');
          const flips = [];
          const a = cellPos(st.origin, 0.42);
          for (let k = 0; k < 5; k++) {
            const targetCell = st.cells[k];
            let b;
            if (targetCell != null) {
              b = cellPos(targetCell, 0.35);
            } else {
              const ang = (k / 5) * Math.PI * 2;
              b = new THREE.Vector3(
                THREE.MathUtils.clamp(a.x + Math.cos(ang) * 1.8, -3.5, 3.5),
                0.35,
                THREE.MathUtils.clamp(a.z + Math.sin(ang) * 1.8, -3.5, 3.5),
              );
            }
            this.effects.whipStrike(a, b, fx, k);
            this.sfx?.whip(k);
            this.shake(0.14 + k * 0.02);
            if (targetCell != null) flips.push(this.flipPiece(targetCell, color, st.origin, fx));
            await this.wait(0.22);
          }
          await Promise.all(flips);
          break;
        }

        case 'trumpwall':
          this.sfx?.ability('trump');
          this.effects.trumpWall(pos, st.cells.map(c => cellPos(c)), fx);
          this.shake(0.2);
          await this.wait(0.75);
          break;

        case 'punish': {
          this.sfx?.ability('liuzhenren');
          this.effects.liuSeal(pos, fx);
          this.shake(0.2);
          const targets = st.cells || [];
          if (targets.length === 0) {
            await this.wait(0.5);
          } else {
            const flips = [];
            for (let k = 0; k < targets.length; k++) {
              const targetCell = targets[k];
              const tp = cellPos(targetCell);
              this.effects.divineThunder(tp, k, fx);
              this.sfx?.thunder(k);
              this.shake(0.16 + k * 0.02);
              flips.push(this.flipPiece(targetCell, color, st.origin, fx));
              await this.wait(0.2);
            }
            await Promise.all(flips);
          }
          break;
        }

        case 'guoguard':
          this.sfx?.ability('guozhenren');
          this.effects.guoGuard(pos, st.cells.map(c => cellPos(c)), fx);
          this.shake(0.2);
          await this.wait(0.8);
          break;

        default: break;
      }
    }
  }

  // ================================================================ 常駐物件
  _addVoid(cell, animate = false) {
    if (this.voids.has(cell)) return;
    this._removePiece(cell);
    const pos = cellPos(cell);
    const g = new THREE.Group();
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.46, 48), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    hole.rotation.x = -Math.PI / 2; hole.position.y = SURFACE_Y + 0.003;
    const disk = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.5, 64), accretionMaterial(0.55));
    disk.rotation.x = -Math.PI / 2; disk.position.y = SURFACE_Y + 0.006;
    disk.scale.setScalar(1.25);
    const horizon = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 8, 48).rotateX(Math.PI / 2), this._glow('#ffb070', 1, 3));
    horizon.position.y = SURFACE_Y + 0.01;
    g.add(hole, disk, horizon);
    g.position.set(pos.x, 0, pos.z);
    g.userData.disk = disk;
    if (animate) { g.scale.setScalar(0.01); this.tween(0.5, k => g.scale.setScalar(Math.max(0.01, k)), easeOutCubic); }
    this.scene.add(g);
    this.voids.set(cell, g);
  }

  _setShield(cell, on) {
    const has = this.shieldFx.get(cell);
    if (on && !has) {
      const g = new THREE.Group();
      const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.45, 6, 1, true), pillarMaterial('#40e0d0'));
      hex.position.y = 0.22;
      const edge = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.012, 6, 6).rotateX(Math.PI / 2), this._glow('#40e0d0', 1, 3));
      edge.position.y = 0.02;
      const top = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.01, 6, 6).rotateX(Math.PI / 2), this._glow('#7ffff0', 0.8, 3));
      top.position.y = 0.42;
      g.add(hex, edge, top);
      const p = cellPos(cell); g.position.set(p.x, 0, p.z);
      g.userData.phase = Math.random() * 6;
      this.scene.add(g); this.shieldFx.set(cell, g);
    } else if (!on && has) {
      this.scene.remove(has); this.shieldFx.delete(cell);
    }
  }

  /** 讓 3D 畫面完全符合遊戲狀態（動畫結束後或重新開始時呼叫） */
  sync(game) {
    for (let i = 0; i < 64; i++) {
      const v = game.board[i];
      let p = this.pieces[i];
      if (v === BLACK || v === WHITE) {
        if (!p) {
          p = this.createPiece(v, game.marks[i]);
          const pos = cellPos(i); p.position.set(pos.x, PIECE_Y, pos.z); p.rotation.y = Math.random() * 6;
          this._orient(p, v, p.rotation.y);
          this.scene.add(p); this.pieces[i] = p;
        } else {
          if (p.userData.color !== v) this._orient(p, v, p.rotation.y);
          p.visible = true; p.scale.setScalar(1);
        }
        this._setMark(p, game.marks[i] || null);
      } else if (p) this._removePiece(i);

      if (v === VOID) this._addVoid(i);
      else if (this.voids.has(i)) { this.scene.remove(this.voids.get(i)); this.voids.delete(i); }

      this._setShield(i, (v === BLACK || v === WHITE) && game.isShielded(i));
    }
    if (game.lastMove != null && game.board[game.lastMove] !== VOID) {
      const pos = cellPos(game.lastMove);
      this.lastMarker.visible = true; this.lastMarker.position.x = pos.x; this.lastMarker.position.z = pos.z;
    } else this.lastMarker.visible = false;
  }

  reset() {
    this.tweens = [];
    this.timeScale = 1;
    this._camTweenId = (this._camTweenId || 0) + 1;
    for (let i = 0; i < 64; i++) this._removePiece(i);
    for (const g of this.voids.values()) this.scene.remove(g);
    this.voids.clear();
    for (const g of this.shieldFx.values()) this.scene.remove(g);
    this.shieldFx.clear();
    this.lastMarker.visible = false;
    this.setHighlights([], '#ffffff', 'empty');
  }

  // ================================================================ 提示 / 懸停
  setHighlights(cells, color, mode = 'empty', ghostColor = BLACK) {
    for (const m of this.markers) this.scene.remove(m);
    this.markers = [];
    this.highlightSet = new Set(cells);
    this.highlightMode = mode;
    this.ghostColor = ghostColor;
    this.hlColor = color;
    const mat = this._glow(color, 0.9, 2.2);
    for (const c of cells) {
      const pos = cellPos(c);
      let m;
      if (mode === 'enemy') {
        m = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.02, 8, 48).rotateX(Math.PI / 2), mat);
        m.position.set(pos.x, PIECE_Y + 0.02, pos.z);
      } else {
        m = new THREE.Group();
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 24), mat);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.3, 40), mat);
        dot.rotation.x = ring.rotation.x = -Math.PI / 2;
        m.add(dot, ring);
        m.position.set(pos.x, SURFACE_Y + 0.006, pos.z);
      }
      m.userData.phase = (pos.x + pos.z) * 0.6;
      this.scene.add(m); this.markers.push(m);
    }
    this._updateHover();
  }

  _updateHover() {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (this.hoverRing) { this.scene.remove(this.hoverRing); this.hoverRing = null; }
    const c = this.hoverCell;
    const ok = this.interactive && c >= 0 && this.highlightSet.has(c);
    this.renderer.domElement.style.cursor = ok ? 'pointer' : 'default';
    if (!ok) return;
    const pos = cellPos(c);
    if (this.highlightMode === 'enemy') {
      this.hoverRing = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 32, 1, true), pillarMaterial(this.hlColor));
      this.hoverRing.position.set(pos.x, 0.8, pos.z);
      this.scene.add(this.hoverRing);
    } else {
      this.ghost = this.createPiece(this.ghostColor, null, true);
      this.ghost.position.set(pos.x, PIECE_Y + 0.25, pos.z);
      this.scene.add(this.ghost);
      this.hoverRing = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 1.2, 32, 1, true), pillarMaterial(this.hlColor));
      this.hoverRing.position.set(pos.x, 0.6, pos.z);
      this.scene.add(this.hoverRing);
    }
    this.sfx?.hover();
  }

  _getIdealView(color = this.viewColor) {
    const w = window.innerWidth, h = Math.max(1, window.innerHeight);
    const aspect = w / h;
    const isPortrait = aspect < 0.95;
    const fov = isPortrait ? THREE.MathUtils.clamp(42 + (0.95 - aspect) * 28, 42, 58) : 42;
    this.camera.fov = fov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    const halfTan = Math.tan(THREE.MathUtils.degToRad(fov * 0.5));
    // 確保寬 10.0 的棋盤底座在手機直立螢幕左右完整呈現並保留舒適邊距（可視寬度 >= 10.8）
    const minWDist = 10.8 / (2 * halfTan * Math.max(aspect, 0.36));
    const dist = Math.max(15.84, minWDist);
    this.controls.minDistance = dist * 0.78;
    this.controls.maxDistance = dist * 1.22;

    const sign = color === WHITE ? -1 : 1;
    // 直立模式拉高俯角（讓 8x8 棋格更方正、手指更好點擊）
    const elev = isPortrait ? 0.875 : 0.795;
    const horiz = Math.sqrt(1 - elev * elev);
    const target = new THREE.Vector3(0, dist * elev, sign * dist * horiz);
    const tz = sign * (isPortrait ? 0.35 : 0.3);
    return { target, tz, dist };
  }

  setViewSide(color = this.viewColor, animate = true) {
    this.viewColor = color;
    const { target, tz } = this._getIdealView(color);
    const id = (this._camTweenId = (this._camTweenId || 0) + 1);
    if (!animate) {
      this.camera.position.copy(target);
      this.controls.target.set(0, 0, tz);
      this.controls.update();
      return Promise.resolve();
    }
    const from = this.camera.position.clone(), t0 = this.controls.target.clone();
    const sph0 = new THREE.Spherical().setFromVector3(from), sph1 = new THREE.Spherical().setFromVector3(target);
    let dTheta = sph1.theta - sph0.theta;
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    return this.tween(0.95, k => {
      if (this._camTweenId !== id) return;
      const s = new THREE.Spherical(sph0.radius + (sph1.radius - sph0.radius) * k, sph0.phi + (sph1.phi - sph0.phi) * k, sph0.theta + dTheta * k);
      this.camera.position.setFromSpherical(s);
      this.controls.target.set(0, 0, t0.z + (tz - t0.z) * k);
    }, easeInOutCubic);
  }

  resetView(animate = true) {
    return this.setViewSide(this.viewColor, animate);
  }

  introCamera(color) {
    this.viewColor = color;
    const { dist } = this._getIdealView(color);
    const scale = dist / 15.84;
    this.camera.position.set(6 * scale, 16.5 * scale, (color === WHITE ? -13.5 : 13.5) * scale);
    return this.setViewSide(color, true);
  }

  // ================================================================ 主迴圈
  _loop() {
    const rdt = Math.min(this.clock.getDelta(), 0.05);
    const dt = rdt * this.timeScale;
    this.time += rdt;

    for (let k = this.tweens.length - 1; k >= 0; k--) {
      const tw = this.tweens[k];
      tw.t += dt;
      const p = Math.min(1, tw.t / tw.dur);
      tw.fn(tw.ease(p));
      if (p >= 1) { this.tweens.splice(k, 1); tw.res(); }
    }
    this.effects.update(dt);

    const t = this.time;
    for (const m of this.markers) {
      const s = 0.85 + Math.sin(t * 4 + m.userData.phase) * 0.15;
      m.scale.set(s, 1, s);
    }
    if (this.ghost) { this.ghost.position.y = PIECE_Y + 0.25 + Math.sin(t * 5) * 0.05; this.ghost.rotation.y = t; }
    for (const g of this.voids.values()) { g.userData.disk.material.uniforms.uTime.value = t; }
    for (const g of this.shieldFx.values()) {
      g.rotation.y = t * 0.6 + g.userData.phase;
      g.children[0].material.uniforms.uOpacity.value = 0.45 + Math.sin(t * 3 + g.userData.phase) * 0.15;
    }
    this.lastMarker.material.opacity = 0.5 + Math.sin(t * 3) * 0.3;
    this.stars.rotation.y = t * 0.004;
    const mp = this.motes.geometry.attributes.position;
    for (let i = 0; i < mp.count; i++) {
      let y = mp.getY(i) + rdt * 0.12;
      if (y > 7) y = 0;
      mp.setY(i, y);
      mp.setX(i, mp.getX(i) + Math.sin(t * 0.5 + i) * rdt * 0.05);
    }
    mp.needsUpdate = true;

    this.camera.position.sub(this._shakeOff);
    this.controls.update();
    if (this._shakeAmt > 0.001) {
      this._shakeOff.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(this._shakeAmt);
      this._shakeAmt *= Math.exp(-rdt * 9);
    } else this._shakeOff.set(0, 0, 0);
    this.camera.position.add(this._shakeOff);

    this.composer.render();
  }
}
