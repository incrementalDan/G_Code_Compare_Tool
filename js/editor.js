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

    wrapper.appendChild(display);
    wrapper.appendChild(textarea);
    container.appendChild(wrapper);

    const state = {
      side,
      wrapper,
      textarea,
      display,
      content: '',
      decorations: {},  // lineIndex -> {type, tokenDiffs}
      filename: 'untitled',
      alignmentPadding: {}, // lineIndex -> number of padding lines to insert BEFORE this line
      toolpathSeparators: {}, // lineIndex -> {id, label, disabled}
      onSeparatorClick: null,
      onSeparatorToggle: null
    };

    // Focus textarea on click anywhere in the editor
    display.addEventListener('mousedown', (e) => {
      // Calculate which line was clicked
      const rect = display.getBoundingClientRect();
      const scrollTop = wrapper.scrollTop;
      const y = e.clientY - rect.top + scrollTop;
      const lineHeight = 20;
      const clickedLine = Math.floor(y / lineHeight);
      const lines = state.content.split('\n');

      // Map display line to actual line (accounting for padding)
      let actualLine = 0;
      let displayLine = 0;
      for (let i = 0; i < lines.length; i++) {
        const padding = state.alignmentPadding[i] || 0;
        displayLine += padding;
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

      // Set cursor position in textarea
      let pos = 0;
      for (let i = 0; i < actualLine && i < lines.length; i++) {
        pos += lines[i].length + 1;
      }
      setTimeout(() => {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = Math.min(pos, textarea.value.length);
      }, 0);
    });

    // Sync scrolling from wrapper
    wrapper.addEventListener('scroll', () => {
      // Keep textarea scroll in sync (it's positioned absolute)
      textarea.scrollTop = wrapper.scrollTop;
      textarea.scrollLeft = wrapper.scrollLeft;
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

    // Cursor tracking
    textarea.addEventListener('click', () => updateCursorPos(textarea));
    textarea.addEventListener('keyup', () => updateCursorPos(textarea));

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

  /**
   * Render the display area with line numbers, syntax highlighting, and diff colors.
   */
  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render(state) {
    const lines = state.content.split('\n');
    let html = '';
    let sepCount = 0;

    for (let i = 0; i < lines.length; i++) {
      // Insert toolpath separator before this line (before padding)
      const sep = state.toolpathSeparators[i];
      if (sep) {
        sepCount++;
        const checkedAttr = sep.disabled ? '' : ' checked';
        const disabledCls = sep.disabled ? ' tp-sep-disabled' : '';
        html += `<div class="editor-line tp-separator${disabledCls}" data-tp-id="${escapeHtml(sep.id)}">` +
          `<span class="line-num"></span>` +
          `<span class="line-content tp-sep-content">` +
          `<input type="checkbox" class="tp-sep-cb"${checkedAttr}> ` +
          `<span class="tp-sep-label">${escapeHtml(sep.label)}</span>` +
          `</span></div>`;
      }

      // Insert alignment padding lines before this line
      const padding = state.alignmentPadding[i] || 0;
      for (let p = 0; p < padding; p++) {
        html += `<div class="editor-line padding-line"><span class="line-num"></span><span class="line-content">&nbsp;</span></div>`;
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

    // Bind separator events
    state.display.querySelectorAll('.tp-separator').forEach(el => {
      const cb = el.querySelector('.tp-sep-cb');
      const tpId = el.dataset.tpId;
      el.addEventListener('click', (e) => {
        if (e.target === cb) return;
        if (state.onSeparatorClick) state.onSeparatorClick(tpId);
      });
      cb.addEventListener('change', () => {
        if (state.onSeparatorToggle) state.onSeparatorToggle(tpId, cb.checked);
      });
    });

    // Ensure the display is tall enough
    const lineHeight = 20;
    const padTotal = Object.values(state.alignmentPadding).reduce((a, b) => a + b, 0);
    const totalDisplayLines = lines.length + padTotal + sepCount;
    state.display.style.minHeight = (totalDisplayLines * lineHeight) + 'px';
  }

  /**
   * Extract character ranges from tokenDiffs for a given side.
   * Returns sorted, non-overlapping [{start, end}] arrays.
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
    // Sort by start position
    ranges.sort((a, b) => a.start - b.start);
    // Merge overlapping
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

    // Insert PUA markers at diff token boundaries (before HTML escaping)
    let s = line;
    if (tokenDiffs && side) {
      const ranges = extractDiffRanges(tokenDiffs, side);
      if (ranges.length > 0) {
        // Insert markers from end to start so positions stay valid
        for (let r = ranges.length - 1; r >= 0; r--) {
          const { start, end } = ranges[r];
          const safeEnd = Math.min(end, s.length);
          const safeStart = Math.min(start, s.length);
          s = s.slice(0, safeEnd) + '\uE001' + s.slice(safeEnd);
          s = s.slice(0, safeStart) + '\uE000' + s.slice(safeStart);
        }
      }
    }

    // Escape HTML
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Apply syntax tokens (order matters — later rules can color inside earlier spans)
    // Comments first
    s = s.replace(/(\([^)]*\))/g, '<span class="gcode-comment-paren">$1</span>');
    s = s.replace(/(;.*)$/, '<span class="gcode-comment-semi">$1</span>');
    // Line numbers (N)
    s = s.replace(/\b(N\d+)\b/gi, '<span class="gcode-line-number">$1</span>');
    // Macro variables
    s = s.replace(/(#\d+)/g, '<span class="gcode-macro">$1</span>');
    // G codes
    s = s.replace(/\b(G\d+\.?\d*)\b/gi, '<span class="gcode-g">$1</span>');
    // M codes
    s = s.replace(/\b(M\d+\.?\d*)\b/gi, '<span class="gcode-m">$1</span>');
    // Tool
    s = s.replace(/\b(T\d+)\b/gi, '<span class="gcode-t">$1</span>');
    // H/D offsets
    s = s.replace(/\b([HD]\d+)\b/gi, '<span class="gcode-hd">$1</span>');
    // Feed
    s = s.replace(/\b(F-?\d+\.?\d*)\b/gi, '<span class="gcode-f">$1</span>');
    // Spindle
    s = s.replace(/\b(S\d+\.?\d*)\b/gi, '<span class="gcode-s">$1</span>');
    // X/Y axes (red)
    s = s.replace(/\b([XY]-?\d+\.?\d*)\b/gi, '<span class="gcode-xy">$1</span>');
    // Z axis (green)
    s = s.replace(/\b(Z-?\d+\.?\d*)\b/gi, '<span class="gcode-z">$1</span>');
    // Rotary ABC (green)
    s = s.replace(/\b([ABC]-?\d+\.?\d*)\b/gi, '<span class="gcode-abc">$1</span>');
    // Arc IJK (yellow)
    s = s.replace(/\b([IJK]-?\d+\.?\d*)\b/gi, '<span class="gcode-ijk">$1</span>');
    // Other params R, P, Q, L
    s = s.replace(/\b([RPQL]-?\d+\.?\d*)\b/gi, '<span class="gcode-param">$1</span>');

    // Replace PUA markers with token-diff spans (after all syntax highlighting)
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

  /**
   * Set diff decorations and alignment padding for a side.
   * decorations: array of { line, type }
   * padding: object { lineIndex: numPaddingLines } — blank lines inserted before lineIndex
   */
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
  }

  function scrollToLine(side, lineNum) {
    const state = side === 'left' ? leftState : rightState;
    if (!state) return;
    const lineHeight = 20;
    // Account for padding lines and separator rows before this line
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
    setSeparatorCallbacks, getLineCount, loadFileInto
  };
})();
