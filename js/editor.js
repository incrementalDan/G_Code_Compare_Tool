/**
 * Editor Module
 * CodeMirror 6 setup with G-code syntax highlighting and drag-drop.
 * Falls back to plain textareas if CM6 fails to load.
 */

const Editor = (() => {
  // We'll use a simpler approach: CodeMirror 5 from CDN (much easier to set up)
  // or plain textareas with manual syntax highlighting overlay.
  // Given the CDN constraints, we'll use a lightweight custom editor.

  let leftEditor = null;
  let rightEditor = null;
  let onChangeCallback = null;
  let syncScrollEnabled = true;
  let isScrolling = false;

  // Diff decoration state
  let leftDecorations = []; // array of { line, type }
  let rightDecorations = [];

  function init(leftEl, rightEl, onChange) {
    onChangeCallback = onChange;
    leftEditor = createEditor(leftEl, 'left');
    rightEditor = createEditor(rightEl, 'right');
    setupSyncScroll();
  }

  function createEditor(container, side) {
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-editor-wrapper';
    wrapper.style.cssText = 'height:100%;display:flex;position:relative;';

    // Line numbers gutter
    const gutter = document.createElement('div');
    gutter.className = 'editor-gutter';
    gutter.style.cssText = `
      width:48px; min-width:48px; overflow:hidden; background:#0d0d1a;
      color:#444; font-family:var(--font-mono); font-size:13px;
      line-height:20px; text-align:right; padding:4px 6px 4px 0;
      user-select:none; border-right:1px solid var(--border);
    `;

    // Highlighted overlay (positioned behind textarea)
    const highlightLayer = document.createElement('div');
    highlightLayer.className = 'editor-highlight-layer';
    highlightLayer.style.cssText = `
      position:absolute; top:0; left:49px; right:0; bottom:0;
      overflow:hidden; pointer-events:none;
      font-family:var(--font-mono); font-size:13px; line-height:20px;
      padding:4px 8px; white-space:pre; color:transparent;
    `;

    // Textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'editor-textarea';
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.style.cssText = `
      flex:1; background:transparent; color:var(--text);
      font-family:var(--font-mono); font-size:13px; line-height:20px;
      border:none; outline:none; resize:none; padding:4px 8px;
      tab-size:4; white-space:pre; overflow:auto; position:relative;
      z-index:1; caret-color: var(--text);
    `;

    // Syntax highlight overlay (on top of highlight layer but behind textarea caret)
    const syntaxLayer = document.createElement('pre');
    syntaxLayer.className = 'editor-syntax-layer';
    syntaxLayer.style.cssText = `
      position:absolute; top:0; left:49px; right:0; bottom:0;
      overflow:hidden; pointer-events:none;
      font-family:var(--font-mono); font-size:13px; line-height:20px;
      padding:4px 8px; margin:0; white-space:pre;
      color:var(--text); z-index:0;
    `;

    wrapper.appendChild(gutter);
    wrapper.appendChild(highlightLayer);
    wrapper.appendChild(syntaxLayer);
    wrapper.appendChild(textarea);
    container.appendChild(wrapper);

    // Sync scroll between layers
    textarea.addEventListener('scroll', () => {
      highlightLayer.scrollTop = textarea.scrollTop;
      highlightLayer.scrollLeft = textarea.scrollLeft;
      syntaxLayer.scrollTop = textarea.scrollTop;
      syntaxLayer.scrollLeft = textarea.scrollLeft;
      updateGutter(gutter, textarea);
    });

    // Debounced change handler
    let debounceTimer = null;
    textarea.addEventListener('input', () => {
      updateSyntax(syntaxLayer, textarea.value);
      updateHighlight(highlightLayer, textarea.value, side === 'left' ? leftDecorations : rightDecorations);
      updateGutter(gutter, textarea);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (onChangeCallback) onChangeCallback();
      }, 300);
    });

    // Track cursor position
    textarea.addEventListener('click', updateCursorPos);
    textarea.addEventListener('keyup', updateCursorPos);

    // Tab key support
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        textarea.dispatchEvent(new Event('input'));
      }
    });

    // Drag and drop
    setupDragDrop(container, side);

    return { textarea, gutter, highlightLayer, syntaxLayer, wrapper };
  }

  function updateCursorPos(e) {
    const textarea = e.target;
    const val = textarea.value.substring(0, textarea.selectionStart);
    const lines = val.split('\n');
    const ln = lines.length;
    const col = lines[lines.length - 1].length + 1;
    const el = document.getElementById('stat-cursor');
    if (el) el.textContent = `Ln ${ln}, Col ${col}`;
  }

  function updateGutter(gutter, textarea) {
    const lineCount = textarea.value.split('\n').length;
    const scrollTop = textarea.scrollTop;
    const lineHeight = 20;
    const startLine = Math.floor(scrollTop / lineHeight);
    const visibleLines = Math.ceil(textarea.clientHeight / lineHeight) + 2;

    let html = '';
    const paddingTop = startLine * lineHeight;
    html += `<div style="height:${paddingTop}px"></div>`;
    for (let i = startLine; i < Math.min(startLine + visibleLines, lineCount); i++) {
      html += `<div style="height:${lineHeight}px;line-height:${lineHeight}px">${i + 1}</div>`;
    }
    gutter.innerHTML = html;
    gutter.scrollTop = 0; // We use virtual positioning
  }

  function syntaxHighlightLine(line) {
    // Escape HTML first
    let escaped = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Apply syntax highlighting with spans
    // Order matters: comments first (they override everything inside)
    // Paren comments
    escaped = escaped.replace(/(\([^)]*\))/g, '<span class="gcode-comment-paren">$1</span>');
    // Semi comments
    escaped = escaped.replace(/(;.*)$/, '<span class="gcode-comment-semi">$1</span>');
    // Line numbers
    escaped = escaped.replace(/^(N\d+)/i, '<span class="gcode-line-number">$1</span>');
    // Macro variables
    escaped = escaped.replace(/(#\d+)/g, '<span class="gcode-macro">$1</span>');
    // G codes
    escaped = escaped.replace(/\b(G\d+\.?\d*)\b/gi, '<span class="gcode-g">$1</span>');
    // M codes
    escaped = escaped.replace(/\b(M\d+\.?\d*)\b/gi, '<span class="gcode-m">$1</span>');
    // Tool
    escaped = escaped.replace(/\b(T\d+)\b/gi, '<span class="gcode-t">$1</span>');
    // Feed
    escaped = escaped.replace(/\b(F\d+\.?\d*)\b/gi, '<span class="gcode-f">$1</span>');
    // Spindle
    escaped = escaped.replace(/\b(S\d+\.?\d*)\b/gi, '<span class="gcode-s">$1</span>');
    // Axes XYZ
    escaped = escaped.replace(/\b([XYZ]-?\d+\.?\d*)\b/gi, '<span class="gcode-xyz">$1</span>');
    // Axes ABC
    escaped = escaped.replace(/\b([ABC]-?\d+\.?\d*)\b/gi, '<span class="gcode-abc">$1</span>');
    // Arc IJK
    escaped = escaped.replace(/\b([IJK]-?\d+\.?\d*)\b/gi, '<span class="gcode-ijk">$1</span>');

    return escaped;
  }

  function updateSyntax(syntaxLayer, text) {
    const lines = text.split('\n');
    syntaxLayer.innerHTML = lines.map(syntaxHighlightLine).join('\n');
  }

  function updateHighlight(highlightLayer, text, decorations) {
    const lines = text.split('\n');
    const decoMap = {};
    for (const d of decorations) {
      decoMap[d.line] = d.type;
    }

    let html = '';
    for (let i = 0; i < lines.length; i++) {
      const type = decoMap[i];
      const bgClass = type ? `cm-diff-${type}` : '';
      const borderClass = type ? `cm-diff-${type}-marker` : '';
      const cls = [bgClass, borderClass].filter(Boolean).join(' ');
      // Use non-breaking space to ensure empty lines have height
      const content = lines[i].length === 0 ? '&nbsp;' : '&nbsp;'.repeat(lines[i].length);
      html += `<div class="${cls}" style="height:20px;line-height:20px;padding-left:${type ? '0' : '3px'}">${content}</div>`;
    }
    highlightLayer.innerHTML = html;
  }

  function setupSyncScroll() {
    if (!leftEditor || !rightEditor) return;

    leftEditor.textarea.addEventListener('scroll', () => {
      if (!syncScrollEnabled || isScrolling) return;
      isScrolling = true;
      rightEditor.textarea.scrollTop = leftEditor.textarea.scrollTop;
      setTimeout(() => { isScrolling = false; }, 10);
    });

    rightEditor.textarea.addEventListener('scroll', () => {
      if (!syncScrollEnabled || isScrolling) return;
      isScrolling = true;
      leftEditor.textarea.scrollTop = rightEditor.textarea.scrollTop;
      setTimeout(() => { isScrolling = false; }, 10);
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

      if (files.length >= 2 && side === 'left') {
        // Two files dropped on left → load both
        loadFileInto(files[0], 'left');
        loadFileInto(files[1], 'right');
      } else if (files.length >= 2 && side === 'right') {
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
    // Store in localStorage
    localStorage.setItem(`gcode-compare-${side}-filename`, name);
  }

  function getFilename(side) {
    const el = document.getElementById(side === 'left' ? 'left-filename' : 'right-filename');
    return el ? el.textContent : 'untitled';
  }

  function getValue(side) {
    const editor = side === 'left' ? leftEditor : rightEditor;
    return editor ? editor.textarea.value : '';
  }

  function setValue(side, text) {
    const editor = side === 'left' ? leftEditor : rightEditor;
    if (editor) {
      editor.textarea.value = text;
      updateSyntax(editor.syntaxLayer, text);
      updateHighlight(editor.highlightLayer, text, side === 'left' ? leftDecorations : rightDecorations);
      updateGutter(editor.gutter, editor.textarea);
    }
  }

  function setDecorations(side, decorations) {
    if (side === 'left') {
      leftDecorations = decorations;
      if (leftEditor) {
        updateHighlight(leftEditor.highlightLayer, leftEditor.textarea.value, decorations);
      }
    } else {
      rightDecorations = decorations;
      if (rightEditor) {
        updateHighlight(rightEditor.highlightLayer, rightEditor.textarea.value, decorations);
      }
    }
  }

  function scrollToLine(side, lineNum) {
    const editor = side === 'left' ? leftEditor : rightEditor;
    if (!editor) return;
    const lineHeight = 20;
    const targetScroll = lineNum * lineHeight - editor.textarea.clientHeight / 2;
    editor.textarea.scrollTop = Math.max(0, targetScroll);
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
