/**
 * G-Code Semantic Diff Engine
 * Token-aware parsing, whole-file LCS, modal state fingerprints, and noise detection.
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
   * Detect toolpath boundaries using N## G100 T## anchor lines.
   * Falls back to comment-based segmentation if no anchors found.
   * Returns array of toolpath objects with metadata.
   */
  function segmentIntoToolpaths(lines, parsedLines) {
    // Pass 1: Find anchor lines (G100 T##)
    // Must have T## (tool call) + G100 + significant context (S##, X/Y axes, or M03/M04)
    // This distinguishes real toolpath starts from park-at-end moves like bare "G100 T51"
    const anchors = [];
    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      if (p.tool !== null) {
        const hasG100 = p.gCodes.some(g => {
          const num = parseFloat(g.replace(/^G/i, ''));
          return num === 100;
        });
        if (hasG100) {
          // Must have spindle speed, X/Y position, or M03/M04 to be a real toolpath start
          const hasXY = p.axes.X !== undefined || p.axes.Y !== undefined;
          const hasSpin = p.spindle !== null;
          const hasM03M04 = p.mCodes.some(m => {
            const num = parseFloat(m.replace(/^M/i, ''));
            return num === 3 || num === 4;
          });
          if (hasXY || hasSpin || hasM03M04) {
            anchors.push({
              lineIndex: i,
              toolNumber: p.tool,
              nNumber: p.lineNumber,
              spindleSpeed: p.spindle
            });
          }
        }
      }
    }

    // No anchors found — fall back to comment-based sections
    if (anchors.length === 0) {
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

    // Pass 2: Expand boundaries backward from each anchor
    const toolpaths = [];
    const PREAMBLE_CODES = new Set(['G28', 'G53', 'G90', 'G49', 'G69', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G53.1', 'G68.2']);
    const PREAMBLE_MCODES = new Set(['M05', 'M09', 'M298', 'M442', 'M443', 'M444', 'M445', 'M495', 'M01']);
    const CUTTING_GCODES = new Set([1, 2, 3]);

    for (let a = 0; a < anchors.length; a++) {
      const anchor = anchors[a];
      let preambleStart = anchor.lineIndex;

      // Walk backward to find where preamble begins
      const minLine = a > 0 ? anchors[a - 1].lineIndex + 1 : 0;
      const maxBack = Math.max(minLine, anchor.lineIndex - 40);

      for (let i = anchor.lineIndex - 1; i >= maxBack; i--) {
        const p = parsedLines[i];

        // Stop at cutting moves (G01/G02/G03 with axis values)
        if (p.gCodes.length > 0) {
          const hasCutting = p.gCodes.some(g => {
            const num = parseFloat(g.replace(/^G/i, ''));
            return CUTTING_GCODES.has(num);
          });
          if (hasCutting && Object.keys(p.axes).length > 0) break;
        }

        // Bare coordinate lines (no G/M) under modal G1/G2/G3 = cutting
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

      // Extract metadata from lines between preambleStart and anchor
      let name = '';
      let opType = '';
      let nameFound = false;
      for (let i = preambleStart; i < anchor.lineIndex; i++) {
        const p = parsedLines[i];
        if (p.isCommentOnly && p.comment && p.comment.length >= 8) {
          if (!nameFound) {
            name = p.comment;
            nameFound = true;
          } else if (!opType) {
            opType = p.comment;
          }
        }
      }

      toolpaths.push({
        id: toolpaths.length,
        type: 'toolpath',
        name,
        opType,
        toolNumber: anchor.toolNumber,
        nNumber: anchor.nNumber,
        spindleSpeed: anchor.spindleSpeed,
        startLine: preambleStart,
        anchorLine: anchor.lineIndex,
        endLine: lines.length - 1  // will be adjusted below
      });
    }

    // Adjust endLines: each toolpath ends where the next one's preamble starts
    for (let i = 0; i < toolpaths.length - 1; i++) {
      toolpaths[i].endLine = toolpaths[i + 1].startLine - 1;
    }
    if (toolpaths.length > 0) {
      toolpaths[toolpaths.length - 1].endLine = lines.length - 1;
    }

    // Add program preamble if first toolpath doesn't start at line 0
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
      for (let i = lastTp.endLine; i >= lastTp.anchorLine + 1; i--) {
        const p = parsedLines[i];
        if (p.mCodes.some(m => parseFloat(m.replace(/^M/i, '')) === 30)) {
          // Split: find where the end sequence starts (walk back from M30)
          let endStart = i;
          for (let j = i - 1; j > lastTp.anchorLine; j--) {
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
      tokenDiffs.push({ field: 'gCode', severity: 'critical', leftVal: gA, rightVal: gB,
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
  // Adaptive Noise Detection (with tolerance for non-noise sections)
  // =====================================================

  /**
   * Post-process diff ops with section-aware noise detection.
   * Noisy sections: coordinate diffs → 'noise' (rare Z stays critical)
   * Non-noisy sections: coordinate diffs classified by tolerance thresholds
   */
  function detectAdaptiveNoise(sectionOps, noiseThreshold, minorThreshold, majorThreshold) {
    let coordOnlyCount = 0;
    let modifiedCount = 0;
    let zOnlyCount = 0;

    for (const op of sectionOps) {
      if (op.type === 'equal') continue;
      if (op.type === 'added' || op.type === 'removed') {
        // Unpaired coord-only lines count toward noise threshold
        if (op.coordOnly) { modifiedCount++; coordOnlyCount++; }
        continue;
      }
      modifiedCount++;
      if (op.tokenDiffs) {
        const hasCritical = op.tokenDiffs.some(d => d.severity === 'critical');
        const hasCoord = op.tokenDiffs.some(d => d.severity === 'coordinate' || d.severity === 'coordinate-z');
        const onlyCoord = !hasCritical && hasCoord;
        const onlyZ = onlyCoord && op.tokenDiffs.every(d => d.severity === 'coordinate-z' || d.severity === 'equal');
        if (onlyCoord) coordOnlyCount++;
        if (onlyZ) zOnlyCount++;
      }
    }

    const isNoisy = coordOnlyCount >= noiseThreshold ||
                    (modifiedCount > 5 && coordOnlyCount / modifiedCount > 0.6);

    if (isNoisy) {
      // Noisy section: mark coordinate-only lines as noise, preserve rare Z
      const preserveZ = zOnlyCount <= 5;

      for (const op of sectionOps) {
        // Unpaired coord-only lines → noise-added / noise-removed
        if (op.type === 'added' && op.coordOnly) { op.type = 'noise-added'; continue; }
        if (op.type === 'removed' && op.coordOnly) { op.type = 'noise-removed'; continue; }

        if (!op.tokenDiffs) continue;
        const hasCritical = op.tokenDiffs.some(d => d.severity === 'critical');
        if (hasCritical) continue;

        const hasCoord = op.tokenDiffs.some(d => d.severity === 'coordinate' || d.severity === 'coordinate-z');
        const onlyZ = op.tokenDiffs.every(d => d.severity === 'coordinate-z' || d.severity === 'equal');

        if (hasCoord) {
          if (onlyZ && preserveZ) {
            op.type = 'critical';
          } else {
            op.type = 'noise';
          }
        }
      }
    } else {
      // Non-noisy section: apply tolerance thresholds to coordinate diffs
      applyToleranceClassification(sectionOps, minorThreshold, majorThreshold);
    }
  }

  /**
   * For non-noise sections, classify coordinate diffs using tolerance thresholds.
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
        // Missing axis on one side — keep as-is (critical by default)
        continue;
      }

      if (maxDelta <= minorThreshold + FP_EPS) {
        op.type = 'equal';
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
  // Main Semantic Diff — Whole-File LCS
  // =====================================================

  function computeSemanticDiff(leftLines, rightLines, opts) {
    const rules = opts.rules || {};
    const noiseThreshold = opts.noiseThreshold || 10;
    const suppressNoise = opts.suppressNoise !== false;
    const minorThreshold = opts.minorThreshold || 0.001;
    const majorThreshold = opts.majorThreshold || 0.01;

    // Parse all lines
    const leftParsed = leftLines.map(l => parseGCodeLine(l));
    const rightParsed = rightLines.map(l => parseGCodeLine(l));

    // Track modal G-code state per file
    const leftModal = trackModalState(leftParsed);
    const rightModal = trackModalState(rightParsed);

    // Build fingerprints for ALL non-blank lines (whole file)
    const leftFP = [];
    const rightFP = [];
    const leftIdxMap = [];
    const rightIdxMap = [];

    for (let i = 0; i < leftParsed.length; i++) {
      if (leftParsed[i].isBlank) continue;
      leftFP.push(fingerprint(leftParsed[i], rules, leftModal[i]));
      leftIdxMap.push(i);
    }
    for (let i = 0; i < rightParsed.length; i++) {
      if (rightParsed[i].isBlank) continue;
      rightFP.push(fingerprint(rightParsed[i], rules, rightModal[i]));
      rightIdxMap.push(i);
    }

    const n = leftFP.length;
    const m = rightFP.length;

    // Segment into toolpaths (for noise detection and UI)
    const leftToolpaths = segmentIntoToolpaths(leftLines, leftParsed);
    const rightToolpaths = segmentIntoToolpaths(rightLines, rightParsed);

    if (n === 0 && m === 0) return { ops: [], leftToolpaths, rightToolpaths };

    // Whole-file LCS on fingerprints
    const dp = buildLCSTable(leftFP, rightFP, n, m);
    const rawOps = backtrackLCS(leftFP, rightFP, dp, n, m);

    // Classify each op with token-level comparison
    const allOps = classifyOps(rawOps, leftLines, leftParsed, rightLines, rightParsed, leftIdxMap, rightIdxMap);

    // Post-process: apply noise detection per toolpath
    if (suppressNoise) {
      applyNoiseDetection(allOps, leftLines, leftParsed, rightLines, rightParsed,
        noiseThreshold, minorThreshold, majorThreshold, leftToolpaths, rightToolpaths);
    }

    return { ops: allOps, leftToolpaths, rightToolpaths };
  }

  /**
   * Convert raw LCS ops into classified diff ops with token diffs.
   * Groups consecutive removes/adds and pairs them for comparison.
   */
  /**
   * Returns true if a parsed line contains only axis/arc values (no G/M/T/F/S codes).
   * These are bare coordinate lines generated by adaptive/HEM toolpaths.
   */
  function isCoordOnlyLine(parsed) {
    if (!parsed || parsed.isBlank || parsed.isCommentOnly) return false;
    if (parsed.gCodes.length > 0 || parsed.mCodes.length > 0) return false;
    if (parsed.tool !== null || parsed.feed !== null || parsed.spindle !== null) return false;
    const hasAxes = Object.keys(parsed.axes).length > 0 || Object.keys(parsed.arcParams).length > 0;
    return hasAxes;
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
        result.push({ type: 'removed', leftIdx: li, leftLine: leftLines[li],
          coordOnly: isCoordOnlyLine(leftParsed[li]) });
      }
      for (let p = pairCount; p < adds.length; p++) {
        const ri = rightIdxMap[adds[p].rightIdx];
        result.push({ type: 'added', rightIdx: ri, rightLine: rightLines[ri],
          coordOnly: isCoordOnlyLine(rightParsed[ri]) });
      }
    }

    return result;
  }

  /**
   * Segment diff ops into sections based on left-side line indices,
   * then apply noise detection per section.
   */
  function applyNoiseDetection(allOps, leftLines, leftParsed, rightLines, rightParsed,
    noiseThreshold, minorThreshold, majorThreshold, leftToolpaths, rightToolpaths) {

    // Use toolpath boundaries for grouping
    const leftSections = leftToolpaths || segmentIntoToolpaths(leftLines, leftParsed);
    const rightSections = rightToolpaths || segmentIntoToolpaths(rightLines, rightParsed);

    function getSectionIdx(lineIdx, sections) {
      for (let s = sections.length - 1; s >= 0; s--) {
        if (lineIdx >= sections[s].startLine) return s;
      }
      return 0;
    }

    // Group ops by their toolpath section
    const sectionOpsMap = {};
    for (const op of allOps) {
      let sIdx;
      if (op.leftIdx !== undefined) {
        sIdx = 'L' + getSectionIdx(op.leftIdx, leftSections);
      } else {
        sIdx = 'R' + getSectionIdx(op.rightIdx, rightSections);
      }
      if (!sectionOpsMap[sIdx]) sectionOpsMap[sIdx] = [];
      sectionOpsMap[sIdx].push(op);
    }

    // Apply noise detection to each toolpath group
    for (const ops of Object.values(sectionOpsMap)) {
      detectAdaptiveNoise(ops, noiseThreshold, minorThreshold, majorThreshold);
    }
  }

  // =====================================================
  // Stats
  // =====================================================

  function countStats(diffResult) {
    let critical = 0, noise = 0, added = 0, removed = 0, minor = 0;
    for (const op of diffResult) {
      if (op.type === 'critical' || op.type === 'coordinate-z') critical++;
      else if (op.type === 'noise' || op.type === 'coordinate' || op.type === 'noise-added' || op.type === 'noise-removed') noise++;
      else if (op.type === 'minor') minor++;
      else if (op.type === 'added') added++;
      else if (op.type === 'removed') removed++;
    }
    return { critical, noise, minor, added, removed };
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
