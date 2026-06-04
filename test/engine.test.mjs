// Minimal dependency-free test runner for the pure engine.
// Run with:  node test/engine.test.mjs
import {
  BOARD_SIZE,
  PIECES,
  BASE_SHAPES,
  emptyBoard,
  cloneBoard,
  canPlace,
  placePiece,
  findClears,
  applyClears,
  hasAnyMove,
  scoreMove,
  lineBonus,
  comboMultiplier,
  clearLabel,
  applyMove,
  isBoardEmpty,
  makeRng,
  randomPiece,
  normalize,
  rotate,
} from '../engine.js';

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
  }
}
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// Helper to find a piece by name + matching width/height.
function pieceByName(name) {
  return PIECES.find((p) => p.name === name);
}

// --- shape helpers -------------------------------------------------------
eq(normalize([[2, 3], [2, 4]]), [[0, 0], [0, 1]], 'normalize shifts to origin');
eq(rotate([[0, 0], [0, 1], [0, 2]]), [[0, 0], [1, 0], [2, 0]], 'rotate H-line -> V-line');

// --- piece set sanity ----------------------------------------------------
ok(PIECES.length > 20, `piece set has many orientations (${PIECES.length})`);
ok(PIECES.every((p) => p.cells.length === p.size), 'piece size matches cell count');
ok(PIECES.every((p) => p.w >= 1 && p.h >= 1 && p.w <= 5 && p.h <= 5), 'piece dims in range');
ok(pieceByName('square3').size === 9, '3x3 square has 9 cells');
ok(pieceByName('mono').size === 1, 'mono has 1 cell');
// every piece's cells are within its bounding box
ok(
  PIECES.every((p) => p.cells.every(([r, c]) => r >= 0 && c >= 0 && r < p.h && c < p.w)),
  'cells within bounding box',
);

// --- placement -----------------------------------------------------------
{
  const b = emptyBoard();
  const sq = pieceByName('square2');
  ok(canPlace(b, sq, 0, 0), 'square2 fits at origin on empty board');
  ok(!canPlace(b, sq, 7, 7), 'square2 does not fit off the bottom-right edge');
  placePiece(b, sq, 0, 0);
  ok(!canPlace(b, sq, 0, 0), 'cannot overlap an occupied square');
  ok(canPlace(b, sq, 0, 2), 'fits adjacent to placed piece');
  eq([b[0][0], b[0][1], b[1][0], b[1][1]], [sq.color, sq.color, sq.color, sq.color], 'square2 filled 4 cells');
}

// --- row clear -----------------------------------------------------------
{
  const b = emptyBoard();
  for (let c = 0; c < BOARD_SIZE; c++) b[3][c] = '#fff';
  const { rows, cols } = findClears(b);
  eq(rows, [3], 'detects full row 3');
  eq(cols, [], 'no full columns');
  const cleared = applyClears(b, rows, cols);
  eq(cleared.length, BOARD_SIZE, 'cleared 8 cells');
  ok(b[3].every((x) => x === null), 'row 3 now empty');
}

// --- column clear --------------------------------------------------------
{
  const b = emptyBoard();
  for (let r = 0; r < BOARD_SIZE; r++) b[r][5] = '#fff';
  const { rows, cols } = findClears(b);
  eq(cols, [5], 'detects full column 5');
  applyClears(b, rows, cols);
  ok(b.every((row) => row[5] === null), 'column 5 now empty');
}

// --- simultaneous row + column clear share the intersection cell ---------
{
  const b = emptyBoard();
  for (let c = 0; c < BOARD_SIZE; c++) b[0][c] = '#fff';
  for (let r = 0; r < BOARD_SIZE; r++) b[r][0] = '#fff';
  const { rows, cols } = findClears(b);
  eq(rows, [0], 'row 0 full');
  eq(cols, [0], 'col 0 full');
  const cleared = applyClears(b, rows, cols);
  // 8 + 8 - 1 shared intersection = 15 distinct cells
  eq(cleared.length, 15, 'row+col clear de-dupes the intersection cell');
}

// --- game over detection -------------------------------------------------
{
  // Fill the whole board: nothing fits.
  const full = emptyBoard();
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) full[r][c] = '#fff';
  ok(!hasAnyMove(full, [pieceByName('mono')]), 'full board: even a mono cannot be placed');

  // One empty cell -> only the mono fits.
  const oneOpen = cloneBoard(full);
  oneOpen[4][4] = null;
  ok(hasAnyMove(oneOpen, [pieceByName('mono')]), 'single hole fits a mono');
  ok(!hasAnyMove(oneOpen, [pieceByName('square2')]), 'single hole does not fit a 2x2');
}

// --- scoring -------------------------------------------------------------
eq(lineBonus(1), 10, '1-line bonus = 10');
eq(lineBonus(2), 20, '2-line bonus = 20');
eq(lineBonus(3), 60, '3-line bonus = 60');
eq(lineBonus(4), 120, '4-line bonus = 120');
eq(lineBonus(7), 300, '6+ lines bonus = 300');
eq(comboMultiplier(0), 1, 'no combo -> 1.0x');
eq(comboMultiplier(1), 1, 'first clear -> 1.0x');
eq(comboMultiplier(3), 2, 'third consecutive clear -> 2.0x');
{
  // place 4 blocks, no clear, no prior combo
  const a = scoreMove({ placedBlocks: 4, linesCleared: 0, comboBefore: 0 });
  eq(a, { points: 4, combo: 0 }, 'placement-only score = blocks, combo resets to 0');
  // first single line clear (8 cells): base = 8*10 + 10 = 90, x1.0
  const c1 = scoreMove({ placedBlocks: 3, linesCleared: 1, clearedCells: 8, comboBefore: 0 });
  eq(c1, { points: 3 + 90, combo: 1 }, 'first single clear: per-cell 10 + line bonus');
  // second consecutive clear, 2 lines (16 cells): base = 16*10 + 20 = 180, x1.5
  const c2 = scoreMove({ placedBlocks: 2, linesCleared: 2, clearedCells: 16, comboBefore: 1 });
  eq(c2, { points: 2 + Math.round(180 * 1.5), combo: 2 }, 'combo multiplies the clear score');
  // full-board clear adds the perfect-clear bonus
  const fb = scoreMove({ placedBlocks: 1, linesCleared: 1, clearedCells: 8, comboBefore: 0, boardEmptyAfter: true });
  eq(fb, { points: 1 + 90 + 360, combo: 1 }, 'full board clear adds perfect-clear bonus');
}

// --- labels --------------------------------------------------------------
ok(clearLabel(0, 0) === null, 'no clear -> no label');
ok(clearLabel(2, 1).includes('Double'), 'double label');
ok(clearLabel(1, 3).includes('Combo x3'), 'combo label appears at streak >= 2');

// --- isBoardEmpty --------------------------------------------------------
ok(isBoardEmpty(emptyBoard()), 'fresh board is empty');
{
  const b = emptyBoard();
  b[0][0] = '#fff';
  ok(!isBoardEmpty(b), 'one filled cell -> not empty');
}

// --- applyMove integration ----------------------------------------------
{
  const b = emptyBoard();
  // Fill row 7 columns 0..6, leave (7,7) empty; drop a mono there -> clears
  // row 7 AND empties the board (perfect clear).
  for (let c = 0; c < 7; c++) b[7][c] = '#fff';
  const mono = pieceByName('mono');
  const res = applyMove(b, mono, 7, 7, 0);
  ok(res.ok, 'applyMove succeeds on valid placement');
  eq(res.linesCleared, 1, 'applyMove cleared 1 line');
  ok(b[7].every((x) => x === null), 'row fully cleared after applyMove');
  ok(res.boardEmptyAfter, 'applyMove reports perfect clear');
  ok(res.points === 1 + 90 + 360, 'applyMove score = 1 block + 90 clear + 360 perfect-clear');
}
{
  // Same row clear but with a stray block elsewhere -> no perfect-clear bonus.
  const b = emptyBoard();
  for (let c = 0; c < 7; c++) b[7][c] = '#fff';
  b[0][0] = '#fff';
  const res = applyMove(b, pieceByName('mono'), 7, 7, 0);
  ok(!res.boardEmptyAfter, 'not a perfect clear when a stray block remains');
  ok(res.points === 1 + 90, 'no perfect-clear bonus -> 1 block + 90 clear');
}
{
  const b = emptyBoard();
  placePiece(b, pieceByName('square2'), 0, 0);
  const res = applyMove(b, pieceByName('square2'), 0, 0, 0); // overlaps
  ok(!res.ok, 'applyMove rejects an overlapping placement');
}

// --- spawn weight is per base shape, not per rotation --------------------
{
  const byName = new Map();
  for (const p of PIECES) byName.set(p.name, (byName.get(p.name) || 0) + p.weight);
  for (const base of BASE_SHAPES) {
    const sum = byName.get(base.name);
    ok(Math.abs(sum - base.weight) < 1e-9, `base "${base.name}" total spawn weight == authored ${base.weight}`);
  }
  // square2 (1 orientation) and corner3 (4 orientations) share weight 9, so they
  // must be equally likely overall despite differing rotation counts.
  ok(
    Math.abs(byName.get('square2') - byName.get('corner3')) < 1e-9,
    'equal authored weight -> equal spawn probability regardless of rotation count',
  );
}

// --- RNG determinism -----------------------------------------------------
{
  const r1 = makeRng(12345);
  const r2 = makeRng(12345);
  const a = [r1(), r1(), r1()];
  const bb = [r2(), r2(), r2()];
  eq(a, bb, 'same seed -> same RNG sequence');
  ok(a.every((x) => x >= 0 && x < 1), 'RNG outputs in [0,1)');
  const p = randomPiece(makeRng(1));
  ok(p && p.cells.length >= 1, 'randomPiece returns a valid piece');
}

// --- report --------------------------------------------------------------
console.log(`\nEngine tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗', f);
  process.exit(1);
} else {
  console.log('All engine tests passed ✓');
}
