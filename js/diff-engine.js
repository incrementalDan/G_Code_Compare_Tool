/**
 * G-Code Semantic Diff Engine
 * Token-aware parsing, segmented LCS, modal state fingerprints, and tolerance classification.
 */

const DiffEngine = (() => {

  // =====================================================
  // Token Parser
  // =====================================================

  function parseGCodeLine(line) {
    const result = {
      gCodes: [],
      mCodes: [],
      axes: {},
      arcParams: {},
      rotary: {},
      feed: null,
      spindle: null,
      tool: null,
      hOffset: null,
      dOffset: null,
      comment: null,
      parenComments: [],
      semiComments: [],
      macros: [],
      programNumber: null,
      exprs: {},          // letter -> expression text, e.g. X[#101+1] or X#101
      unparsed: '',       // characters that are not a word, comment or macro (e.g. *, a lone X)
      isMacroStatement: false, // IF/GOTO/WHILE/#1=SIN[..] style line
      lineNumber: null,
      blockDelete: false,
      isBlank: false,
      isCommentOnly: false,
      raw: line,
      tokens: []
    };

    const trimmed = line.trim();
    if (!trimmed) {
      result.isBlank = true;
      return result;
    }

    let pos = 0;
    const src = line;
    const len = src.length;

    // Characters the parser cannot read are kept, so a stray or mistyped
    // character is still compared instead of silently dropped.
    function addUnparsed(at) {
      result.unparsed += src[at].toUpperCase();
      const last = result.tokens[result.tokens.length - 1];
      if (last && last.type === 'unparsed' && last.end === at) {
        last.text += src[at]; last.end = at + 1;
      } else {
        result.tokens.push({ type: 'unparsed', text: src[at], start: at, end: at + 1 });
      }
    }

    // Two letters in a row outside comments means a macro statement
    // (IF, GOTO, WHILE, DO, END, SIN, ...). Normal G-code words are always
    // a single letter followed by a number.
    const codeOnly = src.replace(/\([^)]*\)?/g, ' ').replace(/;.*$/, '');
    const macroMode = /[A-Za-z]{2,}/.test(codeOnly);

    // Block delete may follow leading whitespace
    while (pos < len && /\s/.test(src[pos])) pos++;
    if (src[pos] === '/') {
      result.blockDelete = true;
      result.tokens.push({ type: 'blockDelete', text: '/', start: pos, end: pos + 1 });
      pos++;
    }

    while (pos < len) {
      if (/\s/.test(src[pos])) { pos++; continue; }

      if (src[pos] === '(') {
        // Find the matching ')' (handles nested brackets inside a comment)
        let depth = 0, closePos = len;
        for (let q = pos; q < len; q++) {
          if (src[q] === '(') depth++;
          else if (src[q] === ')' && --depth === 0) { closePos = q + 1; break; }
        }
        const text = src.substring(pos, closePos);
        const inner = text.replace(/^\(/, '').replace(/\)$/, '').trim();
        result.comment = result.comment ? result.comment + ' ' + inner : inner;
        result.parenComments.push(inner);
        result.tokens.push({ type: 'comment', kind: 'paren', text, start: pos, end: closePos });
        pos = closePos;
        continue;
      }

      if (src[pos] === ';') {
        const text = src.substring(pos);
        const inner = text.substring(1).trim();
        result.comment = result.comment ? result.comment + ' ' + inner : inner;
        result.semiComments.push(inner);
        result.tokens.push({ type: 'comment', kind: 'semi', text, start: pos, end: len });
        pos = len;
        continue;
      }

      // Macro statement: after an optional N-number, the rest of the code
      // (up to a comment) is one macro token, compared as text.
      if (macroMode && !(/[nN]/.test(src[pos]) && /\d/.test(src[pos + 1] || '') &&
          !result.tokens.some(t => t.type !== 'blockDelete'))) {
        let q = pos;
        while (q < len && src[q] !== '(' && src[q] !== ';') q++;
        const text = src.substring(pos, q).trimEnd();
        result.isMacroStatement = true;
        result.macros.push(text);
        result.tokens.push({ type: 'macro', text, start: pos, end: pos + text.length });
        pos = q;
        continue;
      }

      // Word with an expression value: X[#101+1], X#101, Z-[#5]
      const exprMatch = src.substring(pos).match(/^([a-zA-Z])\s*(-?\[|-?#\d+)/);
      if (exprMatch && !/[oO]/.test(src[pos])) {
        const letter = exprMatch[1].toUpperCase();
        let q = pos + exprMatch[0].length;
        if (exprMatch[2].endsWith('[')) {
          let depth = 1;
          while (q < len && depth > 0) {
            if (src[q] === '[') depth++;
            else if (src[q] === ']') depth--;
            q++;
          }
        }
        const text = src.substring(pos, q);
        result.exprs[letter] = text.substring(1).replace(/\s+/g, '').toUpperCase();
        result.tokens.push({ type: 'expr', text, param: letter, start: pos, end: q });
        pos = q;
        continue;
      }

      if (src[pos] === '#') {
        const macroMatch = src.substring(pos).match(/^#\d+\s*=?\s*[^A-Z(;]*/i);
        if (macroMatch) {
          const text = macroMatch[0].trimEnd();
          result.macros.push(text);
          result.tokens.push({ type: 'macro', text, start: pos, end: pos + text.length });
          pos += text.length;
          continue;
        }
        const refMatch = src.substring(pos).match(/^#\d+/);
        if (refMatch) {
          result.macros.push(refMatch[0]);
          result.tokens.push({ type: 'macro', text: refMatch[0], start: pos, end: pos + refMatch[0].length });
          pos += refMatch[0].length;
          continue;
        }
        addUnparsed(pos);
        pos++;
        continue;
      }

      if ((src[pos] === 'O' || src[pos] === 'o') && /\d/.test(src[pos + 1] || '')) {
        const m = src.substring(pos).match(/^[oO]\d+/);
        if (m) {
          result.programNumber = parseInt(m[0].substring(1), 10);
          result.tokens.push({ type: 'program', text: m[0], start: pos, end: pos + m[0].length });
          pos += m[0].length;
          continue;
        }
      }

      // Letter + number. Accepts .5  -.25  +1.  and a space after the letter (X 1.)
      const tokenMatch = src.substring(pos).match(/^([a-zA-Z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/);
      if (tokenMatch) {
        const letter = tokenMatch[1].toUpperCase();
        const numStr = tokenMatch[2];
        const num = parseFloat(numStr);
        const text = tokenMatch[0];
        const tStart = pos;
        const tEnd = pos + text.length;
        const noDecimal = !numStr.includes('.');

        switch (letter) {
          case 'N':
            result.lineNumber = text;
            result.tokens.push({ type: 'lineNumber', text, value: num, start: tStart, end: tEnd });
            break;
          case 'G':
            result.gCodes.push(text.toUpperCase());
            result.tokens.push({ type: 'gCode', text, value: num, start: tStart, end: tEnd });
            break;
          case 'M':
            result.mCodes.push(text.toUpperCase());
            result.tokens.push({ type: 'mCode', text, value: num, start: tStart, end: tEnd });
            break;
          case 'X': case 'Y': case 'Z':
            result.axes[letter] = num;
            result.tokens.push({ type: 'axis', text, value: num, axis: letter, start: tStart, end: tEnd, noDecimal });
            break;
          case 'A': case 'B': case 'C':
            result.rotary[letter] = num;
            result.tokens.push({ type: 'rotary', text, value: num, axis: letter, start: tStart, end: tEnd, noDecimal });
            break;
          case 'I': case 'J': case 'K':
            result.arcParams[letter] = num;
            result.tokens.push({ type: 'arcParam', text, value: num, axis: letter, start: tStart, end: tEnd, noDecimal });
            break;
          case 'F':
            result.feed = num;
            result.tokens.push({ type: 'feed', text, value: num, start: tStart, end: tEnd });
            break;
          case 'S':
            result.spindle = num;
            result.tokens.push({ type: 'spindle', text, value: num, start: tStart, end: tEnd });
            break;
          case 'T':
            result.tool = num;
            result.tokens.push({ type: 'tool', text, value: num, start: tStart, end: tEnd });
            break;
          case 'H':
            result.hOffset = num;
            result.tokens.push({ type: 'hOffset', text, value: num, start: tStart, end: tEnd });
            break;
          case 'D':
            result.dOffset = num;
            result.tokens.push({ type: 'dOffset', text, value: num, start: tStart, end: tEnd });
            break;
          case 'R': case 'P': case 'Q': case 'L':
            result.tokens.push({ type: 'param', text, value: num, param: letter, start: tStart, end: tEnd, noDecimal });
            break;
          default:
            result.tokens.push({ type: 'other', text, value: num, param: letter, start: tStart, end: tEnd });
        }
        pos = tEnd;
        continue;
      }

      addUnparsed(pos);
      pos++;
    }

    const nonCommentTokens = result.tokens.filter(t => t.type !== 'comment' && t.type !== 'lineNumber' && t.type !== 'blockDelete');
    result.isCommentOnly = nonCommentTokens.length === 0 && result.comment !== null;

    return result;
  }

  // =====================================================
  // Modal G-Code State Tracking
  // =====================================================

  // Group 1 motion codes: rapid, feed, arcs, and canned cycles (G80 cancels).
  // A bare coordinate line moves according to whichever of these is active.
  const MODAL_MOTION_CODES = new Set([0, 1, 2, 3, 73, 74, 76, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89]);

  /**
   * Track modal G-code state across a file.
   * Returns array of modal G-code strings per line (e.g. "G1").
   */
  function trackModalState(parsedLines) {
    const modalStates = [];
    let currentModal = null;

    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      for (const g of p.gCodes) {
        const num = parseFloat(g.replace(/^G/i, ''));
        if (MODAL_MOTION_CODES.has(num)) {
          currentModal = 'G' + num;
        }
      }
      modalStates.push(currentModal);
    }

    return modalStates;
  }

  const POS_LETTERS = ['X', 'Y', 'Z', 'A', 'B', 'C'];
  // After these codes the written value no longer tells where the machine is
  // (homing, machine coords, tool change, offset/rotation change, macro calls).
  const POSITION_RESET_G = new Set([10, 28, 30, 43, 44, 49, 52, 53, 53.1, 65, 66, 68, 68.2, 69, 92, 100]);
  const CANNED_CODES = new Set([73, 74, 76, 81, 82, 83, 84, 85, 86, 87, 88, 89]);

  /**
   * Per-line machine context, taken BEFORE each line runs:
   *   inc[i]  1 when the line moves in incremental mode (G91), else 0
   *   pos[L]  last absolute value written for X/Y/Z/A/B/C (NaN = unknown)
   *   feed    active modal F (NaN = unknown)
   * Used to spot redundant words (same value as already active) and
   * incremental lines (where small errors add up).
   */
  function trackContext(parsedLines, modalStates) {
    const n = parsedLines.length;
    const inc = new Uint8Array(n);
    const pos = {};
    for (const L of POS_LETTERS) pos[L] = new Float64Array(n);
    const feed = new Float64Array(n);
    const cur = {};
    for (const L of POS_LETTERS) cur[L] = NaN;
    let curF = NaN, incremental = false, inverseTime = false;

    for (let i = 0; i < n; i++) {
      const p = parsedLines[i];
      for (const L of POS_LETTERS) pos[L][i] = cur[L];
      feed[i] = curF;

      const nums = p.gCodes.map(codeNum);
      if (nums.includes(91)) incremental = true;
      if (nums.includes(90)) incremental = false;
      if (nums.includes(93)) inverseTime = true;
      if (nums.includes(94) || nums.includes(95)) inverseTime = false;
      inc[i] = incremental ? 1 : 0;

      const reset = incremental || p.isMacroStatement ||
        nums.some(g => POSITION_RESET_G.has(g) || CANNED_CODES.has(g) || (g >= 54 && g < 60)) ||
        CANNED_CODES.has(codeNum(modalStates[i] || '')) ||
        p.mCodes.some(m => { const v = codeNum(m); return v === 6 || v === 98 || v === 99; });
      for (const L of POS_LETTERS) {
        const v = p.axes[L] ?? p.rotary[L];
        if (reset || p.exprs[L] !== undefined) cur[L] = NaN;
        else if (v !== undefined) cur[L] = v;
      }

      // Feed mode change (G93/G94/G95) changes what F means. In G93 every move needs its own F.
      if (nums.some(g => g === 93 || g === 94 || g === 95)) curF = NaN;
      if (inverseTime || p.exprs.F !== undefined) curF = NaN;
      else if (p.feed !== null) curF = p.feed;
    }
    return { inc, pos, feed };
  }

  /** Context object for one line, as classifyTokens expects it. */
  function lineContext(track, i) {
    if (!track) return null;
    const prev = {};
    for (const L of POS_LETTERS) prev[L] = track.pos[L][i];
    prev.F = track.feed[i];
    return { inc: track.inc[i] === 1, prev };
  }

  /**
   * Mark N-number labels that a GOTO (or M99 Pn) jumps to. These are not
   * just sequence numbers, so they are compared even when N-numbers are ignored.
   */
  function markJumpTargets(parsedLines) {
    const targets = new Set();
    for (const p of parsedLines) {
      for (const m of p.macros) {
        for (const g of m.matchAll(/GOTO\s*(\d+)/gi)) targets.add(parseInt(g[1], 10));
      }
      if (p.mCodes.some(m => codeNum(m) === 99)) {
        const pt = p.tokens.find(t => t.type === 'param' && t.param === 'P');
        if (pt) targets.add(Math.round(pt.value));
      }
    }
    if (targets.size === 0) return;
    for (const p of parsedLines) {
      const nt = p.tokens.find(t => t.type === 'lineNumber');
      if (nt && targets.has(Math.round(nt.value))) p.jumpTarget = true;
    }
  }

  // =====================================================
  // Section Segmentation (comment-based fallback)
  // =====================================================

  function segmentIntoSections(lines, parsedLines) {
    const sections = [];
    let currentSection = null;

    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      if (p.isCommentOnly && p.comment && p.comment.length >= 10) {
        if (currentSection) {
          currentSection.endLine = i - 1;
          sections.push(currentSection);
        }
        currentSection = {
          headerText: p.comment,
          headerLine: i,
          startLine: i,
          endLine: lines.length - 1
        };
      }
    }

    if (currentSection) {
      currentSection.endLine = lines.length - 1;
      sections.push(currentSection);
    }

    if (sections.length === 0) {
      sections.push({
        headerText: '',
        headerLine: 0,
        startLine: 0,
        endLine: lines.length - 1
      });
    }

    return sections;
  }

  // =====================================================
  // Toolpath Segmentation (anchor-based, Brother Speedio)
  // =====================================================

  /**
   * Detect toolpath boundaries using comment-pair anchors and G100 lines.
   *
   * Universal pattern (Fusion 360 + Brother Speedio):
   *   blank_line → comment_only_line → comment_only_line
   * This appears for ALL toolpaths (both tool changes and same-tool re-calls).
   *
   * G100 anchors (tool changes only) are associated with the nearest comment-pair.
   * Same-tool re-calls have no G100 — the comment pair is the only marker.
   *
   * Falls back to comment-based segmentation if no comment-pairs found.
   */
  function segmentIntoToolpaths(lines, parsedLines) {
    // --- Pass 1: Find comment-pair anchors ---
    // Pattern: blank line followed by 2+ consecutive comment-only lines
    // Skip pairs that are in the program header (before any G/M code)

    // Find where the header ends (first non-comment, non-blank line)
    let headerEndLine = 0;
    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      if (!p.isBlank && !p.isCommentOnly) {
        headerEndLine = i;
        break;
      }
    }

    const commentAnchors = [];
    for (let i = headerEndLine; i < parsedLines.length - 1; i++) {
      const p = parsedLines[i];
      if (!p.isBlank) continue;

      // Found a blank line — check if next 2+ lines are comment-only
      const nextIdx = i + 1;
      if (nextIdx >= parsedLines.length) continue;
      if (!parsedLines[nextIdx].isCommentOnly) continue;
      if (nextIdx + 1 >= parsedLines.length) continue;
      if (!parsedLines[nextIdx + 1].isCommentOnly) continue;

      // Found: blank → comment → comment. Collect all consecutive comments.
      const comments = [];
      let j = nextIdx;
      while (j < parsedLines.length && parsedLines[j].isCommentOnly) {
        comments.push(parsedLines[j].comment || '');
        j++;
      }

      commentAnchors.push({
        blankLine: i,
        commentStart: nextIdx,
        commentEnd: nextIdx + comments.length - 1,
        comments
      });

      // Skip past this block so we don't double-detect
      i = nextIdx + comments.length - 1;
    }

    // --- Pass 2: Find G100 anchors (tool changes) ---
    const g100Anchors = [];
    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      if (p.tool !== null) {
        const hasG100 = p.gCodes.some(g => {
          const num = parseFloat(g.replace(/^G/i, ''));
          return num === 100;
        });
        if (hasG100) {
          const hasXY = p.axes.X !== undefined || p.axes.Y !== undefined;
          const hasSpin = p.spindle !== null;
          const hasM03M04 = p.mCodes.some(m => {
            const num = parseFloat(m.replace(/^M/i, ''));
            return num === 3 || num === 4;
          });
          if (hasXY || hasSpin || hasM03M04) {
            g100Anchors.push({
              lineIndex: i,
              toolNumber: p.tool,
              nNumber: p.lineNumber,
              spindleSpeed: p.spindle
            });
          }
        }
      }
    }

    // --- New layout (APW posts v8.8.1+ / R v2.1+): divider comment starts each toolpath ---
    const byDivider = segmentByDividers(lines, parsedLines, g100Anchors);
    if (byDivider) return finishToolpaths(byDivider, lines, parsedLines);

    // --- No comment-pair anchors found — fall back ---
    if (commentAnchors.length === 0) {
      // If we have G100 anchors but no comment-pairs, use G100-only detection
      if (g100Anchors.length > 0) {
        return buildFromG100Only(lines, parsedLines, g100Anchors);
      }
      // No anchors at all — fall back to comment-based sections
      const sections = segmentIntoSections(lines, parsedLines);
      return sections.map((s, idx) => ({
        id: idx,
        type: 'toolpath',
        name: s.headerText || '',
        opType: '',
        toolNumber: null,
        nNumber: null,
        spindleSpeed: null,
        startLine: s.startLine,
        anchorLine: -1,
        endLine: s.endLine
      }));
    }

    // --- Pass 3: Associate G100 anchors with comment-pairs ---
    // For each comment-pair, look forward up to 20 lines for a G100 anchor
    const g100Used = new Set();
    const commentG100Map = new Map(); // commentAnchor index → g100Anchor

    for (let c = 0; c < commentAnchors.length; c++) {
      const ca = commentAnchors[c];
      for (const g of g100Anchors) {
        if (g100Used.has(g)) continue;
        if (g.lineIndex > ca.commentEnd && g.lineIndex <= ca.commentEnd + 20) {
          commentG100Map.set(c, g);
          g100Used.add(g);
          break;
        }
      }
    }

    // --- Pass 4: Build toolpath objects ---
    const PREAMBLE_CODES = new Set(['G28', 'G53', 'G90', 'G49', 'G69', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G53.1', 'G68.2']);
    const PREAMBLE_MCODES = new Set(['M5', 'M9', 'M298', 'M442', 'M443', 'M444', 'M445', 'M495', 'M1', 'M141']);
    const CUTTING_GCODES = new Set([1, 2, 3]);

    const toolpaths = [];
    let prevToolNumber = null;

    for (let c = 0; c < commentAnchors.length; c++) {
      const ca = commentAnchors[c];
      const g100 = commentG100Map.get(c) || null;

      // Expand backward from the blank line before the comment pair
      let preambleStart = ca.blankLine;
      const prevEnd = c > 0 ? commentAnchors[c - 1].commentEnd + 1 : headerEndLine;
      const maxBack = Math.max(prevEnd, ca.blankLine - 40);

      for (let i = ca.blankLine - 1; i >= maxBack; i--) {
        const p = parsedLines[i];

        // Stop at cutting moves (G01/G02/G03 with axis values)
        if (p.gCodes.length > 0) {
          const hasCutting = p.gCodes.some(g => {
            const num = parseFloat(g.replace(/^G/i, ''));
            return CUTTING_GCODES.has(num);
          });
          if (hasCutting && Object.keys(p.axes).length > 0) break;
        }

        // Bare coordinate lines under modal cutting = cutting content
        if (p.gCodes.length === 0 && p.mCodes.length === 0 &&
            Object.keys(p.axes).length > 0 && !p.isCommentOnly && !p.isBlank) {
          break;
        }

        // Accept preamble-type lines
        const isPreambleG = p.gCodes.some(g => {
          return PREAMBLE_CODES.has(normCode(g));
        });
        const isPreambleM = p.mCodes.some(m => {
          return PREAMBLE_MCODES.has(normCode(m));
        });
        const isRapid = p.gCodes.some(g => parseFloat(g.replace(/^G/i, '')) === 0);

        if (p.isBlank || p.isCommentOnly || isPreambleG || isPreambleM || isRapid ||
            (p.gCodes.length === 0 && p.mCodes.length === 0 && Object.keys(p.axes).length === 0 && !p.isBlank)) {
          preambleStart = i;
        } else {
          break;
        }
      }

      // Extract metadata
      // Old layout: (job - tool description) (operation name) [more comments]
      const jobTool = ca.comments.length > 1 ? ca.comments[0] : '';
      const name = ca.comments.length > 1 ? ca.comments[1] : (ca.comments[0] || '');
      const opType = ca.comments.length > 2 ? ca.comments[2] : '';
      const toolNumber = g100 ? g100.toolNumber : prevToolNumber;
      const nNumber = g100 ? g100.nNumber : null;
      const spindleSpeed = g100 ? g100.spindleSpeed : null;
      // Separator sits on the visible comment line (toolpath name)
      const anchorLine = ca.commentStart;
      const g100Line = g100 ? g100.lineIndex : -1;

      prevToolNumber = toolNumber;

      toolpaths.push({
        id: toolpaths.length,
        type: 'toolpath',
        name,
        opType,
        jobTool,
        layout: 'blank-comments',
        toolNumber,
        nNumber,
        spindleSpeed,
        startLine: preambleStart,
        anchorLine,
        g100Line,
        endLine: lines.length - 1
      });
    }

    return finishToolpaths(toolpaths, lines, parsedLines);
  }

  function isDivider(p) {
    return p.isCommentOnly && /^-{10,}$/.test((p.comment || '').trim());
  }

  function isMotionLine(p) {
    const hasAxes = Object.keys(p.axes).length + Object.keys(p.rotary).length > 0;
    return p.gCodes.some(g => codeNum(g) === 100) ||
      (hasAxes && p.gCodes.some(g => { const n = codeNum(g); return n >= 0 && n <= 3; }));
  }

  /** Only labels, macro statements, or comments (e.g. the tool length check block). */
  function isLabelOrMacroOnly(p) {
    return p.gCodes.length === 0 && p.mCodes.length === 0 &&
      Object.keys(p.axes).length === 0 && p.tool === null && p.spindle === null;
  }

  /**
   * New layout: every toolpath starts with a divider comment (-----).
   *   (----------)
   *   [tool length check: IF/GOTO lines]
   *   (job - tool description)   <- optional
   *   (operation name)
   *   (strategy, e.g. ADAPTIVE)
   *   G54 / M01 / G100 ...       <- or straight to moves for a same-tool toolpath
   * Dividers in the header tool list and the tool-setting block are skipped:
   * they have an M06 or no motion before the next divider.
   * Returns null when the file does not use this layout.
   */
  function segmentByDividers(lines, parsedLines, g100Anchors) {
    const dividers = [];
    for (let i = 0; i < parsedLines.length; i++) if (isDivider(parsedLines[i])) dividers.push(i);
    if (dividers.length === 0) return null;

    const valid = [];
    for (let k = 0; k < dividers.length; k++) {
      const d = dividers[k];
      const stop = k + 1 < dividers.length ? dividers[k + 1] : parsedLines.length;
      let hasM06 = false, hasMotion = false;
      for (let i = d + 1; i < stop; i++) {
        const p = parsedLines[i];
        if (p.mCodes.some(m => codeNum(m) === 6)) { hasM06 = true; break; }
        if (isMotionLine(p)) hasMotion = true;
      }
      if (!hasM06 && hasMotion) valid.push(d);
    }
    if (valid.length === 0) return null;

    const toolpaths = [];
    let prevToolNumber = null;
    for (let k = 0; k < valid.length; k++) {
      const d = valid[k];
      const next = k + 1 < valid.length ? valid[k + 1] : parsedLines.length;

      // First real code line after the divider (skips the length check block)
      let r = -1;
      for (let i = d + 1; i < next; i++) {
        const p = parsedLines[i];
        if (p.isBlank || p.isCommentOnly || isLabelOrMacroOnly(p)) continue;
        r = i; break;
      }
      // Comment group directly above it
      const group = [];
      for (let i = (r >= 0 ? r : next) - 1; i > d; i--) {
        const p = parsedLines[i];
        if (!p.isCommentOnly || isDivider(p)) break;
        group.unshift(p.comment || '');
      }
      const strategy = group.length >= 2 ? group[group.length - 1] : '';
      const name = group.length >= 2 ? group[group.length - 2] : (group[0] || '');
      const jobTool = group.length >= 3 ? group[group.length - 3] : '';

      const g100 = g100Anchors.find(g => g.lineIndex > d && g.lineIndex < next) || null;
      const toolNumber = g100 ? g100.toolNumber : prevToolNumber;
      prevToolNumber = toolNumber;

      toolpaths.push({
        id: toolpaths.length,
        type: 'toolpath',
        name,
        opType: strategy,
        jobTool,
        layout: 'divider',
        toolNumber,
        nNumber: g100 ? g100.nNumber : null,
        spindleSpeed: g100 ? g100.spindleSpeed : null,
        startLine: d,
        anchorLine: d,
        g100Line: g100 ? g100.lineIndex : -1,
        endLine: lines.length - 1
      });
    }
    return toolpaths;
  }

  /**
   * Shared last step: set end lines, add Program Header and Program End.
   */
  function finishToolpaths(toolpaths, lines, parsedLines) {
    // Adjust endLines
    for (let i = 0; i < toolpaths.length - 1; i++) {
      toolpaths[i].endLine = toolpaths[i + 1].startLine - 1;
    }
    if (toolpaths.length > 0) {
      toolpaths[toolpaths.length - 1].endLine = lines.length - 1;
    }

    // Add program header if first toolpath doesn't start at line 0
    const result = [];
    if (toolpaths.length > 0 && toolpaths[0].startLine > 0) {
      result.push({
        id: 0,
        type: 'preamble',
        name: 'Program Header',
        opType: '',
        toolNumber: null,
        nNumber: null,
        spindleSpeed: null,
        startLine: 0,
        anchorLine: -1,
        endLine: toolpaths[0].startLine - 1
      });
    }

    // Re-number IDs
    for (const tp of toolpaths) {
      tp.id = result.length;
      result.push(tp);
    }

    // Check for program end (M30)
    if (result.length > 0) {
      const lastTp = result[result.length - 1];
      const searchStart = lastTp.anchorLine >= 0 ? lastTp.anchorLine + 1 : lastTp.startLine;
      for (let i = lastTp.endLine; i >= searchStart; i--) {
        const p = parsedLines[i];
        if (p.mCodes.some(m => parseFloat(m.replace(/^M/i, '')) === 30)) {
          let endStart = i;
          for (let j = i - 1; j > searchStart; j--) {
            const pj = parsedLines[j];
            if (pj.isBlank || pj.mCodes.length > 0 ||
                pj.gCodes.some(g => parseFloat(g.replace(/^G/i, '')) === 28 || parseFloat(g.replace(/^G/i, '')) === 53) ||
                (pj.gCodes.some(g => parseFloat(g.replace(/^G/i, '')) === 100) && pj.lineNumber === null) ||
                pj.gCodes.some(g => parseFloat(g.replace(/^G/i, '')) === 90 || parseFloat(g.replace(/^G/i, '')) === 49)) {
              endStart = j;
            } else {
              break;
            }
          }
          lastTp.endLine = endStart - 1;
          result.push({
            id: result.length,
            type: 'program_end',
            name: 'Program End',
            opType: '',
            toolNumber: null,
            nNumber: null,
            spindleSpeed: null,
            startLine: endStart,
            anchorLine: -1,
            endLine: lines.length - 1
          });
          break;
        }
      }
    }

    return result;
  }

  /**
   * Fallback: build toolpath list from G100 anchors only (no comment-pairs found).
   */
  function buildFromG100Only(lines, parsedLines, g100Anchors) {
    const PREAMBLE_CODES = new Set(['G28', 'G53', 'G90', 'G49', 'G69', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G53.1', 'G68.2']);
    const PREAMBLE_MCODES = new Set(['M5', 'M9', 'M298', 'M442', 'M443', 'M444', 'M445', 'M495', 'M1', 'M141']);
    const CUTTING_GCODES = new Set([1, 2, 3]);
    const toolpaths = [];

    for (let a = 0; a < g100Anchors.length; a++) {
      const anchor = g100Anchors[a];
      let preambleStart = anchor.lineIndex;
      const minLine = a > 0 ? g100Anchors[a - 1].lineIndex + 1 : 0;
      const maxBack = Math.max(minLine, anchor.lineIndex - 40);

      for (let i = anchor.lineIndex - 1; i >= maxBack; i--) {
        const p = parsedLines[i];
        if (p.gCodes.length > 0) {
          const hasCutting = p.gCodes.some(g => CUTTING_GCODES.has(parseFloat(g.replace(/^G/i, ''))));
          if (hasCutting && Object.keys(p.axes).length > 0) break;
        }
        if (p.gCodes.length === 0 && p.mCodes.length === 0 &&
            Object.keys(p.axes).length > 0 && !p.isCommentOnly && !p.isBlank) break;

        const isPreambleG = p.gCodes.some(g => PREAMBLE_CODES.has(normCode(g)));
        const isPreambleM = p.mCodes.some(m => PREAMBLE_MCODES.has(normCode(m)));
        const isRapid = p.gCodes.some(g => parseFloat(g.replace(/^G/i, '')) === 0);

        if (p.isBlank || p.isCommentOnly || isPreambleG || isPreambleM || isRapid ||
            (p.gCodes.length === 0 && p.mCodes.length === 0 && Object.keys(p.axes).length === 0 && !p.isBlank)) {
          preambleStart = i;
        } else break;
      }

      let name = '', opType = '', nameFound = false;
      for (let i = preambleStart; i < anchor.lineIndex; i++) {
        if (parsedLines[i].isCommentOnly && parsedLines[i].comment) {
          if (!nameFound) { name = parsedLines[i].comment; nameFound = true; }
          else if (!opType) { opType = parsedLines[i].comment; }
        }
      }

      toolpaths.push({
        id: toolpaths.length, type: 'toolpath', name, opType,
        toolNumber: anchor.toolNumber, nNumber: anchor.nNumber,
        spindleSpeed: anchor.spindleSpeed, startLine: preambleStart,
        anchorLine: anchor.lineIndex, endLine: lines.length - 1
      });
    }

    for (let i = 0; i < toolpaths.length - 1; i++) {
      toolpaths[i].endLine = toolpaths[i + 1].startLine - 1;
    }

    const result = [];
    if (toolpaths.length > 0 && toolpaths[0].startLine > 0) {
      result.push({
        id: 0, type: 'preamble', name: 'Program Header', opType: '',
        toolNumber: null, nNumber: null, spindleSpeed: null,
        startLine: 0, anchorLine: -1, endLine: toolpaths[0].startLine - 1
      });
    }
    for (const tp of toolpaths) { tp.id = result.length; result.push(tp); }
    return result;
  }

  // =====================================================
  // Structural Fingerprints for LCS
  // =====================================================

  /**
   * Create a structural fingerprint for LCS matching.
   * Includes modal G-code state and binned coordinate values for bare coordinate lines.
   */
  function fingerprint(parsed, rules, modalG) {
    if (parsed.isBlank) return '__BLANK__';

    const parts = [];

    // G/M codes are always normalized here (G01 == G1) so equivalent lines
    // still pair up. Format-only differences are reported by classifyTokens.
    for (const g of parsed.gCodes) parts.push(normCode(g));
    for (const m of parsed.mCodes) parts.push(normCode(m));

    const hasGM = parsed.gCodes.length > 0 || parsed.mCodes.length > 0;

    // Axis letters present (sorted)
    const axisLetters = Object.keys(parsed.axes).sort().join('');
    const arcLetters = Object.keys(parsed.arcParams).sort().join('');
    const rotaryLetters = Object.keys(parsed.rotary).sort().join('');
    const hasCoords = axisLetters || arcLetters || rotaryLetters;

    // For bare coordinate lines (no G/M codes), prepend modal G-code
    if (!hasGM && hasCoords && modalG) {
      parts.push(modalG);
    }

    if (axisLetters) parts.push(axisLetters);
    if (arcLetters) parts.push(arcLetters);
    if (rotaryLetters) parts.push(rotaryLetters);

    // F/S/T/H/D presence
    if (parsed.feed !== null) parts.push('F');
    if (parsed.spindle !== null) parts.push('S');
    if (parsed.tool !== null) parts.push('T');
    if (parsed.hOffset !== null) parts.push('H');
    if (parsed.dOffset !== null) parts.push('D');
    // Macros and expression words
    if (parsed.macros.length > 0) parts.push('#MACRO');
    const exprLetters = Object.keys(parsed.exprs).sort().join('');
    if (exprLetters) parts.push('[' + exprLetters + ']');
    // Comment-only lines get their (rule-normalized) text for precise matching.
    // Ignored comment types contribute nothing.
    if (parsed.isCommentOnly) {
      const ct = commentText(parsed, rules);
      if (ct) parts.push('(' + ct + ')');
    }

    return parts.join(' ') || '__EMPTY__';
  }

  // =====================================================
  // Token-Level Classification
  // =====================================================

  const FP_EPS = 1e-10;

  /** Strip leading zeros and uppercase: G01 -> G1, m03 -> M3, T05 -> T5. */
  function normCode(c) {
    return c.replace(/^([A-Z])0+(\d)/i, '$1$2').toUpperCase();
  }

  function codeNum(c) {
    return parseFloat(c.replace(/^[A-Z]/i, ''));
  }

  function isMotionCode(c) {
    return MODAL_MOTION_CODES.has(codeNum(c));
  }

  /** Work offsets G54-G59 (G54.1 extended form included). */
  function isWorkOffsetCode(c) {
    const n = codeNum(c);
    return n >= 54 && n < 60;
  }

  function normText(text, rules) {
    let t = text;
    if (rules.ignoreWhitespace) t = t.replace(/\s+/g, '');
    if (rules.ignoreCase) t = t.toLowerCase();
    return t;
  }

  /** Comment text that takes part in comparison, after applying ignore rules. */
  function commentText(parsed, rules) {
    const parts = [];
    if (!rules.ignoreParenComments) parts.push(...parsed.parenComments);
    if (!rules.ignoreSemiComments) parts.push(...parsed.semiComments);
    return normText(parts.join(' '), rules);
  }

  function comparedCommentTokens(parsed, rules) {
    return parsed.tokens.filter(t => t.type === 'comment' &&
      !(t.kind === 'paren' && rules.ignoreParenComments) &&
      !(t.kind === 'semi' && rules.ignoreSemiComments));
  }

  /** Line text with all comments removed (used for case/whitespace format checks). */
  function codePart(parsed) {
    let s = parsed.raw || '';
    const comments = parsed.tokens.filter(t => t.type === 'comment').sort((a, b) => b.start - a.start);
    for (const c of comments) s = s.slice(0, c.start) + s.slice(c.end);
    return s.trim();
  }

  /**
   * ALL rules that decide how serious a line difference is live here.
   * Severities per token diff:
   *   workoffset — G54-G59 change (highest tier, always surfaces)
   *   critical   — anything that can change what the machine does
   *   minor      — format-only differences (shown amber)
   *   coordinate / coordinate-z — numeric value change, graded later by tolerance
   *
   * modalA / modalB are the active motion modes (G0/G1/G2/G3/canned) for each line.
   */
  function classifyTokens(parsedA, parsedB, rules, modalA, modalB, ctxA, ctxB) {
    rules = rules || {};
    const tokenDiffs = [];
    // Lines that write or shift offsets: values here are offset data, not moves
    const offsetLine = isOffsetSetLine(parsedA) || isOffsetSetLine(parsedB);
    // Incremental (G91): small errors add up line after line, so no tolerance
    const incremental = !!((ctxA && ctxA.inc) || (ctxB && ctxB.inc));
    // A missing word is only "redundant" on a plain move line in absolute mode
    const plainMoves = !offsetLine && !incremental && isPlainMoveLine(parsedA, modalA) && isPlainMoveLine(parsedB, modalB);
    const gTokA = parsedA.tokens.filter(t => t.type === 'gCode');
    const gTokB = parsedB.tokens.filter(t => t.type === 'gCode');

    // --- Motion mode (G0/G1/G2/G3/canned cycles), using modal state ---
    // Rapid vs feed is a crash risk, so any change is critical.
    const movesA = Object.keys(parsedA.axes).length + Object.keys(parsedA.rotary).length + Object.keys(parsedA.arcParams).length > 0;
    const movesB = Object.keys(parsedB.axes).length + Object.keys(parsedB.rotary).length + Object.keys(parsedB.arcParams).length > 0;
    const explicitMotionA = parsedA.gCodes.filter(isMotionCode).map(normCode).join(',');
    const explicitMotionB = parsedB.gCodes.filter(isMotionCode).map(normCode).join(',');
    const motionA = modalA !== undefined ? (modalA || '') : explicitMotionA;
    const motionB = modalB !== undefined ? (modalB || '') : explicitMotionB;
    // Only matters when a line moves or sets the mode itself.
    if ((movesA || movesB || explicitMotionA || explicitMotionB) && motionA !== motionB) {
      tokenDiffs.push({ field: 'motion', severity: 'critical', leftVal: motionA, rightVal: motionB,
        leftTokens: gTokA.filter(t => isMotionCode(t.text)),
        rightTokens: gTokB.filter(t => isMotionCode(t.text)) });
    }

    // --- Non-motion G-codes (set compare) ---
    const nonMotionA = parsedA.gCodes.filter(g => !isMotionCode(g)).map(normCode);
    const nonMotionB = parsedB.gCodes.filter(g => !isMotionCode(g)).map(normCode);
    const setA = new Set(nonMotionA), setB = new Set(nonMotionB);
    const changed = [...setA].filter(g => !setB.has(g)).concat([...setB].filter(g => !setA.has(g)));
    if (changed.length > 0) {
      const changedSet = new Set(changed);
      const woChanged = changed.some(isWorkOffsetCode) ||
        (offsetLine && changed.some(g => OFFSET_SET_CODES.has(codeNum(g))));
      tokenDiffs.push({ field: woChanged ? 'workOffset' : 'gCode',
        severity: woChanged ? 'workoffset' : 'critical',
        leftVal: [...setA].sort().join(','), rightVal: [...setB].sort().join(','),
        leftTokens: gTokA.filter(t => changedSet.has(normCode(t.text))),
        rightTokens: gTokB.filter(t => changedSet.has(normCode(t.text))) });
    }

    // --- M-codes ---
    const mA = parsedA.mCodes.map(normCode).sort().join(',');
    const mB = parsedB.mCodes.map(normCode).sort().join(',');
    if (mA !== mB) {
      tokenDiffs.push({ field: 'mCode', severity: 'critical', leftVal: mA, rightVal: mB,
        leftTokens: parsedA.tokens.filter(t => t.type === 'mCode'),
        rightTokens: parsedB.tokens.filter(t => t.type === 'mCode') });
    }

    // --- Tool, offsets, spindle, feed ---
    compareField(parsedA, parsedB, 'tool', 'critical', tokenDiffs);
    compareField(parsedA, parsedB, 'hOffset', 'critical', tokenDiffs);
    compareField(parsedA, parsedB, 'dOffset', 'critical', tokenDiffs);
    compareField(parsedA, parsedB, 'spindle', 'critical', tokenDiffs);
    if (parsedA.feed === null && parsedB.feed !== null && sameAsActive(ctxA, 'F', parsedB.feed)) {
      tokenDiffs.push(redundantDiff('F', 'feed', parsedA, parsedB));
    } else if (parsedB.feed === null && parsedA.feed !== null && sameAsActive(ctxB, 'F', parsedA.feed)) {
      tokenDiffs.push(redundantDiff('F', 'feed', parsedA, parsedB));
    } else {
      compareField(parsedA, parsedB, 'feed', 'critical', tokenDiffs);
    }

    // --- Axes. Value change -> graded by tolerance. Missing on one side -> critical. ---
    for (const axis of ['X', 'Y', 'Z', 'A', 'B', 'C']) {
      const va = parsedA.axes[axis] ?? parsedA.rotary[axis] ?? null;
      const vb = parsedB.axes[axis] ?? parsedB.rotary[axis] ?? null;
      if (va === null && vb === null) continue;
      if (va === null || vb === null || Math.abs(va - vb) > FP_EPS) {
        const missing = va === null || vb === null;
        const tType = (axis === 'A' || axis === 'B' || axis === 'C') ? 'rotary' : 'axis';
        // Word written on one side only, but equal to the value already active on the other
        if (missing && plainMoves &&
            ((va === null && sameAsActive(ctxA, axis, vb)) || (vb === null && sameAsActive(ctxB, axis, va)))) {
          tokenDiffs.push(redundantDiff(axis, tType, parsedA, parsedB));
          continue;
        }
        let sev = missing ? 'critical' : (axis === 'Z' ? 'coordinate-z' : 'coordinate');
        if (offsetLine) sev = 'workoffset';
        else if (incremental) sev = 'critical';
        const delta = missing ? null : Math.abs(va - vb);
        tokenDiffs.push({ field: 'axis-' + axis, severity: sev,
          leftVal: va, rightVal: vb, delta, incremental: incremental && !offsetLine && !missing,
          leftTokens: parsedA.tokens.filter(t => (t.type === tType) && t.axis === axis),
          rightTokens: parsedB.tokens.filter(t => (t.type === tType) && t.axis === axis) });
      }
    }

    // --- Arc params ---
    for (const p of ['I', 'J', 'K']) {
      const va = parsedA.arcParams[p] ?? null;
      const vb = parsedB.arcParams[p] ?? null;
      if (va === null && vb === null) continue;
      if (va === null || vb === null || Math.abs(va - vb) > FP_EPS) {
        const missing = va === null || vb === null;
        const delta = missing ? null : Math.abs(va - vb);
        tokenDiffs.push({ field: 'arc-' + p, severity: missing ? 'critical' : 'coordinate',
          leftVal: va, rightVal: vb, delta,
          leftTokens: parsedA.tokens.filter(t => t.type === 'arcParam' && t.axis === p),
          rightTokens: parsedB.tokens.filter(t => t.type === 'arcParam' && t.axis === p) });
      }
    }

    // --- Comments (respecting ignore rules) ---
    const cA = commentText(parsedA, rules);
    const cB = commentText(parsedB, rules);
    if (cA !== cB) {
      tokenDiffs.push({ field: 'comment', severity: 'critical',
        leftVal: parsedA.comment, rightVal: parsedB.comment,
        leftTokens: comparedCommentTokens(parsedA, rules),
        rightTokens: comparedCommentTokens(parsedB, rules) });
    }

    // --- Macros ---
    // Numbers inside macros are compared as numbers: #100=5. equals #100=5.0
    const macroA = normText(normMacroNumbers(parsedA.macros.join('|')), { ...rules, ignoreCase: true });
    const macroB = normText(normMacroNumbers(parsedB.macros.join('|')), { ...rules, ignoreCase: true });
    if (macroA !== macroB) {
      tokenDiffs.push({ field: 'macro', severity: 'critical',
        leftVal: parsedA.macros.join('|'), rightVal: parsedB.macros.join('|'),
        leftTokens: parsedA.tokens.filter(t => t.type === 'macro'),
        rightTokens: parsedB.tokens.filter(t => t.type === 'macro') });
    }

    // G54.1 Pn: the P word picks the work offset. On G10/G52/G92 lines, P/L/R are offset data.
    const extWO = parsedA.gCodes.some(g => codeNum(g) === 54.1) || parsedB.gCodes.some(g => codeNum(g) === 54.1);
    // R on an arc (G2/G3 both sides) is geometry, graded by tolerance like I/J/K.
    // R in a canned cycle is the retract plane and stays critical.
    const ARC = new Set(['G2', 'G3']);
    const arcBoth = ARC.has(normCode(motionA || '')) && ARC.has(normCode(motionB || ''));

    // --- Params (R, P, Q, L) and unrecognized words (U, V, W, E ...) ---
    for (const ttype of ['param', 'other']) {
      const tA = parsedA.tokens.filter(t => t.type === ttype);
      const tB = parsedB.tokens.filter(t => t.type === ttype);
      const mapA = {}, mapB = {};
      for (const t of tA) mapA[t.param] = t.value;
      for (const t of tB) mapB[t.param] = t.value;
      const keys = new Set([...Object.keys(mapA), ...Object.keys(mapB)]);
      for (const k of keys) {
        const va = mapA[k], vb = mapB[k];
        if (va === undefined || vb === undefined || Math.abs(va - vb) > FP_EPS) {
          const wo = (extWO && k === 'P') || (offsetLine && ttype === 'param');
          const arcR = !wo && arcBoth && ttype === 'param' && k === 'R' && va !== undefined && vb !== undefined;
          tokenDiffs.push({ field: wo ? 'workOffset' : ttype + '-' + k,
            severity: wo ? 'workoffset' : (arcR ? 'coordinate' : 'critical'),
            leftVal: va, rightVal: vb, delta: arcR ? Math.abs(va - vb) : undefined,
            leftTokens: tA.filter(t => t.param === k),
            rightTokens: tB.filter(t => t.param === k) });
        }
      }
    }

    // --- Expression words: X[#101+1], X#101 (compared as text) ---
    const exprKeys = new Set([...Object.keys(parsedA.exprs), ...Object.keys(parsedB.exprs)]);
    for (const k of exprKeys) {
      if (parsedA.exprs[k] !== parsedB.exprs[k]) {
        const wo = extWO && k === 'P'; // G54.1 P#153 (pallet work offset)
        tokenDiffs.push({ field: wo ? 'workOffset' : 'expr-' + k, severity: wo ? 'workoffset' : 'critical',
          leftVal: parsedA.exprs[k], rightVal: parsedB.exprs[k],
          leftTokens: parsedA.tokens.filter(t => t.type === 'expr' && t.param === k),
          rightTokens: parsedB.tokens.filter(t => t.type === 'expr' && t.param === k) });
      }
    }

    // --- Characters the parser could not read (stray or mistyped) ---
    if (parsedA.unparsed !== parsedB.unparsed) {
      tokenDiffs.push({ field: 'unparsed', severity: 'critical',
        leftVal: parsedA.unparsed, rightVal: parsedB.unparsed,
        leftTokens: parsedA.tokens.filter(t => t.type === 'unparsed'),
        rightTokens: parsedB.tokens.filter(t => t.type === 'unparsed') });
    }

    // --- No decimal point (setting): on many controls X1 = 0.0001", X1. = 1" ---
    if (rules.decimalPointMatters) {
      for (const L of DECIMAL_LETTERS) {
        const ta = parsedA.tokens.find(t => t.noDecimal !== undefined && (t.axis === L || t.param === L));
        const tb = parsedB.tokens.find(t => t.noDecimal !== undefined && (t.axis === L || t.param === L));
        if (!ta || !tb || ta.noDecimal === tb.noDecimal) continue;
        if (ta.value === 0 && tb.value === 0) continue; // X0 = X0. on every control
        tokenDiffs.push({ field: 'decimal-' + L, severity: 'critical',
          leftVal: ta.text, rightVal: tb.text, leftTokens: [ta], rightTokens: [tb] });
      }
    }

    // --- Block delete: a "/" switches the whole line on/off at the control ---
    if (!rules.ignoreBlockDelete && parsedA.blockDelete !== parsedB.blockDelete) {
      tokenDiffs.push({ field: 'blockDelete', severity: 'critical',
        leftVal: parsedA.blockDelete, rightVal: parsedB.blockDelete,
        leftTokens: parsedA.tokens.filter(t => t.type === 'blockDelete'),
        rightTokens: parsedB.tokens.filter(t => t.type === 'blockDelete') });
    }

    // --- GOTO / M99 P jump labels: always compared, a wrong label breaks the jump ---
    const jump = parsedA.jumpTarget || parsedB.jumpTarget;
    const nVal = p => { const t = p.tokens.find(x => x.type === 'lineNumber'); return t ? Math.round(t.value) : null; };
    if (jump && nVal(parsedA) !== nVal(parsedB)) {
      tokenDiffs.push({ field: 'jumpLabel', severity: 'critical',
        leftVal: parsedA.lineNumber, rightVal: parsedB.lineNumber,
        leftTokens: parsedA.tokens.filter(t => t.type === 'lineNumber'),
        rightTokens: parsedB.tokens.filter(t => t.type === 'lineNumber') });
    }
    // --- N-numbers (format only) ---
    else if (!rules.ignoreLineNumbers && (parsedA.lineNumber || '').toUpperCase() !== (parsedB.lineNumber || '').toUpperCase()) {
      tokenDiffs.push({ field: 'lineNumber', severity: 'minor',
        leftVal: parsedA.lineNumber, rightVal: parsedB.lineNumber,
        leftTokens: parsedA.tokens.filter(t => t.type === 'lineNumber'),
        rightTokens: parsedB.tokens.filter(t => t.type === 'lineNumber') });
    }

    // --- Program number (O-number) ---
    if (parsedA.programNumber !== parsedB.programNumber) {
      tokenDiffs.push({ field: 'program', severity: 'minor',
        leftVal: parsedA.programNumber, rightVal: parsedB.programNumber,
        leftTokens: parsedA.tokens.filter(t => t.type === 'program'),
        rightTokens: parsedB.tokens.filter(t => t.type === 'program') });
    }

    // --- Format-only differences (only checked when nothing else differs) ---
    if (tokenDiffs.length === 0) {
      const codeA = codePart(parsedA), codeB = codePart(parsedB);
      if (codeA !== codeB) {
        const strip = s => s.replace(/\s+/g, '');
        let fmt = null;
        if (!rules.normalizeGMCodes) {
          const rawGM = p => p.tokens.filter(t => t.type === 'gCode' || t.type === 'mCode').map(t => t.text.toUpperCase()).sort().join(',');
          if (rawGM(parsedA) !== rawGM(parsedB)) fmt = 'gmFormat';
        }
        if (!fmt && !rules.ignoreCase && strip(codeA) !== strip(codeB) && strip(codeA).toUpperCase() === strip(codeB).toUpperCase()) fmt = 'case';
        if (!fmt && !rules.ignoreWhitespace && strip(codeA) === strip(codeB)) fmt = 'whitespace';
        if (fmt) {
          tokenDiffs.push({ field: fmt, severity: 'minor', leftVal: codeA, rightVal: codeB,
            leftTokens: [], rightTokens: [] });
        }
      }
    }

    // Overall severity: workoffset > critical > coordinate-z > coordinate > minor
    let severity = 'equal';
    if (tokenDiffs.length > 0) {
      const has = sev => tokenDiffs.some(d => d.severity === sev);
      if (has('workoffset')) severity = 'workoffset';
      else if (has('critical')) severity = 'critical';
      else if (has('coordinate-z')) severity = 'coordinate-z';
      else if (has('coordinate')) severity = 'coordinate';
      else severity = 'minor';
    }

    return { severity, tokenDiffs };
  }

  /**
   * Rule for one-sided lines (added/removed): does the line carry content that
   * must surface even inside a hidden toolpath? Same rule set as classifyTokens,
   * applied against an empty line.
   */
  function hasCriticalContent(parsed, rules) {
    if (parsed.isBlank) return false;
    const empty = parseGCodeLine('');
    const { tokenDiffs } = classifyTokens(parsed, empty, rules);
    // Plain motion (axes, arcs, motion mode) does not count: hiding a toolpath
    // should still hide its re-posted moves.
    return tokenDiffs.some(d => (d.severity === 'critical' || d.severity === 'workoffset') &&
      d.field !== 'motion' && !d.field.startsWith('axis-') && !d.field.startsWith('arc-'));
  }

  function hasWorkOffset(parsed) {
    return parsed.gCodes.some(isWorkOffsetCode) || isOffsetSetLine(parsed);
  }

  // Letters where a missing decimal point can change the value (setting decimalPointMatters)
  const DECIMAL_LETTERS = ['X', 'Y', 'Z', 'A', 'B', 'C', 'I', 'J', 'K', 'R', 'Q'];
  // G10 (write offset), G52 (local shift), G92 (preset; only with axis words —
  // on Brother turning G92 S.. Q.. is a spindle clamp)
  const OFFSET_SET_CODES = new Set([10, 52, 92]);

  function isOffsetSetLine(p) {
    return p.gCodes.some(g => {
      const n = codeNum(g);
      if (n === 10 || n === 52) return true;
      return n === 92 && Object.keys(p.axes).length + Object.keys(p.rotary).length > 0;
    });
  }

  /** A line where an axis/F word means "go here": no homing, cycles, offsets or macros. */
  function isPlainMoveLine(p, modal) {
    if (p.isMacroStatement) return false;
    if (CANNED_CODES.has(codeNum(modal || ''))) return false;
    return !p.gCodes.some(g => { const n = codeNum(g); return POSITION_RESET_G.has(n) || CANNED_CODES.has(n); });
  }

  /** True when value v equals the value already active before this line. */
  function sameAsActive(ctx, letter, v) {
    if (!ctx || !ctx.prev) return false;
    const a = ctx.prev[letter];
    return !Number.isNaN(a) && a !== undefined && Math.abs(a - v) <= FP_EPS;
  }

  function redundantDiff(letter, tType, parsedA, parsedB) {
    const pick = p => p.tokens.filter(t => t.type === tType && (tType === 'feed' || t.axis === letter));
    return { field: 'redundant-' + letter, severity: 'minor',
      leftVal: null, rightVal: null, leftTokens: pick(parsedA), rightTokens: pick(parsedB) };
  }

  /** 5. / 5.0 / 05 -> 5 inside macro text, so number format does not count as a change. */
  function normMacroNumbers(text) {
    return text.replace(/\d+\.\d*|\.\d+|\d+/g, m => String(parseFloat(m)));
  }

  function compareField(parsedA, parsedB, field, severity, tokenDiffs) {
    const va = parsedA[field];
    const vb = parsedB[field];
    if (va === null && vb === null) return;
    if (va === null || vb === null || Math.abs(va - vb) > FP_EPS) {
      tokenDiffs.push({ field, severity, leftVal: va, rightVal: vb,
        leftTokens: parsedA.tokens.filter(t => t.type === field),
        rightTokens: parsedB.tokens.filter(t => t.type === field) });
    }
  }

  // =====================================================
  // Tolerance Classification
  // =====================================================

  /**
   * Grade coordinate diffs using tolerance thresholds (max delta on the line):
   * - <= minorThreshold -> 'tolerance' (hidden while the toolpath's TOL is on;
   *                        shown as minor when TOL is off)
   * - <= majorThreshold -> 'minor' (amber)
   * - >  majorThreshold -> 'critical' (red, always surfaces)
   * Lines that already have a critical/work-offset diff are never downgraded.
   * Missing-axis diffs are already critical in classifyTokens.
   */
  function applyToleranceClassification(ops, minorThreshold, majorThreshold) {
    for (const op of ops) {
      if (op.type !== 'coordinate' && op.type !== 'coordinate-z') continue;

      let maxDelta = 0;
      for (const cd of op.tokenDiffs) {
        if ((cd.severity === 'coordinate' || cd.severity === 'coordinate-z') && cd.delta > maxDelta) {
          maxDelta = cd.delta;
        }
      }
      op.maxDelta = maxDelta;
      const hasMinorDiff = op.tokenDiffs.some(d => d.severity === 'minor');

      if (maxDelta > majorThreshold + FP_EPS) {
        op.type = 'critical';
        op.overMajor = true;
      } else if (maxDelta > minorThreshold + FP_EPS || hasMinorDiff) {
        op.type = 'minor';
      } else {
        op.type = 'tolerance';
      }
    }
  }

  // =====================================================
  // LCS Infrastructure
  // =====================================================

  // Above this many DP cells (left x right lines), use Myers diff instead
  // of the full table, so huge toolpaths don't freeze or crash the browser.
  const MAX_DP_CELLS = 4000000;
  const MAX_MYERS_D = 2000;

  /** Plain LCS table (used for small lists like toolpath keys). */
  function buildLCSTable(leftArr, rightArr, n, m) {
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (leftArr[i - 1] === rightArr[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
        else dp[i][j] = dp[i - 1][j] > dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
      }
    }
    return dp;
  }

  function backtrackLCS(leftArr, rightArr, dp, n, m) {
    const ops = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && leftArr[i - 1] === rightArr[j - 1]) {
        ops.push({ type: 'equal', leftIdx: i - 1, rightIdx: j - 1 });
        i--; j--;
      } else if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) {
        ops.push({ type: 'removed', leftIdx: i - 1 });
        i--;
      } else {
        ops.push({ type: 'added', rightIdx: j - 1 });
        j--;
      }
    }
    return ops.reverse();
  }

  /**
   * Weighted LCS: lines with identical text score 2, lines with the same
   * structure (fingerprint) score 1. Prefers exact matches, so an inserted
   * move lines up correctly instead of shifting the pairing by one.
   */
  function weightedAlign(fpA, fpB, keyA, keyB) {
    const n = fpA.length, m = fpB.length, W = m + 1;
    const dp = new Int32Array((n + 1) * (m + 1));
    const w = (i, j) => keyA[i] === keyB[j] ? 2 : (fpA[i] === fpB[j] ? 1 : 0);
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const up = dp[(i - 1) * W + j], left = dp[i * W + j - 1];
        let best = up > left ? up : left;
        const ww = w(i - 1, j - 1);
        if (ww > 0) {
          const diag = dp[(i - 1) * W + j - 1] + ww;
          if (diag > best) best = diag;
        }
        dp[i * W + j] = best;
      }
    }
    const ops = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0) {
        const ww = w(i - 1, j - 1);
        if (ww > 0 && dp[i * W + j] === dp[(i - 1) * W + j - 1] + ww) {
          ops.push({ type: 'equal', leftIdx: i - 1, rightIdx: j - 1 });
          i--; j--; continue;
        }
      }
      if (i > 0 && (j === 0 || dp[(i - 1) * W + j] >= dp[i * W + j - 1])) {
        ops.push({ type: 'removed', leftIdx: i - 1 }); i--;
      } else {
        ops.push({ type: 'added', rightIdx: j - 1 }); j--;
      }
    }
    return ops.reverse();
  }

  /**
   * Myers O(ND) diff. Fast when the two lists are mostly the same.
   * Returns null if more than maxD edits are needed.
   */
  function myersAlign(a, b, maxD) {
    const N = a.length, M = b.length;
    const off = maxD + 1;
    const V = new Int32Array(2 * maxD + 3);
    const trace = [];
    let found = -1;
    for (let d = 0; d <= maxD && found < 0; d++) {
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && a[x] === b[y]) { x++; y++; }
        V[off + k] = x;
        if (x >= N && y >= M) { found = d; break; }
      }
      trace.push(V.slice(off - d, off + d + 1)); // values for k = -d..d
    }
    if (found < 0) return null;

    const ops = [];
    let x = N, y = M;
    for (let d = found; d > 0; d--) {
      const prev = trace[d - 1]; // k = -(d-1)..(d-1), index k + d - 1
      const get = k => prev[k + d - 1];
      const k = x - y;
      const prevK = (k === -d || (k !== d && get(k - 1) < get(k + 1))) ? k + 1 : k - 1;
      const prevX = get(prevK), prevY = prevX - prevK;
      while (x > prevX && y > prevY) { ops.push({ type: 'equal', leftIdx: x - 1, rightIdx: y - 1 }); x--; y--; }
      if (prevK === k + 1) ops.push({ type: 'added', rightIdx: prevY });
      else ops.push({ type: 'removed', leftIdx: prevX });
      x = prevX; y = prevY;
    }
    while (x > 0 && y > 0) { ops.push({ type: 'equal', leftIdx: x - 1, rightIdx: y - 1 }); x--; y--; }
    return ops.reverse();
  }

  /**
   * Line up two segments. Steps:
   * 1. Identical lines at the start and end are matched directly.
   * 2. The middle uses weighted LCS when small enough.
   * 3. Otherwise Myers on exact text, then Myers on structure.
   * 4. Last resort: pair lines in order (every line still gets compared).
   */
  function alignLines(fpA, fpB, keyA, keyB) {
    const n = fpA.length, m = fpB.length;
    let pre = 0;
    while (pre < n && pre < m && keyA[pre] === keyB[pre]) pre++;
    let suf = 0;
    while (suf < n - pre && suf < m - pre && keyA[n - 1 - suf] === keyB[m - 1 - suf]) suf++;

    const ops = [];
    for (let i = 0; i < pre; i++) ops.push({ type: 'equal', leftIdx: i, rightIdx: i });

    const fa = fpA.slice(pre, n - suf), fb = fpB.slice(pre, m - suf);
    const ka = keyA.slice(pre, n - suf), kb = keyB.slice(pre, m - suf);
    let mid;
    if (fa.length * fb.length <= MAX_DP_CELLS) mid = weightedAlign(fa, fb, ka, kb);
    else mid = myersAlign(ka, kb, MAX_MYERS_D) || myersAlign(fa, fb, MAX_MYERS_D);
    if (!mid) {
      mid = [];
      const common = Math.min(fa.length, fb.length);
      for (let i = 0; i < common; i++) mid.push({ type: 'equal', leftIdx: i, rightIdx: i });
      for (let i = common; i < fa.length; i++) mid.push({ type: 'removed', leftIdx: i });
      for (let j = common; j < fb.length; j++) mid.push({ type: 'added', rightIdx: j });
    }
    for (const op of mid) {
      if (op.leftIdx !== undefined) op.leftIdx += pre;
      if (op.rightIdx !== undefined) op.rightIdx += pre;
      ops.push(op);
    }
    for (let i = suf; i > 0; i--) ops.push({ type: 'equal', leftIdx: n - i, rightIdx: m - i });
    return ops;
  }

  /** Exact-text key for a line (whitespace removed, uppercased). */
  function lineKey(parsed) {
    return (parsed.raw || '').replace(/\s+/g, '').toUpperCase();
  }

  // =====================================================
  // Toolpath Matching
  // =====================================================

  function tpKey(tp) {
    if (tp.type === 'preamble') return 'PREAMBLE';
    if (tp.type === 'program_end') return 'PROGRAM_END';
    // Operation name + tool, so old-layout and new-layout files of the same job match
    return (tp.name || '').toUpperCase() + '|T' + tp.toolNumber;
  }

  /**
   * Compute content similarity (0–1) between two toolpath sections
   * using LCS on line fingerprints.
   */
  function computeToolpathSimilarity(leftTP, rightTP, leftParsed, rightParsed, rules) {
    const leftFP = [];
    for (let i = leftTP.startLine; i <= leftTP.endLine; i++) {
      if (leftParsed[i].isBlank) continue;
      leftFP.push(fingerprint(leftParsed[i], rules, null));
    }
    const rightFP = [];
    for (let i = rightTP.startLine; i <= rightTP.endLine; i++) {
      if (rightParsed[i].isBlank) continue;
      rightFP.push(fingerprint(rightParsed[i], rules, null));
    }

    if (leftFP.length === 0 && rightFP.length === 0) return 1.0;
    if (leftFP.length === 0 || rightFP.length === 0) return 0.0;
    const maxLen = Math.max(leftFP.length, rightFP.length);

    if (leftFP.length * rightFP.length > MAX_DP_CELLS) {
      // Large toolpaths: count shared line shapes instead of full LCS
      const counts = new Map();
      for (const f of leftFP) counts.set(f, (counts.get(f) || 0) + 1);
      let shared = 0;
      for (const f of rightFP) {
        const c = counts.get(f);
        if (c) { shared++; counts.set(f, c - 1); }
      }
      return shared / maxLen;
    }

    const dp = buildLCSTable(leftFP, rightFP, leftFP.length, rightFP.length);
    return dp[leftFP.length][rightFP.length] / maxLen;
  }

  /** Indices (into arr) of one longest strictly increasing subsequence. */
  function longestIncreasing(arr) {
    const n = arr.length;
    const len = new Array(n).fill(1), prev = new Array(n).fill(-1);
    let best = -1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        if (arr[j] < arr[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
      }
      if (best < 0 || len[i] > len[best]) best = i;
    }
    const out = new Set();
    for (let i = best; i >= 0; i = prev[i]) out.add(i);
    return out;
  }

  function matchToolpaths(leftTPs, rightTPs, leftParsed, rightParsed, rules) {
    const SIMILARITY_THRESHOLD = 0.5;

    // --- Pass 1: Key-based LCS matching ---
    const leftKeys = leftTPs.map(tp => tpKey(tp));
    const rightKeys = rightTPs.map(tp => tpKey(tp));

    const dp = buildLCSTable(leftKeys, rightKeys, leftKeys.length, rightKeys.length);
    const tpOps = backtrackLCS(leftKeys, rightKeys, dp, leftKeys.length, rightKeys.length);

    const keyMatched = [];
    const leftMatched = new Set();
    const rightMatched = new Set();

    for (const op of tpOps) {
      if (op.type === 'equal') {
        keyMatched.push({ left: leftTPs[op.leftIdx], right: rightTPs[op.rightIdx] });
        leftMatched.add(op.leftIdx);
        rightMatched.add(op.rightIdx);
      }
    }

    const unmatchedLeft = new Set();
    const unmatchedRight = new Set();
    for (let i = 0; i < leftTPs.length; i++) {
      if (!leftMatched.has(i)) unmatchedLeft.add(i);
    }
    for (let i = 0; i < rightTPs.length; i++) {
      if (!rightMatched.has(i)) unmatchedRight.add(i);
    }

    // --- Pass 1b: Refine duplicate-key matches by content similarity ---
    // When multiple right TPs share the same key, LCS may pick the wrong one.
    // Check each key-matched pair: if unmatched right TPs have the same key,
    // compare content similarity and swap to the best match.
    for (let k = 0; k < keyMatched.length; k++) {
      const match = keyMatched[k];
      const matchKey = tpKey(match.left);
      // Find unmatched right TPs with the same key
      const sameKeyCandidates = [];
      for (const ri of unmatchedRight) {
        if (tpKey(rightTPs[ri]) === matchKey) sameKeyCandidates.push(ri);
      }
      if (sameKeyCandidates.length === 0) continue;

      const currentRightIdx = rightTPs.indexOf(match.right);
      const currentScore = computeToolpathSimilarity(
        match.left, match.right, leftParsed, rightParsed, rules);

      let bestScore = currentScore;
      let bestRi = -1;
      for (const ri of sameKeyCandidates) {
        const score = computeToolpathSimilarity(
          match.left, rightTPs[ri], leftParsed, rightParsed, rules);
        if (score > bestScore) { bestScore = score; bestRi = ri; }
      }

      if (bestRi >= 0) {
        // Swap: unmatch current right, match the better candidate
        unmatchedRight.add(currentRightIdx);
        rightMatched.delete(currentRightIdx);
        unmatchedRight.delete(bestRi);
        rightMatched.add(bestRi);
        keyMatched[k] = { left: match.left, right: rightTPs[bestRi] };
      }
    }

    // --- Pass 2: Content similarity fallback ---
    const simMatched = [];

    if (unmatchedLeft.size > 0 && unmatchedRight.size > 0) {
      const pairs = [];
      for (const li of unmatchedLeft) {
        for (const ri of unmatchedRight) {
          let score = computeToolpathSimilarity(
            leftTPs[li], rightTPs[ri], leftParsed, rightParsed, rules
          );
          // Tool number boost
          if (leftTPs[li].toolNumber !== null && leftTPs[li].toolNumber === rightTPs[ri].toolNumber) {
            score = Math.min(1.0, score + 0.1);
          }
          if (score >= SIMILARITY_THRESHOLD) {
            pairs.push({ li, ri, score });
          }
        }
      }

      // Greedy match: highest score first
      pairs.sort((a, b) => b.score - a.score);
      const usedLeft = new Set();
      const usedRight = new Set();
      for (const p of pairs) {
        if (usedLeft.has(p.li) || usedRight.has(p.ri)) continue;
        simMatched.push({ left: leftTPs[p.li], right: rightTPs[p.ri] });
        usedLeft.add(p.li);
        usedRight.add(p.ri);
        unmatchedLeft.delete(p.li);
        unmatchedRight.delete(p.ri);
      }
    }

    // --- Merge in file order ---
    // Pairs must not cross (left order and right order must agree), otherwise
    // the two panes cannot line up. Keep the largest non-crossing set
    // (longest increasing run of right indices); crossed pairs become unmatched.
    const leftIndex = new Map(leftTPs.map((tp, i) => [tp, i]));
    const rightIndex = new Map(rightTPs.map((tp, i) => [tp, i]));
    const pairs = keyMatched.concat(simMatched)
      .map(m => ({ li: leftIndex.get(m.left), ri: rightIndex.get(m.right), m }))
      .sort((a, b) => a.li - b.li);

    const keep = longestIncreasing(pairs.map(p => p.ri));
    const kept = [];
    pairs.forEach((p, idx) => {
      if (keep.has(idx)) kept.push(p);
      else { unmatchedLeft.add(p.li); unmatchedRight.add(p.ri); }
    });

    // Walk both files together; unmatched toolpaths go just before the next
    // matched pair that follows them in their own file.
    const allEntries = [];
    const ul = [...unmatchedLeft].sort((a, b) => a - b);
    const ur = [...unmatchedRight].sort((a, b) => a - b);
    let a = 0, b = 0;
    for (const p of kept) {
      while (a < ul.length && ul[a] < p.li) allEntries.push({ left: leftTPs[ul[a++]], right: null });
      while (b < ur.length && ur[b] < p.ri) allEntries.push({ left: null, right: rightTPs[ur[b++]] });
      allEntries.push(p.m);
    }
    while (a < ul.length) allEntries.push({ left: leftTPs[ul[a++]], right: null });
    while (b < ur.length) allEntries.push({ left: null, right: rightTPs[ur[b++]] });

    return allEntries;
  }

  // =====================================================
  // Main Semantic Diff — Anchor-Based Segmented LCS
  // =====================================================

  function computeSemanticDiff(leftLines, rightLines, opts) {
    const rules = opts.rules || {};
    const minorThreshold = opts.minorThreshold || 0.001;
    const majorThreshold = opts.majorThreshold || 0.01;

    // Parse all lines
    const leftParsed = leftLines.map(l => parseGCodeLine(l));
    const rightParsed = rightLines.map(l => parseGCodeLine(l));

    // Track modal G-code state per file
    const leftModal = trackModalState(leftParsed);
    const rightModal = trackModalState(rightParsed);
    // G90/G91, last position and modal F per line; GOTO jump labels
    const leftTrack = trackContext(leftParsed, leftModal);
    const rightTrack = trackContext(rightParsed, rightModal);
    markJumpTargets(leftParsed);
    markJumpTargets(rightParsed);

    // Segment into toolpaths
    const leftToolpaths = segmentIntoToolpaths(leftLines, leftParsed);
    const rightToolpaths = segmentIntoToolpaths(rightLines, rightParsed);

    // Match toolpaths between files (two-tier: key-based then content similarity)
    const tpMatches = matchToolpaths(leftToolpaths, rightToolpaths, leftParsed, rightParsed, rules);

    const allOps = [];

    for (const match of tpMatches) {
      if (match.left && match.right) {
        // Build fingerprints for this segment only
        const segLeftFP = [], segLeftKey = [], segLeftIdxMap = [];
        for (let i = match.left.startLine; i <= match.left.endLine; i++) {
          if (leftParsed[i].isBlank) continue;
          segLeftFP.push(fingerprint(leftParsed[i], rules, leftModal[i]));
          segLeftKey.push(lineKey(leftParsed[i]));
          segLeftIdxMap.push(i);
        }
        const segRightFP = [], segRightKey = [], segRightIdxMap = [];
        for (let i = match.right.startLine; i <= match.right.endLine; i++) {
          if (rightParsed[i].isBlank) continue;
          segRightFP.push(fingerprint(rightParsed[i], rules, rightModal[i]));
          segRightKey.push(lineKey(rightParsed[i]));
          segRightIdxMap.push(i);
        }

        if (segLeftFP.length === 0 && segRightFP.length === 0) continue;

        const rawOps = alignLines(segLeftFP, segRightFP, segLeftKey, segRightKey);

        // classifyOps — index maps already point to real line indices
        const segOps = classifyOps(rawOps, leftLines, leftParsed, rightLines, rightParsed,
                                    segLeftIdxMap, segRightIdxMap, rules, leftModal, rightModal,
                                    leftTrack, rightTrack);
        allOps.push(...segOps);

      } else if (match.left) {
        // Entire toolpath removed
        for (let i = match.left.startLine; i <= match.left.endLine; i++) {
          if (leftParsed[i].isBlank) continue;
          allOps.push(oneSidedOp('removed', i, leftLines, leftParsed, rules));
        }
      } else {
        // Entire toolpath added
        for (let i = match.right.startLine; i <= match.right.endLine; i++) {
          if (rightParsed[i].isBlank) continue;
          allOps.push(oneSidedOp('added', i, rightLines, rightParsed, rules));
        }
      }
    }

    // Grade coordinate diffs by tolerance
    applyToleranceClassification(allOps, minorThreshold, majorThreshold);

    // alwaysShow: the diff must surface even inside a hidden toolpath
    for (const op of allOps) {
      if (op.type === 'critical' || op.type === 'workoffset') op.alwaysShow = true;
    }

    return { ops: allOps, leftToolpaths, rightToolpaths, tpMatches, leftParsed, rightParsed };
  }

  /** Word letters used on a line, e.g. "G1 X1. F10." -> {G, X, F}. */
  function wordLetters(parsed) {
    const set = new Set();
    for (const t of parsed.tokens) {
      if (t.type === 'comment' || t.type === 'lineNumber' || t.type === 'blockDelete') continue;
      if (t.type === 'macro') set.add('#');
      else set.add(t.text[0].toUpperCase());
    }
    return set;
  }

  /** Two lines are the same kind if they share at least half their word letters. */
  function sameKind(pa, pb) {
    if (pa.isCommentOnly && pb.isCommentOnly) return true;
    const a = wordLetters(pa), b = wordLetters(pb);
    if (a.size === 0 || b.size === 0) return false;
    let shared = 0;
    for (const x of a) if (b.has(x)) shared++;
    return shared / Math.max(a.size, b.size) >= 0.5;
  }

  /**
   * modal is passed only for lines inside a matched toolpath: there an added
   * or removed rapid (G0) move always shows, even when the toolpath is hidden.
   */
  function oneSidedOp(type, idx, lines, parsed, rules, modal) {
    const op = type === 'added'
      ? { type, rightIdx: idx, rightLine: lines[idx] }
      : { type, leftIdx: idx, leftLine: lines[idx] };
    if (hasCriticalContent(parsed[idx], rules)) op.alwaysShow = true;
    if (modal && modal[idx] === 'G0' &&
        Object.keys(parsed[idx].axes).length + Object.keys(parsed[idx].rotary).length > 0) {
      op.alwaysShow = true;
      op.rapid = true;
    }
    if (hasWorkOffset(parsed[idx])) op.workOffset = true;
    return op;
  }

  function classifyOps(rawOps, leftLines, leftParsed, rightLines, rightParsed, leftIdxMap, rightIdxMap, rules, leftModal, rightModal, leftTrack, rightTrack) {
    const result = [];
    let i = 0;

    while (i < rawOps.length) {
      if (rawOps[i].type === 'equal') {
        const li = leftIdxMap[rawOps[i].leftIdx];
        const ri = rightIdxMap[rawOps[i].rightIdx];
        const classification = classifyTokens(leftParsed[li], rightParsed[ri], rules, leftModal[li], rightModal[ri],
          lineContext(leftTrack, li), lineContext(rightTrack, ri));
        if (classification.severity === 'equal') {
          result.push({ type: 'equal', leftIdx: li, rightIdx: ri,
                        leftLine: leftLines[li], rightLine: rightLines[ri] });
        } else {
          result.push({
            type: classification.severity,
            leftIdx: li, rightIdx: ri,
            leftLine: leftLines[li], rightLine: rightLines[ri],
            tokenDiffs: classification.tokenDiffs
          });
        }
        i++;
        continue;
      }

      // Collect contiguous removes/adds
      const removes = [];
      const adds = [];
      while (i < rawOps.length && rawOps[i].type !== 'equal') {
        if (rawOps[i].type === 'removed') removes.push(rawOps[i]);
        else adds.push(rawOps[i]);
        i++;
      }

      // Pair removed lines with added lines only when they are the same kind
      // of line (share most word letters). Unrelated lines stay as plain
      // removed / added instead of being compared against each other.
      let ai = 0, ri = 0;
      const emitRemoved = upTo => { for (; ri < upTo; ri++) { const li = leftIdxMap[removes[ri].leftIdx]; result.push(oneSidedOp('removed', li, leftLines, leftParsed, rules, leftModal)); } };
      const emitAdded = upTo => { for (; ai < upTo; ai++) { const rj = rightIdxMap[adds[ai].rightIdx]; result.push(oneSidedOp('added', rj, rightLines, rightParsed, rules, rightModal)); } };
      let searchFrom = 0;
      for (let r = 0; r < removes.length; r++) {
        const li = leftIdxMap[removes[r].leftIdx];
        let match = -1;
        for (let a = searchFrom; a < adds.length; a++) {
          if (sameKind(leftParsed[li], rightParsed[rightIdxMap[adds[a].rightIdx]])) { match = a; break; }
        }
        if (match < 0) continue;
        emitRemoved(r);
        emitAdded(match);
        const rj = rightIdxMap[adds[match].rightIdx];
        const classification = classifyTokens(leftParsed[li], rightParsed[rj], rules, leftModal[li], rightModal[rj],
          lineContext(leftTrack, li), lineContext(rightTrack, rj));
        result.push({
          type: classification.severity,
          leftIdx: li, rightIdx: rj,
          leftLine: leftLines[li], rightLine: rightLines[rj],
          tokenDiffs: classification.tokenDiffs
        });
        ri = r + 1; ai = match + 1; searchFrom = match + 1;
      }
      emitRemoved(removes.length);
      emitAdded(adds.length);
    }

    return result;
  }

  // =====================================================
  // Stats
  // =====================================================

  function countStats(diffResult) {
    let critical = 0, added = 0, removed = 0, minor = 0;
    for (const op of diffResult) {
      if (op.type === 'critical' || op.type === 'workoffset') critical++;
      else if (op.type === 'minor') minor++;
      else if (op.type === 'added') added++;
      else if (op.type === 'removed') removed++;
    }
    return { critical, minor, added, removed };
  }

  // =====================================================
  // Exports
  // =====================================================

  return {
    parseGCodeLine,
    fingerprint,
    classifyTokens,
    hasCriticalContent,
    segmentIntoSections,
    segmentIntoToolpaths,
    trackModalState,
    trackContext,
    computeSemanticDiff,
    countStats
  };
})();
