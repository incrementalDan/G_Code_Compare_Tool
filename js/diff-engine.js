/**
 * G-Code Semantic Diff Engine
 * Token-aware parsing, section matching, structural LCS, and noise detection.
 */

const DiffEngine = (() => {

  // =====================================================
  // Token Parser
  // =====================================================

  /**
   * Parse a G-code line into semantic tokens.
   * Returns structured object with typed fields and raw token list.
   */
  function parseGCodeLine(line) {
    const result = {
      gCodes: [],
      mCodes: [],
      axes: {},       // X, Y, Z
      arcParams: {},  // I, J, K
      rotary: {},     // A, B, C
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
      tokens: []      // [{type, text, value, start, end}]
    };

    const trimmed = line.trim();
    if (!trimmed) {
      result.isBlank = true;
      return result;
    }

    let pos = 0;
    const src = line;
    const len = src.length;

    // Block delete
    if (src[pos] === '/') {
      result.blockDelete = true;
      result.tokens.push({ type: 'blockDelete', text: '/', start: 0, end: 1 });
      pos = 1;
    }

    while (pos < len) {
      // Skip whitespace
      if (/\s/.test(src[pos])) { pos++; continue; }

      // Parenthetical comment
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

      // Semicolon comment
      if (src[pos] === ';') {
        const text = src.substring(pos);
        const inner = text.substring(1).trim();
        result.comment = result.comment ? result.comment + ' ' + inner : inner;
        result.tokens.push({ type: 'comment', text, start: pos, end: len });
        pos = len;
        continue;
      }

      // Macro variable: #NNN or #[expr]
      if (src[pos] === '#') {
        const macroMatch = src.substring(pos).match(/^#\d+\s*=?\s*[^A-Z(;]*/i);
        if (macroMatch) {
          const text = macroMatch[0].trimEnd();
          result.macros.push(text);
          result.tokens.push({ type: 'macro', text, start: pos, end: pos + text.length });
          pos += text.length;
          continue;
        }
        // Simple #NNN reference
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

      // O-word (program number)
      if ((src[pos] === 'O' || src[pos] === 'o') && /\d/.test(src[pos + 1] || '')) {
        const m = src.substring(pos).match(/^[oO]\d+/);
        if (m) {
          result.tokens.push({ type: 'program', text: m[0], start: pos, end: pos + m[0].length });
          pos += m[0].length;
          continue;
        }
      }

      // Letter + number tokens
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

      // % or other single chars
      pos++;
    }

    // Determine if this is a comment-only line
    const nonCommentTokens = result.tokens.filter(t => t.type !== 'comment' && t.type !== 'lineNumber' && t.type !== 'blockDelete');
    result.isCommentOnly = nonCommentTokens.length === 0 && result.comment !== null;

    return result;
  }

  // =====================================================
  // Section Segmentation
  // =====================================================

  /**
   * Segment a file into toolpath sections based on comment headers.
   * A section header is a comment-only line with 10+ chars of comment text.
   */
  function segmentIntoSections(lines, parsedLines) {
    const sections = [];
    let currentSection = null;

    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];

      // Section header: comment-only line with substantial text
      if (p.isCommentOnly && p.comment && p.comment.length >= 10) {
        // Close previous section
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

    // Close last section
    if (currentSection) {
      currentSection.endLine = lines.length - 1;
      sections.push(currentSection);
    }

    // If no sections found, treat the whole file as one section
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

  /**
   * Match sections between two files by header text similarity.
   */
  function matchSections(leftSections, rightSections) {
    const matches = [];
    const usedRight = new Set();

    for (const ls of leftSections) {
      let bestMatch = null;
      let bestScore = 0;

      for (let ri = 0; ri < rightSections.length; ri++) {
        if (usedRight.has(ri)) continue;
        const rs = rightSections[ri];
        const score = headerSimilarity(ls.headerText, rs.headerText);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = ri;
        }
      }

      if (bestMatch !== null && bestScore > 0.4) {
        matches.push({ left: ls, right: rightSections[bestMatch], score: bestScore });
        usedRight.add(bestMatch);
      } else {
        matches.push({ left: ls, right: null });
      }
    }

    // Unmatched right sections
    for (let ri = 0; ri < rightSections.length; ri++) {
      if (!usedRight.has(ri)) {
        matches.push({ left: null, right: rightSections[ri] });
      }
    }

    return matches;
  }

  /**
   * Compute similarity between two header strings (0-1).
   * Uses longest common substring ratio.
   */
  function headerSimilarity(a, b) {
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    if (la === lb) return 1;

    // Longest common substring
    const n = la.length, m = lb.length;
    let maxLen = 0;
    let prev = new Uint16Array(m + 1);
    let curr = new Uint16Array(m + 1);

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (la[i - 1] === lb[j - 1]) {
          curr[j] = prev[j - 1] + 1;
          if (curr[j] > maxLen) maxLen = curr[j];
        } else {
          curr[j] = 0;
        }
      }
      [prev, curr] = [curr, prev];
      curr.fill(0);
    }

    return (maxLen * 2) / (n + m);
  }

  // =====================================================
  // Structural Fingerprints for LCS
  // =====================================================

  /**
   * Create a structural fingerprint for LCS matching.
   * Includes G/M codes and which axis letters are present, but NOT values.
   * This lets lines with same structure match even if coordinates differ.
   */
  function fingerprint(parsed, rules) {
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
    // Axis letters present (sorted)
    const axisLetters = Object.keys(parsed.axes).sort().join('');
    if (axisLetters) parts.push(axisLetters);
    // Arc params present
    const arcLetters = Object.keys(parsed.arcParams).sort().join('');
    if (arcLetters) parts.push(arcLetters);
    // Rotary present
    const rotaryLetters = Object.keys(parsed.rotary).sort().join('');
    if (rotaryLetters) parts.push(rotaryLetters);
    // F/S/T/H/D presence
    if (parsed.feed !== null) parts.push('F');
    if (parsed.spindle !== null) parts.push('S');
    if (parsed.tool !== null) parts.push('T');
    if (parsed.hOffset !== null) parts.push('H');
    if (parsed.dOffset !== null) parts.push('D');
    // Macros presence
    if (parsed.macros.length > 0) parts.push('#MACRO');
    // Comment (include text for comment-only lines so they match specifically)
    if (parsed.isCommentOnly && parsed.comment) {
      const ct = rules.ignoreCase ? parsed.comment.toLowerCase() : parsed.comment;
      parts.push('(' + ct + ')');
    }

    return parts.join(' ') || '__EMPTY__';
  }

  // =====================================================
  // Token-Level Classification
  // =====================================================

  // Token types that are always critical when they differ
  const CRITICAL_TYPES = new Set([
    'gCode', 'mCode', 'tool', 'hOffset', 'dOffset', 'spindle', 'feed', 'macro', 'comment'
  ]);

  // Token types that are coordinate noise candidates
  const COORDINATE_TYPES = new Set(['axis', 'arcParam', 'rotary']);

  /**
   * Compare two parsed lines token-by-token.
   * Returns { severity, tokenDiffs }
   */
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

    // Compare axes (coordinate — noise candidate)
    for (const axis of ['X', 'Y', 'Z', 'A', 'B', 'C']) {
      const va = parsedA.axes[axis] ?? parsedA.rotary[axis] ?? null;
      const vb = parsedB.axes[axis] ?? parsedB.rotary[axis] ?? null;
      if (va === null && vb === null) continue;
      if (va === null || vb === null || Math.abs(va - vb) > 1e-10) {
        const sev = axis === 'Z' ? 'coordinate-z' : 'coordinate';
        const tType = (axis === 'A' || axis === 'B' || axis === 'C') ? 'rotary' : 'axis';
        tokenDiffs.push({ field: 'axis-' + axis, severity: sev,
          leftVal: va, rightVal: vb,
          leftTokens: parsedA.tokens.filter(t => (t.type === tType) && t.axis === axis),
          rightTokens: parsedB.tokens.filter(t => (t.type === tType) && t.axis === axis) });
      }
    }

    // Compare arc params
    for (const p of ['I', 'J', 'K']) {
      const va = parsedA.arcParams[p] ?? null;
      const vb = parsedB.arcParams[p] ?? null;
      if (va === null && vb === null) continue;
      if (va === null || vb === null || Math.abs(va - vb) > 1e-10) {
        tokenDiffs.push({ field: 'arc-' + p, severity: 'coordinate',
          leftVal: va, rightVal: vb,
          leftTokens: parsedA.tokens.filter(t => t.type === 'arcParam' && t.axis === p),
          rightTokens: parsedB.tokens.filter(t => t.type === 'arcParam' && t.axis === p) });
      }
    }

    // Compare comments (presence and content)
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
    if (va === null || vb === null || Math.abs(va - vb) > 1e-10) {
      tokenDiffs.push({ field, severity, leftVal: va, rightVal: vb,
        leftTokens: parsedA.tokens.filter(t => t.type === field),
        rightTokens: parsedB.tokens.filter(t => t.type === field) });
    }
  }

  // =====================================================
  // Adaptive Noise Detection
  // =====================================================

  /**
   * Post-process a section's diff results.
   * If many lines only have coordinate changes, mark them as noise.
   * Rare Z-only changes stay critical.
   */
  function detectAdaptiveNoise(sectionOps, noiseThreshold) {
    // Count lines with only coordinate diffs vs any critical diffs
    let coordOnlyCount = 0;
    let modifiedCount = 0;
    let zOnlyCount = 0;

    for (const op of sectionOps) {
      if (op.type !== 'equal' && op.type !== 'added' && op.type !== 'removed') {
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
    }

    // If enough coordinate-only lines, mark them as noise
    const isNoisy = coordOnlyCount >= noiseThreshold ||
                    (modifiedCount > 5 && coordOnlyCount / modifiedCount > 0.6);

    if (!isNoisy) return;

    // Mark coordinate-only lines as noise, but preserve rare Z changes as critical
    const preserveZ = zOnlyCount <= 5;

    for (const op of sectionOps) {
      if (op.tokenDiffs) {
        const hasCritical = op.tokenDiffs.some(d => d.severity === 'critical');
        if (hasCritical) continue; // Don't touch lines with critical diffs

        const hasCoord = op.tokenDiffs.some(d => d.severity === 'coordinate' || d.severity === 'coordinate-z');
        const onlyZ = op.tokenDiffs.every(d => d.severity === 'coordinate-z');

        if (hasCoord) {
          if (onlyZ && preserveZ) {
            // Rare Z change — keep as critical
            op.type = 'critical';
          } else {
            // Adaptive noise — dim it
            op.type = 'noise';
          }
        }
      }
    }
  }

  // =====================================================
  // LCS infrastructure (reused for both old and new engine)
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
  // Main Semantic Diff
  // =====================================================

  /**
   * Compute a G-code-aware semantic diff.
   * opts: { rules, noiseThreshold, suppressNoise }
   */
  function computeSemanticDiff(leftLines, rightLines, opts) {
    const rules = opts.rules || {};
    const noiseThreshold = opts.noiseThreshold || 10;
    const suppressNoise = opts.suppressNoise !== false;

    // Parse all lines
    const leftParsed = leftLines.map(l => parseGCodeLine(l));
    const rightParsed = rightLines.map(l => parseGCodeLine(l));

    // Segment into sections
    const leftSections = segmentIntoSections(leftLines, leftParsed);
    const rightSections = segmentIntoSections(rightLines, rightParsed);

    // Match sections
    const sectionMatches = matchSections(leftSections, rightSections);

    // Diff within each matched section pair
    const allOps = [];

    for (const match of sectionMatches) {
      if (match.left && match.right) {
        // Both sides present — diff within section
        const ops = diffSection(
          leftLines, leftParsed, match.left,
          rightLines, rightParsed, match.right,
          rules
        );

        // Apply noise detection
        if (suppressNoise) {
          detectAdaptiveNoise(ops, noiseThreshold);
        }

        allOps.push(...ops);

      } else if (match.left) {
        // Section only on left — all removed
        for (let i = match.left.startLine; i <= match.left.endLine; i++) {
          if (!leftParsed[i].isBlank) {
            allOps.push({ type: 'removed', leftIdx: i, leftLine: leftLines[i] });
          }
        }
      } else if (match.right) {
        // Section only on right — all added
        for (let i = match.right.startLine; i <= match.right.endLine; i++) {
          if (!rightParsed[i].isBlank) {
            allOps.push({ type: 'added', rightIdx: i, rightLine: rightLines[i] });
          }
        }
      }
    }

    // Fill in any lines not covered by sections (shouldn't happen, but safety)
    // Sort ops by line index for proper ordering
    allOps.sort((a, b) => {
      const ai = a.leftIdx ?? a.rightIdx ?? 0;
      const bi = b.leftIdx ?? b.rightIdx ?? 0;
      return ai - bi;
    });

    return allOps;
  }

  /**
   * Diff two matched sections using structural fingerprint LCS.
   */
  function diffSection(leftLines, leftParsed, leftSection, rightLines, rightParsed, rightSection, rules) {
    // Extract section line ranges
    const lStart = leftSection.startLine;
    const lEnd = leftSection.endLine;
    const rStart = rightSection.startLine;
    const rEnd = rightSection.endLine;

    // Build fingerprints for this section's lines
    const leftFP = [];
    const rightFP = [];
    const leftIdxMap = []; // maps section-local index to global line index
    const rightIdxMap = [];

    for (let i = lStart; i <= lEnd; i++) {
      if (leftParsed[i].isBlank) continue; // skip blank lines
      leftFP.push(fingerprint(leftParsed[i], rules));
      leftIdxMap.push(i);
    }
    for (let i = rStart; i <= rEnd; i++) {
      if (rightParsed[i].isBlank) continue;
      rightFP.push(fingerprint(rightParsed[i], rules));
      rightIdxMap.push(i);
    }

    const n = leftFP.length;
    const m = rightFP.length;

    if (n === 0 && m === 0) return [];

    // LCS on fingerprints
    const dp = buildLCSTable(leftFP, rightFP, n, m);
    const rawOps = backtrackLCS(leftFP, rightFP, dp, n, m);

    // Group consecutive removes/adds and pair them
    const result = [];
    let i = 0;

    while (i < rawOps.length) {
      if (rawOps[i].type === 'equal') {
        const li = leftIdxMap[rawOps[i].leftIdx];
        const ri = rightIdxMap[rawOps[i].rightIdx];
        // Even "equal" fingerprints may have value differences
        const classification = classifyTokens(leftParsed[li], rightParsed[ri]);
        if (classification.severity === 'equal') {
          result.push({ type: 'equal', leftIdx: li, rightIdx: ri,
                        leftLine: leftLines[li], rightLine: rightLines[ri] });
        } else {
          result.push({
            type: classification.severity === 'critical' ? 'critical' : classification.severity,
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

      // Pair them and classify
      const pairCount = Math.min(removes.length, adds.length);
      for (let p = 0; p < pairCount; p++) {
        const li = leftIdxMap[removes[p].leftIdx];
        const ri = rightIdxMap[adds[p].rightIdx];
        const classification = classifyTokens(leftParsed[li], rightParsed[ri]);
        const type = classification.severity === 'equal' ? 'equal' : classification.severity;
        result.push({
          type: type === 'critical' ? 'critical' : type,
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
    let critical = 0, noise = 0, added = 0, removed = 0;
    for (const op of diffResult) {
      if (op.type === 'critical' || op.type === 'coordinate-z') critical++;
      else if (op.type === 'noise' || op.type === 'coordinate') noise++;
      else if (op.type === 'added') added++;
      else if (op.type === 'removed') removed++;
    }
    return { critical, noise, added, removed };
  }

  // =====================================================
  // Exports
  // =====================================================

  return {
    parseGCodeLine,
    fingerprint,
    classifyTokens,
    segmentIntoSections,
    matchSections,
    computeSemanticDiff,
    countStats
  };
})();
