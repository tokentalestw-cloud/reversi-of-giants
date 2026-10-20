// 簡易電腦對手：一步模擬 + 位置權重評估，會在划算時使用科學家棋子
import { SCIENTISTS } from './scientists.js';
import { opp, EMPTY } from './game.js';

const W = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];

function evaluate(g, me) {
  const o = opp(me);
  if (g.over) {
    const d = g.count(me) - g.count(o);
    return d > 0 ? 10000 + d : d < 0 ? -10000 + d : 0;
  }
  const empties = g.board.filter(v => v === EMPTY).length;
  let pos = 0;
  for (let i = 0; i < 64; i++) { if (g.board[i] === me) pos += W[i]; else if (g.board[i] === o) pos -= W[i]; }
  const disc = g.count(me) - g.count(o);
  const mob = g.legalMoves(me).length - g.legalMoves(o).length;
  const phase = 1 - empties / 60;
  let s = pos + mob * 6 * (1 - phase) + disc * (2 + phase * 14);
  // 輪到誰：若下一手仍是自己（愛因斯坦），額外加分
  if (g.current === me && !g.over) s += 25;
  return s;
}

export function chooseAction(game, difficulty = 1) {
  const me = game.current;
  const actions = game.legalMoves(me).map(c => ({ type: 'move', cell: c }));
  if (game.charges[me] > 0) {
    for (const s of SCIENTISTS) {
      if (s.id === 'schrodinger' || !game.canUse(me, s.id)) continue;
      for (const c of game.validTargets(me, s.id)) actions.push({ type: 'move', cell: c, ability: s.id });
    }
  }
  if (!actions.length) return { type: 'pass' };

  const empties = game.board.filter(v => v === EMPTY).length;
  // 越早期使用技能成本越高，避免一開局就用光
  const abilityCost = 20 + 45 * (empties / 60);
  let best = null, bestScore = -Infinity;
  for (const a of actions) {
    const g = game.clone();
    try { g.apply(a); } catch { continue; }
    let s = evaluate(g, me);
    if (a.ability) s -= abilityCost;
    s += Math.random() * (difficulty === 0 ? 40 : 6);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best || actions[0];
}
