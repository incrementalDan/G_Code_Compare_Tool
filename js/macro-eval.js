/**
 * Macro variable resolver (Fanuc / Brother style #variables).
 *
 * Walks a file top to bottom and works out what each #variable holds, so a
 * word like X#101 or X[#101+1] can be shown (and compared) as a number.
 *
 * Handles:  #n = expr, #[expr] = expr, + - * / MOD AND OR XOR, brackets,
 *           SIN COS TAN ASIN ACOS ATAN SQRT ABS ROUND FIX FUP LN EXP POW BIN BCD,
 *           IF [..] THEN, IF [..] GOTO n, GOTO n, WHILE [..] DO n / END n.
 * Does NOT run loops. It stays honest instead:
 *   - a variable changed inside a loop (WHILE or backward GOTO) is unknown
 *     inside the loop and after it
 *   - a forward GOTO whose condition is unknown makes the variables changed
 *     in the jumped-over lines unknown at the label
 *   - block delete (/) lines may or may not run: a changed value is unknown
 *   - G65 / G66 / M06 calls may change common variables (#100+): unknown after.
 *     M98 subprograms share local variables too: everything unknown after.
 *   - machine values (#5221 work offsets, tool lengths, ...) are unknown
 *     unless the file sets them
 *
 * A value is a number, null (vacant, like #0) or undefined (unknown).
 */
const MacroEval = (() => {

  const FUNCS = new Set(['SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN', 'ATN', 'SQRT', 'SQR', 'ABS',
    'ROUND', 'RND', 'FIX', 'FUP', 'LN', 'EXP', 'POW', 'BIN', 'BCD', 'ADP']);
  const MUL_OPS = new Set(['*', '/', 'MOD', 'AND']);
  const ADD_OPS = new Set(['+', '-', 'OR', 'XOR']);
  const CMP_OPS = new Set(['EQ', 'NE', 'GT', 'GE', 'LT', 'LE']);
  const DEG = Math.PI / 180;
  const MAX_VAR = 99999;

  // ---------------------------------------------------------------
  // Tokenizer: code text (comments removed, upper case, no spaces)
  // ---------------------------------------------------------------
  function tokenize(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/[0-9.]/.test(c)) {
        const m = s.substring(i).match(/^(\d+\.?\d*|\.\d+)/);
        if (!m) return null;
        out.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
      } else if (/[A-Z]/.test(c)) {
        const m = s.substring(i).match(/^[A-Z]+/);
        out.push({ t: 'word', v: m[0] });
        i += m[0].length;
      } else if ('#[]+-*/=,'.includes(c)) {
        out.push({ t: c });
        i++;
      } else {
        return null; // something we cannot read
      }
    }
    return out;
  }

  // ---------------------------------------------------------------
  // Expression parser -> small tree. Fanuc precedence:
  //   functions, then * / MOD AND, then + - OR XOR, then EQ NE GT GE LT LE
  // ---------------------------------------------------------------
  function Parser(tokens) {
    this.tk = tokens;
    this.i = 0;
  }
  Parser.prototype.peek = function () { return this.tk[this.i]; };
  Parser.prototype.next = function () { return this.tk[this.i++]; };
  Parser.prototype.isWord = function (w) { const t = this.peek(); return t && t.t === 'word' && t.v === w; };
  Parser.prototype.expect = function (type) {
    const t = this.next();
    if (!t || t.t !== type) throw new Error('expected ' + type);
    return t;
  };

  Parser.prototype.compare = function () {
    let left = this.sum();
    const t = this.peek();
    if (t && t.t === 'word' && CMP_OPS.has(t.v)) {
      this.next();
      left = { op: t.v, a: left, b: this.sum() };
    }
    return left;
  };
  Parser.prototype.sum = function () {
    let left = this.product();
    for (;;) {
      const t = this.peek();
      if (!t) return left;
      const op = (t.t === '+' || t.t === '-') ? t.t : (t.t === 'word' && ADD_OPS.has(t.v) ? t.v : null);
      if (!op) return left;
      this.next();
      left = { op, a: left, b: this.product() };
    }
  };
  Parser.prototype.product = function () {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t) return left;
      const op = (t.t === '*' || t.t === '/') ? t.t : (t.t === 'word' && MUL_OPS.has(t.v) ? t.v : null);
      if (!op) return left;
      // ATAN[a]/[b] is one function, handled in primary
      this.next();
      left = { op, a: left, b: this.unary() };
    }
  };
  Parser.prototype.unary = function () {
    const t = this.peek();
    if (t && (t.t === '-' || t.t === '+')) {
      this.next();
      const v = this.unary();
      return t.t === '-' ? { op: 'neg', a: v } : v;
    }
    return this.primary();
  };
  Parser.prototype.primary = function () {
    const t = this.next();
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') return { num: t.v };
    if (t.t === '#') return { ref: this.refIndex() };
    if (t.t === '[') {
      const e = this.compare();
      this.expect(']');
      return e;
    }
    if (t.t === 'word' && FUNCS.has(t.v)) {
      this.expect('[');
      const a = this.compare();
      let b = null;
      if (this.peek() && this.peek().t === ',') { this.next(); b = this.compare(); }
      this.expect(']');
      // ATAN[a]/[b] form
      if ((t.v === 'ATAN' || t.v === 'ATN') && !b && this.peek() && this.peek().t === '/' &&
          this.tk[this.i + 1] && this.tk[this.i + 1].t === '[') {
        this.next(); this.next();
        b = this.compare();
        this.expect(']');
      }
      return { fn: t.v, a, b };
    }
    throw new Error('cannot read');
  };
  /** After '#': a number (#101), a bracket (#[100+#1]) or another ref (##1). */
  Parser.prototype.refIndex = function () {
    const t = this.next();
    if (!t) throw new Error('bad #');
    if (t.t === 'num') return { num: t.v };
    if (t.t === '[') { const e = this.compare(); this.expect(']'); return e; }
    if (t.t === '#') return { ref: this.refIndex() };
    throw new Error('bad #');
  };

  function parseExpr(text) {
    const tk = tokenize(text);
    if (!tk) return null;
    try {
      const p = new Parser(tk);
      const e = p.compare();
      if (p.i !== tk.length) return null;
      return e;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------
  const num0 = v => (v === null ? 0 : v); // vacant counts as 0 in maths

  /** Variable number from an index tree, or undefined when unknown / invalid. */
  function indexOf(node, get) {
    const v = evaluate(node, get);
    if (typeof v !== 'number' || !isFinite(v)) return undefined;
    const n = Math.round(v);
    if (Math.abs(v - n) > 1e-6 || n < 0 || n > MAX_VAR) return undefined;
    return n;
  }

  /** Trim float noise: SIN[30]*10 -> 5, not 4.999999999999999 */
  function clean(v) {
    return typeof v === 'number' ? (isFinite(v) ? Math.round(v * 1e9) / 1e9 : undefined) : v;
  }

  function roundHalfAway(v) { return Math.sign(v) * Math.round(Math.abs(v)); }

  function evaluate(node, get) {
    if (!node) return undefined;
    if (node.num !== undefined) return node.num;
    if (node.ref) {
      const n = indexOf(node.ref, get);
      return n === undefined ? undefined : get(n);
    }
    if (node.fn) {
      const a = evaluate(node.a, get);
      const b = node.b ? evaluate(node.b, get) : null;
      if (a === undefined || b === undefined) return undefined;
      const x = num0(a), y = num0(b);
      switch (node.fn) {
        case 'SIN': return Math.sin(x * DEG);
        case 'COS': return Math.cos(x * DEG);
        case 'TAN': return Math.tan(x * DEG);
        case 'ASIN': return Math.asin(x) / DEG;
        case 'ACOS': return Math.acos(x) / DEG;
        case 'ATAN': case 'ATN': {
          let r = node.b ? Math.atan2(x, y) / DEG : Math.atan(x) / DEG;
          if (node.b && r < 0) r += 360; // Fanuc default: 0..360
          return r;
        }
        case 'SQRT': case 'SQR': return x < 0 ? undefined : Math.sqrt(x);
        case 'ABS': return Math.abs(x);
        case 'ROUND': case 'RND': return roundHalfAway(x);
        case 'FIX': return Math.trunc(x);
        case 'FUP': return x >= 0 ? Math.ceil(x) : Math.floor(x);
        case 'LN': return x <= 0 ? undefined : Math.log(x);
        case 'EXP': return Math.exp(x);
        case 'POW': return Math.pow(x, y);
        default: return undefined; // BIN / BCD / ADP: not worked out
      }
    }
    if (node.op === 'neg') {
      const a = evaluate(node.a, get);
      return a === undefined ? undefined : -num0(a);
    }
    const a = evaluate(node.a, get);
    const b = evaluate(node.b, get);
    if (a === undefined || b === undefined) return undefined;
    // EQ / NE tell vacant apart from 0
    if (node.op === 'EQ') return (a === null || b === null) ? (a === b ? 1 : 0) : (Math.abs(a - b) < 1e-9 ? 1 : 0);
    if (node.op === 'NE') return (a === null || b === null) ? (a !== b ? 1 : 0) : (Math.abs(a - b) >= 1e-9 ? 1 : 0);
    const x = num0(a), y = num0(b);
    switch (node.op) {
      case '+': return x + y;
      case '-': return x - y;
      case '*': return x * y;
      case '/': return y === 0 ? undefined : x / y;
      case 'MOD': return y === 0 ? undefined : x % y;
      case 'AND': return (x & y);
      case 'OR': return (x | y);
      case 'XOR': return (x ^ y);
      case 'GT': return x > y ? 1 : 0;
      case 'GE': return x >= y ? 1 : 0;
      case 'LT': return x < y ? 1 : 0;
      case 'LE': return x <= y ? 1 : 0;
    }
    return undefined;
  }

  // ---------------------------------------------------------------
  // Line reading
  // ---------------------------------------------------------------

  /** Code part of a line: comments removed, upper case, no spaces. */
  function codeText(raw) {
    return raw.replace(/\([^)]*\)?/g, '').replace(/;.*$/, '').replace(/\s+/g, '').toUpperCase();
  }

  /** Find the index just after the bracket that matches s[start] === '['. */
  function closeBracket(s, start) {
    let d = 0;
    for (let i = start; i < s.length; i++) {
      if (s[i] === '[') d++;
      else if (s[i] === ']' && --d === 0) return i + 1;
    }
    return -1;
  }

  /** Split "#101=#100+1" into lhs index tree and rhs tree. */
  function readAssign(s) {
    if (s[0] !== '#') return null;
    let d = 0, eq = -1;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '[') d++;
      else if (s[i] === ']') d--;
      else if (s[i] === '=' && d === 0) { eq = i; break; }
    }
    if (eq < 0) return null;
    const lhs = parseExpr(s.substring(0, eq));
    const rhs = parseExpr(s.substring(eq + 1));
    if (!lhs || !lhs.ref || !rhs) return { bad: true };
    return { index: lhs.ref, value: rhs };
  }

  /**
   * One statement per line. Returns
   *   { kind: 'assign', index, value }
   *   { kind: 'if-then', cond, index, value }
   *   { kind: 'goto', cond (or null), target }
   *   { kind: 'while', cond, loop }   { kind: 'end', loop }
   *   { kind: 'words', words: { letter: tree } }  (G-code line)
   *   { kind: 'bad' }  (a macro statement we cannot read)
   */
  function readStatement(code) {
    if (!code) return { kind: 'none' };
    if (code.startsWith('IF[')) {
      const c = closeBracket(code, 2);
      if (c < 0) return { kind: 'bad' };
      const cond = parseExpr(code.substring(2, c));
      const rest = code.substring(c);
      if (!cond) return { kind: 'bad' };
      if (rest.startsWith('GOTO')) {
        const target = parseExpr(rest.substring(4));
        return target ? { kind: 'goto', cond, target } : { kind: 'bad' };
      }
      if (rest.startsWith('THEN')) {
        const a = readAssign(rest.substring(4));
        if (!a || a.bad) return { kind: 'bad' };
        return { kind: 'if-then', cond, index: a.index, value: a.value };
      }
      return { kind: 'bad' };
    }
    if (code.startsWith('WHILE[')) {
      const c = closeBracket(code, 5);
      const m = c > 0 && code.substring(c).match(/^DO(\d+)$/);
      const cond = c > 0 ? parseExpr(code.substring(5, c)) : null;
      return m && cond ? { kind: 'while', cond, loop: +m[1] } : { kind: 'bad' };
    }
    let m = code.match(/^END(\d+)$/);
    if (m) return { kind: 'end', loop: +m[1] };
    if (code.startsWith('GOTO')) {
      const target = parseExpr(code.substring(4));
      return target ? { kind: 'goto', cond: null, target } : { kind: 'bad' };
    }
    if (code[0] === '#') {
      const a = readAssign(code);
      if (a && !a.bad) return { kind: 'assign', index: a.index, value: a.value };
      if (a && a.bad) return { kind: 'bad' };
    }
    return readWords(code);
  }

  /** G-code words: X1. , X#101 , X-#5 , X[#1+2] , X-[..] , X SIN[..]... */
  function readWords(code) {
    if (/^(DPRNT|BPRNT|POPEN|PCLOS)/.test(code)) return { kind: 'none' }; // output only
    const words = {};
    let i = 0;
    while (i < code.length) {
      const letter = code[i];
      if (!/[A-Z]/.test(letter)) return { kind: 'bad' };
      let j = i + 1;
      // The value runs to the next word letter outside brackets.
      // A function name (X SIN[..]) belongs to the value.
      let d = 0;
      while (j < code.length) {
        const c = code[j];
        if (c === '[') d++;
        else if (c === ']') d--;
        else if (d === 0 && /[A-Z]/.test(c)) {
          const fm = code.substring(j).match(/^[A-Z]+(?=\[)/);
          if (fm && FUNCS.has(fm[0])) { j += fm[0].length; continue; }
          break;
        }
        j++;
      }
      const text = code.substring(i + 1, j);
      if (/[A-Z]{2}/.test(text) && !/[#\[]/.test(text)) return { kind: 'bad' };
      if (text && /[#\[]/.test(text)) {
        const tree = parseExpr(text);
        words[letter] = tree || 'bad';
      }
      i = j;
    }
    return { kind: 'words', words };
  }

  // ---------------------------------------------------------------
  // Whole-file pass
  // ---------------------------------------------------------------

  /**
   * Resolve variables for a parsed file (array from DiffEngine.parseGCodeLine).
   * Adds to each line object that uses macros:
   *   p.resolved = { X: 1.5, ... }    value of each expression word (undefined = unknown)
   *   p.varRefs  = { 101: 1.5, ... }  value of each #n read on the line, before it runs
   *   p.assigned = { index, value }   what an assignment line wrote (value undefined = unknown)
   *   p.macroSkipped = true           line jumped over by a GOTO that is known to be taken
   *   p.jump = { targetN, targetLine, conditional, loop, kind }   GOTO / M99 P jump
   *   p.cond = { value, assumed }     IF condition: 1 / 0 / undefined (unknown)
   *   p.jumpSources = [line, ...]     lines that jump to this N label
   *   p.alarmStop = true | 'maybe'    #3000 = n runs here: the machine stops with an alarm
   *
   * opts.assume: Map line -> { raw, value: true|false } — "test this IF as true / false".
   * Used only when the line text still matches raw.
   */
  function resolveFile(parsedLines, opts) {
    const n = parsedLines.length;
    const stmts = new Array(n);
    const codes = new Array(n);
    const assume = (opts && opts.assume) || null;
    let any = false;

    for (let i = 0; i < n; i++) {
      const p = parsedLines[i];
      delete p.resolved; delete p.varRefs; delete p.assigned; delete p.macroSkipped;
      delete p.jump; delete p.cond; delete p.jumpSources; delete p.alarmStop;
      if (p.isBlank || p.isCommentOnly) { stmts[i] = { kind: 'none' }; codes[i] = ''; continue; }
      let code = codeText(p.raw);
      if (code[0] === '/') code = code.substring(1);
      const nm = code.match(/^N(\d+)/);
      if (nm) code = code.substring(nm[0].length);
      codes[i] = code;
      if (!/[#[]/.test(code) && !/^(IF|WHILE|END|GOTO)/.test(code)) {
        stmts[i] = { kind: 'plain' };
        continue;
      }
      any = true;
      stmts[i] = readStatement(code);
    }
    const hasM99P = parsedLines.some(p => p.mCodes.some(m => parseFloat(m.substring(1)) === 99) &&
      p.tokens.some(t => t.type === 'param' && t.param === 'P'));
    if (!any && !hasM99P) return;

    // --- Program blocks (O-number lines start a new program) ---
    const progStart = new Int32Array(n);
    let ps = 0;
    for (let i = 0; i < n; i++) {
      if (parsedLines[i].programNumber !== null && parsedLines[i].programNumber !== undefined) ps = i;
      progStart[i] = ps;
    }

    // --- Labels ---
    const labels = new Map(); // N value -> sorted line list
    for (let i = 0; i < n; i++) {
      const t = parsedLines[i].tokens.find(x => x.type === 'lineNumber');
      if (!t) continue;
      const v = Math.round(t.value);
      if (!labels.has(v)) labels.set(v, []);
      labels.get(v).push(i);
    }
    function findLabel(from, v) {
      const list = labels.get(v);
      if (!list) return -1;
      for (const li of list) if (li > from && progStart[li] === progStart[from]) return li;
      for (const li of list) if (li >= progStart[from] && progStart[li] === progStart[from]) return li;
      return -1;
    }

    // --- Jumps with a fixed target: GOTO n, IF[..]GOTO n, M99 Pn ---
    const addJump = (i, targetN, conditional, kind) => {
      const t = findLabel(i, targetN);
      parsedLines[i].jump = { targetN, targetLine: t, conditional, loop: t >= 0 && t <= i, kind };
      if (t >= 0) (parsedLines[t].jumpSources = parsedLines[t].jumpSources || []).push(i);
    };
    for (let i = 0; i < n; i++) {
      const s = stmts[i];
      if (s.kind === 'goto' && s.target.num !== undefined) addJump(i, Math.round(s.target.num), !!s.cond, 'goto');
      const p = parsedLines[i];
      if (p.mCodes.some(m => parseFloat(m.substring(1)) === 99)) {
        const pt = p.tokens.find(t => t.type === 'param' && t.param === 'P');
        if (pt) addJump(i, Math.round(pt.value), false, 'm99');
      }
    }
    if (!any) return;

    /** IF condition at line i: a test choice from the user wins over the worked-out value. */
    const condAt = (i, s, p) => {
      const a = assume && assume.get(i);
      if (a && a.raw === p.raw) { p.cond = { value: a.value ? 1 : 0, assumed: true }; return { c: a.value ? 1 : 0, sure: true }; }
      const c = evaluate(s.cond, get);
      const v = c === undefined ? undefined : (num0(c) ? 1 : 0);
      p.cond = { value: v, assumed: false };
      return { c: v, sure: !p.blockDelete };
    };

    // --- What each line may change: a variable number, 'ALL', 'COMMON' or null ---
    function writes(i) {
      const s = stmts[i];
      if (s.kind === 'assign' || s.kind === 'if-then') {
        if (s.index.num !== undefined) return [Math.round(s.index.num)];
        return ['ALL'];
      }
      if (s.kind === 'bad') return ['ALL'];
      const p = parsedLines[i];
      if (p.mCodes.some(m => parseFloat(m.substring(1)) === 98)) return ['ALL'];
      if (p.gCodes.some(g => { const v = parseFloat(g.substring(1)); return v === 65 || v === 66; }) ||
          p.mCodes.some(m => parseFloat(m.substring(1)) === 6)) return ['COMMON'];
      return [];
    }
    function writesIn(a, b) { // lines a..b inclusive
      const set = new Set();
      for (let k = Math.max(0, a); k <= b && k < n; k++) for (const w of writes(k)) set.add(w);
      return set;
    }

    // --- Loops: WHILE..END and backward GOTO. Values changed inside are unknown
    //     from the loop start to after the loop end. ---
    const forget = new Map(); // line -> Set of writes to forget before that line runs
    const addForget = (line, set) => {
      if (line < 0 || line >= n || !set.size) return;
      if (!forget.has(line)) forget.set(line, new Set());
      for (const w of set) forget.get(line).add(w);
    };
    const openLoops = {};
    for (let i = 0; i < n; i++) {
      const s = stmts[i];
      if (s.kind === 'while') (openLoops[s.loop] = openLoops[s.loop] || []).push(i);
      else if (s.kind === 'end') {
        const st = openLoops[s.loop] && openLoops[s.loop].pop();
        if (st === undefined) continue;
        const set = writesIn(st, i);
        addForget(st, set);
        addForget(i + 1, set);
      } else if (s.kind === 'goto' && s.target.num !== undefined) {
        const t = findLabel(i, Math.round(s.target.num));
        if (t >= 0 && t <= i) {
          const set = writesIn(t, i);
          addForget(t, set);
          addForget(i + 1, set);
        }
      }
    }

    // --- Walk the file ---
    const store = new Map();
    const get = k => (k === 0 ? null : (store.has(k) ? store.get(k) : undefined));
    const set = (k, v) => { if (k === 0) return; if (v === undefined) store.delete(k); else store.set(k, v); };
    const clearCommon = () => { for (const k of [...store.keys()]) if (k > 33) store.delete(k); };
    const applyForget = ws => {
      for (const w of ws) {
        if (w === 'ALL') store.clear();
        else if (w === 'COMMON') clearCommon();
        else store.delete(w);
      }
    };
    let skipTo = -1;
    let testTarget = -1; // label line reached by a jump the user is testing as TRUE

    for (let i = 0; i < n; i++) {
      const p = parsedLines[i];
      if (i > 0 && progStart[i] === i) store.clear(); // new program block
      if (forget.has(i)) applyForget(forget.get(i));
      if (skipTo > i) { if (stmts[i].kind !== 'none') p.macroSkipped = true; continue; }
      skipTo = -1;

      const s = stmts[i];
      if (s.kind === 'none') continue;
      if (s.kind === 'plain') { applyForget(writes(i)); continue; }
      const maybe = p.blockDelete; // a "/" line may be skipped by the operator

      // Values read on this line, before it runs
      const refs = {};
      let hasRef = false;
      codes[i].replace(/#(\d+)/g, (m, d) => { refs[d] = get(+d); hasRef = true; return m; });
      if (hasRef) p.varRefs = refs;

      const write = (indexTree, valueTree, sure) => {
        const k = indexOf(indexTree, get);
        const v = clean(evaluate(valueTree, get));
        if (k === undefined) { store.clear(); p.assigned = { index: undefined, value: v }; return; }
        p.assigned = { index: k, value: v };
        // #3000 = n stops the machine (unless a / line is skipped by Block Skip)
        if (k === 3000 && typeof v === 'number' && v !== 0 && (sure || i === testTarget)) {
          p.alarmStop = sure ? true : 'maybe';
        }
        if (sure) set(k, v);
        else if (get(k) !== v) set(k, undefined); // might or might not happen
      };

      switch (s.kind) {
        case 'assign':
          write(s.index, s.value, !maybe);
          break;
        case 'if-then': {
          const { c, sure } = condAt(i, s, p);
          if (c === undefined || !sure) write(s.index, s.value, false);
          else if (c) write(s.index, s.value, true);
          break;
        }
        case 'goto': {
          const tv = evaluate(s.target, get);
          const { c, sure } = s.cond ? condAt(i, s, p) : { c: 1, sure: !maybe };
          if (typeof tv !== 'number') { store.clear(); break; }
          const t = findLabel(i, Math.round(tv));
          if (!p.jump) p.jump = { targetN: Math.round(tv), targetLine: t, conditional: !!s.cond, loop: t >= 0 && t <= i, kind: 'goto' };
          if (t < 0 || t <= i) break; // missing label, or a loop (handled above)
          if (c === undefined || !sure) addForget(t, writesIn(i + 1, t - 1));
          else if (c) { skipTo = t; if (p.cond && p.cond.assumed) testTarget = t; }
          break;
        }
        case 'while': case 'end':
          break;
        case 'words': {
          const res = {};
          let has = false;
          for (const L of Object.keys(s.words)) {
            const tree = s.words[L];
            res[L] = tree === 'bad' ? undefined : clean(evaluate(tree, get));
            has = true;
          }
          if (has) p.resolved = res;
          applyForget(writes(i));
          break;
        }
        case 'bad':
          store.clear();
          break;
      }
    }
  }

  return { resolveFile, parseExpr, evaluate, tokenize };
})();

if (typeof module !== 'undefined') module.exports = MacroEval;
