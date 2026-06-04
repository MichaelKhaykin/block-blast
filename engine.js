// engine.js — Pure, framework-free Block Blast game logic.
// Importable both in the browser (as an ES module) and in Node (for tests).
// No DOM, no globals, no Date.now / Math.random inside pure functions
// (randomness is injected via a seedable RNG so behaviour is testable).

export const BOARD_SIZE = 8;

// ---------------------------------------------------------------------------
// Colour palette — vivid Block-Blast-style block colours.
// Each piece family maps to a stable colour, matching the original's
// "shape has a consistent colour" feel.
// ---------------------------------------------------------------------------
// Tuned to the original's vivid-but-not-neon "gem" palette, calibrated from
// screenshot-sampled clone values (blockerino / pixel samples in research).
export const COLORS = {
  red: '#ef4444',
  orange: '#f08a1d',
  yellow: '#f5c01e',
  green: '#34b14a',
  teal: '#16bfc4',
  cyan: '#28aee0',
  blue: '#3b62e6',
  indigo: '#6a5be0',
  purple: '#a64ad0',
  pink: '#ec5a9e',
};

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

// Normalise a list of [row,col] cells so the top-left is at (0,0).
export function normalize(cells) {
  let minR = Infinity;
  let minC = Infinity;
  for (const [r, c] of cells) {
    if (r < minR) minR = r;
    if (c < minC) minC = c;
  }
  return cells
    .map(([r, c]) => [r - minR, c - minC])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// Rotate a shape 90° clockwise: (r,c) -> (c, -r), then normalise.
export function rotate(cells) {
  return normalize(cells.map(([r, c]) => [c, -r]));
}

function keyOf(cells) {
  return normalize(cells)
    .map(([r, c]) => `${r},${c}`)
    .join(' ');
}

// Given a base shape, produce all distinct rotations (1, 2 or 4).
function rotations(cells) {
  const seen = new Set();
  const out = [];
  let cur = normalize(cells);
  for (let i = 0; i < 4; i++) {
    const k = keyOf(cur);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(cur);
    }
    cur = rotate(cur);
  }
  return out;
}

function dims(cells) {
  let h = 0;
  let w = 0;
  for (const [r, c] of cells) {
    if (r + 1 > h) h = r + 1;
    if (c + 1 > w) w = c + 1;
  }
  return { w, h };
}

// ---------------------------------------------------------------------------
// Base shape catalogue. Each entry: a representative orientation, a colour,
// and a spawn weight (higher = more common). All rotations of a base shape
// share its colour and weight.
// ---------------------------------------------------------------------------
export const BASE_SHAPES = [
  { name: 'mono', color: COLORS.yellow, weight: 6, cells: [[0, 0]] },

  { name: 'domino', color: COLORS.cyan, weight: 10, cells: [[0, 0], [0, 1]] },

  { name: 'tromino-line', color: COLORS.blue, weight: 9, cells: [[0, 0], [0, 1], [0, 2]] },
  { name: 'tetromino-line', color: COLORS.indigo, weight: 6, cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  { name: 'pentomino-line', color: COLORS.purple, weight: 3, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },

  { name: 'square2', color: COLORS.orange, weight: 9, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { name: 'square3', color: COLORS.red, weight: 2, cells: [
    [0, 0], [0, 1], [0, 2],
    [1, 0], [1, 1], [1, 2],
    [2, 0], [2, 1], [2, 2],
  ] },

  { name: 'rect23', color: COLORS.pink, weight: 4, cells: [
    [0, 0], [0, 1], [0, 2],
    [1, 0], [1, 1], [1, 2],
  ] },

  { name: 'corner3', color: COLORS.green, weight: 9, cells: [[0, 0], [1, 0], [1, 1]] }, // L-tromino
  { name: 'L', color: COLORS.orange, weight: 5, cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
  { name: 'J', color: COLORS.blue, weight: 5, cells: [[0, 1], [1, 1], [2, 1], [2, 0]] },
  { name: 'T', color: COLORS.purple, weight: 5, cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
  { name: 'S', color: COLORS.green, weight: 4, cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  { name: 'Z', color: COLORS.red, weight: 4, cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
  { name: 'bigL', color: COLORS.teal, weight: 3, cells: [
    [0, 0],
    [1, 0],
    [2, 0], [2, 1], [2, 2],
  ] }, // 5-cell corner
];

// Expand every base shape into its distinct rotations -> the full piece set.
export const PIECES = (() => {
  const out = [];
  let id = 0;
  for (const base of BASE_SHAPES) {
    const rots = rotations(base.cells);
    // Split the base shape's spawn weight evenly across its rotations so that a
    // shape's overall spawn probability matches its authored weight regardless
    // of how many distinct orientations it has.
    const perRotationWeight = base.weight / rots.length;
    for (const cells of rots) {
      const { w, h } = dims(cells);
      out.push({
        id: id++,
        name: base.name,
        color: base.color,
        weight: perRotationWeight,
        cells,
        w,
        h,
        size: cells.length,
      });
    }
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Seedable RNG (mulberry32) — deterministic given a seed.
// ---------------------------------------------------------------------------
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted pick of a single piece definition.
export function randomPiece(rng) {
  let total = 0;
  for (const p of PIECES) total += p.weight;
  let x = rng() * total;
  for (const p of PIECES) {
    x -= p.weight;
    if (x <= 0) return p;
  }
  return PIECES[PIECES.length - 1];
}

// ---------------------------------------------------------------------------
// Board operations. A board is an 8x8 array of arrays; each cell is either
// null (empty) or a colour string (filled).
// ---------------------------------------------------------------------------
export function emptyBoard(size = BOARD_SIZE) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

// Can `piece` be placed with its top-left anchored at (row, col)?
export function canPlace(board, piece, row, col) {
  const size = board.length;
  for (const [dr, dc] of piece.cells) {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || c < 0 || r >= size || c >= size) return false;
    if (board[r][c] !== null) return false;
  }
  return true;
}

// Place a piece (mutates the board in place). Caller must have checked canPlace.
export function placePiece(board, piece, row, col) {
  const placed = [];
  for (const [dr, dc] of piece.cells) {
    board[row + dr][col + dc] = piece.color;
    placed.push([row + dr, col + dc]);
  }
  return placed;
}

// Find full rows and full columns. Returns indices.
export function findClears(board) {
  const size = board.length;
  const rows = [];
  const cols = [];
  for (let r = 0; r < size; r++) {
    if (board[r].every((cell) => cell !== null)) rows.push(r);
  }
  for (let c = 0; c < size; c++) {
    let full = true;
    for (let r = 0; r < size; r++) {
      if (board[r][c] === null) {
        full = false;
        break;
      }
    }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

// Clear the given rows/cols (mutates board). Returns the list of cleared cells
// (de-duplicated) for animation purposes.
export function applyClears(board, rows, cols) {
  const size = board.length;
  const cleared = new Set();
  for (const r of rows) {
    for (let c = 0; c < size; c++) cleared.add(`${r},${c}`);
  }
  for (const c of cols) {
    for (let r = 0; r < size; r++) cleared.add(`${r},${c}`);
  }
  const cells = [];
  for (const key of cleared) {
    const [r, c] = key.split(',').map(Number);
    board[r][c] = null;
    cells.push([r, c]);
  }
  return cells;
}

// Does any of the given pieces fit anywhere on the board?
export function hasAnyMove(board, pieces) {
  const size = board.length;
  for (const piece of pieces) {
    if (!piece) continue;
    for (let r = 0; r <= size - piece.h; r++) {
      for (let c = 0; c <= size - piece.w; c++) {
        if (canPlace(board, piece, r, c)) return true;
      }
    }
  }
  return false;
}

// Can ALL of the given pieces be placed on the board in SOME order, accounting
// for the space that line-clears free up between placements? Returns true as
// soon as one complete sequence is found (fast for the common, solvable case).
// `cap` bounds the search so a pathological board can never hang the UI — if the
// cap is hit we conservatively return true (treat the set as acceptable).
export function canPlaceSequence(board, pieces, cap = 50000) {
  const list = pieces.filter(Boolean);
  const counter = { n: 0, cap };
  return placeAll(board, list, counter);
}

function placeAll(board, remaining, counter) {
  if (remaining.length === 0) return true;
  const size = board.length;
  for (let i = 0; i < remaining.length; i++) {
    const piece = remaining[i];
    const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
    for (let r = 0; r <= size - piece.h; r++) {
      for (let c = 0; c <= size - piece.w; c++) {
        if (!canPlace(board, piece, r, c)) continue;
        if (++counter.n > counter.cap) return true; // give up; assume placeable
        const nb = cloneBoard(board);
        placePiece(nb, piece, r, c);
        const { rows, cols } = findClears(nb);
        if (rows.length || cols.length) applyClears(nb, rows, cols);
        if (placeAll(nb, rest, counter)) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Scoring. Constants are tuned to match the community-reverse-engineered
// Block Blast model (no official spec exists). All are in one place so they
// stay easy to adjust by feel:
//   - Placing a piece scores +1 per block.
//   - Each CLEARED cell is worth 10 points.
//   - Clearing several lines at once adds a flat super-linear bonus.
//   - A combo streak (consecutive moves that clear >=1 line) multiplies the
//     whole clear score: 1.0x on the first clear, +0.5x for each additional
//     consecutive clear. Resets when a move clears nothing.
//   - Clearing the entire board adds a big perfect-clear bonus.
// ---------------------------------------------------------------------------
export const SCORING = {
  perBlock: 1,
  perClearedCell: 10,
  lineBonus: { 1: 10, 2: 20, 3: 60, 4: 120, 5: 200 },
  lineBonus6plus: 300,
  fullBoardBonus: 360,
  comboStep: 0.5,
};

export function lineBonus(lines) {
  if (lines <= 0) return 0;
  if (lines >= 6) return SCORING.lineBonus6plus;
  return SCORING.lineBonus[lines] ?? 0;
}

// Multiplier for the current streak count (1 = first clear -> 1.0x).
export function comboMultiplier(combo) {
  if (combo <= 0) return 1;
  return 1 + (combo - 1) * SCORING.comboStep;
}

// Compute the score for a move and the next combo value.
// comboBefore is the streak count coming into this move.
export function scoreMove({ placedBlocks, linesCleared, clearedCells = 0, comboBefore, boardEmptyAfter = false }) {
  let points = placedBlocks * SCORING.perBlock;
  let combo = comboBefore;
  if (linesCleared > 0) {
    combo = comboBefore + 1;
    const base = clearedCells * SCORING.perClearedCell + lineBonus(linesCleared);
    let clearPts = base * comboMultiplier(combo);
    if (boardEmptyAfter) clearPts += SCORING.fullBoardBonus;
    points += Math.round(clearPts);
  } else {
    combo = 0;
  }
  return { points, combo };
}

const PRAISE = ['Nice!', 'Good Work!', 'Great!', 'Amazing!', 'Excellent!', 'Perfect!'];

// Human-facing label for a clear event (for combo popups).
export function clearLabel(linesCleared, combo) {
  if (linesCleared <= 0) return null;
  const byLines = { 2: 'Double!', 3: 'Triple!', 4: 'Quad!', 5: 'Penta!' };
  let label;
  if (linesCleared >= 6) label = 'Mega Clear!';
  else if (byLines[linesCleared]) label = byLines[linesCleared];
  else label = PRAISE[Math.min(combo, PRAISE.length - 1)] || 'Clear!';
  if (combo >= 2) label += `  Combo x${combo}`;
  return label;
}

// ---------------------------------------------------------------------------
// High-level "apply a move" helper used by both the UI and tests. Returns a
// description of everything that happened so the UI can animate it. Mutates
// the passed board.
// ---------------------------------------------------------------------------
export function isBoardEmpty(board) {
  for (const row of board) {
    for (const cell of row) if (cell !== null) return false;
  }
  return true;
}

export function applyMove(board, piece, row, col, comboBefore) {
  if (!canPlace(board, piece, row, col)) {
    return { ok: false };
  }
  const placedCells = placePiece(board, piece, row, col);
  const { rows, cols } = findClears(board);
  const linesCleared = rows.length + cols.length;
  const clearedCells = applyClears(board, rows, cols);
  const boardEmptyAfter = clearedCells.length > 0 && isBoardEmpty(board);
  const { points, combo } = scoreMove({
    placedBlocks: piece.cells.length,
    linesCleared,
    clearedCells: clearedCells.length,
    comboBefore,
    boardEmptyAfter,
  });
  return {
    ok: true,
    placedCells,
    rows,
    cols,
    linesCleared,
    clearedCells,
    boardEmptyAfter,
    points,
    combo,
    label: clearLabel(linesCleared, combo),
  };
}
