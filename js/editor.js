/**
 * Editor Module
 * Single-layer line-div editor with syntax highlighting and diff decorations.
 * No overlapping scroll layers — everything renders in one DOM tree per pane.
 */

const Editor = (() => {
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
    // Main scrollable wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'editor-wrapper';

    // Hidden textarea for actual editing (captures all input)
    const textarea = document.createElement('textarea');
    textarea.className = 'editor-input';
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.setAttribute('autocapitalize', 'off');
    textarea.wrap = 'off';

    // Rendered display area (line divs with gutter + content)
    const display = document.createElement('div');
    display.className = 'editor-display';

    // Toolpath header bar (shows current toolpath, click to toggle dropdown)
    const tpHeader = document.createElement('div');
    tpHeader.className = 'tp-header-bar';
    tpHeader.innerHTML = '<span class="tp-header-label"></span>' +
      '<button class="tp-tol-all-btn" title="Toggle tolerance filter for all toolpaths">TOL</button>' +
      '<span class="tp-header-arrow">&#9660;</span>';

    // Toolpath dropdown overlay (full list of all toolpaths)
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
      tpHeader,
      tpDropdown,
      content: '',
      decorations: {},
      filename: 'untitled',
      alignmentPadding: {},
      toolpathSeparators: {},
      separatorPositions: [], // [{id, label, disabled, offsetTop}] cached after render
      dropdownOpen: false,
      onSeparatorClick: null,
      onSeparatorToggle: null,
      onToleranceToggle: null,
      onToleranceToggleAll: null,
      onDropdownToggle: null // callback to sync dropdown state across sides
    };

    // Focus textarea on click anywhere in the editor — but not on separators
    display.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tp-separator')) return;

      const rect = display.getBoundingClientRect();
      const scrollTop = wrapper.scrollTop;
      const y = e.clientY - rect.top + scrollTop;
      const lineHeight = 20;
      const clickedLine = Math.floor(y / lineHeight);
      const lines = state.content.split('\n');

      let actualLine = 0;
      let displayLine = 0;
      for (let i = 0; i < lines.length; i++) {
        // Order must match render(): padding first, then separator, then content
        const padding = state.alignmentPadding[i] || 0;
        displayLine += padding;
        if (state.toolpathSeparators[i]) displayLine++;
        if (displayLine === clickedLine || (displayLine <= clickedLine && clickedLine < displayLine + 1)) {
          actualLine = i;
          break;
        }
        displayLine += 1;
        if (displayLine > clickedLine) {
          actualLine = i;
          break;
        }
        actualLine = i;
      }

      let pos = 0;
      for (let i = 0; i < actualLine && i < lines.length; i++) {
        pos += lines[i].length + 1;
      }
      setTimeout(() => {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = Math.min(pos, textarea.value.length);
      }, 0);
    });

    // Event delegation for separator clicks and checkbox toggles (bound once, not per-render)
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

    // Toolpath header click toggles dropdown (but not when clicking the TOL button)
    tpHeader.addEventListener('click', (e) => {
      if (e.target.classList.contains('tp-tol-all-btn')) return;
      const newState = !state.dropdownOpen;
      setDropdownOpen(state, newState);
      if (state.onDropdownToggle) state.onDropdownToggle(newState);
    });
    // Master tolerance toggle button
    tpHeader.querySelector('.tp-tol-all-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target;
      const isActive = btn.classList.toggle('active');
      if (state.onToleranceToggleAll) state.onToleranceToggleAll(isActive);
    });

    // Event delegation for dropdown items
    tpDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.tp-dropdown-item');
      if (!item) return;
      if (e.target.classList.contains('tp-sep-cb') || e.target.classList.contains('tp-tol-cb')) return;
      if (state.onSeparatorClick) state.onSeparatorClick(item.dataset.tpId);
      // Close dropdown after navigation
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

    // Sync scrolling from wrapper
    wrapper.addEventListener('scroll', () => {
      textarea.scrollTop = wrapper.scrollTop;
      textarea.scrollLeft = wrapper.scrollLeft;
      scheduleUpdateHeader(state);
    });

    // Input handling
    let debounceTimer = null;
    textarea.addEventListener('input', () => {
      state.content = textarea.value;
      render(state);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (onChangeCallback) onChangeCallback();
      }, 300);
    });

    // Cursor tracking (debounced to avoid O(n) split on every event)
    let cursorTimer = null;
    const debouncedCursor = () => {
      clearTimeout(cursorTimer);
      cursorTimer = setTimeout(() => updateCursorPos(textarea), 50);
    };
    textarea.addEventListener('click', debouncedCursor);
    textarea.addEventListener('keyup', debouncedCursor);

    // Tab support
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

    // Drag and drop
    setupDragDrop(container, side);

    return state;
  }

  function updateCursorPos(textarea) {
    const val = textarea.value.substring(0, textarea.selectionStart);
    const lines = val.split('\n');
    const el = document.getElementById('stat-cursor');
    if (el) el.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
  }

  // =====================================================
  // Toolpath Header Bar & Dropdown
  // =====================================================

  let headerRafId = null;
  let pendingHeaderStates = new Set();
  function scheduleUpdateHeader(state) {
    pendingHeaderStates.add(state);
    if (headerRafId) return;
    headerRafId = requestAnimationFrame(() => {
      headerRafId = null;
      for (const s of pendingHeaderStates) updateCurrentHeader(s);
      pendingHeaderStates.clear();
    });
  }

  function updateCurrentHeader(state) {
    const label = state.tpHeader.querySelector('.tp-header-label');
    if (!state.separatorPositions.length) {
      label.innerHTML = '';
      state.tpHeader.classList.add('tp-header-empty');
      return;
    }
    state.tpHeader.classList.remove('tp-header-empty');

    const scrollTop = state.wrapper.scrollTop;

    // Find the last separator that is at or above the current scroll position
    let current = state.separatorPositions[0];
    for (const sep of state.separatorPositions) {
      if (sep.offsetTop <= scrollTop + 2) {
        current = sep;
      } else {
        break;
      }
    }

    if (current) {
      label.innerHTML = buildLabelHtml(current, current.placeholder);
    }
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
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render(state) {
    const lines = state.content.split('\n');
    let html = '';
    let sepCount = 0;

    for (let i = 0; i < lines.length; i++) {
      // Insert alignment padding lines FIRST (keeps both panes aligned)
      const padding = state.alignmentPadding[i] || 0;
      for (let p = 0; p < padding; p++) {
        html += `<div class="editor-line padding-line"><span class="line-num"></span><span class="line-content">&nbsp;</span></div>`;
      }

      // Insert toolpath separator AFTER padding (so it appears at the aligned position)
      const sep = state.toolpathSeparators[i];
      if (sep) {
        sepCount++;
        const checkedAttr = sep.disabled ? '' : ' checked';
        const tolCheckedAttr = sep.toleranceEnabled ? ' checked' : '';
        const disabledCls = sep.disabled ? ' tp-sep-disabled' : '';
        const placeholderCls = sep.placeholder ? ' tp-placeholder' : '';
        html += `<div class="editor-line tp-separator${disabledCls}${placeholderCls}" data-tp-id="${escapeHtml(sep.id)}">` +
          `<span class="line-num"></span>` +
          `<span class="line-content tp-sep-content">` +
          `<input type="checkbox" class="tp-sep-cb"${checkedAttr} title="Show/hide this toolpath">` +
          `<input type="checkbox" class="tp-tol-cb"${tolCheckedAttr} title="Tolerance filter"> ` +
          buildLabelHtml(sep, sep.placeholder) +
          `</span></div>`;
      }

      const isDisabled = state.disabledLines && state.disabledLines.has(i);
      const deco = state.decorations[i];
      const type = isDisabled ? null : (deco ? deco.type : null);
      const tokenDiffs = (!isDisabled && deco) ? deco.tokenDiffs : null;
      const bgClass = type ? `diff-bg-${type}` : '';
      const disabledClass = isDisabled ? ' line-disabled' : '';
      const highlighted = syntaxHighlightLine(lines[i], tokenDiffs, state.side);
      html += `<div class="editor-line ${bgClass}${disabledClass}"><span class="line-num">${i + 1}</span><span class="line-content">${highlighted || '&nbsp;'}</span></div>`;
    }

    state.display.innerHTML = html;

    // Cache separator positions for header/dropdown updates
    state.separatorPositions = [];
    state.display.querySelectorAll('.tp-separator').forEach(el => {
      const tpId = el.dataset.tpId;
      const sep = Object.values(state.toolpathSeparators).find(s => s.id === tpId);
      state.separatorPositions.push({
        id: tpId,
        label: sep ? sep.label : '',
        labelParts: sep ? sep.labelParts : null,
        placeholder: sep ? !!sep.placeholder : false,
        disabled: sep ? sep.disabled : false,
        toleranceEnabled: sep ? !!sep.toleranceEnabled : false,
        offsetTop: el.offsetTop
      });
    });

    // Ensure the display is tall enough
    const lineHeight = 20;
    const padTotal = Object.values(state.alignmentPadding).reduce((a, b) => a + b, 0);
    const totalDisplayLines = lines.length + padTotal + sepCount;
    state.display.style.minHeight = (totalDisplayLines * lineHeight) + 'px';

    // Update header and dropdown after render
    rebuildDropdown(state);
    updateCurrentHeader(state);
  }

  /**
   * Extract character ranges from tokenDiffs for a given side.
   */
  function extractDiffRanges(tokenDiffs, side) {
    if (!tokenDiffs || !tokenDiffs.length) return [];
    const ranges = [];
    const key = side === 'left' ? 'leftTokens' : 'rightTokens';
    for (const td of tokenDiffs) {
      const tokens = td[key];
      if (!tokens) continue;
      for (const t of tokens) {
        if (t.start !== undefined && t.end !== undefined) {
          ranges.push({ start: t.start, end: t.end });
        }
      }
    }
    ranges.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of ranges) {
      if (merged.length > 0 && r.start <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end);
      } else {
        merged.push({ start: r.start, end: r.end });
      }
    }
    return merged;
  }

  function syntaxHighlightLine(line, tokenDiffs, side) {
    if (!line) return '';

    let s = line;
    if (tokenDiffs && side) {
      const ranges = extractDiffRanges(tokenDiffs, side);
      if (ranges.length > 0) {
        for (let r = ranges.length - 1; r >= 0; r--) {
          const { start, end } = ranges[r];
          const safeEnd = Math.min(end, s.length);
          const safeStart = Math.min(start, s.length);
          s = s.slice(0, safeEnd) + '\uE001' + s.slice(safeEnd);
          s = s.slice(0, safeStart) + '\uE000' + s.slice(safeStart);
        }
      }
    }

    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/(\([^)]*\))/g, '<span class="gcode-comment-paren">$1</span>');
    s = s.replace(/(;.*)$/, '<span class="gcode-comment-semi">$1</span>');
    s = s.replace(/\b(N\d+)\b/gi, '<span class="gcode-line-number">$1</span>');
    s = s.replace(/(#\d+)/g, '<span class="gcode-macro">$1</span>');
    s = s.replace(/\b(G\d+\.?\d*)\b/gi, '<span class="gcode-g">$1</span>');
    s = s.replace(/\b(M\d+\.?\d*)\b/gi, '<span class="gcode-m">$1</span>');
    s = s.replace(/\b(T\d+)\b/gi, '<span class="gcode-t">$1</span>');
    s = s.replace(/\b([HD]\d+)\b/gi, '<span class="gcode-hd">$1</span>');
    s = s.replace(/\b(F-?\d+\.?\d*)\b/gi, '<span class="gcode-f">$1</span>');
    s = s.replace(/\b(S\d+\.?\d*)\b/gi, '<span class="gcode-s">$1</span>');
    s = s.replace(/\b([XY]-?\d+\.?\d*)\b/gi, '<span class="gcode-xy">$1</span>');
    s = s.replace(/\b(Z-?\d+\.?\d*)\b/gi, '<span class="gcode-z">$1</span>');
    s = s.replace(/\b([ABC]-?\d+\.?\d*)\b/gi, '<span class="gcode-abc">$1</span>');
    s = s.replace(/\b([IJK]-?\d+\.?\d*)\b/gi, '<span class="gcode-ijk">$1</span>');
    s = s.replace(/\b([RPQL]-?\d+\.?\d*)\b/gi, '<span class="gcode-param">$1</span>');

    s = s.replace(/\uE000/g, '<span class="token-diff">');
    s = s.replace(/\uE001/g, '</span>');

    return s;
  }

  function setupSyncScroll() {
    if (!leftState || !rightState) return;

    leftState.wrapper.addEventListener('scroll', () => {
      if (!syncScrollEnabled || isScrolling) return;
      isScrolling = true;
      rightState.wrapper.scrollTop = leftState.wrapper.scrollTop;
      requestAnimationFrame(() => { isScrolling = false; });
    });

    rightState.wrapper.addEventListener('scroll', () => {
      if (!syncScrollEnabled || isScrolling) return;
      isScrolling = true;
      leftState.wrapper.scrollTop = rightState.wrapper.scrollTop;
      requestAnimationFrame(() => { isScrolling = false; });
    });
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
    localStorage.setItem(`gcode-compare-${side}-filename`, name);
  }

  function getFilename(side) {
    const el = document.getElementById(side === 'left' ? 'left-filename' : 'right-filename');
    return el ? el.textContent : 'untitled';
  }

  function getValue(side) {
    const state = side === 'left' ? leftState : rightState;
    return state ? state.content : '';
  }

  function setValue(side, text) {
    const state = side === 'left' ? leftState : rightState;
    if (!state) return;
    state.content = text;
    state.textarea.value = text;
    render(state);
  }

  function setDecorations(side, decorations, padding, disabledLines, separators) {
    const state = side === 'left' ? leftState : rightState;
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

  function setSeparatorCallbacks(side, callbacks) {
    const state = side === 'left' ? leftState : rightState;
    if (!state) return;
    state.onSeparatorClick = callbacks.onClick || null;
    state.onSeparatorToggle = callbacks.onToggle || null;
    state.onToleranceToggle = callbacks.onToleranceToggle || null;
    state.onToleranceToggleAll = callbacks.onToleranceToggleAll || null;
    state.onDropdownToggle = callbacks.onDropdownToggle || null;
  }

  function setDropdownState(side, open) {
    const state = side === 'left' ? leftState : rightState;
    if (!state) return;
    setDropdownOpen(state, open);
  }

  function scrollToLine(side, lineNum) {
    const state = side === 'left' ? leftState : rightState;
    if (!state) return;
    const lineCount = state.content.split('\n').length;
    if (lineNum < 0 || lineNum >= lineCount) return;
    const lineHeight = 20;
    let displayLine = lineNum;
    for (let i = 0; i <= lineNum; i++) {
      displayLine += (state.alignmentPadding[i] || 0);
      if (state.toolpathSeparators[i]) displayLine++;
    }
    const targetScroll = displayLine * lineHeight - state.wrapper.clientHeight / 2;
    state.wrapper.scrollTop = Math.max(0, targetScroll);
  }

  function getLineCount(side) {
    const val = getValue(side);
    return val ? val.split('\n').length : 0;
  }

  return {
    init, getValue, setValue, setFilename, getFilename,
    setDecorations, scrollToLine, setSyncScroll,
    setSeparatorCallbacks, setDropdownState, getLineCount, loadFileInto
  };
})();
