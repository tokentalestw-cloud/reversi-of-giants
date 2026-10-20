// 黑白棋遊戲引擎（純邏輯，不含畫面）
// 線上對戰時雙方各自執行同一份引擎，隨機效果以「房間種子 + 手數」決定，保證兩端結果一致。
import { SCIENTISTS, getScientist } from './scientists.js';

export const SIZE = 8;
export const EMPTY = 0, BLACK = 1, WHITE = 2, VOID = 3;
export const MAX_CHARGES = 3;
export const SHIELD_PLIES = 4; // 法拉第籠持續手數（= 對手 2 回合）
export const UNLOCK_PLY = 4;   // 第 5 手起才能使用科學家（避免開局秒殺）

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const CORNERS = new Set([0, 7, 56, 63]);

export const idx = (x, y) => y * SIZE + x;
export const xy = i => [i % SIZE, Math.floor(i / SIZE)];
export const opp = c => (c === BLACK ? WHITE : BLACK);
export const colorName = c => (c === BLACK ? '黑方' : '白方');
const inB = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
const cheb = (a, b) => { const [ax, ay] = xy(a), [bx, by] = xy(b); return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); };
const dist2 = (a, b) => { const [ax, ay] = xy(a), [bx, by] = xy(b); return (ax - bx) ** 2 + (ay - by) ** 2; };

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Game {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.board = new Array(64).fill(EMPTY);
    this.board[idx(3, 3)] = WHITE; this.board[idx(4, 4)] = WHITE;
    this.board[idx(4, 3)] = BLACK; this.board[idx(3, 4)] = BLACK;
    this.current = BLACK;
    this.ply = 0;
    this.shields = {};   // cell -> 屏蔽持續到第幾手（不含）
    this.marks = {};     // cell -> 科學家 id（特殊棋子標記）
    this.charges = { [BLACK]: MAX_CHARGES, [WHITE]: MAX_CHARGES };
    this.used = { [BLACK]: [], [WHITE]: [] };
    this.over = false;
    this.result = null;
    this.lastMove = null;
  }

  clone() {
    const g = Object.create(Game.prototype);
    g.seed = this.seed;
    g.board = this.board.slice();
    g.current = this.current;
    g.ply = this.ply;
    g.shields = { ...this.shields };
    g.marks = { ...this.marks };
    g.charges = { ...this.charges };
    g.used = { [BLACK]: this.used[BLACK].slice(), [WHITE]: this.used[WHITE].slice() };
    g.over = this.over;
    g.result = this.result;
    g.lastMove = this.lastMove;
    return g;
  }

  rng() { return mulberry32((this.seed ^ Math.imul(this.ply + 1, 2654435761)) >>> 0); }
  isShielded(i) { return (this.shields[i] || 0) > this.ply; }
  count(c) { let n = 0; for (const v of this.board) if (v === c) n++; return n; }

  /** 從 i 出發（不論 i 本身狀態），以 color 為己方，回傳可被夾擊翻轉的格子（屏蔽中的棋子不翻轉） */
  flipsFrom(i, color) {
    const [x, y] = xy(i), o = opp(color), B = this.board, res = [];
    for (const [dx, dy] of DIRS) {
      let cx = x + dx, cy = y + dy;
      const line = [];
      while (inB(cx, cy) && B[idx(cx, cy)] === o) { line.push(idx(cx, cy)); cx += dx; cy += dy; }
      if (line.length && inB(cx, cy) && B[idx(cx, cy)] === color) {
        for (const j of line) if (!this.isShielded(j)) res.push(j);
      }
    }
    return res;
  }

  isLegal(i, color) { return this.board[i] === EMPTY && this.flipsFrom(i, color).length > 0; }

  legalMoves(color = this.current) {
    const r = [];
    for (let i = 0; i < 64; i++) if (this.isLegal(i, color)) r.push(i);
    return r;
  }

  canUse(color, id) {
    return !this.over && this.ply >= UNLOCK_PLY && this.charges[color] > 0 && !this.used[color].includes(id);
  }

  /** 某能力（null = 一般落子）可選擇的目標格 */
  validTargets(color, abilityId = null) {
    if (!abilityId) return this.legalMoves(color);
    const sc = getScientist(abilityId);
    const r = [];
    if (sc.target === 'legal') return this.legalMoves(color);
    if (sc.target === 'empty') { for (let i = 0; i < 64; i++) if (this.board[i] === EMPTY) r.push(i); }
    if (sc.target === 'enemy') {
      const o = opp(color);
      if (this.count(o) <= 1) return r;
      for (let i = 0; i < 64; i++) if (this.board[i] === o && !this.isShielded(i) && !CORNERS.has(i)) r.push(i);
    }
    return r;
  }

  hasAnyAction(color) {
    if (this.legalMoves(color).length) return true;
    if (this.charges[color] <= 0) return false;
    return SCIENTISTS.some(s => s.target !== 'legal' && this.canUse(color, s.id) && this.validTargets(color, s.id).length > 0);
  }

  /**
   * 執行一個動作，回傳給畫面播放的步驟清單。
   * action: { type: 'move', cell, ability? } | { type: 'pass' }
   */
  apply(action) {
    if (this.over) throw new Error('遊戲已結束');
    const color = this.current, o = opp(color), B = this.board;
    const res = { color, action, ability: action.ability || null, steps: [], extraTurn: false, passed: null, gameOver: null };

    if (action.type === 'pass') {
      if (this.legalMoves(color).length) throw new Error('仍有可下的位置，不能跳過');
      res.steps.push({ kind: 'pass' });
    } else {
      const ab = action.ability || null;
      const i = action.cell;
      if (ab && !this.canUse(color, ab)) throw new Error('此科學家已無法使用');
      if (!this.validTargets(color, ab).includes(i)) throw new Error('這裡不能下');
      const rng = this.rng();

      const enemyOK = c => B[c] === o && !this.isShielded(c);
      // 「最後防線」：科學家效果不能吃光對手的最後一枚棋子（一般夾擊仍可以）
      const spare = cells => cells.slice(0, Math.max(0, this.count(o) - 1));
      const flip = (cells, kind, extra = {}) => {
        let uniq = [...new Set(cells)].filter(enemyOK);
        if (extra.style) uniq = spare(uniq);
        for (const c of uniq) B[c] = color;
        if (uniq.length) res.steps.push({ kind, cells: uniq, origin: i, ...extra });
        return uniq;
      };
      const place = (cell, c) => {
        B[cell] = c;
        if (ab) this.marks[cell] = ab; else delete this.marks[cell];
        res.steps.push({ kind: 'place', cell, color: c, ability: ab });
      };
      const basic = () => { const f = this.flipsFrom(i, color); place(i, color); flip(f, 'flip'); };
      const neighbors = (cell, dirs = DIRS) => {
        const [x, y] = xy(cell), r = [];
        for (const [dx, dy] of dirs) if (inB(x + dx, y + dy)) r.push(idx(x + dx, y + dy));
        return r;
      };

      switch (ab) {
        case null: basic(); break;

        case 'newton':
          basic();
          res.steps.push({ kind: 'gravity', origin: i });
          flip(neighbors(i, ORTHO), 'flip', { style: 'newton' });
          break;

        case 'einstein':
          res.steps.push({ kind: 'timewarp', origin: i });
          basic();
          res.extraTurn = true;
          break;

        case 'curie': {
          basic();
          const cand = [];
          for (let c = 0; c < 64; c++) if (enemyOK(c) && cheb(c, i) <= 2) cand.push(c);
          for (let k = cand.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [cand[k], cand[j]] = [cand[j], cand[k]]; }
          const pick = spare(cand.slice(0, 3));
          res.steps.push({ kind: 'radiation', origin: i, cells: pick });
          flip(pick, 'flip', { style: 'curie' });
          break;
        }

        case 'tesla': {
          basic();
          let cur = i;
          const path = [i], hit = [];
          for (let k = 0; k < 4; k++) {
            const cand = [];
            for (let c = 0; c < 64; c++) if (enemyOK(c) && cheb(c, cur) <= 2) cand.push(c);
            if (!cand.length || this.count(o) <= 1) break;
            const best = Math.min(...cand.map(c => dist2(c, cur)));
            const near = cand.filter(c => dist2(c, cur) === best);
            const next = near[Math.floor(rng() * near.length)];
            B[next] = color; hit.push(next); path.push(next); cur = next;
          }
          res.steps.push({ kind: 'lightning', origin: i, path, cells: hit });
          break;
        }

        case 'faraday': {
          basic();
          const cells = [i, ...neighbors(i)].filter(c => B[c] === color);
          for (const c of cells) this.shields[c] = this.ply + SHIELD_PLIES;
          res.steps.push({ kind: 'shield', origin: i, cells });
          break;
        }

        case 'hawking': {
          B[i] = VOID;
          delete this.marks[i];
          res.steps.push({ kind: 'blackhole', cell: i });
          const eaten = spare(neighbors(i).filter(enemyOK));
          for (const c of eaten) { B[c] = EMPTY; delete this.marks[c]; delete this.shields[c]; }
          if (eaten.length) res.steps.push({ kind: 'remove', origin: i, cells: eaten });
          break;
        }

        case 'turing': {
          B[i] = color;
          this.marks[i] = 'turing';
          res.steps.push({ kind: 'decode', cell: i, color });
          flip(this.flipsFrom(i, color), 'flip', { style: 'turing' });
          break;
        }

        case 'schrodinger': {
          const alive = rng() < 0.5;
          const final = alive ? color : o;
          let f = [];
          if (alive) f = this.flipsFrom(i, color);
          B[i] = final;
          this.marks[i] = 'schrodinger';
          res.steps.push({ kind: 'quantum', cell: i, alive, color: final });
          if (alive) {
            flip(f, 'flip', { style: 'schrodinger' });
            flip(neighbors(i), 'flip', { style: 'schrodinger' });
          }
          res.collapse = alive;
          break;
        }

        case 'darwin': {
          basic();
          const conv = [];
          for (let c = 0; c < 64; c++) {
            if (!enemyOK(c)) continue;
            const own = neighbors(c).filter(n => B[n] === color).length;
            if (own >= 5) conv.push(c);
          }
          const keep = spare(conv);
          res.steps.push({ kind: 'evolve', origin: i, cells: keep });
          flip(keep, 'flip', { style: 'darwin' });
          break;
        }

        default: throw new Error('未知的能力');
      }

      if (ab) { this.charges[color]--; this.used[color].push(ab); }
      this.lastMove = i;
    }

    this.ply++;
    for (const k in this.shields) if (this.shields[k] <= this.ply) delete this.shields[k];
    this._advance(color, res);
    return res;
  }

  _advance(color, res) {
    const isPass = res.action.type === 'pass';
    if (!this.board.includes(EMPTY) || this.count(BLACK) === 0 || this.count(WHITE) === 0) return this._finish(res);
    const next = res.extraTurn ? color : opp(color);
    if (this.hasAnyAction(next)) { this.current = next; return; }
    if (isPass) return this._finish(res);
    const other = opp(next);
    if (this.hasAnyAction(other)) { this.current = other; res.passed = next; return; }
    this._finish(res);
  }

  _finish(res) {
    const b = this.count(BLACK), w = this.count(WHITE);
    this.over = true;
    this.result = { black: b, white: w, winner: b > w ? BLACK : w > b ? WHITE : 0 };
    res.gameOver = this.result;
  }
}
