// 特效系統：GPU 粒子 + 各種網格特效（衝擊波、閃電、光束、黑洞、護盾、二進位雨……）
import * as THREE from 'three';

const MAX_P = 8000;
const rand = (a, b) => a + Math.random() * (b - a);
// 讓粒子大小約等於世界座標單位（fov 45°）
const pointScale = () => window.innerHeight * 1.2 * Math.min(window.devicePixelRatio, 2);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.time = 0;
    this._initParticles();
    this._digitTex = ['0', '1'].map(d => this._textTexture(d, '#00ff9c'));
    this._qTex = this._textTexture('?', '#ff4fd8');
    this._leafTex = this._textTexture('❦', '#9be15d');
    this._whipTex = ['閃', '電', '五', '連', '鞭'].map(ch => this._textTexture(ch, '#ffe14d'));
  }

  // ------------------------------------------------------------ 粒子
  _initParticles() {
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_P * 3);
    this.pCol = new Float32Array(MAX_P * 3);
    this.pSize = new Float32Array(MAX_P);
    this.pAlpha = new Float32Array(MAX_P);
    this.pVel = new Float32Array(MAX_P * 3);
    this.pLife = new Float32Array(MAX_P);
    this.pMax = new Float32Array(MAX_P);
    this.pGrav = new Float32Array(MAX_P);
    this.pDrag = new Float32Array(MAX_P);
    this.pSize0 = new Float32Array(MAX_P);
    this.pAttr = new Float32Array(MAX_P * 4); // 吸引點 xyz + 強度
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('palpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: pointScale() } },
      vertexShader: `
        attribute vec3 pcolor; attribute float psize; attribute float palpha;
        varying vec3 vC; varying float vA; uniform float uScale;
        void main(){
          vC = pcolor; vA = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          a = a * a * vA;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vC * a, a);
        }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.scene.add(this.points);
    this.pIdx = 0;
  }

  /** 發射一顆粒子 */
  emit(p) {
    const i = this.pIdx; this.pIdx = (this.pIdx + 1) % MAX_P;
    this.pPos.set([p.x, p.y, p.z], i * 3);
    this.pVel.set([p.vx || 0, p.vy || 0, p.vz || 0], i * 3);
    const c = p.color, k = p.intensity ?? 2.5;
    this.pCol.set([c.r * k, c.g * k, c.b * k], i * 3);
    this.pLife[i] = this.pMax[i] = p.life ?? 1;
    this.pGrav[i] = p.gravity ?? 0;
    this.pDrag[i] = p.drag ?? 1.5;
    this.pSize0[i] = p.size ?? 0.12;
    if (p.attract) this.pAttr.set([p.attract.x, p.attract.y, p.attract.z, p.attractK ?? 8], i * 4);
    else this.pAttr[i * 4 + 3] = 0;
  }

  burst(pos, color, n = 60, o = {}) {
    const col = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(rand(o.minCos ?? -0.2, 1));
      const s = rand(o.speedMin ?? 1.5, o.speed ?? 5);
      this.emit({
        x: pos.x, y: pos.y + 0.1, z: pos.z,
        vx: Math.sin(ph) * Math.cos(th) * s, vy: Math.cos(ph) * s * (o.up ?? 1), vz: Math.sin(ph) * Math.sin(th) * s,
        color: o.mix ? col.clone().lerp(new THREE.Color(o.mix), Math.random()) : col,
        life: rand(0.4, o.life ?? 1.1), size: rand(0.06, o.size ?? 0.18), gravity: o.gravity ?? -6, drag: o.drag ?? 2,
        intensity: o.intensity,
      });
    }
  }

  _updateParticles(dt) {
    const P = this.pPos, V = this.pVel, A = this.pAttr;
    for (let i = 0; i < MAX_P; i++) {
      if (this.pLife[i] <= 0) { if (this.pAlpha[i] !== 0) { this.pAlpha[i] = 0; this.pSize[i] = 0; } continue; }
      this.pLife[i] -= dt;
      const j = i * 3, k = A[i * 4 + 3];
      if (k > 0) {
        const dx = A[i * 4] - P[j], dy = A[i * 4 + 1] - P[j + 1], dz = A[i * 4 + 2] - P[j + 2];
        const d = Math.hypot(dx, dy, dz) + 0.05;
        // 繞吸引點螺旋
        V[j] += (dx / d * k + dz / d * k * 0.9) * dt;
        V[j + 1] += dy / d * k * dt;
        V[j + 2] += (dz / d * k - dx / d * k * 0.9) * dt;
        if (d < 0.08) this.pLife[i] = 0;
      }
      const drag = Math.exp(-this.pDrag[i] * dt);
      V[j] *= drag; V[j + 1] = V[j + 1] * drag + this.pGrav[i] * dt; V[j + 2] *= drag;
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
      if (P[j + 1] < 0.02 && this.pGrav[i] < 0) { P[j + 1] = 0.02; V[j + 1] *= -0.35; }
      const t = Math.max(this.pLife[i] / this.pMax[i], 0);
      this.pAlpha[i] = Math.min(1, t * 2.2);
      this.pSize[i] = this.pSize0[i] * (0.4 + 0.6 * t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.pcolor.needsUpdate = true;
    g.attributes.psize.needsUpdate = true;
    g.attributes.palpha.needsUpdate = true;
  }

  // ------------------------------------------------------------ 通用
  add(obj, update) { if (obj) this.scene.add(obj); this.items.push({ obj, update, t: 0 }); }

  update(dt) {
    this.time += dt;
    this._updateParticles(dt);
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      it.t += dt;
      if (it.update(it.t, dt) === false) {
        if (it.obj) { this.scene.remove(it.obj); disposeDeep(it.obj); }
        this.items.splice(k, 1);
      }
    }
  }

  onResize() { this.points.material.uniforms.uScale.value = pointScale(); }

  _textTexture(txt, color) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.font = 'bold 96px Consolas, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = color; x.shadowBlur = 18; x.fillStyle = color; x.fillText(txt, 64, 70);
    x.shadowBlur = 0; x.fillStyle = '#ffffff'; x.globalAlpha = 0.6; x.fillText(txt, 64, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  glowMat(color, opacity = 1, k = 3) {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(k), transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
  }

  // ------------------------------------------------------------ 特效
  shockwave(pos, color, maxR = 2.2, dur = 0.7, y = 0.03, thick = 0.12) {
    const m = new THREE.Mesh(new THREE.RingGeometry(1 - thick, 1, 96), this.glowMat(color, 1, 2.5));
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, y, pos.z); m.scale.setScalar(0.01);
    this.add(m, t => {
      const k = t / dur; if (k >= 1) return false;
      const e = 1 - Math.pow(1 - k, 3);
      m.scale.setScalar(0.05 + e * maxR); m.material.opacity = (1 - k) ** 1.5;
    });
  }

  flash(pos, color, intensity = 30, dur = 0.5, dist = 6) {
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.set(pos.x, pos.y + 0.8, pos.z);
    this.add(l, t => { const k = t / dur; if (k >= 1) return false; l.intensity = intensity * (1 - k) ** 2; });
  }

  /** 一般落子衝擊 */
  impact(pos, color, big = false) {
    this.shockwave(pos, color, big ? 3.2 : 1.6, big ? 0.9 : 0.55);
    if (big) this.shockwave(pos, '#ffffff', 2.0, 0.5, 0.04, 0.05);
    this.burst(pos, color, big ? 140 : 45, { speed: big ? 6 : 3.5, size: big ? 0.22 : 0.14, minCos: 0.1, mix: '#ffffff' });
    this.flash(pos, color, big ? 60 : 18, big ? 0.7 : 0.35);
  }

  /** 翻轉時的小火花 */
  sparkle(pos, color, n = 14) {
    this.burst(pos, color, n, { speed: 2.2, size: 0.1, life: 0.7, gravity: -3, minCos: 0.3 });
  }

  /** 牛頓：向內收縮的引力環 + 被吸入的粒子 */
  gravityWell(pos, color, dur = 0.9) {
    for (let r = 0; r < 4; r++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 96), this.glowMat(color, 0, 2.2));
      m.rotation.x = -Math.PI / 2; m.position.set(pos.x, 0.04 + r * 0.002, pos.z);
      const delay = r * 0.15;
      this.add(m, t => {
        const k = (t - delay) / (dur - 0.3); if (k >= 1) return false; if (k < 0) return;
        m.scale.setScalar(2.6 * (1 - k) + 0.1); m.material.opacity = Math.sin(k * Math.PI);
      });
    }
    const col = new THREE.Color(color), target = new THREE.Vector3(pos.x, 0.2, pos.z);
    for (let k = 0; k < 120; k++) {
      const a = Math.random() * Math.PI * 2, r = rand(1.5, 3);
      this.emit({ x: pos.x + Math.cos(a) * r, y: rand(0.1, 0.8), z: pos.z + Math.sin(a) * r, color: col, life: 1.2, size: rand(0.06, 0.14), drag: 1.2, attract: target, attractK: 14 });
    }
    this.flash(pos, color, 25, dur);
  }

  /** 愛因斯坦：時空扭曲（扭曲網格 + 旋轉時鐘環） */
  timeWarp(pos, color, dur = 1.2) {
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(6, 6, 48, 48), new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(2), wireframe: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    grid.rotation.x = -Math.PI / 2; grid.position.set(pos.x, 0.05, pos.z);
    const base = grid.geometry.attributes.position.array.slice();
    this.add(grid, t => {
      const k = t / dur; if (k >= 1) return false;
      const arr = grid.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i], y = base[i + 1], r = Math.hypot(x, y);
        arr[i + 2] = -1.2 * Math.exp(-r * r * 0.6) * Math.sin(k * Math.PI) + 0.08 * Math.sin(r * 5 - t * 10) * (1 - k);
      }
      grid.geometry.attributes.position.needsUpdate = true;
      grid.material.opacity = Math.sin(k * Math.PI) * 0.5;
      grid.rotation.z = t * 0.8;
    });
    // 時鐘刻度環
    const ring = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, i % 3 ? 0.18 : 0.35), this.glowMat(color, 1, 3));
      const a = (i / 12) * Math.PI * 2; tick.position.set(Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4); tick.rotation.y = -a + Math.PI / 2;
      ring.add(tick);
    }
    const hand = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.05), this.glowMat('#ffffff', 1, 3));
    hand.position.x = 0.6; const handG = new THREE.Group(); handG.add(hand); ring.add(handG);
    ring.position.set(pos.x, 0.9, pos.z);
    this.add(ring, t => {
      const k = t / dur; if (k >= 1) return false;
      ring.rotation.y = -t * 1.5; handG.rotation.y = t * 12;
      const s = Math.sin(k * Math.PI); ring.scale.setScalar(0.6 + s * 0.6);
      ring.traverse(o => { if (o.material) o.material.opacity = s; });
    });
    this.burst(pos, color, 90, { speed: 4, gravity: 0, drag: 1, life: 1.4, mix: '#ffffff', minCos: -1 });
    this.flash(pos, color, 40, dur);
  }

  /** 居禮：放射性脈衝 + 綠色光束 */
  radiation(pos, color, targets, dur = 1.0) {
    const sph = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.glowMat(color, 0.6, 2));
    sph.position.set(pos.x, 0.2, pos.z);
    this.add(sph, t => {
      const k = t / dur; if (k >= 1) return false;
      sph.scale.setScalar(0.2 + k * 2.6); sph.material.opacity = 0.5 * (1 - k);
    });
    for (let r = 0; r < 3; r++) setTimeout(() => this.shockwave(pos, color, 2.6, 0.6), r * 160);
    const col = new THREE.Color(color);
    for (let k = 0; k < 160; k++) {
      const a = Math.random() * Math.PI * 2, s = rand(0.5, 2.5);
      this.emit({ x: pos.x, y: 0.2, z: pos.z, vx: Math.cos(a) * s, vy: rand(0.2, 2.5), vz: Math.sin(a) * s, color: col, life: rand(0.8, 1.6), size: rand(0.05, 0.13), gravity: 0.3, drag: 0.8 });
    }
    for (const tp of targets) this.beam(new THREE.Vector3(pos.x, 0.25, pos.z), new THREE.Vector3(tp.x, 0.25, tp.z), color, 0.7, 0.05);
    this.flash(pos, color, 50, dur);
  }

  beam(a, b, color, dur = 0.6, radius = 0.06) {
    const len = a.distanceTo(b);
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.4, radius * 0.4, len, 8, 1, true), this.glowMat('#ffffff', 1, 3));
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 12, 1, true), this.glowMat(color, 0.8, 3));
    g.add(core, glow);
    g.position.copy(a).lerp(b, 0.5);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.add(g, t => {
      const k = t / dur; if (k >= 1) return false;
      const o = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      core.material.opacity = o; glow.material.opacity = o * 0.8;
      g.scale.set(1 + Math.sin(t * 60) * 0.3, 1, 1 + Math.sin(t * 60) * 0.3);
    });
  }

  /** 特斯拉：鋸齒閃電（持續閃爍重生） */
  lightning(a, b, color, dur = 0.45) {
    const g = new THREE.Group();
    const coreMat = this.glowMat('#ffffff', 1, 4), glowMat = this.glowMat(color, 0.7, 4);
    const rebuild = () => {
      g.children.forEach(c => c.geometry.dispose()); g.clear();
      const pts = [], n = 10, dir = b.clone().sub(a), len = dir.length();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      for (let i = 0; i <= n; i++) {
        const p = a.clone().lerp(b, i / n);
        if (i > 0 && i < n) {
          const amp = 0.18 * len * Math.sin((i / n) * Math.PI) * 0.35;
          p.addScaledVector(side, rand(-amp, amp)); p.y += rand(-amp, amp) * 0.6 + Math.sin((i / n) * Math.PI) * 0.5;
        }
        pts.push(p);
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.025, 5), coreMat));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.09, 6), glowMat));
      // 分岔
      const fi = 3 + Math.floor(Math.random() * 4), fp = pts[fi];
      const end = fp.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.2, 0.3), rand(-0.6, 0.6)));
      const mid = fp.clone().lerp(end, 0.5).add(new THREE.Vector3(rand(-0.15, 0.15), rand(-0.1, 0.1), rand(-0.15, 0.15)));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([fp, mid, end]), 10, 0.015, 4), coreMat));
    };
    rebuild();
    let acc = 0;
    this.add(g, (t, dt) => {
      if (t >= dur) { coreMat.dispose(); glowMat.dispose(); return false; }
      acc += dt; if (acc > 0.05) { acc = 0; rebuild(); }
      const o = 1 - t / dur; coreMat.opacity = o; glowMat.opacity = 0.7 * o * (0.6 + Math.random() * 0.4);
    });
    this.flash(b, color, 35, dur * 1.2);
    this.burst(b, color, 40, { speed: 4, size: 0.12, mix: '#ffffff' });
  }

  /** 法拉第：電磁籠（網格穹頂） */
  cage(pos, color, radius = 1.7, dur = 1.3) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), wireframe: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const shell = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.99, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), this.glowMat(color, 0, 1));
    const g = new THREE.Group(); g.add(dome, shell); g.position.set(pos.x, 0.02, pos.z);
    this.add(g, t => {
      const k = t / dur; if (k >= 1) return false;
      const e = Math.min(1, k * 4);
      g.scale.set(1, e, 1); g.rotation.y = t * 0.8;
      const o = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      dome.material.opacity = o * 0.9; shell.material.opacity = o * 0.12 * (1 + Math.sin(t * 30) * 0.3);
    });
    this.shockwave(pos, color, radius * 1.3, 0.6);
    const col = new THREE.Color(color);
    for (let k = 0; k < 80; k++) {
      const a = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI / 2;
      this.emit({ x: pos.x + Math.cos(a) * Math.cos(ph) * radius, y: Math.sin(ph) * radius, z: pos.z + Math.sin(a) * Math.cos(ph) * radius, color: col, life: rand(0.5, 1.2), size: rand(0.05, 0.12), drag: 3 });
    }
    this.flash(pos, color, 40, dur);
  }

  /** 霍金：黑洞生成（事件視界 + 吸積盤 + 吸入粒子），回傳結束 Promise 的時長 */
  blackHole(pos, dur = 1.6) {
    const g = new THREE.Group(); g.position.set(pos.x, 0.5, pos.z);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 16), this.glowMat('#ff8a3d', 0.35, 2));
    const disk = new THREE.Mesh(new THREE.RingGeometry(0.45, 1.3, 96, 1), accretionMaterial());
    disk.rotation.x = -Math.PI / 2 + 0.25;
    g.add(halo, core, disk);
    g.scale.setScalar(0.01);
    this.add(g, t => {
      const k = t / dur; if (k >= 1) return false;
      const s = k < 0.2 ? k / 0.2 : k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      g.scale.setScalar(Math.max(0.01, s * (1 + Math.sin(t * 20) * 0.03)));
      disk.material.uniforms.uTime.value = t;
      g.position.y = 0.5 - (k > 0.8 ? (k - 0.8) * 2 : 0);
    });
    const target = new THREE.Vector3(pos.x, 0.5, pos.z);
    const c1 = new THREE.Color('#ff6a3d'), c2 = new THREE.Color('#ffd27a');
    for (let k = 0; k < 260; k++) {
      const a = Math.random() * Math.PI * 2, r = rand(1.2, 3.5);
      this.emit({ x: pos.x + Math.cos(a) * r, y: rand(0.05, 1.2), z: pos.z + Math.sin(a) * r, color: Math.random() < 0.5 ? c1 : c2, life: rand(1, 1.6), size: rand(0.05, 0.14), drag: 0.6, attract: target, attractK: 10 });
    }
    this.shockwave(pos, '#ff6a3d', 3, 1.0);
    this.flash(pos, '#ff6a3d', 50, dur);
  }

  /** 圖靈：上升的 0/1 數字雨 + 綠色掃描環 */
  binary(pos, dur = 1.2) {
    for (let k = 0; k < 40; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._digitTex[k % 2], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2, 2, 2) }));
      const a = Math.random() * Math.PI * 2, r = rand(0.1, 1.2), delay = Math.random() * 0.5, speed = rand(0.8, 2);
      sp.position.set(pos.x + Math.cos(a) * r, 0.1, pos.z + Math.sin(a) * r); sp.scale.setScalar(0.28);
      sp.material.opacity = 0;
      this.add(sp, t => {
        const k2 = (t - delay) / dur; if (k2 >= 1) return false; if (k2 < 0) return;
        sp.position.y = 0.1 + k2 * speed * 1.5; sp.material.opacity = Math.sin(k2 * Math.PI);
        if (Math.random() < 0.08) sp.material.map = this._digitTex[Math.random() < 0.5 ? 0 : 1];
      });
    }
    for (let r = 0; r < 3; r++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.015, 6, 64), this.glowMat('#00ff9c', 1, 3));
      ring.rotation.x = Math.PI / 2; ring.position.set(pos.x, 0, pos.z);
      const delay = r * 0.25;
      this.add(ring, t => {
        const k = (t - delay) / 0.8; if (k >= 1) return false; if (k < 0) { ring.visible = false; return; }
        ring.visible = true; ring.position.y = 0.05 + k * 1.2; ring.material.opacity = 1 - k;
      });
    }
    this.flash(pos, '#00ff9c', 30, dur);
  }

  /** 薛丁格：問號 + 粉紫粒子環繞 */
  quantum(pos, dur = 1.4) {
    for (let k = 0; k < 10; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._qTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2, 2, 2) }));
      const a0 = (k / 10) * Math.PI * 2;
      sp.scale.setScalar(0.35);
      this.add(sp, t => {
        const k2 = t / dur; if (k2 >= 1) return false;
        const a = a0 + t * 3, r = 0.9 - k2 * 0.6;
        sp.position.set(pos.x + Math.cos(a) * r, 0.5 + Math.sin(t * 4 + k) * 0.2, pos.z + Math.sin(a) * r);
        sp.material.opacity = Math.sin(k2 * Math.PI) * (0.5 + Math.random() * 0.5);
      });
    }
    const col = new THREE.Color('#ff4fd8'), col2 = new THREE.Color('#7af0ff');
    for (let k = 0; k < 120; k++) {
      const a = Math.random() * Math.PI * 2, r = rand(0.6, 1.4);
      this.emit({ x: pos.x + Math.cos(a) * r, y: rand(0.1, 1), z: pos.z + Math.sin(a) * r, vx: -Math.sin(a) * 2, vz: Math.cos(a) * 2, color: Math.random() < 0.5 ? col : col2, life: rand(0.8, 1.4), size: rand(0.05, 0.12), drag: 0.5 });
    }
  }

  /** 達爾文：DNA 雙螺旋 + 葉片 */
  helix(pos, color, dur = 1.3) {
    const c1 = new THREE.Color(color), c2 = new THREE.Color('#40e0d0');
    const N = 70;
    for (let k = 0; k < N; k++) {
      const delay = (k / N) * 0.6;
      setTimeout(() => {
        for (const s of [0, Math.PI]) {
          const a = k * 0.35 + s;
          this.emit({ x: pos.x + Math.cos(a) * 0.45, y: 0.1 + (k / N) * 2.2, z: pos.z + Math.sin(a) * 0.45, vx: -Math.sin(a) * 0.3, vy: 0.4, vz: Math.cos(a) * 0.3, color: s ? c2 : c1, life: 1.1, size: 0.13, drag: 0.5 });
        }
      }, delay * 1000);
    }
    for (let k = 0; k < 14; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._leafTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.8, 1.8, 1.8) }));
      const a = Math.random() * Math.PI * 2, sp0 = rand(0.8, 2);
      sp.scale.setScalar(0.3);
      this.add(sp, t => {
        const k2 = t / dur; if (k2 >= 1) return false;
        sp.position.set(pos.x + Math.cos(a + t) * k2 * sp0, 0.3 + Math.sin(k2 * Math.PI) * 1.2, pos.z + Math.sin(a + t) * k2 * sp0);
        sp.material.rotation = t * 3; sp.material.opacity = Math.sin(k2 * Math.PI);
      });
    }
    this.shockwave(pos, color, 2.5, 0.8);
    this.flash(pos, color, 30, dur);
  }

  /** 目標格上的短暫光柱（標示被影響的棋子） */
  pillar(pos, color, dur = 0.6) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 2, 24, 1, true), pillarMaterial(color));
    m.position.set(pos.x, 1, pos.z);
    this.add(m, t => { const k = t / dur; if (k >= 1) return false; m.material.uniforms.uOpacity.value = Math.sin(k * Math.PI); m.scale.set(1 - k * 0.3, 1, 1 - k * 0.3); });
  }

  /** 馬保國：閃電五連鞭（金雷長鞭弧線 + 閃電伴隨 + 「閃電五連鞭」浮空大字） */
  whipStrike(a, b, color = '#ffe14d', whipIdx = 0, dur = 0.42) {
    const g = new THREE.Group();
    const coreMat = this.glowMat('#ffffff', 1, 4);
    const whipMat = this.glowMat(color, 0.9, 3.5);
    const dir = b.clone().sub(a);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const sign = whipIdx % 2 === 0 ? 1 : -1;

    const rebuild = phase => {
      g.children.forEach(c => c.geometry.dispose());
      g.clear();
      const pts = [], n = 16;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const p = a.clone().lerp(b, u);
        const wave = Math.sin(u * Math.PI * 2 - phase * 14) * Math.sin(u * Math.PI) * 0.65 * sign;
        p.addScaledVector(side, wave);
        p.y += Math.sin(u * Math.PI) * 1.15 + Math.cos(u * Math.PI * 3 - phase * 10) * 0.12;
        pts.push(p);
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.032, 6), coreMat));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.095, 8), whipMat));
    };
    rebuild(0);
    this.add(g, t => {
      if (t >= dur) { coreMat.dispose(); whipMat.dispose(); return false; }
      rebuild(t);
      const o = 1 - t / dur;
      coreMat.opacity = o;
      whipMat.opacity = 0.9 * o;
    });

    // 伴隨青金閃電與鞭擊震波
    this.lightning(a, b, '#6fe8ff', 0.26);
    this.shockwave(b, color, 1.35, 0.38, 0.04, 0.15);
    this.burst(b, color, 45, { speed: 4.8, size: 0.16, mix: '#6fe8ff' });
    this.flash(b, color, 45, 0.35);

    // 浮現「閃・電・五・連・鞭」大字特效
    const tex = this._whipTex[whipIdx % this._whipTex.length];
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2.2, 2.0, 1.4),
    }));
    sp.position.set(b.x, 0.65, b.z);
    sp.scale.setScalar(0.85);
    this.add(sp, t => {
      const k = t / 0.65;
      if (k >= 1) return false;
      sp.position.y = 0.65 + k * 0.9;
      const s = k < 0.2 ? 0.5 + (k / 0.2) * 0.55 : 1.05 - (k - 0.2) * 0.25;
      sp.scale.setScalar(s);
      sp.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    });
  }
}

export function accretionMaterial(strength = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uStrength: { value: strength } },
    vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uStrength; varying vec3 vP;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float r = length(vP.xy); float a = atan(vP.y, vP.x);
        float rn = clamp((r - 0.45) / 0.85, 0.0, 1.0);
        float swirl = a * 3.0 + uTime * 4.0 - r * 6.0;
        float n = noise(vec2(swirl, r * 8.0)) * 0.6 + noise(vec2(swirl * 2.0, r * 16.0)) * 0.4;
        float inner = smoothstep(0.0, 0.08, rn) * (1.0 - smoothstep(0.35, 1.0, rn));
        vec3 hot = vec3(1.0, 0.85, 0.55), warm = vec3(1.0, 0.35, 0.08);
        vec3 col = mix(hot, warm, rn) * (0.6 + n * 1.2) * 3.0 * uStrength;
        float alpha = inner * (0.5 + n * 0.6);
        gl_FragColor = vec4(col * alpha, alpha);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
}

export function pillarMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(2.5) }, uOpacity: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
      void main(){ float a = pow(1.0 - vUv.y, 2.0) * uOpacity; gl_FragColor = vec4(uColor * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
}

export function disposeDeep(obj) {
  obj.traverse?.(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(m => { if (m.map && !m.map.userData?.shared) { /* 共用貼圖不釋放 */ } m.dispose(); });
    }
  });
}
