// 主程式：模式管理、UI、動作佇列
import { Game, BLACK, WHITE, opp, colorName, xy, MAX_CHARGES, UNLOCK_PLY } from './game.js';
import { SCIENTISTS, getScientist, portraitUrl } from './scientists.js';
import { BoardView, PLAYER_FX } from './renderer.js';
import { Sfx } from './sfx.js';
import { Net } from './net.js';
import { chooseAction } from './ai.js';

const $ = s => document.querySelector(s);
const sfx = new Sfx();
const view = new BoardView($('#app'), sfx);

const S = {
  mode: null,        // 'online' | 'local' | 'ai'
  game: null,
  myColor: BLACK,
  aiColor: WHITE,
  selected: null,
  busy: false,
  chain: Promise.resolve(),
  net: null,
  code: null,
  token: 0,
  rematchSent: false,
};

const cellName = i => { const [x, y] = xy(i); return 'ABCDEFGH'[x] + (y + 1); };
const randSeed = () => (Math.random() * 2 ** 31) | 0;

// ====================================================================== 共用 UI
function toast(msg, err = false) {
  const d = document.createElement('div');
  d.className = 'toast' + (err ? ' err' : '');
  d.textContent = msg;
  $('#toast-wrap').appendChild(d);
  setTimeout(() => d.remove(), 2900);
}

function show(id, on = true) { $(id).classList.toggle('hidden', !on); }

function log(html, color = '#888') {
  const d = document.createElement('div');
  d.className = 'log-item';
  d.style.setProperty('--c', color);
  d.innerHTML = html;
  const box = $('#log');
  box.prepend(d);
  while (box.children.length > 40) box.lastChild.remove();
}

function playerLabel(color) {
  if (S.mode === 'online') return color === S.myColor ? '你' : '對手';
  if (S.mode === 'ai') return color === S.aiColor ? '電腦' : '你';
  return color === BLACK ? '玩家 1' : '玩家 2';
}

function showBanner(id, color) {
  const sc = getScientist(id);
  const b = $('#banner');
  b.style.setProperty('--c', sc.color);
  $('#banner-img').src = portraitUrl(id);
  $('#b-player').textContent = `${colorName(color)}（${playerLabel(color)}）發動`;
  $('#b-skill').textContent = sc.skill;
  $('#b-name').textContent = `${sc.name} · ${sc.field}`;
  $('#b-quote').textContent = `「${sc.quote}」`;
  b.classList.add('hidden'); void b.offsetWidth; // 重新觸發動畫
  b.classList.remove('hidden');
  sfx.banner();
  return new Promise(r => setTimeout(() => { b.classList.add('hidden'); r(); }, 1650));
}

// ====================================================================== HUD / 牌組
function deckColor() {
  if (!S.game) return BLACK;
  return S.mode === 'local' ? S.game.current : S.myColor;
}

function isMyTurn() {
  const g = S.game;
  if (!g || g.over) return false;
  if (S.mode === 'local') return true;
  return g.current === S.myColor;
}

function renderHUD() {
  const g = S.game;
  for (const c of [BLACK, WHITE]) {
    $(`#score-${c}`).textContent = g.count(c);
    $(`#tag-${c}`).textContent = playerLabel(c);
    $(`#panel-${c}`).classList.toggle('active', !g.over && g.current === c);
    $(`#charges-${c}`).innerHTML = Array.from({ length: MAX_CHARGES }, (_, k) => `<div class="gem ${k < g.charges[c] ? '' : 'empty'}"></div>`).join('');
    $(`#used-${c}`).innerHTML = g.used[c].map(id => { const s = getScientist(id); return `<img src="${portraitUrl(id)}" title="${s.short}・${s.skill}" style="--c:${s.color}">`; }).join('');
  }
  $('#turn-text').textContent = g.over ? '對局結束' : `${colorName(g.current)}・${playerLabel(g.current)}`;
  $('#ply-text').textContent = `第 ${g.ply + 1} 手`;
}

function renderDeck() {
  const g = S.game, color = deckColor();
  const canAct = isMyTurn() && !S.busy;
  $('#deck-sub').textContent = g.ply < UNLOCK_PLY ? `第 ${UNLOCK_PLY + 1} 手解鎖（點卡片看說明）` : `${colorName(color)}剩 ${g.charges[color]} 次 · 每位限 1 次`;

  if (S.selected) {
    const sc = getScientist(S.selected);
    show('#deck-head-normal', false);
    show('#deck-head-active', true);
    $('#deck-head-active').style.setProperty('--c', sc.color);
    $('#da-text').textContent = `✦ 已選：${sc.short}【${sc.skill}】點棋盤發動`;
    $('#btn-toggle-detail').textContent = S.detailId === S.selected ? '收起說明' : '查看說明';
  } else {
    show('#deck-head-normal', true);
    show('#deck-head-active', false);
  }

  const wrap = $('#cards');
  if (!wrap.children.length) {
    for (const s of SCIENTISTS) {
      const d = document.createElement('div');
      d.className = 'card';
      d.dataset.id = s.id;
      d.style.setProperty('--c', s.color);
      const type = { legal: '落子', empty: '任意格', enemy: '敵子' }[s.target];
      d.innerHTML = `<img src="${portraitUrl(s.id)}" alt=""><div class="c-type">${type}</div><div class="c-name">${s.short}</div><div class="c-skill">${s.skill}</div><div class="c-used">已使用</div>`;
      d.addEventListener('click', e => { e.stopPropagation(); onCardClick(s.id); });
      d.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && !S.selected) showDetail(s.id); });
      d.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !S.selected && !S.pinnedDetail) hideDetail(); });
      wrap.appendChild(d);
    }
  }
  for (const d of wrap.children) {
    const id = d.dataset.id;
    const used = g.used[color].includes(id);
    const usable = canAct && g.canUse(color, id) && g.validTargets(color, id).length > 0;
    d.classList.toggle('used', used);
    d.classList.toggle('disabled', !usable && !used);
    d.classList.toggle('selected', S.selected === id);
  }
}

function hideDetail() {
  S.detailId = null;
  S.pinnedDetail = false;
  show('#card-detail', false);
  if (S.game) renderDeck();
}

function showDetail(id, pinned = false) {
  const s = getScientist(id), el = $('#card-detail');
  S.detailId = id;
  if (pinned) S.pinnedDetail = true;
  el.style.setProperty('--c', s.color);
  const g = S.game, color = deckColor();
  const isSelected = S.selected === id;
  let statusText = '';
  if (g) {
    if (isSelected) statusText = '✦ 已選取：可直接點擊中央棋盤發動，或收起說明後落子';
    else if (g.used[color].includes(id)) statusText = '（此科學家本局已使用過）';
    else if (g.ply < UNLOCK_PLY) statusText = `（將於第 ${UNLOCK_PLY + 1} 手解鎖使用）`;
  }
  const actionsHtml = isSelected
    ? `<div class="cd-actions">
        <button class="cd-btn primary" data-act="collapse" type="button">✓ 收起說明（保持選取）</button>
        <button class="cd-btn cancel" data-act="cancel" type="button">✕ 取消選取</button>
      </div>`
    : `<div class="cd-actions">
        <button class="cd-btn" data-act="collapse" type="button">✕ 關閉說明</button>
      </div>`;

  el.innerHTML = `<img src="${portraitUrl(id)}" alt="">
    <div class="cd-body">
      <div class="cd-top">
        <div class="cd-name">${s.name} <span style="font-size:11px;color:#9aa0b0;font-weight:500">${s.years} · ${s.field}</span></div>
      </div>
      <div class="cd-skill">✦ ${s.skill} <span style="font-size:11px;color:#e8c46e;font-weight:500">${statusText}</span></div>
      <div class="cd-desc">${s.desc}</div>
      ${actionsHtml}
    </div>`;
  show('#card-detail', true);
  if (S.game) renderDeck();
}

$('#card-detail').addEventListener('click', e => {
  e.stopPropagation();
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'cancel') {
    S.selected = null;
    hideDetail();
    refresh();
    return;
  }
  // 點擊「收起說明」或說明框本身：僅隱藏說明框，保留已選取的科學家！
  hideDetail();
});

$('#btn-toggle-detail').addEventListener('click', e => {
  e.stopPropagation();
  if (!S.selected) return;
  if (S.detailId === S.selected) hideDetail();
  else showDetail(S.selected, true);
});

$('#btn-cancel-select').addEventListener('click', e => {
  e.stopPropagation();
  S.selected = null;
  hideDetail();
  refresh();
});

function onCardClick(id) {
  const g = S.game, color = deckColor();
  // 若已選取同一張卡 → 再次點擊卡片本身即取消選取
  if (S.selected === id) {
    S.selected = null;
    hideDetail();
    refresh();
    return;
  }
  const usable = isMyTurn() && !S.busy && g && g.canUse(color, id) && g.validTargets(color, id).length > 0;
  if (!usable) {
    // 不可發動時（例如未滿第 5 手）：切換顯示或關閉該科學家的說明
    if (S.pinnedDetail && S.detailId === id) {
      hideDetail();
    } else {
      S.selected = null;
      showDetail(id, true);
      refresh();
    }
    return;
  }
  S.selected = id;
  showDetail(id, true);
  sfx.select();
  refresh();
}

function updateHighlights() {
  const g = S.game;
  if (!g || g.over || S.busy || !isMyTurn()) {
    view.interactive = false;
    view.setHighlights([], '#ffffff');
    return;
  }
  const color = g.current;
  const sc = S.selected ? getScientist(S.selected) : null;
  const targets = g.validTargets(color, S.selected);
  view.interactive = true;
  view.setHighlights(targets, sc ? sc.color : PLAYER_FX[color], sc?.target === 'enemy' ? 'enemy' : 'empty', color);
}

function updatePassBtn() {
  const g = S.game;
  const need = g && !g.over && !S.busy && isMyTurn() && g.legalMoves(g.current).length === 0;
  show('#pass-btn', !!need);
}

function refresh() {
  if (!S.game) return;
  renderHUD();
  renderDeck();
  updateHighlights();
  updatePassBtn();
}

// ====================================================================== 動作流程
function submit(action) {
  if (!isMyTurn() || S.busy) return;
  try { S.game.clone().apply(action); } catch (e) { toast(e.message, true); sfx.error(); return; }
  if (S.mode === 'online') S.net.send({ t: 'action', action, ply: S.game.ply });
  S.selected = null;
  hideDetail();
  enqueue(action);
}

function enqueue(action) {
  const token = S.token;
  S.chain = S.chain.then(() => (token === S.token ? perform(action, token) : null)).catch(e => console.error(e));
}

async function perform(action, token) {
  const g = S.game;
  S.busy = true;
  refresh();
  const color = g.current;
  let res;
  try { res = g.apply(action); } catch (e) {
    console.error(e); toast('動作同步失敗：' + e.message, true);
    S.busy = false; refresh(); return;
  }
  if (res.ability) await showBanner(res.ability, color);
  if (token !== S.token) return;
  await view.playResult(res);
  if (token !== S.token) return;
  view.sync(g);
  logResult(res);
  S.busy = false;

  if (res.ability === 'schrodinger') toast(res.collapse ? '🐱 觀測結果：貓還活著！疊加態坍縮為己方' : '💀 觀測結果：坍縮成了對手的棋子…', !res.collapse);
  if (res.extraTurn && !res.gameOver) toast(`⏳ 時間膨脹！${colorName(color)}再行動一次`);
  if (res.passed) toast(`${colorName(res.passed)}（${playerLabel(res.passed)}）無處可下，跳過回合`);
  refresh();
  if (res.gameOver) { setTimeout(() => showGameOver(res.gameOver), 600); return; }
  if (S.mode !== 'local' && isMyTurn()) sfx.turn();
  maybeAI();
}

function logResult(res) {
  const c = res.color, who = `${colorName(c)}`;
  const pc = PLAYER_FX[c];
  if (res.action.type === 'pass') { log(`${who} 跳過回合`, pc); return; }
  let flipped = 0, removed = 0;
  for (const st of res.steps) {
    if (st.kind === 'flip' || st.kind === 'lightning') flipped += st.cells.length;
    if (st.kind === 'remove') removed += st.cells.length;
  }
  const where = cellName(res.action.cell);
  if (res.ability) {
    const s = getScientist(res.ability);
    let extra = flipped ? `翻轉 ${flipped} 子` : '';
    if (removed) extra += `${extra ? '，' : ''}吞噬 ${removed} 子`;
    if (res.ability === 'schrodinger') extra = (res.collapse ? '坍縮為己方！' : '坍縮為對手…') + (flipped ? ` 翻轉 ${flipped} 子` : '');
    if (res.ability === 'faraday') extra += '，展開電磁屏蔽';
    if (res.ability === 'einstein') extra += '，獲得額外回合';
    log(`${who} 召喚 <b>${s.short}・${s.skill}</b> 於 ${where}${extra ? '，' + extra : ''}`, s.color);
  } else {
    log(`${who} 落子 ${where}，翻轉 ${flipped} 子`, pc);
  }
}

function maybeAI() {
  const g = S.game;
  if (S.mode !== 'ai' || !g || g.over || S.busy || g.current !== S.aiColor) return;
  const token = S.token;
  setTimeout(() => {
    if (token !== S.token || S.busy || g.over || g.current !== S.aiColor) return;
    enqueue(chooseAction(g));
  }, 650);
}

function showGameOver(r) {
  $('#go-black').textContent = r.black;
  $('#go-white').textContent = r.white;
  let title;
  if (r.winner === 0) title = '平手！';
  else if (S.mode === 'local') title = `${colorName(r.winner)}勝利！`;
  else title = r.winner === (S.mode === 'ai' ? opp(S.aiColor) : S.myColor) ? '🏆 你贏了！' : '你輸了…';
  $('#go-title').textContent = title;
  $('#go-sub').textContent = r.winner ? `${colorName(r.winner)}以 ${Math.max(r.black, r.white)} : ${Math.min(r.black, r.white)} 取勝` : '勢均力敵';
  const iWon = S.mode === 'local' || r.winner === (S.mode === 'ai' ? opp(S.aiColor) : S.myColor);
  if (iWon) sfx.win(); else sfx.lose();
  $('#btn-rematch').textContent = '再來一局';
  $('#btn-rematch').disabled = false;
  S.rematchSent = false;
  show('#gameover', true);
}

// ====================================================================== 模式切換
function startGame(mode, seed, myColor = BLACK) {
  S.token++;
  S.mode = mode;
  S.game = new Game(seed);
  S.myColor = myColor;
  S.aiColor = mode === 'ai' ? opp(myColor) : null;
  S.selected = null;
  hideDetail();
  S.busy = false;
  S.chain = Promise.resolve();
  view.controls.autoRotate = false;
  view.controls.enabled = true;
  view.reset();
  view.sync(S.game);
  view.introCamera(mode === 'online' ? myColor : BLACK);
  ['#lobby', '#waiting', '#gameover', '#rules'].forEach(id => show(id, false));
  ['#hud', '#deck', '#log', '#topbar'].forEach(id => show(id, true));
  show('#room-badge', mode === 'online');
  if (mode === 'online') $('#room-badge').textContent = `房間 ${S.code}`;
  $('#log').innerHTML = '';
  log('對局開始！黑方先手', '#e8c46e');
  if (mode === 'online') toast(`對手已加入！你執${colorName(myColor)}${myColor === BLACK ? '（先手）' : '（後手）'}`);
  refresh();
  maybeAI();
}

function toLobby() {
  S.token++;
  S.mode = null;
  S.selected = null;
  hideDetail();
  if (S.net) { S.net.close(); S.net = null; }
  ['#hud', '#deck', '#log', '#topbar', '#waiting', '#gameover', '#pass-btn', '#rules'].forEach(id => show(id, false));
  show('#lobby', true);
  view.interactive = false;
  view.setHighlights([], '#fff');
  view.controls.enabled = true;
  view.controls.autoRotate = true;
  view.controls.autoRotateSpeed = 0.5;
  history.replaceState(null, '', location.pathname);
}

async function goOnline(joinCode = null) {
  sfx.unlock();
  if (S.net) S.net.close();
  const net = S.net = new Net();
  net.on('created', m => {
    S.code = m.code;
    $('#room-code').textContent = m.code;
    const link = `${location.origin}${location.pathname}?room=${m.code}`;
    $('#share-link').value = link;
    history.replaceState(null, '', `?room=${m.code}`);
    show('#lobby', false); show('#waiting', true);
  })
    .on('start', m => { S.code = m.code; startGame('online', m.seed, m.color); })
    .on('action', m => { if (S.mode === 'online') enqueue(m.action); })
    .on('error', m => { toast(m.msg, true); toLobby(); })
    .on('rematch_request', () => { toast('對手想再來一局！'); $('#btn-rematch').textContent = '接受再戰'; })
    .on('opponent_left', () => {
      toast('對手已離開房間', true);
      if (S.game && !S.game.over) { S.token++; S.busy = false; $('#go-title').textContent = '對手已離線'; $('#go-sub').textContent = '對局中斷'; }
      $('#btn-rematch').disabled = true;
      show('#gameover', true);
    })
    .on('close', () => { if (S.mode === 'online' || !$('#waiting').classList.contains('hidden')) { toast('與伺服器的連線中斷', true); toLobby(); } });
  try {
    await net.connect();
  } catch (e) { toast(e.message, true); S.net = null; return; }
  if (joinCode) { S.code = joinCode.toUpperCase(); net.send({ t: 'join', code: S.code }); }
  else net.send({ t: 'create' });
}

// ====================================================================== 事件綁定
view.onCellClick = cell => {
  const action = { type: 'move', cell };
  if (S.selected) action.ability = S.selected;
  submit(action);
};
view.onEmptyClick = () => {
  // 點擊棋盤空白處僅收起詳細說明框，保持已選取的科學家不變，方便玩家落子
  if (S.detailId) {
    hideDetail();
  }
};

$('#btn-create').onclick = () => goOnline();
$('#btn-join').onclick = () => {
  const code = $('#join-code').value.trim();
  if (code.length !== 4) { toast('請輸入 4 碼房間代碼', true); return; }
  goOnline(code);
};
$('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });
$('#btn-local').onclick = () => { sfx.unlock(); startGame('local', randSeed()); };
$('#btn-ai').onclick = () => { sfx.unlock(); startGame('ai', randSeed(), BLACK); };
$('#btn-cancel-wait').onclick = toLobby;
$('#btn-copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#share-link').value); toast('已複製連結'); }
  catch { $('#share-link').select(); document.execCommand('copy'); toast('已複製連結'); }
};
$('#pass-btn').onclick = () => submit({ type: 'pass' });
$('#btn-rematch').onclick = () => {
  if (S.mode === 'online') {
    if (S.rematchSent) return;
    S.rematchSent = true;
    S.net.send({ t: 'rematch' });
    $('#btn-rematch').textContent = '等待對手同意…';
  } else startGame(S.mode, randSeed(), S.myColor);
};
$('#btn-tolobby').onclick = toLobby;
$('#btn-leave').onclick = () => { if (confirm('確定要離開這場對局嗎？')) toLobby(); };
$('#btn-sound').onclick = () => { sfx.enabled = !sfx.enabled; $('#btn-sound').textContent = sfx.enabled ? '🔊' : '🔇'; };
$('#btn-cam').onclick = () => { view.resetView(true); toast('🎥 已重置視角'); };

function toggleRules(open) {
  const isOpen = !$('#rules').classList.contains('hidden');
  const next = open === undefined ? !isOpen : open;
  show('#rules', next);
  view.controls.enabled = !next;
}
$('#btn-rules').onclick = () => toggleRules();
$('#btn-rules2').onclick = () => toggleRules(true);
$('#btn-close-rules').onclick = () => toggleRules(false);
$('#btn-close-rules-bottom').onclick = () => toggleRules(false);
$('#rules').addEventListener('click', e => {
  if (e.target.id === 'rules') toggleRules(false);
});

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#rules').classList.contains('hidden')) toggleRules(false);
    else if (S.selected || S.detailId) { S.selected = null; hideDetail(); refresh(); }
  }
  if ((e.key === 'r' || e.key === 'R') && S.mode && document.activeElement.tagName !== 'INPUT') {
    view.resetView(true);
    toast('🎥 已重置視角');
  }
  if (S.mode && S.game && /^[1-9]$/.test(e.key) && document.activeElement.tagName !== 'INPUT') onCardClick(SCIENTISTS[+e.key - 1].id);
});

// 防止觸控板雙指縮放把整個瀏覽器頁面放大而卡住
window.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
window.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
window.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });

// 圖鑑 & 大廳頭像
$('#gallery').innerHTML = SCIENTISTS.map(s => `
  <div class="g-item" id="gal-${s.id}" style="--c:${s.color}">
    <img src="${portraitUrl(s.id)}" alt="" loading="lazy">
    <div><div class="g-name">${s.name}</div><div class="g-meta">${s.en} · ${s.years} · ${s.field}</div>
    <div class="g-skill">✦ ${s.skill}</div><div class="g-desc">${s.desc}</div></div>
  </div>`).join('');
$('#lobby-portraits').innerHTML = SCIENTISTS.map(s => `<img src="${portraitUrl(s.id)}" data-id="${s.id}" title="點擊查看：${s.name}・${s.skill}" style="border-color:${s.color}">`).join('');
$('#lobby-portraits').addEventListener('click', e => {
  const id = e.target.dataset?.id;
  if (!id) return;
  toggleRules(true);
  document.getElementById(`gal-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// 初始畫面
const demo = new Game(1);
view.sync(demo);
view.controls.autoRotate = true;
view.controls.autoRotateSpeed = 0.5;
const loading = $('#loading');
loading.style.opacity = '0';
setTimeout(() => loading.remove(), 700);

const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) { $('#join-code').value = roomParam.toUpperCase(); goOnline(roomParam); }

// 方便除錯
window.__S = S;
window.__view = view;
