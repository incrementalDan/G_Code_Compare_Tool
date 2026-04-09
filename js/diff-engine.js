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
      macros: [],
      lineNumber: null,
      blockDelete: false,
      isBlank: false,
      isCommentOnly: false,
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

    if (src[pos] === '/') {
      result.blockDelete = true;
      result.tokens.push({ type: 'blockDelete', text: '/', start: 0, end: 1 });
      pos = 1;
    }

    while (pos < len) {
      if (/\s/.test(src[pos])) { pos++; continue; }

      if (src[pos] === '(') {
        const end = src.indexOf(')', pos);
        const closePos = end >= 0 ? end + 1 : len;
        const text = src.substring(pos, closePos);
        const inner = text.replace(/^\(/, '').replace(/\)$/, '').trim();
        result.comment = result.comment ? result.comment + ' ' + inner : inner;
        result.tokens.push({ type: 'comment', text, start: pos, end: closePos });
        pos = closePos;
        continue;
      }

      if (src[pos] === ';') {
        const text = src.substring(pos);
        const inner = text.substring(1).trim();
        result.comment = result.comment ? result.comment + ' ' + inner : inner;
        result.tokens.push({ type: 'comment', text, start: pos, end: len });
        pos = len;
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
        pos++;
        continue;
      }

      if ((src[pos] === 'O' || src[pos] === 'o') && /\d/.test(src[pos + 1] || '')) {
        const m = src.substring(pos).match(/^[oO]\d+/);
        if (m) {
          result.tokens.push({ type: 'program', text: m[0], start: pos, end: pos + m[0].length });
          pos += m[0].length;
          continue;
        }
      }

      const tokenMatch = src.substring(pos).match(/^([a-zA-Z])(-?\d+\.?\d*)/);
      if (tokenMatch) {
        const letter = tokenMatch[1].toUpperCase();
        const numStr = tokenMatch[2];
        const num = parseFloat(numStr);
        const text = tokenMatch[0];
        const tStart = pos;
        const tEnd = pos + text.length;

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
            result.tokens.push({ type: 'axis', text, value: num, axis: letter, start: tStart, end: tEnd });
            break;
          case 'A': case 'B': case 'C':
            result.rotary[letter] = num;
            result.tokens.push({ type: 'rotary', text, value: num, axis: letter, start: tStart, end: tEnd });
            break;
          case 'I': case 'J': case 'K':
            result.arcParams[letter] = num;
            result.tokens.push({ type: 'arcParam', text, value: num, axis: letter, start: tStart, end: tEnd });
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
            result.tokens.push({ type: 'param', text, value: num, param: letter, start: tStart, end: tEnd });
            break;
          default:
            result.tokens.push({ type: 'other', text, value: num, start: tStart, end: tEnd });
        }
        pos = tEnd;
        continue;
      }

      pos++;
    }

    const nonCommentTokens = result.tokens.filter(t => t.type !== 'comment' && t.type !== 'lineNumber' && t.type !== 'blockDelete');
    result.isCommentOnly = nonCommentTokens.length === 0 && result.comment !== null;

    return result;
  }

  // =====================================================
  // Modal G-Code State Tracking
  // =====================================================

  const MODAL_MOTION_CODES = new Set([0, 1, 2, 3]);

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
    const PREAMBLE_MCODES = new Set(['M05', 'M09', 'M298', 'M442', 'M443', 'M444', 'M445', 'M495', 'M01', 'M141']);
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
          const norm = g.replace(/^G0*/i, 'G').toUpperCase();
          return PREAMBLE_CODES.has(norm);
        });
        const isPreambleM = p.mCodes.some(m => {
          const norm = m.replace(/^M0*/i, 'M').toUpperCase();
          return PREAMBLE_MCODES.has(norm);
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
      const name = ca.comments[0] || '';
      const opType = ca.comments.length > 1 ? ca.comments[1] : '';
      const toolNumber = g100 ? g100.toolNumber : prevToolNumber;
      const nNumber = g100 ? g100.nNumber : null;
      const spindleSpeed = g100 ? g100.spindleSpeed : null;
      const anchorLine = g100 ? g100.lineIndex : ca.commentStart;

      prevToolNumber = toolNumber;

      toolpaths.push({
        id: toolpaths.length,
        type: 'toolpath',
        name,
        opType,
        toolNumber,
        nNumber,
        spindleSpeed,
        startLine: preambleStart,
        anchorLine,
        endLine: lines.length - 1
      });
    }

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
    const PREAMBLE_MCODES = new Set(['M05', 'M09', 'M298', 'M442', 'M443', 'M444', 'M445', 'M495', 'M01', 'M141']);
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

        const isPreambleG = p.gCodes.some(g => PREAMBLE_CODES.has(g.replace(/^G0*/i, 'G').toUpperCase()));
        const isPreambleM = p.mCodes.some(m => PREAMBLE_MCODES.has(m.replace(/^M0*/i, 'M').toUpperCase()));
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

    // G-codes (normalized)
    for (const g of parsed.gCodes) {
      parts.push(rules.normalizeGMCodes ? g.replace(/([GM])0+(\d)/gi, '$1$2').toUpperCase() : g.toUpperCase());
    }
    // M-codes
    for (const m of parsed.mCodes) {
      parts.push(rules.normalizeGMCodes ? m.replace(/([GM])0+(\d)/gi, '$1$2').toUpperCase() : m.toUpperCase());
    }

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
    // Macros
    if (parsed.macros.length > 0) parts.push('#MACRO');
    // Comment-only lines get full text for precise matching
    if (parsed.isCommentOnly && parsed.comment) {
      const ct = rules.ignoreCase ? parsed.comment.toLowerCase() : parsed.comment;
      parts.push('(' + ct + ')');
    }

    return parts.join(' ') || '__EMPTY__';
  }

  // =====================================================
  // Token-Level Classification
  // =====================================================

  const FP_EPS = 1e-10;

  function classifyTokens(parsedA, parsedB) {
    const tokenDiffs = [];

    // Compare G-codes
    const gA = normalizeCodeSet(parsedA.gCodes);
    const gB = normalizeCodeSet(parsedB.gCodes);
    if (gA !== gB) {
      // Motion code interchange (G0/G1/G2/G3) is normal CAM behavior, not structural
      const isMotionOnly = (codes) => {
        if (!codes) return true;
        return codes.split(',').every(g => {
          const num = parseFloat(g.replace(/^G/i, ''));
          return num >= 0 && num <= 3;
        });
      };
      const severity = (isMotionOnly(gA) && isMotionOnly(gB)) ? 'minor' : 'critical';
      tokenDiffs.push({ field: 'gCode', severity, leftVal: gA, rightVal: gB,
        leftTokens: parsedA.tokens.filter(t => t.type === 'gCode'),
        rightTokens: parsedB.tokens.filter(t => t.type === 'gCode') });
    }

    // Compare M-codes
    const mA = normalizeCodeSet(parsedA.mCodes);
    const mB = normalizeCodeSet(parsedB.mCodes);
    if (mA !== mB) {
      tokenDiffs.push({ field: 'mCode', severity: 'critical', leftVal: mA, rightVal: mB,
        leftTokens: parsedA.tokens.filter(t => t.type === 'mCode'),
        rightTokens: parsedB.tokens.filter(t => t.type === 'mCode') });
    }

    // Compare critical single-value fields
    compareField(parsedA, parsedB, 'tool', 'critical', tokenDiffs);
    compareField(parsedA, parsedB, 'hOffset', 'critical', tokenDiffs);
    compareField(parsedA, parsedB, 'dOffset', 'critical', tokenDiffs);
    compareField(parsedA, parsedB, 'spindle', 'critical', tokenDiffs);
    compareField(parsedA, parsedB, 'feed', 'critical', tokenDiffs);

    // Compare axes
    for (const axis of ['X', 'Y', 'Z', 'A', 'B', 'C']) {
      const va = parsedA.axes[axis] ?? parsedA.rotary[axis] ?? null;
      const vb = parsedB.axes[axis] ?? parsedB.rotary[axis] ?? null;
      if (va === null && vb === null) continue;
      if (va === null || vb === null || Math.abs(va - vb) > FP_EPS) {
        const sev = axis === 'Z' ? 'coordinate-z' : 'coordinate';
        const tType = (axis === 'A' || axis === 'B' || axis === 'C') ? 'rotary' : 'axis';
        const delta = (va !== null && vb !== null) ? Math.abs(va - vb) : null;
        tokenDiffs.push({ field: 'axis-' + axis, severity: sev,
          leftVal: va, rightVal: vb, delta,
          leftTokens: parsedA.tokens.filter(t => (t.type === tType) && t.axis === axis),
          rightTokens: parsedB.tokens.filter(t => (t.type === tType) && t.axis === axis) });
      }
    }

    // Compare arc params
    for (const p of ['I', 'J', 'K']) {
      const va = parsedA.arcParams[p] ?? null;
      const vb = parsedB.arcParams[p] ?? null;
      if (va === null && vb === null) continue;
      if (va === null || vb === null || Math.abs(va - vb) > FP_EPS) {
        const delta = (va !== null && vb !== null) ? Math.abs(va - vb) : null;
        tokenDiffs.push({ field: 'arc-' + p, severity: 'coordinate',
          leftVal: va, rightVal: vb, delta,
          leftTokens: parsedA.tokens.filter(t => t.type === 'arcParam' && t.axis === p),
          rightTokens: parsedB.tokens.filter(t => t.type === 'arcParam' && t.axis === p) });
      }
    }

    // Compare comments
    if ((parsedA.comment || '') !== (parsedB.comment || '')) {
      tokenDiffs.push({ field: 'comment', severity: 'critical',
        leftVal: parsedA.comment, rightVal: parsedB.comment,
        leftTokens: parsedA.tokens.filter(t => t.type === 'comment'),
        rightTokens: parsedB.tokens.filter(t => t.type === 'comment') });
    }

    // Compare macros
    const macroA = parsedA.macros.join('|');
    const macroB = parsedB.macros.join('|');
    if (macroA !== macroB) {
      tokenDiffs.push({ field: 'macro', severity: 'critical',
        leftVal: macroA, rightVal: macroB,
        leftTokens: parsedA.tokens.filter(t => t.type === 'macro'),
        rightTokens: parsedB.tokens.filter(t => t.type === 'macro') });
    }

    // Compare other params (R, P, Q, L)
    const paramsA = parsedA.tokens.filter(t => t.type === 'param');
    const paramsB = parsedB.tokens.filter(t => t.type === 'param');
    const paramMapA = {};
    const paramMapB = {};
    for (const p of paramsA) paramMapA[p.param] = p.value;
    for (const p of paramsB) paramMapB[p.param] = p.value;
    const allParams = new Set([...Object.keys(paramMapA), ...Object.keys(paramMapB)]);
    for (const pk of allParams) {
      if (paramMapA[pk] !== paramMapB[pk]) {
        tokenDiffs.push({ field: 'param-' + pk, severity: 'critical',
          leftVal: paramMapA[pk], rightVal: paramMapB[pk],
          leftTokens: paramsA.filter(t => t.param === pk),
          rightTokens: paramsB.filter(t => t.param === pk) });
      }
    }

    // Determine overall severity
    let severity = 'equal';
    if (tokenDiffs.length > 0) {
      const hasCritical = tokenDiffs.some(d => d.severity === 'critical');
      const hasCoordZ = tokenDiffs.some(d => d.severity === 'coordinate-z');
      if (hasCritical) severity = 'critical';
      else if (hasCoordZ) severity = 'coordinate-z';
      else severity = 'coordinate';
    }

    return { severity, tokenDiffs };
  }

  function normalizeCodeSet(codes) {
    return codes.map(c => c.replace(/([GMT])0+(\d)/gi, '$1$2').toUpperCase()).sort().join(',');
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
   * Classify coordinate diffs using tolerance thresholds.
   * - All deltas within minorThreshold → 'equal' (invisible)
   * - Any delta within majorThreshold → 'minor' (amber)
   * - Any delta beyond majorThreshold → 'critical' (red)
   */
  function applyToleranceClassification(sectionOps, minorThreshold, majorThreshold) {
    for (const op of sectionOps) {
      if (!op.tokenDiffs) continue;
      const hasCritical = op.tokenDiffs.some(d => d.severity === 'critical');
      if (hasCritical) continue;

      const coordDiffs = op.tokenDiffs.filter(d =>
        d.severity === 'coordinate' || d.severity === 'coordinate-z'
      );
      if (coordDiffs.length === 0) continue;

      // Check max delta across all coordinate diffs on this line
      let maxDelta = 0;
      let allHaveDelta = true;
      for (const cd of coordDiffs) {
        if (cd.delta === null) {
          allHaveDelta = false;
          break;
        }
        if (cd.delta > maxDelta) maxDelta = cd.delta;
      }

      if (!allHaveDelta) {
        // Missing axis on one side — flag as critical
        op.type = 'critical';
        continue;
      }

      if (maxDelta <= minorThreshold + FP_EPS) {
        op.type = 'tolerance';
      } else if (maxDelta <= majorThreshold + FP_EPS) {
        op.type = 'minor';
      } else {
        op.type = 'critical';
      }
    }
  }

  // =====================================================
  // LCS Infrastructure
  // =====================================================

  function buildLCSTable(leftArr, rightArr, n, m) {
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      dp[i] = new Uint16Array(m + 1);
    }
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (leftArr[i - 1] === rightArr[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = dp[i - 1][j] > dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
        }
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

  // =====================================================
  // Toolpath Matching
  // =====================================================

  function tpKey(tp) {
    if (tp.type === 'preamble') return 'PREAMBLE';
    if (tp.type === 'program_end') return 'PROGRAM_END';
    return (tp.name || '') + '|' + (tp.opType || '') + '|T' + tp.toolNumber;
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

    const dp = buildLCSTable(leftFP, rightFP, leftFP.length, rightFP.length);
    const lcsLen = dp[leftFP.length][rightFP.length];
    return lcsLen / Math.max(leftFP.length, rightFP.length);
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

    // --- Merge all results in file-position order ---
    const allEntries = [];
    for (const m of keyMatched) allEntries.push(m);
    for (const m of simMatched) allEntries.push(m);
    for (const i of unmatchedLeft) allEntries.push({ left: leftTPs[i], right: null });
    for (const i of unmatchedRight) allEntries.push({ left: null, right: rightTPs[i] });

    allEntries.sort((a, b) => {
      const aPos = a.left ? a.left.startLine : a.right.startLine;
      const bPos = b.left ? b.left.startLine : b.right.startLine;
      return aPos - bPos;
    });

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

    // Segment into toolpaths
    const leftToolpaths = segmentIntoToolpaths(leftLines, leftParsed);
    const rightToolpaths = segmentIntoToolpaths(rightLines, rightParsed);

    // Match toolpaths between files (two-tier: key-based then content similarity)
    const tpMatches = matchToolpaths(leftToolpaths, rightToolpaths, leftParsed, rightParsed, rules);

    const allOps = [];

    for (const match of tpMatches) {
      if (match.left && match.right) {
        // Build fingerprints for this segment only
        const segLeftFP = [], segLeftIdxMap = [];
        for (let i = match.left.startLine; i <= match.left.endLine; i++) {
          if (leftParsed[i].isBlank) continue;
          segLeftFP.push(fingerprint(leftParsed[i], rules, leftModal[i]));
          segLeftIdxMap.push(i);
        }
        const segRightFP = [], segRightIdxMap = [];
        for (let i = match.right.startLine; i <= match.right.endLine; i++) {
          if (rightParsed[i].isBlank) continue;
          segRightFP.push(fingerprint(rightParsed[i], rules, rightModal[i]));
          segRightIdxMap.push(i);
        }

        if (segLeftFP.length === 0 && segRightFP.length === 0) continue;

        // Run LCS on this segment
        const dp = buildLCSTable(segLeftFP, segRightFP, segLeftFP.length, segRightFP.length);
        const rawOps = backtrackLCS(segLeftFP, segRightFP, dp, segLeftFP.length, segRightFP.length);

        // classifyOps — index maps already point to real line indices
        const segOps = classifyOps(rawOps, leftLines, leftParsed, rightLines, rightParsed,
                                    segLeftIdxMap, segRightIdxMap);
        allOps.push(...segOps);

      } else if (match.left) {
        // Entire toolpath removed
        for (let i = match.left.startLine; i <= match.left.endLine; i++) {
          if (leftParsed[i].isBlank) continue;
          allOps.push({ type: 'removed', leftIdx: i, leftLine: leftLines[i] });
        }
      } else {
        // Entire toolpath added
        for (let i = match.right.startLine; i <= match.right.endLine; i++) {
          if (rightParsed[i].isBlank) continue;
          allOps.push({ type: 'added', rightIdx: i, rightLine: rightLines[i] });
        }
      }
    }

    // Snapshot raw types before tolerance reclassification
    for (const op of allOps) op.rawType = op.type;

    // Post-process: apply tolerance classification to all coordinate diffs
    applyToleranceClassification(allOps, minorThreshold, majorThreshold);

    return { ops: allOps, leftToolpaths, rightToolpaths, tpMatches };
  }

  function classifyOps(rawOps, leftLines, leftParsed, rightLines, rightParsed, leftIdxMap, rightIdxMap) {
    const result = [];
    let i = 0;

    while (i < rawOps.length) {
      if (rawOps[i].type === 'equal') {
        const li = leftIdxMap[rawOps[i].leftIdx];
        const ri = rightIdxMap[rawOps[i].rightIdx];
        const classification = classifyTokens(leftParsed[li], rightParsed[ri]);
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

      // Pair removes with adds and classify
      const pairCount = Math.min(removes.length, adds.length);
      for (let p = 0; p < pairCount; p++) {
        const li = leftIdxMap[removes[p].leftIdx];
        const ri = rightIdxMap[adds[p].rightIdx];
        const classification = classifyTokens(leftParsed[li], rightParsed[ri]);
        const type = classification.severity === 'equal' ? 'equal' : classification.severity;
        result.push({
          type,
          leftIdx: li, rightIdx: ri,
          leftLine: leftLines[li], rightLine: rightLines[ri],
          tokenDiffs: classification.tokenDiffs
        });
      }

      for (let p = pairCount; p < removes.length; p++) {
        const li = leftIdxMap[removes[p].leftIdx];
        result.push({ type: 'removed', leftIdx: li, leftLine: leftLines[li] });
      }
      for (let p = pairCount; p < adds.length; p++) {
        const ri = rightIdxMap[adds[p].rightIdx];
        result.push({ type: 'added', rightIdx: ri, rightLine: rightLines[ri] });
      }
    }

    return result;
  }

  // =====================================================
  // Stats
  // =====================================================

  function countStats(diffResult) {
    let critical = 0, added = 0, removed = 0, minor = 0;
    for (const op of diffResult) {
      if (op.type === 'critical') critical++;
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
    segmentIntoSections,
    segmentIntoToolpaths,
    trackModalState,
    computeSemanticDiff,
    countStats
  };
})();
