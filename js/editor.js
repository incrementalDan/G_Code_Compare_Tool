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
      decorations: {},  // lineIndex -> type
      filename: 'untitled',
      alignmentPadding: {} // lineIndex -> number of padding lines to insert BEFORE this line
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
  function render(state) {
    const lines = state.content.split('\n');
    let html = '';

    for (let i = 0; i < lines.length; i++) {
      // Insert alignment padding lines before this line
      const padding = state.alignmentPadding[i] || 0;
      for (let p = 0; p < padding; p++) {
        html += `<div class="editor-line padding-line"><span class="line-num"></span><span class="line-content">&nbsp;</span></div>`;
      }

      const type = state.decorations[i];
      const bgClass = type ? `diff-bg-${type}` : '';
      const highlighted = syntaxHighlightLine(lines[i]);
      html += `<div class="editor-line ${bgClass}"><span class="line-num">${i + 1}</span><span class="line-content">${highlighted || '&nbsp;'}</span></div>`;
    }

    state.display.innerHTML = html;

    // Ensure the display is tall enough
    const lineHeight = 20;
    const totalDisplayLines = lines.length + Object.values(state.alignmentPadding).reduce((a, b) => a + b, 0);
    state.display.style.minHeight = (totalDisplayLines * lineHeight) + 'px';
  }

  function syntaxHighlightLine(line) {
    if (!line) return '';

    // Escape HTML
    let s = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Apply syntax tokens (order matters)
    // Comments first — they should override inner matches
    s = s.replace(/(\([^)]*\))/g, '<span class="gcode-comment-paren">$1</span>');
    s = s.replace(/(;.*)$/, '<span class="gcode-comment-semi">$1</span>');
    // Line numbers
    s = s.replace(/^(N\d+)/i, '<span class="gcode-line-number">$1</span>');
    // Macro variables
    s = s.replace(/(#\d+)/g, '<span class="gcode-macro">$1</span>');
    // G codes
    s = s.replace(/\b(G\d+\.?\d*)\b/gi, '<span class="gcode-g">$1</span>');
    // M codes
    s = s.replace(/\b(M\d+\.?\d*)\b/gi, '<span class="gcode-m">$1</span>');
    // Tool
    s = s.replace(/\b(T\d+)\b/gi, '<span class="gcode-t">$1</span>');
    // Feed
    s = s.replace(/\b(F\d+\.?\d*)\b/gi, '<span class="gcode-f">$1</span>');
    // Spindle
    s = s.replace(/\b(S\d+\.?\d*)\b/gi, '<span class="gcode-s">$1</span>');
    // Axes XYZ
    s = s.replace(/\b([XYZ]-?\d+\.?\d*)\b/gi, '<span class="gcode-xyz">$1</span>');
    // Axes ABC
    s = s.replace(/\b([ABC]-?\d+\.?\d*)\b/gi, '<span class="gcode-abc">$1</span>');
    // Arc IJK
    s = s.replace(/\b([IJK]-?\d+\.?\d*)\b/gi, '<span class="gcode-ijk">$1</span>');

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
  function setDecorations(side, decorations, padding) {
    const state = side === 'left' ? leftState : rightState;
    if (!state) return;

    state.decorations = {};
    for (const d of decorations) {
      state.decorations[d.line] = d.type;
    }
    state.alignmentPadding = padding || {};
    render(state);
  }

  function scrollToLine(side, lineNum) {
    const state = side === 'left' ? leftState : rightState;
    if (!state) return;
    const lineHeight = 20;
    // Account for padding lines before this line
    let displayLine = lineNum;
    for (let i = 0; i <= lineNum; i++) {
      displayLine += (state.alignmentPadding[i] || 0);
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
    getLineCount, loadFileInto
  };
})();
