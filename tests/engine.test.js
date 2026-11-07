// Diff engine tests. No npm needed — run with:  node tests/engine.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'diff-engine.js'), 'utf8');
const ctx = {};
vm.runInNewContext(src + '\nthis.DiffEngine = DiffEngine;', ctx);
const DE = ctx.DiffEngine;

const DEFAULT_RULES = {
  ignoreParenComments: false, ignoreSemiComments: true, ignoreWhitespace: true,
  ignoreCase: true, normalizeGMCodes: true, ignoreLineNumbers: true, ignoreBlockDelete: false
};

function diff(left, right, rules = {}) {
  return DE.computeSemanticDiff(left, right, {
    rules: { ...DEFAULT_RULES, ...rules }, minorThreshold: 0.001, majorThreshold: 0.01
  });
}
function types(left, right, rules) {
  return diff(left, right, rules).ops.map(o => o.type).join(',');
}

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(actual, expected) {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('Severity rules');
test('G0 vs G1 is critical', () => eq(types(['G0 X1. Y1.'], ['G1 X1. Y1.']), 'critical'));
test('G1 vs G2 is critical', () => eq(types(['G1 X1. Y1. I1.'], ['G2 X1. Y1. I1.']), 'critical'));
test('modal: bare move under G0 vs G1 is critical', () =>
  eq(types(['G0 X0.', 'X1.'], ['G1 X0. F10.', 'X1.']).split(',')[1], 'critical'));
test('explicit G1 vs modal G1 is equal', () => eq(types(['G1 X0. F10.', 'G1 X1.'], ['G1 X0. F10.', 'X1.']), 'equal,equal'));
test('G01 vs G1 equal when normalized', () => eq(types(['G01 X1.'], ['G1 X1.']), 'equal'));
test('G01 vs G1 minor when not normalized', () => eq(types(['G01 X1.'], ['G1 X1.'], { normalizeGMCodes: false }), 'minor'));
test('work offset G54 vs G55', () => eq(types(['G90 G54'], ['G90 G55']), 'workoffset'));
test('missing axis is critical', () => eq(types(['G1 X1. Y1.'], ['G1 X1.']), 'critical'));
test('feed change is critical', () => eq(types(['G1 X1. F10.'], ['G1 X1. F20.']), 'critical'));
test('unknown word (U) change is critical', () => eq(types(['G1 X1. U1.'], ['G1 X1. U2.']), 'critical'));

console.log('Tolerance');
test('within minor -> tolerance', () => eq(types(['G1 X1.0000'], ['G1 X1.0005']), 'tolerance'));
test('between minor and major -> minor', () => eq(types(['G1 X1.000'], ['G1 X1.005']), 'minor'));
test('beyond major -> critical, alwaysShow', () => {
  const op = diff(['G1 X1.'], ['G1 X1.5']).ops[0];
  eq(op.type, 'critical'); eq(op.alwaysShow, true);
});
test('no "coordinate" type reaches the UI', () => {
  const t = types(['G1 X1. Y1. Z1.'], ['G1 X1.0002 Y1.003 Z1.2']);
  eq(/coordinate/.test(t), false);
});

console.log('Comparison rule settings');
test('block delete flagged when not ignored', () => eq(types(['G1 X1.'], ['/G1 X1.']), 'critical'));
test('block delete ignored when set', () => eq(types(['G1 X1.'], ['/G1 X1.'], { ignoreBlockDelete: true }), 'equal'));
test('paren comment change critical by default', () => eq(types(['G0 X1. (A)'], ['G0 X1. (B)']), 'critical'));
test('paren comment ignored when set', () => eq(types(['G0 X1. (A)'], ['G0 X1. (B)'], { ignoreParenComments: true }), 'equal'));
test('semicolon comment ignored by default', () => eq(types(['G0 X1. ;A'], ['G0 X1. ;B']), 'equal'));
test('semicolon comment flagged when not ignored', () => eq(types(['G0 X1. ;A'], ['G0 X1. ;B'], { ignoreSemiComments: false }), 'critical'));
test('comment case ignored by default', () => eq(types(['G0 X1. (abc)'], ['G0 X1. (ABC)']), 'equal'));
test('comment case flagged when not ignored', () => eq(types(['G0 X1. (abc)'], ['G0 X1. (ABC)'], { ignoreCase: false }), 'critical'));
test('comment whitespace ignored by default', () => eq(types(['G0 X1. (A  B)'], ['G0 X1. (A B)']), 'equal'));
test('code whitespace flagged when not ignored', () => eq(types(['G0X1.'], ['G0 X1.'], { ignoreWhitespace: false }), 'minor'));
test('N-number ignored by default', () => eq(types(['N10 G0 X1.'], ['N20 G0 X1.']), 'equal'));
test('N-number minor when not ignored', () => eq(types(['N10 G0 X1.'], ['N20 G0 X1.'], { ignoreLineNumbers: false }), 'minor'));

console.log('One-sided lines (added/removed)');
test('added M-code line must show through', () => {
  const op = diff(['G0 X1.'], ['G0 X1.', 'M0']).ops.find(o => o.type === 'added');
  eq(op.alwaysShow, true);
});
test('added plain move does not force show-through', () => {
  const op = diff(['G1 X1. F10.'], ['G1 X1. F10.', 'X2.']).ops.find(o => o.type === 'added');
  eq(!!op.alwaysShow, false);
});
test('added work offset line flagged', () => {
  const op = diff(['G0 X1.'], ['G0 X1.', 'G55']).ops.find(o => o.type === 'added');
  eq(op.workOffset, true);
});

console.log('Toolpath matching and order');
function program(tps) {
  const out = ['%', 'O1000', '(HEADER)', 'G90 G54'];
  for (const tp of tps) {
    out.push('', '(' + tp.name + ')', '(' + tp.op + ')', 'G100 T' + tp.t + ' X0. Y0. S1000 M3');
    for (let i = 0; i < 4; i++) out.push(`G1 X${tp.t}.${i} Y${i}. F100.`);
    out.push('G0 Z1.');
  }
  out.push('M30', '%');
  return out;
}
const A = { name: 'FACE', op: 'FACE1', t: 1 };
const B = { name: 'DRILL', op: 'DRILL1', t: 2 };
const C = { name: 'POCKET', op: 'POCKET1', t: 3 };
const D = { name: 'CHAMFER', op: 'CHAMFER1', t: 4 };

test('extra toolpath on right stays in order', () => {
  const r = diff(program([A, B, D]), program([A, B, C, D]));
  const order = r.tpMatches.map(m => (m.left ? m.left.name : '-') + '/' + (m.right ? m.right.name : '-')).join(' ');
  eq(order, 'FACE/FACE DRILL/DRILL -/POCKET CHAMFER/CHAMFER Program End/Program End');
});
test('separator anchors on the comment line', () => {
  const lines = program([A]);
  const tp = DE.segmentIntoToolpaths(lines, lines.map(DE.parseGCodeLine)).find(t => t.type === 'toolpath');
  eq(lines[tp.anchorLine], '(FACE)');
});
test('identical files have no diffs', () => {
  const p = program([A, B, C]);
  eq(diff(p, p).ops.every(o => o.type === 'equal'), true);
});

console.log('Number formats');
test('X.5 vs X.6 is caught', () => eq(types(['G1 X.5'], ['G1 X.6']), 'critical'));
test('X-.25 vs X-.35 is caught', () => eq(types(['G1 X-.25'], ['G1 X-.35']), 'critical'));
test('F.5 vs F.6 is caught', () => eq(types(['G1 X1. F.5'], ['G1 X1. F.6']), 'critical'));
test('X 1. (space) vs X 2. is caught', () => eq(types(['G1 X 1.'], ['G1 X 2.']), 'critical'));
test('X0.5 equals X.5', () => eq(types(['G1 X0.5'], ['G1 X.5']), 'equal'));
test('X+1. equals X1.', () => eq(types(['G1 X+1.'], ['G1 X1.']), 'equal'));

console.log('Macros and expressions');
test('GOTO target change is critical', () => eq(types(['IF [#1 GT 2] GOTO10'], ['IF [#1 GT 2] GOTO20']), 'critical'));
test('GOTO is not read as a program number', () =>
  eq(DE.parseGCodeLine('IF [#1 GT 2] GOTO10').programNumber, null));
test('X[#101+1] vs X[#101+2] is critical', () => eq(types(['G1 X[#101+1]'], ['G1 X[#101+2]']), 'critical'));
test('#101=SIN[30] vs SIN[45] is critical', () => eq(types(['#101=SIN[30]'], ['#101=SIN[45]']), 'critical'));
test('nested bracket comment compared in full', () => eq(types(['(A(B)C)'], ['(A(B)D)']), 'critical'));

console.log('Line pairing');
test('inserted move lines up exactly', () =>
  eq(types(['G1 X1. F10.', 'X2.', 'X3.'], ['G1 X1. F10.', 'X2.', 'X2.5', 'X3.']), 'equal,equal,added,equal'));
test('unrelated lines are not paired', () =>
  eq(types(['G0 X0.', 'M8', 'G1 X1.'], ['G0 X0.', 'T2', 'G1 X1.']), 'equal,removed,added,equal'));
test('same-kind changed line is paired', () =>
  eq(types(['G0 X0.', 'M8', 'G1 X1.'], ['G0 X0.', 'M9', 'G1 X1.']), 'equal,critical,equal'));

console.log('Big files');
function bigToolpath(n) {
  const L = ['%', 'O1', '', '(SURF)', '(SCALLOP)', 'G100 T1 X0. Y0. S1000 M3', 'G1 Z0. F100.'];
  for (let i = 0; i < n; i++) L.push(`X${(i * 0.01).toFixed(4)} Y${(i % 100 * 0.1).toFixed(4)} Z-.01`);
  L.push('M30', '%');
  return L;
}
test('70,000-line toolpath with one change: fast and found', () => {
  const L = bigToolpath(70000), R = L.slice();
  R[35000] = 'X9.9 Y9.9 Z-1.';
  const t = Date.now();
  const ops = diff(L, R).ops.filter(o => o.type !== 'equal');
  eq(ops.length, 1);
  eq(ops[0].type, 'critical');
  if (Date.now() - t > 10000) throw new Error('too slow: ' + (Date.now() - t) + ' ms');
});
test('70,000-line re-post with tiny changes everywhere: all within tolerance', () => {
  const L = bigToolpath(70000);
  const R = L.map(l => l.replace(/^X(\d+\.\d{3})\d/, (m, a) => 'X' + a + '7'));
  const ops = diff(L, R).ops;
  eq(ops.filter(o => o.type !== 'equal' && o.type !== 'tolerance').length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
