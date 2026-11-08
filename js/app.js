/**
 * App Module
 * UI wiring, settings management, state, and diff coordination.
 */

const App = (() => {
  // === State ===
  let settings = {
    ignoreParenComments: false,
    ignoreSemiComments: true,
    ignoreWhitespace: true,
    ignoreCase: true,
    normalizeGMCodes: true,
    ignoreLineNumbers: true,
    ignoreBlockDelete: false,
    decimalPointMatters: false, // ON: X1 (no decimal) is not the same as X1.
    minorThreshold: 0.001,
    majorThreshold: 0.01,
    syncScroll: true,
    showVarValues: true // show worked-out #variable values after macro lines
  };

  let currentDiff = [];
  let diffPositions = []; // indices into currentDiff that are actual diffs
  let currentDiffIndex = -1;
  let currentToolpaths = { left: [], right: [] };
  let currentTpMatches = []; // toolpath match pairs from diff engine
  let lastDiffResult = null; // full engine result (parsed lines, toolpaths) for Feeds & Speeds
  let disabledToolpathIds = new Set(); // toolpath IDs (from left side) that are disabled
  let toleranceOffIds = new Set(); // toolpath IDs with tolerance filtering turned OFF (default: empty = all ON)
  // "Test this IF as true / false" choices: line -> { raw, value } per side
  let assumptions = { left: new Map(), right: new Map() };

  // === Example data ===
  const EXAMPLE_LEFT = `O1000 (PART PROGRAM - KNOWN GOOD)
N10 G90 G54 G17
N20 G00 X0. Y0. Z1.0 (RAPID TO START)
N30 T01 M06 (TOOL CHANGE)
N40 S8000 M03
N50 G01 X1.0000 Y2.0000 Z-0.5000 F50.0
N60 G01 X3.0000 Y2.0000 Z-0.5000
N70 G02 X4.0000 Y3.0000 I1.0000 J0.0000
N80 G01 X5.0000 Y3.0000
N90 G01 X5.0000 Y5.0000 Z-0.5000
N100 G00 Z1.0 M05
N110 G28 G91 Z0
N120 M30`;

  const EXAMPLE_RIGHT = `O1000 (PART PROGRAM - CAM REPOST V2)
N10 G90 G54 G17
N20 G0 X0. Y0. Z1.0 (RAPID MOVE TO START POSITION)
N30 T1 M6 (TOOL CHANGE)
N40 S8000 M3
N50 G1 X1.0001 Y2.0000 Z-0.5000 F50.0
N60 G1 X3.0005 Y2.0000 Z-0.5000
N70 G02 X4.0000 Y3.0000 I1.0000 J0.0000
N80 G1 X5.0000 Y3.0000
N85 G1 X5.0000 Y4.0000 Z-0.2500
N90 G1 X5.0000 Y5.0000 Z-0.5100
N100 G0 Z1.0 M5
N110 G28 G91 Z0
N120 M30`;

  // === Init ===
  function init() {
    loadSettings();
    applySettingsToUI();

    Editor.init(
      document.getElementById('left-editor'),
      document.getElementById('right-editor'),
      runDiff
    );

    // Wire inline toolpath separator callbacks
    const sepToggle = (tpId, checked) => {
      if (checked) disabledToolpathIds.delete(tpId);
      else disabledToolpathIds.add(tpId);
      applyDecorations();
    };
    const sepClick = (tpId) => {
      // Find the toolpath and scroll to it (use anchorLine for visible position)
      const scrollLine = (tp) => (tp.anchorLine >= 0) ? tp.anchorLine : tp.startLine;
      const isRight = tpId.startsWith('R');
      if (isRight) {
        const rId = parseInt(tpId.slice(1), 10);
        const rtp = currentToolpaths.right.find(t => t.id === rId);
        if (rtp) Editor.scrollToLine('right', scrollLine(rtp));
        const ltp = currentToolpaths.left.find(t => t.id === rId);
        if (ltp) Editor.scrollToLine('left', scrollLine(ltp));
      } else {
        const lId = parseInt(tpId, 10);
        const ltp = currentToolpaths.left.find(t => t.id === lId);
        if (ltp) Editor.scrollToLine('left', scrollLine(ltp));
        const rtp = currentToolpaths.right.find(t => t.id === lId);
        if (rtp) Editor.scrollToLine('right', scrollLine(rtp));
      }
    };
    const tolToggle = (tpId, checked) => {
      if (checked) toleranceOffIds.delete(tpId);
      else toleranceOffIds.add(tpId);
      applyDecorations();
    };
    const tolToggleAll = (checked) => {
      if (checked) {
        toleranceOffIds.clear();
      } else {
        for (const tp of currentToolpaths.left) toleranceOffIds.add(String(tp.id));
        for (const tp of currentToolpaths.right) toleranceOffIds.add('R' + tp.id);
      }
      Editor.setTolAllActive(checked);
      applyDecorations();
    };
    // Linked dropdown: opening one side opens the other
    const dropdownToggle = (open) => {
      Editor.setDropdownState('left', open);
      Editor.setDropdownState('right', open);
    };
    const cbs = { onClick: sepClick, onToggle: sepToggle, onToleranceToggle: tolToggle, onToleranceToggleAll: tolToggleAll, onDropdownToggle: dropdownToggle };
    Editor.setSeparatorCallbacks('left', cbs);
    Editor.setSeparatorCallbacks('right', cbs);

    bindButtons();
    bindSettings();
    bindKeyboard();
    bindJumpUi();

    // Restore filenames
    let lf = null, rf = null;
    try {
      lf = localStorage.getItem('gcode-compare-left-filename');
      rf = localStorage.getItem('gcode-compare-right-filename');
    } catch (e) { /* storage blocked */ }
    if (lf) Editor.setFilename('left', lf);
    if (rf) Editor.setFilename('right', rf);
  }

  // === Settings persistence ===
  const SETTINGS_VERSION = 6; // bump when defaults change

  function loadSettings() {
    try {
      const ver = parseInt(localStorage.getItem('gcode-compare-settings-version') || '0');
      if (ver < SETTINGS_VERSION) {
        localStorage.removeItem('gcode-compare-settings');
        localStorage.setItem('gcode-compare-settings-version', String(SETTINGS_VERSION));
        return;
      }
      const saved = localStorage.getItem('gcode-compare-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.assign(settings, parsed);
      }
    } catch (e) { /* use defaults */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem('gcode-compare-settings-version', String(SETTINGS_VERSION));
      localStorage.setItem('gcode-compare-settings', JSON.stringify(settings));
    } catch (e) { /* storage blocked */ }
  }

  function applySettingsToUI() {
    document.getElementById('opt-ignore-paren-comments').checked = settings.ignoreParenComments;
    document.getElementById('opt-ignore-semi-comments').checked = settings.ignoreSemiComments;
    document.getElementById('opt-ignore-whitespace').checked = settings.ignoreWhitespace;
    document.getElementById('opt-ignore-case').checked = settings.ignoreCase;
    document.getElementById('opt-normalize-gm').checked = settings.normalizeGMCodes;
    document.getElementById('opt-ignore-line-numbers').checked = settings.ignoreLineNumbers;
    document.getElementById('opt-ignore-block-delete').checked = settings.ignoreBlockDelete;
    document.getElementById('opt-decimal-point-matters').checked = settings.decimalPointMatters;
    document.getElementById('minor-threshold-value').textContent = settings.minorThreshold;
    document.getElementById('major-threshold-value').textContent = settings.majorThreshold;
    document.getElementById('opt-sync-scroll').checked = settings.syncScroll;
    document.getElementById('opt-show-var-values').checked = settings.showVarValues;
  }

  // === Button bindings ===
  function bindButtons() {
    document.getElementById('btn-new').addEventListener('click', startNew);

    document.getElementById('btn-open-left').addEventListener('click', () => {
      document.getElementById('file-input-left').click();
    });
    document.getElementById('btn-open-right').addEventListener('click', () => {
      document.getElementById('file-input-right').click();
    });

    document.getElementById('file-input-left').addEventListener('change', (e) => {
      if (e.target.files[0]) Editor.loadFileInto(e.target.files[0], 'left');
      e.target.value = '';
    });
    document.getElementById('file-input-right').addEventListener('change', (e) => {
      if (e.target.files[0]) Editor.loadFileInto(e.target.files[0], 'right');
      e.target.value = '';
    });

    document.getElementById('btn-swap').addEventListener('click', swapPanes);
    document.getElementById('btn-save-left').addEventListener('click', () => saveFile('left'));
    document.getElementById('btn-save-right').addEventListener('click', () => saveFile('right'));
    document.getElementById('btn-example').addEventListener('click', loadExample);

    document.getElementById('btn-prev-diff').addEventListener('click', () => navigateDiff(-1));
    document.getElementById('btn-next-diff').addEventListener('click', () => navigateDiff(1));

    document.getElementById('settings-toggle').addEventListener('click', toggleSettings);

    // Clickable diff gutter — jump both editors to the diff nearest the click
    document.getElementById('diff-markers').addEventListener('click', (e) => {
      if (diffPositions.length === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = (e.clientY - rect.top) / rect.height;
      const targetRow = fraction * Math.max(1, Editor.getTotalRows('left'));
      let best = null, bestDist = Infinity;
      for (const i of diffPositions) {
        const dist = Math.abs(opRow(currentDiff[i]) - targetRow);
        if (dist < bestDist) { bestDist = dist; best = currentDiff[i]; }
      }
      if (!best) return;
      if (best.leftIdx !== undefined) Editor.scrollToLine('left', best.leftIdx);
      if (best.rightIdx !== undefined) Editor.scrollToLine('right', best.rightIdx);
    });
  }

  // === Settings bindings ===
  function bindSettings() {
    const checkboxMap = {
      'opt-ignore-paren-comments': 'ignoreParenComments',
      'opt-ignore-semi-comments': 'ignoreSemiComments',
      'opt-ignore-whitespace': 'ignoreWhitespace',
      'opt-ignore-case': 'ignoreCase',
      'opt-normalize-gm': 'normalizeGMCodes',
      'opt-ignore-line-numbers': 'ignoreLineNumbers',
      'opt-ignore-block-delete': 'ignoreBlockDelete',
      'opt-decimal-point-matters': 'decimalPointMatters',
      'opt-sync-scroll': 'syncScroll',
      'opt-show-var-values': 'showVarValues'
    };

    for (const [id, key] of Object.entries(checkboxMap)) {
      document.getElementById(id).addEventListener('change', (e) => {
        settings[key] = e.target.checked;
        saveSettings();
        if (key === 'syncScroll') {
          Editor.setSyncScroll(e.target.checked);
        } else if (key === 'showVarValues') {
          applyAnnotations();
        } else {
          runDiff();
        }
      });
    }

    // Stepper buttons for thresholds
    document.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        const dir = parseInt(btn.dataset.dir);

        if (target === 'minor-tol') {
          const steps = [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1];
          let idx = steps.indexOf(settings.minorThreshold);
          if (idx < 0) idx = 2;
          idx = Math.max(0, Math.min(steps.length - 1, idx + dir));
          settings.minorThreshold = steps[idx];
          document.getElementById('minor-threshold-value').textContent = settings.minorThreshold;
        } else if (target === 'major-tol') {
          const steps = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0];
          let idx = steps.indexOf(settings.majorThreshold);
          if (idx < 0) idx = 2;
          idx = Math.max(0, Math.min(steps.length - 1, idx + dir));
          settings.majorThreshold = steps[idx];
          document.getElementById('major-threshold-value').textContent = settings.majorThreshold;
        }

        saveSettings();
        runDiff();
      });
    });
  }

  // === Keyboard shortcuts ===
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F7' && !e.shiftKey) {
        e.preventDefault();
        navigateDiff(1);
      } else if (e.key === 'F7' && e.shiftKey) {
        e.preventDefault();
        navigateDiff(-1);
      }
    });
  }

  // === Helpers ===
  function decoType(opType) {
    switch (opType) {
      case 'critical': return 'major';
      case 'workoffset': return 'workoffset';
      case 'minor': return 'minor';
      case 'added': return 'added';
      case 'removed': return 'removed';
      case 'tolerance': return 'tolerance';
      // Anything unexpected is shown red rather than hidden
      default: return 'major';
    }
  }

  // === Toolpath helpers ===
  function buildTpLabelParts(tp) {
    if (tp.type === 'preamble') return { nNumber: '', tool: '', desc: 'Program Header' };
    if (tp.type === 'program_end') return { nNumber: '', tool: '', desc: 'Program End' };
    const nNumber = tp.nNumber || '';
    const tool = tp.toolNumber !== null ? 'T' + tp.toolNumber : '';
    const descParts = [];
    if (tp.name) descParts.push(tp.name);
    if (tp.opType) descParts.push(tp.opType);
    const desc = descParts.join(' | ') || 'Section ' + tp.id;
    return { nNumber, tool, desc };
  }

  function buildTpLabel(tp) {
    const p = buildTpLabelParts(tp);
    const parts = [];
    if (p.nNumber) parts.push(p.nNumber);
    if (p.tool) parts.push(p.tool);
    if (p.desc) parts.push(p.desc);
    return parts.join(' - ') || 'Section ' + tp.id;
  }

  // === Toolpath section filtering ===
  function getToolpathForLine(lineIdx, toolpaths) {
    for (let s = toolpaths.length - 1; s >= 0; s--) {
      if (lineIdx >= toolpaths[s].startLine) return toolpaths[s];
    }
    return toolpaths[0] || null;
  }

  /**
   * Effective op type for display, considering the toolpath's TOL checkbox.
   * TOL on (default): within-tolerance diffs stay 'tolerance' (faint, not counted).
   * TOL off: within-tolerance diffs are shown as 'minor' so every change is visible.
   * Severity rules themselves live in diff-engine.js (classifyTokens).
   */
  function effectiveType(op) {
    if (op.type !== 'tolerance') return op.type;
    return isToleranceOff(op) ? 'minor' : 'tolerance';
  }

  function isToleranceOff(op) {
    if (toleranceOffIds.size === 0) return false;
    if (op.leftIdx !== undefined) {
      const tp = getToolpathForLine(op.leftIdx, currentToolpaths.left);
      return !!tp && toleranceOffIds.has(String(tp.id));
    }
    if (op.rightIdx !== undefined) {
      const tp = getToolpathForLine(op.rightIdx, currentToolpaths.right);
      return !!tp && toleranceOffIds.has('R' + tp.id);
    }
    return false;
  }

  function findCorrespondingLine(unmatchedEntry, targetSide, matches, lineCount) {
    const unmatchedIdx = matches.indexOf(unmatchedEntry);
    for (let i = unmatchedIdx + 1; i < matches.length; i++) {
      if (matches[i][targetSide]) return matches[i][targetSide].startLine;
    }
    return lineCount;
  }

  function isOpDisabled(op) {
    if (disabledToolpathIds.size === 0) return false;
    if (op.leftIdx !== undefined) {
      const tp = getToolpathForLine(op.leftIdx, currentToolpaths.left);
      if (tp && disabledToolpathIds.has(String(tp.id))) return true;
    }
    if (op.rightIdx !== undefined && op.leftIdx === undefined) {
      const tp = getToolpathForLine(op.rightIdx, currentToolpaths.right);
      if (tp && disabledToolpathIds.has('R' + tp.id)) return true;
    }
    return false;
  }

  // === Remembering per-toolpath choices across re-compares ===
  // A toolpath is identified by side + name/op/tool + how many times that
  // label appeared before it, so choices survive edits and re-posts.
  function toolpathKeys(toolpaths, prefix) {
    const seen = {};
    const map = new Map(); // id string -> key
    for (const tp of toolpaths) {
      const label = tp.type + '|' + (tp.name || '') + '|' + (tp.opType || '') + '|' + tp.toolNumber;
      seen[label] = (seen[label] || 0) + 1;
      map.set(prefix + tp.id, prefix + label + '#' + seen[label]);
    }
    return map;
  }

  function allKeys(toolpaths) {
    const m = toolpathKeys(toolpaths.left, '');
    for (const [k, v] of toolpathKeys(toolpaths.right, 'R')) m.set(k, v);
    return m;
  }

  function idsToKeys(ids, toolpaths) {
    const m = allKeys(toolpaths);
    const out = new Set();
    for (const id of ids) if (m.has(id)) out.add(m.get(id));
    return out;
  }

  function keysToIds(keys, toolpaths) {
    const out = new Set();
    for (const [id, key] of allKeys(toolpaths)) if (keys.has(key)) out.add(id);
    return out;
  }

  // === Core diff execution ===
  function runDiff() {
    const leftText = Editor.getValue('left');
    const rightText = Editor.getValue('right');

    if (!leftText && !rightText) {
      currentDiff = [];
      lastDiffResult = null;
      clearDecorations();
      applyAnnotations();
      updateStatusBar({ workoffset: 0, critical: 0, minor: 0, added: 0, removed: 0 }, 0, 0);
      return;
    }

    const leftLines = leftText.split('\n');
    const rightLines = rightText.split('\n');

    // Drop IF tests whose line was edited or moved
    let pruned = false;
    for (const [side, lines] of [['left', leftLines], ['right', rightLines]]) {
      for (const [line, a] of assumptions[side]) {
        if (lines[line] !== a.raw) { assumptions[side].delete(line); pruned = true; }
      }
    }
    if (pruned) updateTestBanner();

    // Run semantic diff engine
    const diffResult = DiffEngine.computeSemanticDiff(leftLines, rightLines, {
      assumeLeft: assumptions.left,
      assumeRight: assumptions.right,
      rules: settings,
      minorThreshold: settings.minorThreshold,
      majorThreshold: settings.majorThreshold
    });
    currentDiff = diffResult.ops;
    lastDiffResult = diffResult;
    const prevToolpaths = currentToolpaths;
    currentToolpaths = { left: diffResult.leftToolpaths, right: diffResult.rightToolpaths };
    currentTpMatches = diffResult.tpMatches || [];

    // Carry hide/TOL choices over to the new toolpath list (matched by name)
    const prevDisabled = idsToKeys(disabledToolpathIds, prevToolpaths);
    const prevTolOff = idsToKeys(toleranceOffIds, prevToolpaths);
    disabledToolpathIds = keysToIds(prevDisabled, currentToolpaths);
    toleranceOffIds = keysToIds(prevTolOff, currentToolpaths);
    Editor.setTolAllActive(toleranceOffIds.size === 0);

    // Apply decorations and update UI
    applyDecorations();
    applyAnnotations();
  }

  // === Variable values shown after macro lines ===
  function fmtValue(v) {
    if (v === null) return 'empty';
    if (typeof v !== 'number') return '?';
    return String(+v.toFixed(4));
  }

  /** "→ X1.5 Y?" after a line that uses #variables; "= 4" after an assignment. */
  function lineNote(p) {
    if (p.macroSkipped) return '  \u21b7 skipped by GOTO';
    const parts = [];
    if (p.cond) {
      parts.push(p.cond.assumed ? (p.cond.value ? 'TRUE (testing)' : 'FALSE (testing)')
        : p.cond.value === 1 ? 'true' : p.cond.value === 0 ? 'false' : '?');
    }
    if (p.resolved) {
      for (const L of Object.keys(p.resolved)) parts.push(L + fmtValue(p.resolved[L]));
    }
    if (p.assigned) {
      // Plain "#101=1.5" needs no note; "#102=#101*2" does
      const rhs = p.raw.replace(/\([^)]*\)?/g, '').replace(/;.*$/, '').split('=').slice(1).join('=').trim();
      const plain = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(rhs) && p.assigned.index !== undefined;
      if (!plain) parts.push((p.assigned.index !== undefined ? '#' + p.assigned.index : '#?') + ' = ' + fmtValue(p.assigned.value));
    }
    let note = parts.length ? '  \u2192 ' + parts.join(' ') : '';
    if (p.alarmStop) note += p.alarmStop === true ? '  \u26d4 alarm stops the program here'
      : '  \u26d4 alarm stops the program here (if this / line runs)';
    return note;
  }

  function annotationsFor(parsed) {
    const out = {};
    if (!parsed) return out;
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      if (!p.resolved && !p.assigned && !p.macroSkipped && !p.cond && !p.alarmStop) continue;
      const note = lineNote(p);
      if (note) out[i] = note;
    }
    return out;
  }

  // === IF tests ("what if this condition is true / false") ===
  function setAssumption(side, line, value) {
    const lines = Editor.getValue(side).split('\n');
    if (line < 0 || line >= lines.length) return;
    if (value === null) assumptions[side].delete(line);
    else assumptions[side].set(line, { raw: lines[line], value: !!value });
    runDiff();
    updateTestBanner();
  }

  function clearAssumptions(rerun) {
    const had = assumptions.left.size + assumptions.right.size > 0;
    assumptions = { left: new Map(), right: new Map() };
    updateTestBanner();
    if (had && rerun) runDiff();
  }

  function updateTestBanner() {
    const el = document.getElementById('test-banner');
    if (!el) return;
    const items = [];
    for (const side of ['left', 'right']) {
      for (const [line, a] of [...assumptions[side].entries()].sort((x, y) => x[0] - y[0])) {
        items.push(`<button data-side="${side}" data-line="${line}" title="Clear this test">` +
          `${side === 'left' ? 'L' : 'R'}${line + 1} = ${a.value ? 'TRUE' : 'FALSE'} \u2715</button>`);
      }
    }
    if (!items.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<span title="Values below these lines follow your choice">Testing IF:</span>${items.join('')}` +
      `<button data-clear-all="1">Clear all</button>`;
  }

  // === Jumping (GOTO / M99 P targets) ===
  let backTimer = null;
  function jumpTo(side, line, fromLine) {
    Editor.scrollToLine(side, line);
    Editor.flashLine(side, line);
    const btn = document.getElementById('jump-back');
    if (!btn) return;
    clearTimeout(backTimer);
    if (fromLine === undefined || fromLine === null || fromLine === line) { btn.hidden = true; return; }
    btn.textContent = `\u2190 Back to line ${fromLine + 1}`;
    btn.dataset.side = side;
    btn.dataset.line = fromLine;
    btn.hidden = false;
    backTimer = setTimeout(() => { btn.hidden = true; }, 15000);
  }

  function bindJumpUi() {
    const back = document.getElementById('jump-back');
    if (back) back.addEventListener('click', () => {
      back.hidden = true;
      jumpTo(back.dataset.side, parseInt(back.dataset.line, 10));
    });
    const banner = document.getElementById('test-banner');
    if (banner) banner.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.clearAll) clearAssumptions(true);
      else setAssumption(b.dataset.side, parseInt(b.dataset.line, 10), null);
    });
  }

  function applyAnnotations() {
    const on = settings.showVarValues && lastDiffResult;
    Editor.setAnnotations('left', on ? annotationsFor(lastDiffResult.leftParsed) : {});
    Editor.setAnnotations('right', on ? annotationsFor(lastDiffResult.rightParsed) : {});
  }

  /** 'in' / 'mm' from the first G20 / G21 in a file, or '' if none. */
  function unitsOf(parsed) {
    if (!parsed) return '';
    for (const p of parsed) {
      for (const g of p.gCodes) {
        const n = parseFloat(g.substring(1));
        if (n === 20) return 'in';
        if (n === 21) return 'mm';
      }
    }
    return '';
  }

  /**
   * Build decorations from currentDiff, applying toolpath filtering.
   * Called from runDiff() and when toolpath toggles change.
   */
  function applyDecorations() {
    const leftText = Editor.getValue('left');
    const rightText = Editor.getValue('right');
    const leftLineCount = leftText ? leftText.split('\n').length : 0;
    const rightLineCount = rightText ? rightText.split('\n').length : 0;

    // Build disabled line sets for editor dimming
    const leftDisabled = new Set();
    const rightDisabled = new Set();
    for (const tp of currentToolpaths.left) {
      if (disabledToolpathIds.has(String(tp.id))) {
        for (let l = tp.startLine; l <= tp.endLine && l < leftLineCount; l++) leftDisabled.add(l);
      }
    }
    for (const tp of currentToolpaths.right) {
      if (disabledToolpathIds.has('R' + tp.id)) {
        for (let l = tp.startLine; l <= tp.endLine && l < rightLineCount; l++) rightDisabled.add(l);
      }
    }

    // Un-disable lines with must-surface diffs — they show through hidden toolpaths
    for (const op of currentDiff) {
      if (!op.alwaysShow) continue;
      if (op.leftIdx !== undefined) leftDisabled.delete(op.leftIdx);
      if (op.rightIdx !== undefined) rightDisabled.delete(op.rightIdx);
    }

    const leftDecos = [];
    const rightDecos = [];
    const leftPadding = {};
    const rightPadding = {};
    diffPositions = [];

    let leftPendingPad = 0;
    let rightPendingPad = 0;

    // Stats count only what is actually shown
    const stats = { workoffset: 0, critical: 0, minor: 0, added: 0, removed: 0 };

    for (let i = 0; i < currentDiff.length; i++) {
      const op = currentDiff[i];
      const disabled = isOpDisabled(op);

      // Toolpath boundary flush — always, even for disabled ops
      if (op.leftIdx !== undefined) {
        const leftTp = getToolpathForLine(op.leftIdx, currentToolpaths.left);
        if (leftTp && leftTp.startLine === op.leftIdx && leftPendingPad > 0) {
          leftPadding[op.leftIdx] = (leftPadding[op.leftIdx] || 0) + leftPendingPad;
          leftPendingPad = 0;
        }
      }
      if (op.rightIdx !== undefined) {
        const rightTp = getToolpathForLine(op.rightIdx, currentToolpaths.right);
        if (rightTp && rightTp.startLine === op.rightIdx && rightPendingPad > 0) {
          rightPadding[op.rightIdx] = (rightPadding[op.rightIdx] || 0) + rightPendingPad;
          rightPendingPad = 0;
        }
      }

      // Resolve effective type considering per-toolpath tolerance setting
      const etype = effectiveType(op);

      // One-sided ops: always count padding (even if disabled), optionally skip decoration
      if (etype === 'added') {
        leftPendingPad++;
        if (disabled && !op.alwaysShow) continue;
        rightDecos.push({ line: op.rightIdx, type: op.workOffset ? 'workoffset' : 'added' });
        diffPositions.push(i);
        if (op.workOffset) stats.workoffset++; else stats.added++;
        continue;
      }
      if (etype === 'removed') {
        rightPendingPad++;
        if (disabled && !op.alwaysShow) continue;
        leftDecos.push({ line: op.leftIdx, type: op.workOffset ? 'workoffset' : 'removed' });
        diffPositions.push(i);
        if (op.workOffset) stats.workoffset++; else stats.removed++;
        continue;
      }

      // Both-sides ops: skip entirely if disabled
      if (disabled && !op.alwaysShow) continue;

      const hasBothSides = op.leftIdx !== undefined && op.rightIdx !== undefined;
      if (etype === 'equal' || hasBothSides) {
        // Flush pending padding
        if (leftPendingPad > 0 && op.leftIdx !== undefined) {
          leftPadding[op.leftIdx] = (leftPadding[op.leftIdx] || 0) + leftPendingPad;
          leftPendingPad = 0;
        }
        if (rightPendingPad > 0 && op.rightIdx !== undefined) {
          rightPadding[op.rightIdx] = (rightPadding[op.rightIdx] || 0) + rightPendingPad;
          rightPendingPad = 0;
        }
        if (etype !== 'equal') {
          const dt = decoType(etype);
          leftDecos.push({ line: op.leftIdx, type: dt, tokenDiffs: op.tokenDiffs });
          rightDecos.push({ line: op.rightIdx, type: dt, tokenDiffs: op.tokenDiffs });
          // Tolerance diffs get decoration but NOT navigation/stats
          if (etype !== 'tolerance') {
            diffPositions.push(i);
            if (dt === 'workoffset') stats.workoffset++;
            else if (dt === 'minor') stats.minor++;
            else stats.critical++;
          }
        }
      }
    }

    // Trailing padding
    if (leftPendingPad > 0) {
      leftPadding[leftLineCount] = (leftPadding[leftLineCount] || 0) + leftPendingPad;
    }
    if (rightPendingPad > 0) {
      rightPadding[rightLineCount] = (rightPadding[rightLineCount] || 0) + rightPendingPad;
    }

    // Build toolpath separator data for inline display
    // Use anchorLine (comment/G100 line) not startLine (expanded preamble)
    const leftSeparators = {};
    for (const tp of currentToolpaths.left) {
      const sepLine = (tp.anchorLine >= 0) ? tp.anchorLine : tp.startLine;
      leftSeparators[sepLine] = {
        id: String(tp.id),
        label: buildTpLabel(tp),
        labelParts: buildTpLabelParts(tp),
        disabled: disabledToolpathIds.has(String(tp.id)),
        toleranceEnabled: !toleranceOffIds.has(String(tp.id))
      };
    }
    const rightSeparators = {};
    for (const tp of currentToolpaths.right) {
      const sepLine = (tp.anchorLine >= 0) ? tp.anchorLine : tp.startLine;
      rightSeparators[sepLine] = {
        id: 'R' + tp.id,
        label: buildTpLabel(tp),
        labelParts: buildTpLabelParts(tp),
        disabled: disabledToolpathIds.has('R' + tp.id),
        toleranceEnabled: !toleranceOffIds.has('R' + tp.id)
      };
    }

    // Add placeholder separators for unmatched toolpaths on the opposite side.
    // IDs match the real toolpath convention so isOpDisabled() works without changes.
    for (const match of currentTpMatches) {
      if (match.left && !match.right) {
        let rightLine = findCorrespondingLine(match, 'right', currentTpMatches, rightLineCount);
        while (rightLine > 0 && rightSeparators[rightLine]) rightLine--;
        if (!rightSeparators[rightLine]) {
          rightSeparators[rightLine] = {
            id: String(match.left.id),
            label: buildTpLabel(match.left) + ' (not in file)',
            labelParts: buildTpLabelParts(match.left),
            disabled: disabledToolpathIds.has(String(match.left.id)),
            toleranceEnabled: !toleranceOffIds.has(String(match.left.id)),
            placeholder: true
          };
        }
      } else if (!match.left && match.right) {
        let leftLine = findCorrespondingLine(match, 'left', currentTpMatches, leftLineCount);
        while (leftLine > 0 && leftSeparators[leftLine]) leftLine--;
        if (!leftSeparators[leftLine]) {
          leftSeparators[leftLine] = {
            id: 'R' + match.right.id,
            label: buildTpLabel(match.right) + ' (not in file)',
            labelParts: buildTpLabelParts(match.right),
            disabled: disabledToolpathIds.has('R' + match.right.id),
            toleranceEnabled: !toleranceOffIds.has('R' + match.right.id),
            placeholder: true
          };
        }
      }
    }

    // Final equalization: guarantee both panes have identical total display line counts.
    // Formula must match render(): totalDisplayLines = lineCount + padTotal + sepCount
    const leftPadTotal = Object.values(leftPadding).reduce((a, b) => a + b, 0);
    const rightPadTotal = Object.values(rightPadding).reduce((a, b) => a + b, 0);
    const leftSepCount = Object.keys(leftSeparators).length;
    const rightSepCount = Object.keys(rightSeparators).length;
    const leftTotal = leftLineCount + leftPadTotal + leftSepCount;
    const rightTotal = rightLineCount + rightPadTotal + rightSepCount;

    if (leftTotal < rightTotal) {
      leftPadding[leftLineCount] = (leftPadding[leftLineCount] || 0) + (rightTotal - leftTotal);
    } else if (rightTotal < leftTotal) {
      rightPadding[rightLineCount] = (rightPadding[rightLineCount] || 0) + (leftTotal - rightTotal);
    }

    Editor.setDecorations('left', leftDecos, leftPadding, leftDisabled, leftSeparators);
    Editor.setDecorations('right', rightDecos, rightPadding, rightDisabled, rightSeparators);

    // Update diff markers in center gutter
    updateDiffMarkers();

    updateStatusBar(stats, leftLineCount, rightLineCount);

    // Reset diff navigation
    currentDiffIndex = -1;
  }

  function clearDecorations() {
    Editor.setDecorations('left', [], {});
    Editor.setDecorations('right', [], {});
    document.getElementById('diff-markers').innerHTML = '';
  }

  /** Display row of an op (both panes have the same row count). */
  function opRow(op) {
    return op.leftIdx !== undefined ? Editor.getDisplayRow('left', op.leftIdx)
                                    : Editor.getDisplayRow('right', op.rightIdx);
  }

  function updateDiffMarkers() {
    const container = document.getElementById('diff-markers');
    const height = container.clientHeight || 400;
    const totalRows = Editor.getTotalRows('left');
    if (diffPositions.length === 0 || totalRows === 0) { container.innerHTML = ''; return; }

    let html = '';
    const seen = new Set();

    // Same set of diffs as F7 navigation, placed by their real position
    for (const i of diffPositions) {
      const op = currentDiff[i];
      const etype = effectiveType(op);
      const dt = op.workOffset ? 'workoffset' : decoType(etype);
      const top = Math.round((opRow(op) / totalRows) * height);
      const key = `${top}-${dt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      html += `<div class="diff-marker ${dt}" style="top:${top}px"></div>`;
    }

    container.innerHTML = html;
  }

  function updateStatusBar(stats, leftLines, rightLines) {
    document.getElementById('stat-workoffset').textContent = stats.workoffset || 0;
    document.getElementById('stat-major').textContent = stats.critical;
    document.getElementById('stat-minor-count').textContent = stats.minor;
    document.getElementById('stat-lines-left').textContent = leftLines;
    document.getElementById('stat-lines-right').textContent = rightLines;

    // Toolpath counts (only real toolpaths, not preamble/end)
    const leftTpCount = currentToolpaths.left.filter(t => t.type === 'toolpath').length;
    const rightTpCount = currentToolpaths.right.filter(t => t.type === 'toolpath').length;
    const tpLeftEl = document.getElementById('stat-toolpaths-left');
    const tpRightEl = document.getElementById('stat-toolpaths-right');
    if (tpLeftEl) tpLeftEl.textContent = leftTpCount;
    if (tpRightEl) tpRightEl.textContent = rightTpCount;

    // Units (G20 inch / G21 mm) per file
    const uEl = document.getElementById('stat-units');
    if (uEl) {
      const uL = leftLines ? unitsOf(lastDiffResult && lastDiffResult.leftParsed) : '';
      const uR = rightLines ? unitsOf(lastDiffResult && lastDiffResult.rightParsed) : '';
      const differ = uL && uR && uL !== uR;
      uEl.textContent = (uL || uR) ? (uL || 'not set') + ' / ' + (uR || 'not set') :
        (leftLines || rightLines) ? 'not in file' : '–';
      uEl.classList.toggle('status-units-differ', !!differ);
      uEl.title = differ ? 'Units differ: one file is inch (G20), the other metric (G21)'
        : (uL || uR) ? 'Units from G20 (inch) / G21 (mm): left / right'
        : 'No G20 / G21 in the files: the machine uses its own default units';
    }

    // Line count warning
    const center = document.getElementById('status-center');
    if (leftLines > 0 && rightLines > 0) {
      const ratio = Math.abs(leftLines - rightLines) / Math.max(leftLines, rightLines);
      if (ratio > 0.1) {
        center.textContent = '\u26A0 Line count differs significantly \u2014 verify correct files are loaded';
      } else {
        center.textContent = '';
      }
    } else {
      center.textContent = '';
    }
  }

  // === Navigation ===
  function navigateDiff(direction) {
    if (diffPositions.length === 0) return;

    currentDiffIndex += direction;
    if (currentDiffIndex >= diffPositions.length) currentDiffIndex = 0;
    if (currentDiffIndex < 0) currentDiffIndex = diffPositions.length - 1;

    const op = currentDiff[diffPositions[currentDiffIndex]];
    if (op.leftIdx !== undefined) Editor.scrollToLine('left', op.leftIdx);
    if (op.rightIdx !== undefined) Editor.scrollToLine('right', op.rightIdx);
  }

  // === Actions ===
  function startNew() {
    Editor.setValue('left', '');
    Editor.setValue('right', '');
    Editor.setFilename('left', 'untitled');
    Editor.setFilename('right', 'untitled');
    currentDiff = [];
    diffPositions = [];
    currentDiffIndex = -1;
    currentToolpaths = { left: [], right: [] };
    currentTpMatches = [];
    disabledToolpathIds.clear();
    toleranceOffIds.clear();
    Editor.setTolAllActive(true);
    clearAssumptions(false);
    lastDiffResult = null;
    clearDecorations();
    applyAnnotations();
    updateStatusBar({ workoffset: 0, critical: 0, minor: 0, added: 0, removed: 0 }, 0, 0);
  }

  function swapPanes() {
    const leftText = Editor.getValue('left');
    const rightText = Editor.getValue('right');
    const leftName = Editor.getFilename('left');
    const rightName = Editor.getFilename('right');

    // Sides flip, so per-toolpath choices and IF tests no longer apply
    clearAssumptions(false);
    disabledToolpathIds.clear();
    toleranceOffIds.clear();
    currentToolpaths = { left: [], right: [] };

    Editor.setValue('left', rightText);
    Editor.setValue('right', leftText);
    Editor.setFilename('left', rightName);
    Editor.setFilename('right', leftName);

    runDiff();
  }

  function saveFile(side) {
    const content = Editor.getValue(side);
    const filename = Editor.getFilename(side);
    const name = (filename && filename !== 'untitled') ? filename : 'untitled.nc';

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function loadExample() {
    Editor.setValue('left', EXAMPLE_LEFT);
    Editor.setValue('right', EXAMPLE_RIGHT);
    Editor.setFilename('left', 'machine-file.nc');
    Editor.setFilename('right', 'cam-repost-v2.nc');
    runDiff();
  }

  function toggleSettings() {
    document.getElementById('settings-panel').classList.toggle('open');
  }

  // === Page-level drag and drop ===
  function setupGlobalDragDrop() {
    document.body.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    document.body.addEventListener('drop', (e) => {
      if (e.target.closest('.editor-container')) return;
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length >= 2) {
        Editor.loadFileInto(files[0], 'left');
        Editor.loadFileInto(files[1], 'right');
      } else if (files.length === 1) {
        Editor.loadFileInto(files[0], 'left');
      }
    });
  }

  // === Boot ===
  document.addEventListener('DOMContentLoaded', () => {
    init();
    setupGlobalDragDrop();
  });

  /** Parsed lines and toolpaths from the last compare (used by the Feeds & Speeds popup). */
  function getDiffContext() {
    if (!lastDiffResult || (!Editor.getValue('left') && !Editor.getValue('right'))) return null;
    return lastDiffResult;
  }

  return { runDiff, loadExample, getDiffContext, setAssumption, jumpTo };
})();
