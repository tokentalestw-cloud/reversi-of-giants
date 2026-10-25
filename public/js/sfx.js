// 合成音效（Web Audio，無需音檔）
export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this._lastHover = 0;
  }
  _ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, len);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.enabled;
  }
  unlock() { this._ensure(); }

  _tone(freq, dur, { type = 'sine', vol = 0.3, slide = null, delay = 0, attack = 0.005 } = {}) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _noise(dur, { vol = 0.3, freq = 1000, q = 1, type = 'bandpass', slide = null, delay = 0 } = {}) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  place(big = false) {
    if (!this._ensure()) return;
    this._tone(big ? 90 : 140, big ? 0.5 : 0.22, { slide: big ? 35 : 60, vol: big ? 0.7 : 0.45 });
    this._noise(0.08, { vol: 0.35, freq: 3500, q: 0.8 });
    if (big) { this._noise(0.9, { vol: 0.4, freq: 400, type: 'lowpass', slide: 60 }); this._tone(523, 0.6, { type: 'triangle', vol: 0.12, delay: 0.05 }); this._tone(784, 0.7, { type: 'triangle', vol: 0.1, delay: 0.1 }); }
  }
  flip() {
    if (!this._ensure()) return;
    const f = 900 + Math.random() * 500;
    this._tone(f, 0.12, { type: 'triangle', slide: f * 1.6, vol: 0.12 });
    this._noise(0.05, { vol: 0.12, freq: 6000, delay: 0.25 });
  }
  hover() {
    if (!this._ensure()) return;
    const now = performance.now(); if (now - this._lastHover < 60) return; this._lastHover = now;
    this._tone(1800, 0.04, { type: 'sine', vol: 0.03 });
  }
  zap() {
    if (!this._ensure()) return;
    this._noise(0.3, { vol: 0.5, freq: 2500, q: 3, slide: 6000 });
    this._tone(60, 0.25, { type: 'sawtooth', vol: 0.15, slide: 40 });
  }
  whip(idx = 0) {
    if (!this._ensure()) return;
    const base = 180 + idx * 45;
    this._noise(0.14, { vol: 0.55, freq: 900, q: 1.8, slide: 6800 });
    this._noise(0.06, { vol: 0.65, freq: 4500, q: 3.5, delay: 0.04 });
    this._tone(base, 0.18, { type: 'sawtooth', vol: 0.22, slide: base * 2.4 });
  }
  thunder(idx = 0) {
    if (!this._ensure()) return;
    const base = 96 - (idx % 4) * 8;
    this._noise(0.28, { vol: 0.55, freq: 1600, q: 2.2, slide: 320 });
    this._noise(0.06, { vol: 0.62, freq: 5200, q: 3.0, delay: 0.01 });
    this._tone(base, 0.28, { type: 'sawtooth', vol: 0.35, slide: 35 });
  }
  select() { if (this._ensure()) { this._tone(660, 0.12, { type: 'triangle', vol: 0.15 }); this._tone(990, 0.15, { type: 'triangle', vol: 0.12, delay: 0.06 }); } }
  error() { if (this._ensure()) this._tone(180, 0.2, { type: 'square', vol: 0.08, slide: 120 }); }
  turn() { if (this._ensure()) { this._tone(880, 0.15, { vol: 0.1 }); this._tone(1320, 0.25, { vol: 0.08, delay: 0.08 }); } }

  ability(id) {
    if (!this._ensure()) return;
    const T = (...a) => this._tone(...a), N = (...a) => this._noise(...a);
    switch (id) {
      case 'newton': T(400, 0.9, { slide: 80, vol: 0.25 }); N(0.9, { freq: 300, slide: 2000, vol: 0.3 }); break;
      case 'einstein': T(220, 1.6, { type: 'sine', slide: 110, vol: 0.3 }); T(330, 1.6, { type: 'triangle', slide: 165, vol: 0.12 }); N(1.4, { freq: 4000, slide: 300, vol: 0.2 }); break;
      case 'curie': for (let i = 0; i < 12; i++) N(0.03, { freq: 5000, vol: 0.4, delay: Math.random() * 0.9 }); T(110, 1, { type: 'sawtooth', vol: 0.06 }); break;
      case 'tesla': T(55, 1.2, { type: 'sawtooth', vol: 0.15, slide: 70 }); N(1, { freq: 1500, q: 2, vol: 0.2 }); break;
      case 'faraday': T(300, 0.8, { type: 'square', vol: 0.06, slide: 900 }); T(600, 1.0, { type: 'sine', vol: 0.15, slide: 1200, delay: 0.1 }); break;
      case 'hawking': T(80, 2, { slide: 25, vol: 0.6 }); N(2, { freq: 800, type: 'lowpass', slide: 50, vol: 0.5 }); break;
      case 'turing': for (let i = 0; i < 14; i++) T(400 + Math.random() * 1600, 0.06, { type: 'square', vol: 0.05, delay: i * 0.06 }); break;
      case 'schrodinger': T(440, 1.5, { type: 'sine', vol: 0.15, slide: 880 }); T(466, 1.5, { type: 'sine', vol: 0.15, slide: 830 }); break;
      case 'darwin': [392, 494, 587, 784].forEach((f, i) => T(f, 0.5, { type: 'triangle', vol: 0.12, delay: i * 0.12 })); N(1, { freq: 2000, vol: 0.08 }); break;
      case 'mabaoguo': T(110, 0.45, { type: 'sawtooth', slide: 330, vol: 0.25 }); N(0.35, { freq: 1200, slide: 4800, vol: 0.35 }); break;
      case 'trump':
        // 築牆重擊 + 金幣收銀清脆鈴響
        T(85, 0.45, { slide: 40, vol: 0.5 });
        [1046, 1318, 1568, 2093].forEach((f, i) => T(f, 0.32, { type: 'triangle', vol: 0.16, delay: 0.1 + i * 0.09 }));
        break;
      case 'liuzhenren':
        // 正氣天罡劍鳴 + 滾滾天威九天雷雲
        T(523, 0.65, { type: 'sawtooth', slide: 1046, vol: 0.16 });
        T(659, 0.65, { type: 'triangle', slide: 1318, vol: 0.12, delay: 0.04 });
        N(0.42, { freq: 900, q: 1.5, slide: 220, vol: 0.28 });
        break;
      case 'guozhenren':
        // 資工高速演算數據音 + 防火牆護駕共鳴 + 雷射制裁
        for (let i = 0; i < 8; i++) T(700 + i * 180, 0.06, { type: 'square', vol: 0.08, delay: i * 0.04 });
        T(440, 0.85, { type: 'triangle', slide: 880, vol: 0.22, delay: 0.15 });
        N(0.45, { freq: 2400, q: 2.5, slide: 600, vol: 0.35, delay: 0.18 });
        break;
      default: break;
    }
  }
  banner() { if (this._ensure()) { this._noise(0.8, { freq: 200, slide: 5000, vol: 0.25 }); this._tone(196, 1.2, { type: 'sawtooth', vol: 0.06 }); this._tone(294, 1.2, { type: 'sawtooth', vol: 0.05 }); } }
  win() { if (this._ensure()) [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.8, { type: 'triangle', vol: 0.18, delay: i * 0.15 })); }
  lose() { if (this._ensure()) [392, 349, 311, 262].forEach((f, i) => this._tone(f, 0.7, { type: 'triangle', vol: 0.15, delay: i * 0.18 })); }
}
