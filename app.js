// app.js — UI, input, animation and persistence for Block Blast.
// All game rules live in engine.js (pure + unit-tested); this file wires them
// to the DOM and to touch/mouse input.

import {
  BOARD_SIZE,
  PIECES,
  emptyBoard,
  canPlace,
  placePiece,
  findClears,
  applyClears,
  hasAnyMove,
  scoreMove,
  clearLabel,
  isBoardEmpty,
  randomPiece,
} from './engine.js';

// --------------------------------------------------------------- storage ----
const SAVE_KEY = 'blockblast.save.v1';
const BEST_KEY = 'blockblast.best.v1';
const THEME_KEY = 'blockblast.theme.v1';

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch {
      /* ignore (private mode / full) */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

// --------------------------------------------------------------- helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const rng = () => Math.random();

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduceMotion = motionQuery.matches;
if (motionQuery.addEventListener) {
  motionQuery.addEventListener('change', (e) => {
    reduceMotion = e.matches;
  });
}

// --------------------------------------------------------------- DOM refs ---
const boardEl = $('board');
const trayEl = $('tray');
const scoreEl = $('score');
const bestEl = $('best');
const comboLayer = $('combo-layer');
const dragLayer = $('drag-layer');
const overlay = $('overlay');
const rootEl = document.documentElement;

// --------------------------------------------------------------- state ------
const state = {
  board: emptyBoard(),
  tray: [null, null, null], // each slot: { piece } | null
  score: 0,
  best: Number(store.get(BEST_KEY, '0')) || 0,
  combo: 0,
  gameOver: false,
  busy: false, // true while a clear animation is resolving
  cell: 38,
  gap: 5,
  tcell: 22,
  displayScore: 0,
};

const cellEls = []; // cellEls[r][c]

// ------------------------------------------------------------- layout -------
function computeLayout() {
  const vw = Math.min(window.innerWidth, 520);
  const availW = vw - 28;
  const availH = window.innerHeight;
  // Board height ≈ 9.2*cell (8 cells + gaps + padding); reserve ~150px for the
  // header and ~3*cell for the tray below.
  let cell = Math.min(availW / 9.2, (availH - 150) / 12.4, 58);
  cell = Math.max(26, Math.floor(cell));
  const gap = Math.max(3, Math.min(7, Math.round(cell * 0.13)));
  // Cap the tray cell so even a 5-wide line piece fits its 1/3 tray column:
  // width = 5*tcell + 4*(0.12*tcell) + 8px padding = 5.48*tcell + 8.
  const trayCol = (availW - 2 * 4) / 3;
  const fitTcell = Math.floor((trayCol - 8) / 5.48);
  const tcell = Math.max(14, Math.min(Math.round(cell * 0.56), fitTcell));
  state.cell = cell;
  state.gap = gap;
  state.tcell = tcell;
  rootEl.style.setProperty('--cell', cell + 'px');
  rootEl.style.setProperty('--gap', gap + 'px');
  rootEl.style.setProperty('--tcell', tcell + 'px');
}

// ------------------------------------------------------------- board build --
function buildBoard() {
  boardEl.innerHTML = '';
  cellEls.length = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      const el = document.createElement('div');
      el.className = 'cell';
      boardEl.appendChild(el);
      row.push(el);
    }
    cellEls.push(row);
  }
}

function fillCell(r, c, color, pop) {
  const el = cellEls[r][c];
  el.classList.remove('ghost', 'ghost-line', 'ghost-bad', 'clearing');
  el.classList.add('filled', 'gem');
  el.style.setProperty('--c', color);
  if (pop) {
    el.classList.remove('pop');
    void el.offsetWidth; // restart animation
    el.classList.add('pop');
  }
}

function emptyCell(r, c) {
  const el = cellEls[r][c];
  el.classList.remove('filled', 'gem', 'pop', 'ghost', 'ghost-line', 'ghost-bad', 'clearing');
  el.style.removeProperty('--c');
}

function renderBoardFull() {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const v = state.board[r][c];
      if (v) fillCell(r, c, v, false);
      else emptyCell(r, c);
    }
  }
}

// ----------------------------------------------------------- piece render ---
function buildPieceGrid(piece, containerClass, cellVar) {
  const g = document.createElement('div');
  g.className = containerClass;
  g.style.gridTemplateColumns = `repeat(${piece.w}, var(${cellVar}))`;
  g.style.gridTemplateRows = `repeat(${piece.h}, var(${cellVar}))`;
  const filled = new Set(piece.cells.map(([r, c]) => `${r},${c}`));
  for (let r = 0; r < piece.h; r++) {
    for (let c = 0; c < piece.w; c++) {
      const b = document.createElement('div');
      if (filled.has(`${r},${c}`)) {
        b.className = 'blk gem';
        b.style.setProperty('--c', piece.color);
      } else {
        b.className = 'blk hole';
      }
      g.appendChild(b);
    }
  }
  return g;
}

function renderTray(spawn) {
  trayEl.innerHTML = '';
  state.tray.forEach((slot, i) => {
    const slotEl = document.createElement('div');
    slotEl.className = 'tray-slot';
    if (slot) {
      const pieceEl = buildPieceGrid(slot.piece, 'tray-piece', '--tcell');
      pieceEl.dataset.slot = String(i);
      if (spawn) pieceEl.classList.add('spawn');
      pieceEl.addEventListener('pointerdown', onPiecePointerDown);
      slotEl.appendChild(pieceEl);
    }
    trayEl.appendChild(slotEl);
  });
}

// ----------------------------------------------------------- score view -----
function setScoreImmediate(v) {
  state.displayScore = v;
  scoreEl.textContent = String(v);
}

function animateScore(to) {
  const from = state.displayScore;
  if (to === from) return;
  if (reduceMotion) {
    state.displayScore = to;
    scoreEl.textContent = String(to);
    return;
  }
  const start = performance.now();
  const dur = 320;
  scoreEl.classList.remove('bump');
  void scoreEl.offsetWidth;
  scoreEl.classList.add('bump');
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = Math.round(from + (to - from) * eased);
    scoreEl.textContent = String(val);
    if (t < 1) requestAnimationFrame(step);
    else {
      state.displayScore = to;
      scoreEl.textContent = String(to);
    }
  }
  requestAnimationFrame(step);
}

function updateBest() {
  bestEl.textContent = String(state.best);
}

// ----------------------------------------------------------- combo popup ----
function showCombo(label) {
  if (!label) return;
  // announce to assistive tech (the visual layer is aria-hidden)
  const sr = $('sr-announce');
  if (sr) sr.textContent = label;

  const el = document.createElement('div');
  el.className = 'combo-pop';
  el.textContent = label;
  el.style.transform = 'translateY(0)';
  el.style.marginTop = `${-state.cell * 0.6}px`;
  if (reduceMotion) el.classList.add('static'); // visible, non-animated
  comboLayer.appendChild(el);
  setTimeout(() => el.remove(), reduceMotion ? 900 : 1200);
}

// --------------------------------------------------------------- piece gen --
function generateTray(spawn) {
  // Authentic Block Blast draws pieces randomly with no solvability guarantee.
  // We add a gentle safeguard: if all three are dead-on-arrival for the current
  // board, re-roll a few times so a near-empty board never loses unfairly.
  let pick;
  for (let attempt = 0; attempt < 14; attempt++) {
    pick = [randomPiece(rng), randomPiece(rng), randomPiece(rng)];
    if (hasAnyMove(state.board, pick)) break;
  }
  state.tray = pick.map((piece) => ({ piece }));
  renderTray(spawn);
}

// --------------------------------------------------------------- input ------
let drag = null;

function onPiecePointerDown(e) {
  if (state.gameOver || state.busy || drag) return;
  const sourceEl = e.currentTarget;
  const slot = Number(sourceEl.dataset.slot);
  const entry = state.tray[slot];
  if (!entry) return;
  e.preventDefault();

  const piece = entry.piece;
  const el = buildPieceGrid(piece, 'drag-piece', '--cell');
  dragLayer.appendChild(el);
  sourceEl.classList.add('dragging-source');

  // Capture the pointer so we always receive move/up/cancel even if the finger
  // leaves the element — and so the platform guarantees a terminating event.
  try {
    sourceEl.setPointerCapture(e.pointerId);
  } catch {
    /* not supported — fine, we still listen on the element */
  }

  drag = {
    slot,
    piece,
    pointerId: e.pointerId,
    el,
    sourceEl,
    lift: Math.max(30, state.cell * 0.7),
    ghostCells: [],
    target: null,
  };

  sourceEl.addEventListener('pointermove', onPointerMove, { passive: false });
  sourceEl.addEventListener('pointerup', onPointerUp);
  sourceEl.addEventListener('pointercancel', onPointerUp);
  sourceEl.addEventListener('lostpointercapture', onLostCapture);

  moveDrag(e.clientX, e.clientY);
}

// Snap math is recomputed live every move so a mid-drag layout shift (e.g. the
// iOS Safari toolbar showing/hiding) never desyncs the ghost from the finger.
function moveDrag(px, py) {
  const d = drag;
  const cell = state.cell;
  const gap = state.gap;
  const o = cellEls[0][0].getBoundingClientRect();
  const pitch = cell + gap;
  const pieceW = d.piece.w * cell + (d.piece.w - 1) * gap;
  const pieceH = d.piece.h * cell + (d.piece.h - 1) * gap;

  const floatLeft = px - pieceW / 2;
  const floatTop = py - pieceH - d.lift;
  d.el.style.transform = `translate(${floatLeft}px, ${floatTop}px)`;

  const col = Math.round((floatLeft - o.left) / pitch);
  const row = Math.round((floatTop - o.top) / pitch);

  const inRange =
    row >= 0 && col >= 0 && row + d.piece.h <= BOARD_SIZE && col + d.piece.w <= BOARD_SIZE;

  clearGhost();
  if (!inRange) {
    d.target = null;
    return;
  }
  if (canPlace(state.board, d.piece, row, col)) {
    d.target = { row, col };
    showGhost(row, col, d.piece);
  } else {
    d.target = null;
    showGhostBad(row, col, d.piece);
  }
}

function clearGhost() {
  for (const el of drag.ghostCells) {
    el.classList.remove('ghost', 'ghost-line', 'ghost-bad');
    if (!el.classList.contains('filled')) el.style.removeProperty('--c');
  }
  drag.ghostCells = [];
}

function showGhost(row, col, piece) {
  // Would this placement complete any lines? Highlight those ghost cells.
  const test = state.board.map((r) => r.slice());
  for (const [dr, dc] of piece.cells) test[row + dr][col + dc] = piece.color;
  const { rows, cols } = findClears(test);
  const willClear = rows.length + cols.length > 0;
  const rowSet = new Set(rows);
  const colSet = new Set(cols);
  for (const [dr, dc] of piece.cells) {
    const r = row + dr;
    const c = col + dc;
    const el = cellEls[r][c];
    el.style.setProperty('--c', piece.color);
    el.classList.add('ghost');
    if (willClear && (rowSet.has(r) || colSet.has(c))) el.classList.add('ghost-line');
    drag.ghostCells.push(el);
  }
}

function showGhostBad(row, col, piece) {
  for (const [dr, dc] of piece.cells) {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) continue;
    const el = cellEls[r][c];
    if (el.classList.contains('filled')) continue;
    el.classList.add('ghost-bad');
    drag.ghostCells.push(el);
  }
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  e.preventDefault();
  moveDrag(e.clientX, e.clientY);
}

function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  // A system-aborted gesture (pointercancel) must never place a piece.
  const commit = e.type !== 'pointercancel';
  const committed = teardownDrag(commit);
  if (committed) commitMove(committed.slot, committed.target.row, committed.target.col);
}

function onLostCapture(e) {
  // Capture yanked away without a normal release (app switch, Control Center,
  // palm rejection…) — abort safely so dragging can never soft-lock.
  if (!drag || e.pointerId !== drag.pointerId) return;
  teardownDrag(false);
}

// Single teardown path for every way a drag can end. Idempotent.
// Returns the finished drag object when the caller should commit, else null.
function teardownDrag(commit) {
  const d = drag;
  if (!d) return null;
  drag = null;

  const src = d.sourceEl;
  src.removeEventListener('pointermove', onPointerMove);
  src.removeEventListener('pointerup', onPointerUp);
  src.removeEventListener('pointercancel', onPointerUp);
  src.removeEventListener('lostpointercapture', onLostCapture);
  try {
    src.releasePointerCapture(d.pointerId);
  } catch {
    /* already released */
  }

  for (const cell of d.ghostCells) {
    cell.classList.remove('ghost', 'ghost-line', 'ghost-bad');
    if (!cell.classList.contains('filled')) cell.style.removeProperty('--c');
  }
  d.ghostCells = [];

  if (commit && d.target) {
    d.el.remove();
    return d;
  }

  // restore: fade the floating piece out and bring the tray slot back
  d.el.classList.add('returning');
  d.el.style.opacity = '0';
  d.el.style.transform += ' scale(0.6)';
  setTimeout(() => {
    d.el.remove();
    if (src.isConnected) src.classList.remove('dragging-source');
  }, 180);
  return null;
}

// --------------------------------------------------------------- move logic -
async function commitMove(slot, row, col) {
  state.busy = true; // serialize input against placement → clear → refill → game-over
  try {
    const piece = state.tray[slot].piece;

    // 1. place
    const placed = placePiece(state.board, piece, row, col);
    state.tray[slot] = null;
    for (const [r, c] of placed) fillCell(r, c, piece.color, true);
    renderTray(false);

    // 2. detect clears
    const { rows, cols } = findClears(state.board);
    const linesCleared = rows.length + cols.length;

    // cells that will clear (de-duplicated), and whether it empties the board
    const clearKeys = new Set();
    for (const r of rows) for (let c = 0; c < BOARD_SIZE; c++) clearKeys.add(`${r},${c}`);
    for (const c of cols) for (let r = 0; r < BOARD_SIZE; r++) clearKeys.add(`${r},${c}`);
    let filledCount = 0;
    for (let r = 0; r < BOARD_SIZE; r++)
      for (let c = 0; c < BOARD_SIZE; c++) if (state.board[r][c]) filledCount++;
    const boardEmptyAfter = linesCleared > 0 && filledCount === clearKeys.size;

    // 3. score
    const { points, combo } = scoreMove({
      placedBlocks: piece.cells.length,
      linesCleared,
      clearedCells: clearKeys.size,
      comboBefore: state.combo,
      boardEmptyAfter,
    });
    state.combo = combo;
    state.score += points;
    if (state.score > state.best) {
      state.best = state.score;
      store.set(BEST_KEY, String(state.best));
      updateBest();
    }
    animateScore(state.score);

    // 4. clear animation
    if (linesCleared > 0) {
      showCombo(clearLabel(linesCleared, combo));
      if (linesCleared >= 2 || combo >= 3 || boardEmptyAfter) {
        boardEl.classList.remove('shake');
        void boardEl.offsetWidth;
        boardEl.classList.add('shake');
      }
      for (const key of clearKeys) {
        const [r, c] = key.split(',').map(Number);
        cellEls[r][c].classList.add('clearing');
      }
      await sleep(330);
      applyClears(state.board, rows, cols);
      for (const key of clearKeys) {
        const [r, c] = key.split(',').map(Number);
        emptyCell(r, c);
      }
    }

    // 5. refill when the tray is empty
    if (state.tray.every((s) => s === null)) {
      generateTray(true);
    }

    // 6. game over?
    const remaining = state.tray.filter(Boolean).map((s) => s.piece);
    if (!hasAnyMove(state.board, remaining)) {
      saveState();
      await sleep(260);
      endGame();
      return;
    }

    saveState();
  } finally {
    state.busy = false;
  }
}

// --------------------------------------------------------------- game over --
function endGame() {
  state.gameOver = true;
  $('final-score').textContent = String(state.score);
  $('final-best').textContent = String(state.best);
  const isNewBest = state.score > 0 && state.score >= state.best;
  $('new-best-badge').classList.toggle('hidden', !isNewBest);
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}

function newGame() {
  state.board = emptyBoard();
  state.score = 0;
  state.combo = 0;
  state.gameOver = false;
  state.busy = false;
  setScoreImmediate(0);
  renderBoardFull();
  generateTray(true);
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  saveState();
}

// --------------------------------------------------------------- persistence
function saveState() {
  const data = {
    board: state.board,
    tray: state.tray.map((s) => (s ? s.piece.id : null)),
    score: state.score,
    combo: state.combo,
    gameOver: state.gameOver,
  };
  store.set(SAVE_KEY, JSON.stringify(data));
}

function loadState() {
  const raw = store.get(SAVE_KEY, null);
  if (!raw) return false;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!data || !Array.isArray(data.board) || data.gameOver) return false;
  if (data.board.length !== BOARD_SIZE) return false;
  // reconstruct
  state.board = data.board.map((row) => row.slice());
  state.tray = (data.tray || []).map((id) => (id == null ? null : { piece: PIECES[id] }));
  while (state.tray.length < 3) state.tray.push(null);
  state.score = Number(data.score) || 0;
  state.combo = Number(data.combo) || 0;
  state.gameOver = false;
  // if a corrupt/empty tray slipped through, regenerate
  if (state.tray.every((s) => s === null)) generateTray(false);
  return true;
}

// --------------------------------------------------------------- theme ------
function applyTheme(theme) {
  rootEl.setAttribute('data-theme', theme);
  store.set(THEME_KEY, theme);
  const meta = $('theme-color-meta');
  if (meta) {
    const top = getComputedStyle(rootEl).getPropertyValue('--page-top').trim();
    meta.setAttribute('content', top || '#393074');
  }
  const btn = $('theme-btn');
  if (btn) btn.setAttribute('aria-pressed', String(theme === 'light'));
}

function toggleTheme() {
  const cur = rootEl.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(cur);
}

// --------------------------------------------------------------- install ----
function maybeShowInstallHint() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  const dismissed = store.get('blockblast.installHint', '0') === '1';
  if (isIos && !standalone && !dismissed) {
    const hint = $('install-hint');
    hint.classList.remove('hidden');
    $('install-dismiss').addEventListener('click', () => {
      hint.classList.add('hidden');
      store.set('blockblast.installHint', '1');
    });
    setTimeout(() => hint.classList.add('hidden'), 9000);
  }
}

// --------------------------------------------------------------- wiring -----
function init() {
  computeLayout();
  buildBoard();
  applyTheme(store.get(THEME_KEY, 'dark'));
  updateBest();

  const restored = loadState();
  if (restored) {
    renderBoardFull();
    renderTray(false);
    setScoreImmediate(state.score);
    // a restored game could already be unwinnable
    const remaining = state.tray.filter(Boolean).map((s) => s.piece);
    if (!hasAnyMove(state.board, remaining)) endGame();
  } else {
    newGame();
  }

  $('theme-btn').addEventListener('click', toggleTheme);
  $('restart-btn').addEventListener('click', () => {
    if (state.busy) return;
    newGame();
  });
  $('play-again').addEventListener('click', newGame);

  window.addEventListener('resize', () => {
    computeLayout();
  });
  window.addEventListener('orientationchange', () => setTimeout(computeLayout, 150));

  // safety net: never leave a drag hanging if the app is backgrounded mid-gesture
  window.addEventListener('blur', () => teardownDrag(false));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) teardownDrag(false);
  });

  // avoid iOS double-tap zoom / long-press selection on the playfield
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('#board') || e.target.closest('#tray')) e.preventDefault();
  });

  maybeShowInstallHint();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

init();
