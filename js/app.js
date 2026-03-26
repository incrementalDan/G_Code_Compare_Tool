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
    suppressNoise: true,
    noiseThreshold: 10,
    syncScroll: true
  };

  let currentDiff = [];
  let diffPositions = []; // indices into currentDiff that are actual diffs
  let currentDiffIndex = -1;

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

    bindButtons();
    bindSettings();
    bindKeyboard();

    // Restore filenames
    const lf = localStorage.getItem('gcode-compare-left-filename');
    const rf = localStorage.getItem('gcode-compare-right-filename');
    if (lf) Editor.setFilename('left', lf);
    if (rf) Editor.setFilename('right', rf);
  }

  // === Settings persistence ===
  const SETTINGS_VERSION = 3; // bump when defaults change

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
    localStorage.setItem('gcode-compare-settings-version', String(SETTINGS_VERSION));
    localStorage.setItem('gcode-compare-settings', JSON.stringify(settings));
  }

  function applySettingsToUI() {
    document.getElementById('opt-ignore-paren-comments').checked = settings.ignoreParenComments;
    document.getElementById('opt-ignore-semi-comments').checked = settings.ignoreSemiComments;
    document.getElementById('opt-ignore-whitespace').checked = settings.ignoreWhitespace;
    document.getElementById('opt-ignore-case').checked = settings.ignoreCase;
    document.getElementById('opt-normalize-gm').checked = settings.normalizeGMCodes;
    document.getElementById('opt-ignore-line-numbers').checked = settings.ignoreLineNumbers;
    document.getElementById('opt-ignore-block-delete').checked = settings.ignoreBlockDelete;
    document.getElementById('opt-suppress-noise').checked = settings.suppressNoise;
    document.getElementById('noise-threshold-value').textContent = settings.noiseThreshold;
    document.getElementById('opt-sync-scroll').checked = settings.syncScroll;
  }

  // === Button bindings ===
  function bindButtons() {
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
      'opt-suppress-noise': 'suppressNoise',
      'opt-sync-scroll': 'syncScroll'
    };

    for (const [id, key] of Object.entries(checkboxMap)) {
      document.getElementById(id).addEventListener('change', (e) => {
        settings[key] = e.target.checked;
        saveSettings();
        if (key === 'syncScroll') {
          Editor.setSyncScroll(e.target.checked);
        } else {
          runDiff();
        }
      });
    }

    // Noise threshold stepper
    document.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        const dir = parseInt(btn.dataset.dir);

        if (target === 'noise') {
          settings.noiseThreshold = Math.max(3, Math.min(50,
            settings.noiseThreshold + dir
          ));
          document.getElementById('noise-threshold-value').textContent = settings.noiseThreshold;
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

  // === Core diff execution ===
  function runDiff() {
    const leftText = Editor.getValue('left');
    const rightText = Editor.getValue('right');

    if (!leftText && !rightText) {
      currentDiff = [];
      clearDecorations();
      updateStatusBar({ critical: 0, noise: 0, added: 0, removed: 0 }, 0, 0);
      return;
    }

    const leftLines = leftText.split('\n');
    const rightLines = rightText.split('\n');

    // Run semantic diff engine
    currentDiff = DiffEngine.computeSemanticDiff(leftLines, rightLines, {
      rules: settings,
      noiseThreshold: settings.noiseThreshold,
      suppressNoise: settings.suppressNoise
    });

    // Build decorations AND alignment padding
    const leftDecos = [];
    const rightDecos = [];
    const leftPadding = {};
    const rightPadding = {};
    diffPositions = [];

    let leftPendingPad = 0;
    let rightPendingPad = 0;

    // Map semantic types to decoration types
    function decoType(opType) {
      switch (opType) {
        case 'critical': case 'coordinate-z': return 'major';
        case 'coordinate': case 'noise': return 'noise';
        case 'added': return 'added';
        case 'removed': return 'removed';
        default: return opType;
      }
    }

    for (let i = 0; i < currentDiff.length; i++) {
      const op = currentDiff[i];
      const hasBothSides = op.leftIdx !== undefined && op.rightIdx !== undefined;

      if (op.type === 'equal' || hasBothSides) {
        // Both sides have a line — flush any pending padding
        if (leftPendingPad > 0 && op.leftIdx !== undefined) {
          leftPadding[op.leftIdx] = (leftPadding[op.leftIdx] || 0) + leftPendingPad;
          leftPendingPad = 0;
        }
        if (rightPendingPad > 0 && op.rightIdx !== undefined) {
          rightPadding[op.rightIdx] = (rightPadding[op.rightIdx] || 0) + rightPendingPad;
          rightPendingPad = 0;
        }

        if (op.type !== 'equal') {
          const dt = decoType(op.type);
          leftDecos.push({ line: op.leftIdx, type: dt, tokenDiffs: op.tokenDiffs });
          rightDecos.push({ line: op.rightIdx, type: dt, tokenDiffs: op.tokenDiffs });
          diffPositions.push(i);
        }

      } else if (op.type === 'added') {
        rightDecos.push({ line: op.rightIdx, type: 'added' });
        diffPositions.push(i);
        leftPendingPad++;

      } else if (op.type === 'removed') {
        leftDecos.push({ line: op.leftIdx, type: 'removed' });
        diffPositions.push(i);
        rightPendingPad++;
      }
    }

    // Trailing padding
    if (leftPendingPad > 0) {
      leftPadding[leftLines.length] = (leftPadding[leftLines.length] || 0) + leftPendingPad;
    }
    if (rightPendingPad > 0) {
      rightPadding[rightLines.length] = (rightPadding[rightLines.length] || 0) + rightPendingPad;
    }

    Editor.setDecorations('left', leftDecos, leftPadding);
    Editor.setDecorations('right', rightDecos, rightPadding);

    // Update diff markers in center gutter
    updateDiffMarkers(leftDecos, rightDecos, leftLines.length, rightLines.length);

    // Update status bar
    const stats = DiffEngine.countStats(currentDiff);
    updateStatusBar(stats, leftLines.length, rightLines.length);

    // Reset diff navigation
    currentDiffIndex = -1;
  }

  function clearDecorations() {
    Editor.setDecorations('left', [], {});
    Editor.setDecorations('right', [], {});
    document.getElementById('diff-markers').innerHTML = '';
  }

  function updateDiffMarkers(leftDecos, rightDecos, leftCount, rightCount) {
    const container = document.getElementById('diff-markers');
    const height = container.clientHeight || 400;
    const totalLines = Math.max(leftCount, rightCount, 1);

    let html = '';
    const allDecos = [...leftDecos, ...rightDecos];
    const seen = new Set();

    for (const d of allDecos) {
      const key = `${d.line}-${d.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const top = (d.line / totalLines) * height;
      html += `<div class="diff-marker ${d.type}" style="top:${top}px"></div>`;
    }

    container.innerHTML = html;
  }

  function updateStatusBar(stats, leftLines, rightLines) {
    document.getElementById('stat-major').textContent = stats.critical;
    document.getElementById('stat-minor').textContent = stats.noise;
    document.getElementById('stat-lines-left').textContent = leftLines;
    document.getElementById('stat-lines-right').textContent = rightLines;

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
  function swapPanes() {
    const leftText = Editor.getValue('left');
    const rightText = Editor.getValue('right');
    const leftName = Editor.getFilename('left');
    const rightName = Editor.getFilename('right');

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

  return { runDiff, loadExample };
})();
