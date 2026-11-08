// Diff engine tests. No npm needed — run with:  node tests/engine.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'diff-engine.js'), 'utf8');
const ctx = {};
const feedsSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'feeds.js'), 'utf8');
vm.runInNewContext(src + '\n' + feedsSrc + '\nthis.DiffEngine = DiffEngine; this.Feeds = Feeds;', ctx);
const DE = ctx.DiffEngine;
const FD = ctx.Feeds;

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
  eq(order, 'FACE1/FACE1 DRILL1/DRILL1 -/POCKET1 CHAMFER1/CHAMFER1 Program End/Program End');
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

console.log('Toolpath layouts (real files)');
function loadFile(name) {
  const L = fs.readFileSync(path.join(__dirname, '..', 'Examples', name), 'utf8').split(/\r?\n/);
  const P = L.map(DE.parseGCodeLine);
  return { L, P, T: DE.segmentIntoToolpaths(L, P) };
}
const o1268 = loadFile('O1268.NC');
const o1158 = loadFile('O1158.NC.txt');
const tpOnly = f => f.T.filter(t => t.type === 'toolpath');
test('new layout: 13 toolpaths in O1268', () => eq(tpOnly(o1268).length, 13));
test('new layout: names, strategies, tools', () => {
  const t = tpOnly(o1268);
  eq(t[0].name + '|' + t[0].opType + '|T' + t[0].toolNumber, '3D ADAPTIVE ROUGHING1 2|ADAPTIVE|T62');
  eq(t[2].name + '|T' + t[2].toolNumber, '2D CONTOUR5|T76'); // same tool, no G100
  eq(t[7].name + '|' + t[7].opType, 'DRILL3|DRILL');
});
test('new layout: header tool list / tool-setting dividers skipped', () => eq(o1268.T[0].type + ':' + o1268.T[1].startLine, 'preamble:136'));
test('new layout: program end found', () => eq(o1268.T[o1268.T.length - 1].type, 'program_end'));
test('old layout: 6 toolpaths in O1158, op name from 2nd comment', () => {
  const t = tpOnly(o1158);
  eq(t.length, 6);
  eq(t[0].name + '|T' + t[0].toolNumber, 'ROUGH OFF TOP|T51');
});
test('old-layout file matches new-layout file by op name + tool', () => {
  const oldL = ['%', 'O1', 'G90 G54', '', '(JOB - TOOL)', '(FACE)', 'G100 T1 X0. Y0. S1000 M3', 'G1 Z0. F10.', 'G1 X1.', 'M30'];
  const newL = ['%', 'O1', 'G90 G54', '', '(--------------------)', '(JOB - TOOL)', '(FACE)', '(FACE)',
    'G100 T1 X0. Y0. S1000 M3', 'G1 Z0. F10.', 'G1 X1.', 'M30'];
  const r = diff(oldL, newL);
  eq(r.tpMatches.filter(m => m.left && m.right && m.left.type === 'toolpath').length, 1);
});
test('G54.1 P2 vs P3 is a work offset change', () => eq(types(['G54.1 P2'], ['G54.1 P3']), 'workoffset'));

console.log('Feeds & Speeds');
const feeds1268 = FD.analyzeFile(o1268.P, o1268.T);
const top = (tp, key) => {
  const m = feeds1268.get(tp.id)[key];
  return [...m.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]).join('/');
};
const t1268 = tpOnly(o1268);
test('RPM from G100', () => eq(top(t1268[1], 'rpm'), '7600'));
test('RPM inherited by same-tool toolpath', () => eq(top(t1268[2], 'rpm'), '7600'));
test('contour: plunge 40, lead-in 12, cut 8.4', () =>
  eq([top(t1268[2], 'plunge'), top(t1268[2], 'leadIn'), top(t1268[2], 'cut')].join(' '), '40 12 8.4'));
test('flat: ramp 12', () => eq(top(t1268[1], 'ramp'), '12'));
test('drill: cycle feed 11.1', () => eq(top(t1268[7], 'cycle'), '11.1'));
test('G41 lead-in / G40 lead-out', () => eq(top(t1268[11], 'leadIn') + ' ' + top(t1268[11], 'cut'), '15.5 10.9'));
function feedsOf(lines) {
  const P = lines.map(DE.parseGCodeLine), T = DE.segmentIntoToolpaths(lines, P);
  const tp = T.find(t => t.type === 'toolpath');
  const r = FD.analyzeFile(P, T).get(tp.id);
  const out = {};
  for (const k of Object.keys(r)) out[k] = [...r[k].keys()].join('/');
  return out;
}
const base = ['%', '', '(----------)', '(J)', '(OP)', '(POCKET)', 'G100 T1 X0. Y0. Z1. S10000 M3'];
test('ramp RPM from lone S line', () => {
  const f = feedsOf(base.concat(['S8000', 'G1 Z-.1 F20.', 'G1 X1. F50.', 'S10000', 'G0 Z1.', 'M30']));
  eq(f.rpm + ' ' + f.rampRpm, '10000 8000');
});
test('helical ramp then cut', () => {
  const f = feedsOf(base.concat(['G0 Z.1', 'G3 X.1 Y0. Z-.05 I.05 F15.', 'G1 X2. F60.', 'G1 Y1.', 'G0 Z1.', 'M30']));
  eq(f.ramp + ' ' + f.cut, '15 60');
});
test('high feed link and retract', () => {
  const f = feedsOf(base.concat(['G0 Z.1', 'G1 Z-.1 F20.', 'G1 X2. F60.', 'G1 X3. Y3. F200.', 'G1 X4. F60.', 'G1 Z.5 F100.', 'G0 Z1.', 'M30']));
  eq(f.plunge + ' ' + f.cut + ' ' + f.highFeed + ' ' + f.retract, '20 60 200 100');
});
test('feed comparison flags a changed cut feed', () => {
  const L = base.concat(['G0 Z.1', 'G1 Z-.1 F20.', 'G1 X2. F60.', 'G0 Z1.', 'M30']);
  const R = L.map(l => l.replace('F60.', 'F65.'));
  const r = diff(L, R);
  const rows = FD.compare({ leftParsed: r.leftParsed, rightParsed: r.rightParsed,
    leftToolpaths: r.leftToolpaths, rightToolpaths: r.rightToolpaths, tpMatches: r.tpMatches });
  eq(rows[0].cells.cut.changed + ' ' + rows[0].cells.plunge.changed, 'true false');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
