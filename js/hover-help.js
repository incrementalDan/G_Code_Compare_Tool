/**
 * Hover help: point at a G-code, M-code, word or #variable to see what it
 * means, its worked-out value, and a link to the matching page on the
 * Zappettini Consulting CNC wiki (shared with the author's permission).
 *
 * Meanings are for a Brother Speedio mill first, Fanuc as the fallback.
 */
const HoverHelp = (() => {
  const WIKI = 'https://zappettiniconsulting.com/wiki/';

  // Wiki pages used below
  const W = {
    basics: 'cnc-gcode-basics',
    coords: 'coordinate-systems',
    toolComp: 'tool-compensation',
    cycles: 'canned-cycles',
    tapping: 'threading-rigid-tapping',
    twp: 'fanuc-tilted-working-plane-g682',
    tcp: 'fanuc-tcp-tool-center-point',
    hsm: 'high-speed-machining',
    args: 'argument-variables',
    macroStruct: 'macro-structure',
    macroIntro: 'cnc-macros-intro',
    macroCtl: 'macro-control',
    macroMath: 'macro-arithmetic',
    varTypes: 'variable-types',
    sysVars: 'fanuc-system-variables',
    brotherVars: 'brother-system-variables',
    brotherRun: 'brother-running-programs',
    alarms: 'alarms-timers',
    modal: 'modal-position-data',
    toolVars: 'tool-offset-variables',
    glossary: 'cnc-glossary',
    probing: 'brother-blum-probing'
  };

  // [meaning, wiki page]
  const G = {
    0: ['Rapid move — full speed, not cutting', W.basics],
    1: ['Straight-line feed move (cutting)', W.basics],
    2: ['Clockwise arc', W.basics],
    3: ['Counter-clockwise arc', W.basics],
    4: ['Dwell — pause for P (ms) or X (s)', W.basics],
    5.1: ['High-accuracy / look-ahead mode (Q1 on, Q0 off)', W.hsm],
    9: ['Exact stop for this block only', W.hsm],
    10: ['Write data to the control — offsets, work offsets (L / P pick which)', W.coords],
    15: ['Polar coordinates off', W.basics],
    16: ['Polar coordinates on', W.basics],
    17: ['XY plane for arcs and cutter comp', W.basics],
    18: ['ZX plane for arcs and cutter comp', W.basics],
    19: ['YZ plane for arcs and cutter comp', W.basics],
    20: ['Inch units', W.basics],
    21: ['Metric units (mm)', W.basics],
    28: ['Return to machine home, through the point given', W.coords],
    30: ['Return to 2nd reference point (often tool change position)', W.coords],
    31: ['Skip move — stops when the probe triggers', W.probing],
    40: ['Cutter radius comp OFF', W.toolComp],
    41: ['Cutter radius comp LEFT (climb) — uses D offset', W.toolComp],
    42: ['Cutter radius comp RIGHT (conventional) — uses D offset', W.toolComp],
    43: ['Tool length comp ON (+) — uses H offset', W.toolComp],
    43.4: ['Tool centre point control (TCP) ON — 5-axis', W.tcp],
    44: ['Tool length comp ON (−) — uses H offset', W.toolComp],
    49: ['Tool length comp OFF', W.toolComp],
    50: ['Scaling OFF', W.basics],
    51: ['Scaling ON', W.basics],
    50.1: ['Mirror image OFF', W.basics],
    51.1: ['Mirror image ON', W.basics],
    52: ['Local coordinate shift (adds to the work offset)', W.coords],
    53: ['Machine coordinates — this block only', W.coords],
    53.1: ['Point the tool along the tilted plane (after G68.2)', W.twp],
    54: ['Work offset 1 (G54)', W.coords],
    54.1: ['Extended work offset — P picks which one (G54.1 P1 …)', W.coords],
    55: ['Work offset 2 (G55)', W.coords],
    56: ['Work offset 3 (G56)', W.coords],
    57: ['Work offset 4 (G57)', W.coords],
    58: ['Work offset 5 (G58)', W.coords],
    59: ['Work offset 6 (G59)', W.coords],
    61: ['Exact stop mode (every block)', W.hsm],
    64: ['Cutting mode — blends corners (cancels G61)', W.hsm],
    65: ['Macro call — P = program, letters = arguments', W.args],
    66: ['Modal macro call — runs after every move until G67', W.args],
    67: ['Cancel modal macro call (G66)', W.args],
    68: ['Coordinate rotation ON', W.coords],
    68.2: ['Tilted working plane ON — 5-axis 3+2', W.twp],
    69: ['Rotation / tilted plane OFF', W.twp],
    73: ['High-speed peck drill (chip break)', W.cycles],
    74: ['Left-hand tapping cycle', W.tapping],
    76: ['Fine boring cycle (spindle orients, shifts off the wall)', W.cycles],
    80: ['Cancel canned cycle', W.cycles],
    81: ['Drill cycle', W.cycles],
    82: ['Drill cycle with dwell at the bottom', W.cycles],
    83: ['Peck drill cycle (full retract)', W.cycles],
    84: ['Tapping cycle', W.tapping],
    85: ['Boring cycle — feed in, feed out', W.cycles],
    86: ['Boring cycle — spindle stop, rapid out', W.cycles],
    87: ['Back boring cycle', W.cycles],
    88: ['Boring cycle — dwell, manual retract', W.cycles],
    89: ['Boring cycle — dwell, feed out', W.cycles],
    90: ['Absolute positions', W.basics],
    91: ['Incremental moves — each move adds to the last (errors add up)', W.basics],
    92: ['Set the current position (coordinate preset). With S/Q: spindle speed clamp', W.coords],
    93: ['Inverse-time feed (every move needs its own F)', W.basics],
    94: ['Feed per minute', W.basics],
    95: ['Feed per revolution', W.basics],
    98: ['Canned cycle returns to the start height', W.cycles],
    99: ['Canned cycle returns to the R plane', W.cycles],
    100: ['Brother tool change: changes tool, sets length offset, moves to start, starts spindle', W.brotherRun]
  };

  const M = {
    0: ['Program stop — operator presses Start to go on', W.basics],
    1: ['Optional stop — only stops with Opt Stop on', W.basics],
    2: ['End of program', W.basics],
    3: ['Spindle ON clockwise', W.basics],
    4: ['Spindle ON counter-clockwise', W.basics],
    5: ['Spindle stop', W.basics],
    6: ['Tool change', W.basics],
    8: ['Coolant ON', W.basics],
    9: ['Coolant OFF', W.basics],
    19: ['Spindle orient', W.basics],
    29: ['Rigid tapping mode', W.tapping],
    30: ['End of program and rewind', W.basics],
    98: ['Call a subprogram (P = program number)', W.macroStruct],
    99: ['End of subprogram / return (P = jump to N)', W.macroStruct]
  };

  const LETTERS = {
    X: ['X axis position', W.basics], Y: ['Y axis position', W.basics], Z: ['Z axis position', W.basics],
    A: ['A rotary axis', W.basics], B: ['B rotary axis', W.basics], C: ['C rotary axis', W.basics],
    I: ['Arc centre, X distance from the start', W.basics],
    J: ['Arc centre, Y distance from the start', W.basics],
    K: ['Arc centre, Z distance from the start', W.basics],
    F: ['Feed rate', W.basics], S: ['Spindle speed (RPM)', W.basics], T: ['Tool number', W.basics],
    H: ['Tool length offset number', W.toolComp], D: ['Cutter radius (diameter) offset number', W.toolComp],
    R: ['Arc radius, or the canned cycle R plane (retract height)', W.cycles],
    P: ['Parameter: dwell time, program number, or offset number', W.basics],
    Q: ['Parameter: peck depth, or shift amount', W.cycles],
    L: ['Parameter: repeat count, or G10 data type', W.basics],
    N: ['Line number (sequence number / jump label)', W.basics],
    O: ['Program number', W.basics]
  };

  const KEYWORDS = {
    IF: ['IF [condition] — test before GOTO or THEN', W.macroCtl],
    THEN: ['IF [condition] THEN — do the assignment only when true', W.macroCtl],
    GOTO: ['Jump to the line with this N number', W.macroCtl],
    WHILE: ['WHILE [condition] DOn — repeat until END n', W.macroCtl],
    DO: ['Start of a WHILE loop', W.macroCtl],
    END: ['End of a WHILE loop', W.macroCtl],
    EQ: ['Equal to', W.macroCtl], NE: ['Not equal to', W.macroCtl],
    GT: ['Greater than', W.macroCtl], GE: ['Greater than or equal', W.macroCtl],
    LT: ['Less than', W.macroCtl], LE: ['Less than or equal', W.macroCtl],
    AND: ['Logical / bitwise AND', W.macroMath], OR: ['Logical / bitwise OR', W.macroMath],
    XOR: ['Exclusive OR', W.macroMath], MOD: ['Remainder after dividing', W.macroMath],
    SIN: ['Sine (degrees)', W.macroMath], COS: ['Cosine (degrees)', W.macroMath],
    TAN: ['Tangent (degrees)', W.macroMath], ASIN: ['Arc sine (answer in degrees)', W.macroMath],
    ACOS: ['Arc cosine (answer in degrees)', W.macroMath], ATAN: ['Arc tangent (answer in degrees)', W.macroMath],
    SQRT: ['Square root', W.macroMath], ABS: ['Absolute value', W.macroMath],
    ROUND: ['Round to nearest whole number', W.macroMath], FIX: ['Round down (drop the decimals)', W.macroMath],
    FUP: ['Round up', W.macroMath], LN: ['Natural log', W.macroMath], EXP: ['e to the power', W.macroMath],
    POW: ['Power', W.macroMath], BIN: ['BCD to binary', W.macroMath], BCD: ['Binary to BCD', W.macroMath],
    DPRNT: ['Print data out the serial / file port', 'external-output'],
    POPEN: ['Open the output port', 'external-output'], PCLOS: ['Close the output port', 'external-output']
  };

  // G65 argument letter for each local variable
  const ARG = { 1: 'A', 2: 'B', 3: 'C', 4: 'I', 5: 'J', 6: 'K', 7: 'D', 8: 'E', 9: 'F', 11: 'H', 13: 'M',
    17: 'Q', 18: 'R', 19: 'S', 20: 'T', 21: 'U', 22: 'V', 23: 'W', 24: 'X', 25: 'Y', 26: 'Z' };
  const AXES = ['X', 'Y', 'Z', 'A', 'B', 'C'];

  /** [meaning, wiki page] for #n (Brother mill, Fanuc fallback). */
  function varInfo(n) {
    if (n === 0) return ['Always empty (vacant) — "no value"', W.varTypes];
    if (n >= 1 && n <= 33) {
      return ['Local variable' + (ARG[n] ? ` — G65 argument ${ARG[n]}` : '') + '. Cleared when the macro ends', W.args];
    }
    if (n >= 100 && n <= 199) return ['Common variable — shared by all programs, cleared at power off', W.varTypes];
    if (n >= 500 && n <= 999) return ['Common variable — kept at power off', W.varTypes];
    if (n >= 1000 && n <= 1199) return ['Interface signal (input / output to the machine logic)', W.sysVars];
    if (n === 3000) return ['Alarm — writing here stops the machine with this alarm number', W.alarms];
    if (n === 3001) return ['Millisecond timer', W.alarms];
    if (n === 3002) return ['Hour timer', W.alarms];
    if (n === 3003 || n === 3004) return ['Single block / feed hold control', 'feed-hold'];
    if (n === 3006) return ['Stop with a message', W.alarms];
    if (n === 3011) return ['Date (YYYYMMDD)', W.alarms];
    if (n === 3012) return ['Time (HHMMSS)', W.alarms];
    if (n === 3700) return ['Tool number in the spindle (as used by the shop post)', W.brotherVars];
    if (n >= 4001 && n <= 4130) return ['Modal state of the block before — active G-codes, F, S, T, H, D', W.modal];
    if (n >= 5001 && n <= 5006) return [`${AXES[n - 5001]} end point of the block before (work coords)`, W.modal];
    if (n >= 5021 && n <= 5026) return [`${AXES[n - 5021]} current position (machine coords)`, W.modal];
    if (n >= 5041 && n <= 5046) return [`${AXES[n - 5041]} current position (work coords)`, W.modal];
    if (n >= 5061 && n <= 5066) return [`${AXES[n - 5061]} position where the probe triggered (G31)`, W.modal];
    if (n >= 5081 && n <= 5086) return [`${AXES[n - 5081]} tool length offset in use`, W.modal];
    if (n >= 5201 && n <= 5206) return [`External work offset shift — ${AXES[n - 5201]}`, W.brotherVars];
    if (n >= 5221 && n <= 5326) {
      const k = n - 5221, wcs = 54 + Math.floor(k / 20), ax = k % 20;
      if (ax < 6) return [`G${wcs} work offset — ${AXES[ax]}`, W.brotherVars];
    }
    if (n >= 7001 && n <= 7946) {
      const k = n - 7001, pn = 1 + Math.floor(k / 20), ax = k % 20;
      if (ax < 6) return [`G54.1 P${pn} work offset — ${AXES[ax]}`, W.brotherVars];
    }
    if (n >= 10001 && n <= 10999) return [`Tool ${n - 10000} length WEAR`, W.toolVars];
    if (n >= 11001 && n <= 11999) return [`Tool ${n - 11000} LENGTH (geometry)`, W.toolVars];
    if (n >= 12001 && n <= 12999) return [`Tool ${n - 12000} diameter WEAR`, W.toolVars];
    if (n >= 13001 && n <= 13999) return [`Tool ${n - 13000} DIAMETER (geometry)`, W.toolVars];
    if (n >= 2000 && n <= 2999) return ['Tool offset value (small offset memory)', W.toolVars];
    return ['System or machine variable — check the control manual', W.sysVars];
  }

  // =====================================================
  // Find what is under the mouse
  // =====================================================

  function codeKey(text) {
    const n = parseFloat(text.replace(/^[GgMm]\s*/, ''));
    return Math.round(n * 10) / 10;
  }

  function fmt(v) {
    if (v === null) return 'empty';
    if (typeof v !== 'number') return 'unknown';
    return String(+v.toFixed(4));
  }

  /** Parsed line (with worked-out values) from the last compare, if it still matches. */
  function parsedFor(side, line, text) {
    const ctx = typeof App !== 'undefined' && App.getDiffContext ? App.getDiffContext() : null;
    if (!ctx) return null;
    const arr = side === 'left' ? ctx.leftParsed : ctx.rightParsed;
    const p = arr && arr[line];
    return p && p.raw === text ? p : null;
  }

  /** Info about the spot at column col of a line, or null. */
  function lookup(side, line, text, col) {
    if (col < 0 || col >= text.length) return null;
    const parsed = DiffEngine.parseGCodeLine(text);
    const tok = parsed.tokens.find(t => col >= t.start && col < t.end);
    if (!tok || tok.type === 'comment' || tok.type === 'unparsed') return null;
    const full = parsedFor(side, line, text);

    // A #variable anywhere under the mouse (inside macros and expressions too)
    const varHit = findAt(text, col, /#\s*(\d+)/g);
    if (varHit) {
      const n = parseInt(varHit[1], 10);
      const [meaning, page] = varInfo(n);
      const rows = [];
      // The variable being set on this line (#102 in "#102=..."): its old value is not useful
      const isTarget = text.substring(varHit.index + varHit[0].length).trimStart()[0] === '=';
      if (!isTarget && full && full.varRefs && Object.prototype.hasOwnProperty.call(full.varRefs, n)) {
        const v = full.varRefs[n];
        rows.push(['Value here', fmt(v) + (v === undefined ? ' — not set in this file, or changed by a loop / call' : '')]);
      }
      if (full && full.assigned && full.assigned.index === n) rows.push(['Set to', fmt(full.assigned.value)]);
      return { title: '#' + n, meaning, page, rows };
    }

    if (tok.type === 'macro') {
      const kw = findAt(text, col, /[A-Za-z]{2,}/g);
      const KW = kw ? kw[0].toUpperCase() : '';
      if (full && (full.jump || full.cond) && (!kw || KW === 'IF' || KW === 'GOTO' || KW === 'THEN')) {
        return flowInfo(side, line, full, text);
      }
      if (kw && KEYWORDS[kw[0].toUpperCase()]) {
        const [meaning, page] = KEYWORDS[kw[0].toUpperCase()];
        return { title: kw[0].toUpperCase(), meaning, page, rows: macroRows(full) };
      }
      return { title: 'Macro statement', meaning: 'Custom macro B logic', page: W.macroIntro, rows: macroRows(full) };
    }

    if (tok.type === 'gCode') {
      const k = codeKey(tok.text);
      const info = G[k] || ['G-code not in this list — check the Brother manual', W.basics];
      return { title: 'G' + k, meaning: info[0], page: info[1], rows: [] };
    }
    if (tok.type === 'mCode' && codeKey(tok.text) === 99 && full && full.jump) {
      return flowInfo(side, line, full, text);
    }
    if (tok.type === 'lineNumber' && full && full.jumpSources) {
      return labelInfo(side, line, full, tok);
    }
    if (tok.type === 'mCode') {
      const k = codeKey(tok.text);
      const info = M[k] || ['Machine-specific M-code — check the Brother manual', W.basics];
      return { title: 'M' + k, meaning: info[0], page: info[1], rows: [] };
    }
    if (tok.type === 'blockDelete') {
      return { title: '/', meaning: 'Block delete — line is skipped when the Block Skip switch is on', page: W.brotherRun, rows: [] };
    }

    const letter = (tok.type === 'expr' ? tok.param : tok.text.trim()[0] || '').toUpperCase();
    const info = LETTERS[letter];
    if (!info) return null;
    const rows = [];
    if (tok.type === 'expr') {
      const v = full && full.resolved ? full.resolved[letter] : undefined;
      rows.push(['Works out to', fmt(v) + (v === undefined ? ' — a variable has no known value here' : '')]);
    }
    return { title: tok.text.trim(), meaning: info[0], page: info[1], rows };
  }

  // =====================================================
  // GOTO / IF / M99 P / N labels
  // =====================================================

  const EXPLAIN = {
    goto: 'GOTO n jumps to the line labelled Nn and carries on from there. ' +
      'IF [test] GOTO n only jumps when the test is true; otherwise the next line runs.',
    gotoUse: 'Shops use it for checks. Example: if a tool length is out of range, jump to a ' +
      'line that sets #3000 (an alarm), which stops the machine.',
    ifThen: 'IF [test] THEN #n = … only sets the variable when the test is true.',
    m99: 'M99 Pn: in a main program, go back to line Nn instead of the top. ' +
      'In a subprogram, return to the caller at line Nn.',
    label: 'N number used as a jump label. A GOTO or M99 P elsewhere jumps here.'
  };

  /** Next line after i that has something on it (for "test as FALSE"). */
  function nextLine(side, i) {
    const ctx = typeof App !== 'undefined' && App.getDiffContext ? App.getDiffContext() : null;
    const arr = ctx ? (side === 'left' ? ctx.leftParsed : ctx.rightParsed) : null;
    let k = i + 1;
    while (arr && k < arr.length - 1 && arr[k].isBlank) k++;
    return k;
  }

  /** Text of the test, e.g. "[#11032 LT 7.3086]". */
  function condText(text) {
    const m = text.replace(/\([^)]*\)?/g, '').match(/IF\s*(\[.*\])\s*(GOTO|THEN)/i);
    return m ? m[1].replace(/\s+/g, ' ') : '';
  }

  /** Why a test could not be worked out: the unknown variables it reads. */
  function unknownVars(full) {
    if (!full.varRefs) return '';
    const names = Object.keys(full.varRefs).filter(k => full.varRefs[k] === undefined)
      .slice(0, 2).map(k => '#' + k + ' (' + varInfo(+k)[0].split(' — ')[0] + ')');
    return names.length ? ' — uses ' + names.join(', ') + ', which only the machine knows' : '';
  }

  function flowInfo(side, line, full, text) {
    const rows = [];
    const actions = [];
    const j = full.jump;
    const c = full.cond;
    const isThen = !!c && !j;
    const next = nextLine(side, line);

    if (full.macroSkipped) rows.push(['Runs?', 'No — jumped over by an earlier GOTO']);
    if (c) {
      rows.push(['Test', condText(text) || '[…]']);
      rows.push(['Result', c.assumed ? (c.value ? 'TRUE — you are testing this' : 'FALSE — you are testing this')
        : c.value === 1 ? 'true' : c.value === 0 ? 'false' : 'unknown' + unknownVars(full)]);
    }
    if (j) {
      rows.push(['Jumps to', j.targetLine >= 0 ? `N${j.targetN} \u2192 line ${j.targetLine + 1}${j.loop ? ' (back up — a loop)' : ''}`
        : `N${j.targetN} — not found in this program`]);
      if (j.targetLine >= 0) {
        if (!j.conditional || (c && c.value === 1)) rows.push(['Runs next', `line ${j.targetLine + 1} (jumps)`]);
        else if (c && c.value === 0) rows.push(['Runs next', `line ${next + 1} (no jump)`]);
        else rows.push(['Runs next', `line ${j.targetLine + 1} if true, line ${next + 1} if false`]);
      }
    }
    if (isThen && full.assigned) {
      rows.push(['Sets', (full.assigned.index !== undefined ? '#' + full.assigned.index : '#?') + ' = ' +
        fmt(full.assigned.value) + (c.value === undefined ? ' (only if true)' : c.value ? '' : ' (skipped — false)')]);
    }

    // Test buttons for a test only the machine can answer (or one already being tested)
    if (c && (c.value === undefined || c.assumed)) {
      const tTarget = j && j.targetLine >= 0 ? j.targetLine : null;
      if (!(c.assumed && c.value === 1)) {
        actions.push({ label: 'Test TRUE' + (tTarget !== null ? ` \u2192 line ${tTarget + 1}` : ''), cls: 'ht-true',
          act: 'assume', value: 1, side, line, go: tTarget });
      }
      if (!(c.assumed && c.value === 0)) {
        actions.push({ label: 'Test FALSE' + (j ? ` \u2192 line ${next + 1}` : ''), cls: 'ht-false',
          act: 'assume', value: 0, side, line, go: j ? next : null });
      }
      if (c.assumed) actions.push({ label: 'Clear test', cls: 'ht-plain', act: 'assume', value: -1, side, line, go: null });
    }
    if (j && j.targetLine >= 0) {
      actions.push({ label: `Jump to line ${j.targetLine + 1} \u2192`, cls: '', act: 'jump', side, line, go: j.targetLine });
    }

    const kind = j ? (j.kind === 'm99' ? 'm99' : 'goto') : 'ifThen';
    return {
      title: j ? (j.kind === 'm99' ? 'M99 P' + j.targetN : (j.conditional ? 'IF … GOTO ' : 'GOTO ') + j.targetN) : 'IF … THEN',
      rows, actions,
      meaning: EXPLAIN[kind],
      explain: kind === 'goto' ? EXPLAIN.gotoUse : '',
      page: kind === 'm99' ? W.macroStruct : W.macroCtl,
      ctrlJump: j && j.targetLine >= 0 ? j.targetLine : null
    };
  }

  function labelInfo(side, line, full, tok) {
    const src = full.jumpSources;
    const rows = [['Jumped to from', src.slice(0, 6).map(i => 'line ' + (i + 1)).join(', ') + (src.length > 6 ? ' …' : '')]];
    const actions = src.slice(0, 4).map(i => ({ label: `\u2190 Go to line ${i + 1}`, cls: 'ht-plain', act: 'jump', side, line, go: i }));
    return { title: tok.text.trim().toUpperCase(), rows, actions, meaning: EXPLAIN.label, explain: '', page: W.macroCtl,
      ctrlJump: null };
  }

  function macroRows(full) {
    if (!full) return [];
    if (full.macroSkipped) return [['Runs?', 'No — jumped over by a GOTO']];
    if (full.assigned) {
      const target = full.assigned.index !== undefined ? '#' + full.assigned.index : '#? (index unknown)';
      return [['Sets', target + ' = ' + fmt(full.assigned.value)]];
    }
    return [];
  }

  /** The regex match that covers column col, or null. */
  function findAt(text, col, re) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (col >= m.index && col < m.index + m[0].length) return m;
    }
    return null;
  }

  // =====================================================
  // Info panel (bottom, like VS Code)
  //   Click code  -> panel opens (if closed) and shows it; that item is "pinned".
  //   Hover code  -> while the panel is open, shows what is under the mouse.
  //   Leave code  -> back to the pinned item, so its buttons can be reached.
  //   Hidden until something has been clicked. Collapse with the arrow or Esc.
  // =====================================================

  const PANEL_H = 160; // open height in px (header 24 + body)
  const HEAD_H = 24;
  let panel = null;
  let pinned = null;      // { info, where } from the last click
  let shown = null;       // what the panel shows right now
  let tipActions = [];
  let expanded = false;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setHeight() {
    const h = !panel || panel.hidden ? 0 : (expanded ? PANEL_H : HEAD_H);
    document.documentElement.style.setProperty('--panel-h', h + 'px');
    window.dispatchEvent(new Event('resize'));
  }

  function open() {
    if (!panel) return;
    const changed = panel.hidden || !expanded;
    panel.hidden = false;
    expanded = true;
    panel.classList.remove('collapsed');
    if (changed) setHeight();
  }

  function collapse() {
    if (!panel || panel.hidden) return;
    expanded = false;
    panel.classList.add('collapsed');
    setHeight();
  }

  function close() {
    if (!panel) return;
    panel.hidden = true;
    expanded = false;
    setHeight();
  }

  function where(pt) {
    return (pt.side === 'left' ? 'Left' : 'Right') + ' \u00b7 line ' + (pt.line + 1);
  }

  /** Fill the panel: values + buttons on the left, explanation + link on the right. */
  function show(entry) {
    if (!panel || !entry) return;
    shown = entry;
    const info = entry.info;
    panel.querySelector('.ip-title').textContent = info.title;
    panel.querySelector('.ip-where').textContent = entry.where;

    let left = '';
    if (info.rows.length) {
      left += '<div class="ht-rows">';
      for (const [k, v] of info.rows) left += `<div class="ht-row"><span class="ht-key">${esc(k)}:</span> ${esc(v)}</div>`;
      left += '</div>';
    }
    tipActions = info.actions || [];
    if (tipActions.length) {
      left += '<div class="ht-actions">' + tipActions.map((a, i) =>
        `<button class="ht-btn ${a.cls || ''}" data-i="${i}">${esc(a.label)}</button>`).join('') + '</div>';
    }
    let right = `<div class="ht-meaning">${esc(info.meaning)}</div>`;
    if (info.explain) right += `<div class="ht-explain">${esc(info.explain)}</div>`;
    if (info.page) {
      right += `<a class="ht-link" href="${WIKI}${info.page}" target="_blank" rel="noopener noreferrer">More on the Zappettini CNC wiki \u2192</a>`;
    }
    panel.querySelector('.ip-left').innerHTML = left;
    panel.querySelector('.ip-right').innerHTML = right;
  }

  function runAction(a) {
    if (typeof App === 'undefined') return;
    if (a.act === 'assume') App.setAssumption(a.side, a.line, a.value < 0 ? null : !!a.value);
    if (a.go !== null && a.go !== undefined) App.jumpTo(a.side, a.go, a.line);
    // Values changed: refresh the pinned item from the new compare
    if (pinned && pinned.pt) {
      const info = lookup(pinned.pt.side, pinned.pt.line, pinned.pt.text, pinned.pt.col);
      if (info) { pinned.info = info; show(pinned); }
    }
  }

  /** Ctrl/Cmd + click on a GOTO / M99 P: jump straight to its target. */
  function onCtrlClick(pt) {
    const info = lookup(pt.side, pt.line, pt.text, pt.col);
    if (!info || info.ctrlJump === null || info.ctrlJump === undefined) return false;
    App.jumpTo(pt.side, info.ctrlJump, pt.line);
    return true;
  }

  function onClick(pt) {
    if (!pt) return;
    const info = lookup(pt.side, pt.line, pt.text, pt.col);
    if (!info) return; // blank / comment: leave the panel as it is
    pinned = { info, where: where(pt), pt };
    open();
    show(pinned);
  }

  let hoverTimer = null;
  function onHover(pt) {
    clearTimeout(hoverTimer);
    if (!panel || panel.hidden || !expanded) return;
    if (!pt) { if (pinned && shown !== pinned) show(pinned); return; }
    hoverTimer = setTimeout(() => {
      const info = lookup(pt.side, pt.line, pt.text, pt.col);
      if (info) show({ info, where: where(pt), pt });
      else if (pinned && shown !== pinned) show(pinned);
    }, 120);
  }

  function init() {
    if (typeof Editor === 'undefined' || !Editor.setHoverCallback) return;
    panel = document.getElementById('info-panel');
    if (!panel) return;
    Editor.setHoverCallback(onHover);
    if (Editor.setClickCallback) Editor.setClickCallback(onClick);
    if (Editor.setCtrlClickCallback) Editor.setCtrlClickCallback(onCtrlClick);

    panel.addEventListener('click', (e) => {
      const b = e.target.closest('.ht-btn');
      if (b) { const a = tipActions[+b.dataset.i]; if (a) runAction(a); return; }
      if (e.target.closest('.ip-close')) { e.stopPropagation(); close(); return; }
      if (e.target.closest('.ip-head')) { if (expanded) collapse(); else open(); }
    });
    // Mouse over the panel: keep showing the pinned item (its buttons)
    panel.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); if (pinned && shown !== pinned) show(pinned); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel && !panel.hidden && expanded && !document.getElementById('info-overlay')?.classList.contains('open')) collapse();
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { lookup, varInfo };
})();
