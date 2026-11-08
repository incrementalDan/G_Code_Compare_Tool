/**
 * Editor Module
 * Line-div editor with syntax highlighting and diff decorations.
 *
 * Only the rows on screen are drawn (virtual rendering), so big files stay fast.
 * A hidden textarea holds the text and takes keyboard input. Clicks are mapped
 * to a line and column by this module, because the display has extra rows
 * (alignment padding, toolpath separators) the textarea knows nothing about.
 */

const Editor = (() => {
  const LINE_HEIGHT = 20;   // must match --line-height in style.css
  const OVERSCAN = 40;      // extra rows drawn above/below the visible area

  let leftState = null;
  let rightState = null;
  let onChangeCallback = null;
  let syncScrollEnabled = true;
  let isScrolling = false;

  function init(leftEl, rightEl, onChange) {
    onChangeCallback = onChange;
    leftState = createEditor(leftEl, 'left');
    rightState = createEditor(rightEl, 'right');
    setupSyncScroll();
  }

  function createEditor(container, side) {
    const wrapper = document.createElement('div');
    wrapper.className = 'editor-wrapper';

    // Hidden textarea: holds the text and receives typing. Never receives clicks.
    const textarea = document.createElement('textarea');
    textarea.className = 'editor-input';
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.setAttribute('autocapitalize', 'off');
    textarea.wrap = 'off';

    // Display: full-height box; only the visible window of rows is drawn inside.
    const display = document.createElement('div');
    display.className = 'editor-display';
    const windowEl = document.createElement('div');
    windowEl.className = 'editor-window';
    display.appendChild(windowEl);

    const tpHeader = document.createElement('div');
    tpHeader.className = 'tp-header-bar';
    tpHeader.innerHTML = '<span class="tp-header-label"></span>' +
      '<button class="tp-tol-all-btn active" title="Toggle tolerance filter for all toolpaths">TOL</button>' +
      '<span class="tp-header-arrow">&#9660;</span>';

    const tpDropdown = document.createElement('div');
    tpDropdown.className = 'tp-dropdown';

    wrapper.appendChild(display);
    wrapper.appendChild(textarea);
    container.appendChild(tpHeader);
    container.appendChild(tpDropdown);
    container.appendChild(wrapper);

    const state = {
      side,
      wrapper,
      textarea,
      display,
      windowEl,
      tpHeader,
      tpDropdown,
      content: '',
      lines: [''],
      rows: [],             // [{kind:'line'|'pad'|'sep', line}]
      lineToRow: [],        // line index -> row index
      renderedRange: null,  // [first, last] rows currently drawn
      cursorLine: -1,
      decorations: {},
      disabledLines: new Set(),
      filename: 'untitled',
      annotations: {},      // line index -> short text shown after the line (variable values)
      alignmentPadding: {},
      toolpathSeparators: {},
      separatorPositions: [], // [{id, label, disabled, offsetTop}]
      dropdownOpen: false,
      onSeparatorClick: null,
      onSeparatorToggle: null,
      onToleranceToggle: null,
      onToleranceToggleAll: null,
      onDropdownToggle: null
    };

    // Click in the code: place the cursor on the clicked line/column.
    display.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tp-separator')) return;
      e.preventDefault();
      const rect = display.getBoundingClientRect();
      const row = Math.max(0, Math.floor((e.clientY - rect.top) / LINE_HEIGHT));
      const line = lineForRow(state, row);
      const col = columnAt(state, e.clientX);
      const lineText = state.lines[line] || '';
      let pos = 0;
      for (let i = 0; i < line; i++) pos += state.lines[i].length + 1;
      pos += Math.min(col, lineText.length);
      textarea.focus({ preventScroll: true });
      textarea.selectionStart = textarea.selectionEnd = Math.min(pos, textarea.value.length);
      setCursorLine(state, line);
      updateCursorPos(textarea, side);
    });

    // Hover: report the line and character under the mouse (hover-help.js)
    display.addEventListener('mousemove', (e) => {
      if (!hoverCallback) return;
      const rect = display.getBoundingClientRect();
      const row = Math.floor((e.clientY - rect.top) / LINE_HEIGHT);
      const r = state.rows[row];
      if (!r || r.kind !== 'line' || e.target.closest('.tp-separator')) { hoverCallback(null); return; }
      const content = state.windowEl.querySelector('.line-content');
      if (!content) return;
      const left = content.getBoundingClientRect().left + parseFloat(getComputedStyle(content).paddingLeft || 0);
      const col = Math.floor((e.clientX - left) / charWidth(state));
      hoverCallback({ side, line: r.line, col, text: state.lines[r.line] || '', x: e.clientX, y: e.clientY,
        rowTop: rect.top + row * LINE_HEIGHT });
    });
    display.addEventListener('mouseleave', () => { if (hoverCallback) hoverCallback(null); });

    // Event delegation for separator rows (bound once)
    display.addEventListener('click', (e) => {
      const sep = e.target.closest('.tp-separator');
      if (!sep) return;
      if (e.target.classList.contains('tp-sep-cb') || e.target.classList.contains('tp-tol-cb')) return;
      if (state.onSeparatorClick) state.onSeparatorClick(sep.dataset.tpId);
    });
    display.addEventListener('change', (e) => {
      const sep = e.target.closest('.tp-separator');
      if (!sep) return;
      e.stopPropagation();
      if (e.target.classList.contains('tp-sep-cb')) {
        if (state.onSeparatorToggle) state.onSeparatorToggle(sep.dataset.tpId, e.target.checked);
      } else if (e.target.classList.contains('tp-tol-cb')) {
        if (state.onToleranceToggle) state.onToleranceToggle(sep.dataset.tpId, e.target.checked);
      }
    });

    tpHeader.addEventListener('click', (e) => {
      if (e.target.classList.contains('tp-tol-all-btn')) return;
      const newState = !state.dropdownOpen;
      setDropdownOpen(state, newState);
      if (state.onDropdownToggle) state.onDropdownToggle(newState);
    });
    tpHeader.querySelector('.tp-tol-all-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = !e.target.classList.contains('active');
      if (state.onToleranceToggleAll) state.onToleranceToggleAll(isActive);
    });

    tpDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.tp-dropdown-item');
      if (!item) return;
      if (e.target.classList.contains('tp-sep-cb') || e.target.classList.contains('tp-tol-cb')) return;
      if (state.onSeparatorClick) state.onSeparatorClick(item.dataset.tpId);
      setDropdownOpen(state, false);
      if (state.onDropdownToggle) state.onDropdownToggle(false);
    });
    tpDropdown.addEventListener('change', (e) => {
      const item = e.target.closest('.tp-dropdown-item');
      if (!item) return;
      e.stopPropagation();
      if (e.target.classList.contains('tp-sep-cb')) {
        if (state.onSeparatorToggle) state.onSeparatorToggle(item.dataset.tpId, e.target.checked);
      } else if (e.target.classList.contains('tp-tol-cb')) {
        if (state.onToleranceToggle) state.onToleranceToggle(item.dataset.tpId, e.target.checked);
      }
    });

    wrapper.addEventListener('scroll', () => {
      // Keep the (invisible) textarea over the visible area
      textarea.style.top = wrapper.scrollTop + 'px';
      scheduleWindow(state);
    });

    let debounceTimer = null;
    textarea.addEventListener('input', () => {
      state.content = textarea.value;
      render(state);
      followCursor(state);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (onChangeCallback) onChangeCallback();
      }, 300);
    });

    let cursorTimer = null;
    const debouncedCursor = () => {
      clearTimeout(cursorTimer);
      cursorTimer = setTimeout(() => { updateCursorPos(textarea, side); followCursor(state); }, 50);
    };
    textarea.addEventListener('keyup', debouncedCursor);

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        state.content = textarea.value;
        render(state);
      }
    });

    setupDragDrop(container, side);
    render(state);
    return state;
  }

  // =====================================================
  // Cursor helpers
  // =====================================================

  function updateCursorPos(textarea, side) {
    const val = textarea.value.substring(0, textarea.selectionStart);
    const lines = val.split('\n');
    const el = document.getElementById('stat-cursor');
    const pane = side === 'right' ? 'Right' : side === 'left' ? 'Left' : '';
    if (el) el.textContent = `${pane ? pane + ' \u00b7 ' : ''}Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
  }

  /** The text line shown at a display row (padding/separator rows map to the next line). */
  function lineForRow(state, row) {
    const rows = state.rows;
    if (!rows.length) return 0;
    for (let r = Math.min(row, rows.length - 1); r < rows.length; r++) {
      if (rows[r].kind === 'line') return rows[r].line;
    }
    return state.lines.length - 1;
  }

  let charWidthCache = 0;
  function charWidth(state) {
    if (charWidthCache) return charWidthCache;
    const probe = document.createElement('span');
    probe.className = 'line-content';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.textContent = '0'.repeat(100);
    state.display.appendChild(probe);
    charWidthCache = probe.getBoundingClientRect().width / 100 || 7.8;
    probe.remove();
    return charWidthCache;
  }

  function columnAt(state, clientX) {
    const content = state.windowEl.querySelector('.line-content');
    if (!content) return 0;
    const left = content.getBoundingClientRect().left + parseFloat(getComputedStyle(content).paddingLeft || 0);
    return Math.max(0, Math.round((clientX - left) / charWidth(state)));
  }

  function setCursorLine(state, line) {
    if (state.cursorLine === line) return;
    state.cursorLine = line;
    renderWindow(state, true);
  }

  /** After typing or arrow keys, highlight the cursor line and keep it on screen. */
  function followCursor(state) {
    const ta = state.textarea;
    const line = ta.value.substring(0, ta.selectionStart).split('\n').length - 1;
    setCursorLine(state, line);
    if (document.activeElement !== ta) return;
    const row = state.lineToRow[line];
    if (row === undefined) return;
    const top = row * LINE_HEIGHT;
    const w = state.wrapper;
    if (top < w.scrollTop) w.scrollTop = top;
    else if (top + LINE_HEIGHT > w.scrollTop + w.clientHeight) w.scrollTop = top + LINE_HEIGHT - w.clientHeight;
  }

  // =====================================================
  // Toolpath Header Bar & Dropdown
  // =====================================================

  function updateCurrentHeader(state) {
    const label = state.tpHeader.querySelector('.tp-header-label');
    if (!state.separatorPositions.length) {
      label.innerHTML = '';
      state.tpHeader.classList.add('tp-header-empty');
      return;
    }
    state.tpHeader.classList.remove('tp-header-empty');

    const scrollTop = state.wrapper.scrollTop;
    let current = state.separatorPositions[0];
    for (const sep of state.separatorPositions) {
      if (sep.offsetTop <= scrollTop + 2) current = sep;
      else break;
    }
    if (current) label.innerHTML = buildLabelHtml(current, current.placeholder);
  }

  function setDropdownOpen(state, open) {
    state.dropdownOpen = open;
    state.tpDropdown.classList.toggle('open', open);
    state.tpHeader.classList.toggle('active', open);
    const arrow = state.tpHeader.querySelector('.tp-header-arrow');
    if (arrow) arrow.innerHTML = open ? '&#9650;' : '&#9660;';
  }

  function rebuildDropdown(state) {
    if (!state.separatorPositions.length) {
      state.tpDropdown.innerHTML = '';
      return;
    }
    let html = '';
    for (let i = 0; i < state.separatorPositions.length; i++) {
      const sep = state.separatorPositions[i];
      const checkedAttr = sep.disabled ? '' : ' checked';
      const tolCheckedAttr = sep.toleranceEnabled ? ' checked' : '';
      const disabledCls = sep.disabled ? ' tp-sep-disabled' : '';
      const placeholderCls = sep.placeholder ? ' tp-placeholder' : '';
      const rowCls = i % 2 === 0 ? 'tp-dropdown-even' : 'tp-dropdown-odd';
      html += `<div class="tp-dropdown-item ${rowCls}${disabledCls}${placeholderCls}" data-tp-id="${escapeHtml(sep.id)}">` +
        `<input type="checkbox" class="tp-sep-cb"${checkedAttr} title="Show/hide">` +
        `<input type="checkbox" class="tp-tol-cb"${tolCheckedAttr} title="Tolerance filter"> ` +
        buildLabelHtml(sep, sep.placeholder) +
        `</div>`;
    }
    state.tpDropdown.innerHTML = html;
  }

  function buildLabelHtml(sep, isPlaceholder) {
    const parts = sep.labelParts;
    if (parts) {
      const placeholderSuffix = isPlaceholder ? ' <span class="tp-not-in-file">(not in file)</span>' : '';
      return `<span class="tp-n-num">${escapeHtml(parts.nNumber)}</span>` +
        `<span class="tp-tool">${escapeHtml(parts.tool)}</span>` +
        `<span class="tp-desc">${escapeHtml(parts.desc)}${placeholderSuffix}</span>`;
    }
    return `<span class="tp-sep-label">${escapeHtml(sep.label)}</span>`;
  }

  // =====================================================
  // Rendering
  // =====================================================

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * Rebuild the row model (cheap: no HTML) and draw the visible window.
   * Row order per line must stay: padding rows, then separator, then the line.
   */
  function render(state) {
    const lines = state.content.split('\n');
    state.lines = lines;
    const rows = [];
    const lineToRow = new Array(lines.length);
    let maxLen = 0;

    for (let i = 0; i < lines.length; i++) {
      const padding = state.alignmentPadding[i] || 0;
      for (let p = 0; p < padding; p++) rows.push({ kind: 'pad', line: i });
      if (state.toolpathSeparators[i]) rows.push({ kind: 'sep', line: i });
      lineToRow[i] = rows.length;
      rows.push({ kind: 'line', line: i });
      if (lines[i].length > maxLen) maxLen = lines[i].length;
    }
    // Trailing padding (keyed at lines.length)
    const trailing = state.alignmentPadding[lines.length] || 0;
    for (let p = 0; p < trailing; p++) rows.push({ kind: 'pad', line: lines.length });

    state.rows = rows;
    state.lineToRow = lineToRow;
    state.display.style.height = (rows.length * LINE_HEIGHT) + 'px';
    state.display.style.minWidth = `calc(${maxLen}ch + 90px)`;
    state.display.classList.toggle('editor-empty', state.content === '');

    state.separatorPositions = [];
    for (let r = 0; r < rows.length; r++) {
      if (rows[r].kind !== 'sep') continue;
      const sep = state.toolpathSeparators[rows[r].line];
      state.separatorPositions.push({
        id: sep.id,
        label: sep.label || '',
        labelParts: sep.labelParts || null,
        placeholder: !!sep.placeholder,
        disabled: !!sep.disabled,
        toleranceEnabled: !!sep.toleranceEnabled,
        offsetTop: r * LINE_HEIGHT
      });
    }

    renderWindow(state, true);
    rebuildDropdown(state);
    updateCurrentHeader(state);
  }

  const pendingWindows = new Set();
  let windowRafId = null;
  function scheduleWindow(state) {
    pendingWindows.add(state);
    if (windowRafId) return;
    windowRafId = requestAnimationFrame(() => {
      windowRafId = null;
      for (const s of pendingWindows) { renderWindow(s, false); updateCurrentHeader(s); }
      pendingWindows.clear();
    });
  }

  /** Draw only the rows in (and near) the visible area. */
  function renderWindow(state, force) {
    if (state.content === '' && !Object.keys(state.alignmentPadding).length) {
      state.windowEl.innerHTML = '';
      state.renderedRange = null;
      return;
    }
    const rows = state.rows;
    const view = state.wrapper.clientHeight || 800;
    const first = Math.max(0, Math.floor(state.wrapper.scrollTop / LINE_HEIGHT) - OVERSCAN);
    const last = Math.min(rows.length - 1, first + Math.ceil(view / LINE_HEIGHT) + 2 * OVERSCAN);

    // Skip redraw while the needed rows are already drawn
    const r = state.renderedRange;
    if (!force && r && first >= r[0] && last <= r[1]) return;
    const drawFirst = Math.max(0, first - OVERSCAN);
    const drawLast = Math.min(rows.length - 1, last + OVERSCAN);
    state.renderedRange = [drawFirst, drawLast];

    let html = '';
    for (let i = drawFirst; i <= drawLast; i++) html += rowHtml(state, rows[i]);
    state.windowEl.style.top = (drawFirst * LINE_HEIGHT) + 'px';
    state.windowEl.innerHTML = html;
  }

  function rowHtml(state, row) {
    if (row.kind === 'pad') {
      return `<div class="editor-line padding-line"><span class="line-num"></span><span class="line-content">&nbsp;</span></div>`;
    }
    if (row.kind === 'sep') {
      const sep = state.toolpathSeparators[row.line];
      const checkedAttr = sep.disabled ? '' : ' checked';
      const tolCheckedAttr = sep.toleranceEnabled ? ' checked' : '';
      const disabledCls = sep.disabled ? ' tp-sep-disabled' : '';
      const placeholderCls = sep.placeholder ? ' tp-placeholder' : '';
      return `<div class="editor-line tp-separator${disabledCls}${placeholderCls}" data-tp-id="${escapeHtml(sep.id)}">` +
        `<span class="line-num"></span>` +
        `<span class="line-content tp-sep-content">` +
        `<input type="checkbox" class="tp-sep-cb"${checkedAttr} title="Show/hide this toolpath">` +
        `<input type="checkbox" class="tp-tol-cb"${tolCheckedAttr} title="Tolerance filter"> ` +
        buildLabelHtml(sep, sep.placeholder) +
        `</span></div>`;
    }
    const i = row.line;
    const isDisabled = state.disabledLines && state.disabledLines.has(i);
    const deco = state.decorations[i];
    const type = isDisabled ? null : (deco ? deco.type : null);
    const tokenDiffs = (!isDisabled && deco) ? deco.tokenDiffs : null;
    const bgClass = type ? ` diff-bg-${type}` : '';
    const disabledClass = isDisabled ? ' line-disabled' : '';
    const cursorClass = i === state.cursorLine ? ' cursor-line' : '';
    // A trailing \r (Windows line end) would break the row before the value note
    const highlighted = syntaxHighlightLine(state.lines[i].replace(/\r$/, ''), tokenDiffs, state.side);
    const note = state.annotations[i];
    const ghost = note ? `<span class="var-ghost">${escapeHtml(note)}</span>` : '';
    return `<div class="editor-line${bgClass}${disabledClass}${cursorClass}"><span class="line-num">${i + 1}</span><span class="line-content">${highlighted || (ghost ? '' : '&nbsp;')}${ghost}</span></div>`;
  }

  /** Character ranges of changed tokens for one side. */
  function extractDiffRanges(tokenDiffs, side) {
    if (!tokenDiffs || !tokenDiffs.length) return [];
    const ranges = [];
    const key = side === 'left' ? 'leftTokens' : 'rightTokens';
    for (const td of tokenDiffs) {
      const tokens = td[key];
      if (!tokens) continue;
      for (const t of tokens) {
        if (t.start !== undefined && t.end !== undefined) ranges.push({ start: t.start, end: t.end });
      }
    }
    return ranges;
  }

  const TOKEN_CLASS = {
    gCode: 'gcode-g', mCode: 'gcode-m', tool: 'gcode-t', hOffset: 'gcode-hd', dOffset: 'gcode-hd',
    feed: 'gcode-f', spindle: 'gcode-s', arcParam: 'gcode-ijk', rotary: 'gcode-abc',
    param: 'gcode-param', other: 'gcode-param', blockDelete: 'gcode-param',
    macro: 'gcode-macro', expr: 'gcode-macro',
    lineNumber: 'gcode-line-number', program: 'gcode-line-number'
  };

  function tokenClass(t) {
    if (t.type === 'axis') return t.axis === 'Z' ? 'gcode-z' : 'gcode-xy';
    if (t.type === 'comment') return t.kind === 'semi' ? 'gcode-comment-semi' : 'gcode-comment-paren';
    return TOKEN_CLASS[t.type] || '';
  }

  /**
   * Color a line using the diff engine's own parser, so colors always match
   * what is compared (no coloring inside comments, decimals included).
   */
  function syntaxHighlightLine(line, tokenDiffs, side) {
    if (!line) return '';
    const len = line.length;
    const cls = new Array(len).fill('');
    const diff = new Uint8Array(len);
    for (const t of DiffEngine.parseGCodeLine(line).tokens) {
      const c = tokenClass(t);
      for (let p = t.start; p < t.end && p < len; p++) cls[p] = c;
    }
    for (const r of extractDiffRanges(tokenDiffs, side)) {
      for (let p = r.start; p < r.end && p < len; p++) diff[p] = 1;
    }

    let out = '';
    let p = 0;
    while (p < len) {
      let q = p + 1;
      while (q < len && cls[q] === cls[p] && diff[q] === diff[p]) q++;
      let text = escapeHtml(line.substring(p, q));
      if (cls[p]) text = `<span class="${cls[p]}">${text}</span>`;
      if (diff[p]) text = `<span class="token-diff">${text}</span>`;
      out += text;
      p = q;
    }
    return out;
  }

  // =====================================================
  // Scrolling, drag and drop, file I/O
  // =====================================================

  function setupSyncScroll() {
    if (!leftState || !rightState) return;
    const link = (from, to) => {
      from.wrapper.addEventListener('scroll', () => {
        if (!syncScrollEnabled || isScrolling) return;
        isScrolling = true;
        to.wrapper.scrollTop = from.wrapper.scrollTop;
        requestAnimationFrame(() => { isScrolling = false; });
      });
    };
    link(leftState, rightState);
    link(rightState, leftState);
  }

  function setSyncScroll(enabled) {
    syncScrollEnabled = enabled;
  }

  function setupDragDrop(container, side) {
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.classList.add('drag-over');
    });
    container.addEventListener('dragleave', (e) => {
      e.preventDefault();
      container.classList.remove('drag-over');
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length === 0) return;
      if (files.length >= 2) {
        loadFileInto(files[0], 'left');
        loadFileInto(files[1], 'right');
      } else {
        loadFileInto(files[0], side);
      }
    });
  }

  function loadFileInto(file, side) {
    const reader = new FileReader();
    reader.onload = (e) => {
      setValue(side, e.target.result);
      setFilename(side, file.name);
      if (onChangeCallback) onChangeCallback();
    };
    reader.readAsText(file);
  }

  function setFilename(side, name) {
    const el = document.getElementById(side === 'left' ? 'left-filename' : 'right-filename');
    if (el) el.textContent = name;
    try { localStorage.setItem(`gcode-compare-${side}-filename`, name); } catch (e) { /* storage blocked */ }
  }

  function getFilename(side) {
    const el = document.getElementById(side === 'left' ? 'left-filename' : 'right-filename');
    return el ? el.textContent : 'untitled';
  }

  function stateFor(side) {
    return side === 'left' ? leftState : rightState;
  }

  function getValue(side) {
    const state = stateFor(side);
    return state ? state.content : '';
  }

  function setValue(side, text) {
    const state = stateFor(side);
    if (!state) return;
    state.content = text;
    state.textarea.value = text;
    state.cursorLine = -1;
    render(state);
  }

  function setDecorations(side, decorations, padding, disabledLines, separators) {
    const state = stateFor(side);
    if (!state) return;
    state.decorations = {};
    for (const d of decorations) {
      state.decorations[d.line] = { type: d.type, tokenDiffs: d.tokenDiffs || null };
    }
    state.alignmentPadding = padding || {};
    state.disabledLines = disabledLines || new Set();
    state.toolpathSeparators = separators || {};
    render(state);
  }

  /** Short notes shown after lines, e.g. "→ X1.5" (resolved variable values). */
  function setAnnotations(side, annotations) {
    const state = stateFor(side);
    if (!state) return;
    state.annotations = annotations || {};
    renderWindow(state, true);
  }

  let hoverCallback = null;
  function setHoverCallback(fn) { hoverCallback = fn; }

  function setSeparatorCallbacks(side, callbacks) {
    const state = stateFor(side);
    if (!state) return;
    state.onSeparatorClick = callbacks.onClick || null;
    state.onSeparatorToggle = callbacks.onToggle || null;
    state.onToleranceToggle = callbacks.onToleranceToggle || null;
    state.onToleranceToggleAll = callbacks.onToleranceToggleAll || null;
    state.onDropdownToggle = callbacks.onDropdownToggle || null;
  }

  function setDropdownState(side, open) {
    const state = stateFor(side);
    if (!state) return;
    setDropdownOpen(state, open);
  }

  /** Set the TOL master button state on both panes. */
  function setTolAllActive(active) {
    for (const st of [leftState, rightState]) {
      if (!st) continue;
      st.tpHeader.querySelector('.tp-tol-all-btn').classList.toggle('active', active);
    }
  }

  function scrollToLine(side, lineNum) {
    const state = stateFor(side);
    if (!state) return;
    const row = state.lineToRow[lineNum];
    if (row === undefined) return;
    const targetScroll = row * LINE_HEIGHT - state.wrapper.clientHeight / 2;
    state.wrapper.scrollTop = Math.max(0, targetScroll);
  }

  /** Display row of a text line (includes padding and separator rows above it). */
  function getDisplayRow(side, lineNum) {
    const state = stateFor(side);
    if (!state) return 0;
    const row = state.lineToRow[lineNum];
    return row === undefined ? 0 : row;
  }

  function getTotalRows(side) {
    const state = stateFor(side);
    return state ? state.rows.length : 0;
  }

  function getLineCount(side) {
    const val = getValue(side);
    return val ? val.split('\n').length : 0;
  }

  return {
    init, getValue, setValue, setFilename, getFilename,
    setDecorations, setAnnotations, setHoverCallback, scrollToLine, setSyncScroll,
    setSeparatorCallbacks, setDropdownState, setTolAllActive,
    getDisplayRow, getTotalRows, getLineCount, loadFileInto,
    syntaxHighlightLine
  };
})();
