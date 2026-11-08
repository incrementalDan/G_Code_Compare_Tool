/**
 * Tool Table — compares the tool list of both files, plus the fixture line.
 *
 * Where each value comes from:
 *   Tool lines   comment-only lines "(T33 - ID=A-176 = 1/8 ENDMILL ... - OOH=0.75 - HLDR=... -LC-12)"
 *                Header list (top of file) first; tool-setting block lines fill gaps.
 *                Old posts: "(T51 - desc - HLDR=... - OOH=1.2 - PRODID=A-61 -LC-72)"
 *   Gauge        "(CHECKING LENGTH OF TOOL 62 = GAUGE 5.8865)"
 *   Used         G100 tool calls (T with X/Y, S or M3/M4), number of toolpaths
 *   Fixture      "(FIXTURE = ...)" comment
 *
 * Checks per file: used but not in the header list, listed but never used,
 * H or D on the tool call not equal to T.
 * A value is red only when BOTH files have it and it differs. A value missing
 * on one side (older posts) is shown dim, not flagged.
 * RULE: if these rules change, update js/info.js (Tool Table section).
 */

const Tools = (() => {
  const COLUMNS = [
    { key: 'id', label: 'ID' },
    { key: 'desc', label: 'Description' },
    { key: 'ooh', label: 'OOH' },
    { key: 'holder', label: 'Holder' },
    { key: 'lc', label: 'LC' },
    { key: 'gauge', label: 'Gauge' },
    { key: 'used', label: 'Toolpaths' }
  ];

  const TOOL_RE = /^T(\d+)\s*-\s*(.*)$/i;
  const GAUGE_RE = /CHECKING LENGTH OF TOOL\s*(\d+)\s*=\s*GAUGE\s*([-+]?\d*\.?\d+)/i;
  const FIXTURE_RE = /^FIXTURE\s*=\s*(.*)$/i;

  /** Split a tool comment into fields. */
  function parseToolComment(text) {
    const m = (text || '').trim().match(TOOL_RE);
    if (!m) return null;
    const t = { tool: parseInt(m[1], 10), id: '', desc: '', ooh: '', holder: '', lc: '' };
    let rest = m[2];
    const lc = rest.match(/\s*-LC-(\d*)\s*$/i);
    if (lc) { t.lc = lc[1] || ''; rest = rest.slice(0, lc.index); }
    const desc = [];
    for (let seg of rest.split(/\s+-\s+/)) {
      seg = seg.trim();
      let x;
      if ((x = seg.match(/^ID=(\S+)\s*(?:=\s*(.*))?$/i))) { t.id = x[1]; if (x[2]) desc.push(x[2].trim()); }
      else if ((x = seg.match(/^PRODID=(\S+)/i))) t.id = x[1];
      else if ((x = seg.match(/^OOH=(.*)$/i))) t.ooh = x[1].trim();
      else if ((x = seg.match(/^HLDR=(.*)$/i))) t.holder = x[1].trim();
      else if (seg) desc.push(seg);
    }
    t.desc = desc.join(' - ');
    return t;
  }

  /** Tool list, gauges, usage and fixture for one file. */
  function analyzeFile(parsed, toolpaths) {
    const tools = new Map(); // tool -> { fields, line, inHeader, gauge, used, calls, hd: [] }
    const get = n => {
      if (!tools.has(n)) tools.set(n, { tool: n, fields: null, line: -1, inHeader: false, gauge: '', used: 0, callLine: -1, warnings: [] });
      return tools.get(n);
    };
    let headerEnd = parsed.length;
    for (let i = 0; i < parsed.length; i++) {
      if (!parsed[i].isBlank && !parsed[i].isCommentOnly) { headerEnd = i; break; }
    }
    let fixture = null;
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      if (p.isCommentOnly) {
        const c = (p.comment || '').trim();
        const f = parseToolComment(c);
        if (f) {
          const e = get(f.tool);
          const header = i < headerEnd;
          // Header list wins; otherwise first line found
          if (!e.fields || (header && !e.inHeader)) { e.fields = f; e.line = i; }
          if (header) e.inHeader = true;
          continue;
        }
        const fx = c.match(FIXTURE_RE);
        if (fx && fixture === null) fixture = { text: fx[1].trim(), line: i };
      }
      for (const c of p.parenComments) {
        const g = c.match(GAUGE_RE);
        if (g) get(parseInt(g[1], 10)).gauge = g[2];
      }
    }
    // Tool calls: G100 lines that the segmenter took as tool changes
    const seen = new Set();
    for (const tp of toolpaths) {
      if (tp.type !== 'toolpath' || tp.g100Line === undefined || tp.g100Line < 0 || seen.has(tp.g100Line)) continue;
      seen.add(tp.g100Line);
      const p = parsed[tp.g100Line];
      const e = get(tp.toolNumber);
      e.used++;
      if (e.callLine < 0) e.callLine = tp.g100Line;
      if (p.hOffset !== null && p.hOffset !== tp.toolNumber) e.warnings.push(`H${p.hOffset} ≠ T${tp.toolNumber}`);
      if (p.dOffset !== null && p.dOffset !== tp.toolNumber) e.warnings.push(`D${p.dOffset} ≠ T${tp.toolNumber}`);
    }
    // Toolpaths without G100 (same tool) also count as uses of their tool
    for (const tp of toolpaths) {
      if (tp.type === 'toolpath' && (tp.g100Line === undefined || tp.g100Line < 0) && tp.toolNumber !== null && tools.has(tp.toolNumber)) {
        tools.get(tp.toolNumber).used++;
      }
    }
    for (const e of tools.values()) {
      if (e.used > 0 && !e.inHeader) e.warnings.push('not in header list');
      if (e.used === 0 && e.fields) e.warnings.push('listed, never used');
      e.warnings = [...new Set(e.warnings)];
    }
    return { tools, fixture };
  }

  function cellValue(e, key) {
    if (!e) return '';
    if (key === 'gauge') return e.gauge;
    if (key === 'used') return e.used ? String(e.used) : '';
    return e.fields ? e.fields[key] : '';
  }

  function norm(v) { return String(v || '').replace(/\s+/g, ' ').trim().toUpperCase(); }

  /** Same number, so 2 = 2.0 for OOH / gauge. */
  function sameValue(a, b) {
    const na = parseFloat(a), nb = parseFloat(b);
    if (/^[-+]?\d*\.?\d+$/.test(a) && /^[-+]?\d*\.?\d+$/.test(b)) return Math.abs(na - nb) < 1e-9;
    return norm(a) === norm(b);
  }

  /** Rows for the popup, plus the fixture comparison. */
  function compare(ctx) {
    const L = analyzeFile(ctx.leftParsed, ctx.leftToolpaths);
    const R = analyzeFile(ctx.rightParsed, ctx.rightToolpaths);
    const nums = [...new Set([...L.tools.keys(), ...R.tools.keys()])].filter(n => n !== null).sort((a, b) => a - b);
    const rows = nums.map(n => {
      const l = L.tools.get(n) || null, r = R.tools.get(n) || null;
      const cells = {};
      let changed = !l || !r;
      for (const c of COLUMNS) {
        const lv = cellValue(l, c.key), rv = cellValue(r, c.key);
        // Red only when both sides have a value. "Toolpaths" count is info only.
        const diff = c.key !== 'used' && lv !== '' && rv !== '' && !sameValue(lv, rv);
        cells[c.key] = { left: lv, right: rv, changed: diff, oneSided: (lv === '') !== (rv === '') };
        if (diff) changed = true;
      }
      const warnings = { left: l ? l.warnings : [], right: r ? r.warnings : [] };
      if (warnings.left.length || warnings.right.length) changed = true;
      return { tool: n, left: l, right: r, cells, warnings, changed };
    });
    const fl = L.fixture, fr = R.fixture;
    const fixture = {
      left: fl ? fl.text : '', right: fr ? fr.text : '',
      leftLine: fl ? fl.line : -1, rightLine: fr ? fr.line : -1,
      changed: !!(fl && fr && norm(fl.text) !== norm(fr.text))
    };
    return { rows, fixture };
  }

  // ===================== Popup =====================
  let overlay = null, last = null, onlyChanged = false;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function cellHtml(cell, oneSidedRow) {
    const l = cell.left, r = cell.right;
    if (oneSidedRow) return `<td>${esc(l || r) || '<span class="fd-none">—</span>'}</td>`;
    if (cell.changed) {
      return `<td class="fd-changed"><span class="fd-old">${esc(l)}</span>` +
        `<span class="fd-arrow">→</span><span class="fd-new">${esc(r)}</span></td>`;
    }
    if (cell.oneSided) {
      // Missing on one side: shown, not flagged
      return `<td><span class="tt-dim">${esc(l || '—')}</span><span class="fd-arrow">→</span><span class="tt-dim">${esc(r || '—')}</span></td>`;
    }
    return `<td>${esc(l || r) || '<span class="fd-none">—</span>'}</td>`;
  }

  function warnHtml(row) {
    const side = (list, name) => list.map(w => `<span class="tt-warn">${name}: ${esc(w)}</span>`).join(' ');
    return side(row.warnings.left, 'L') + ' ' + side(row.warnings.right, 'R');
  }

  function fixtureHtml(f) {
    if (!f.left && !f.right) return `<div class="tt-fixture"><b>Fixture</b> <span class="fd-none">not in either file</span></div>`;
    if (f.changed) {
      return `<div class="tt-fixture tt-fixture-changed"><b>Fixture</b> <span class="fd-old">${esc(f.left)}</span>` +
        `<span class="fd-arrow">→</span><span class="fd-new">${esc(f.right)}</span></div>`;
    }
    if (!f.left || !f.right) {
      return `<div class="tt-fixture"><b>Fixture</b> ${esc(f.left || f.right)} ` +
        `<span class="tt-dim">(only in ${f.left ? 'left' : 'right'} — not checked)</span></div>`;
    }
    return `<div class="tt-fixture"><b>Fixture</b> ${esc(f.left)} <span class="tt-dim">(same)</span></div>`;
  }

  function render() {
    const body = overlay.querySelector('.tools-body');
    if (!last || (!last.rows.length && !last.fixture.left && !last.fixture.right)) {
      body.innerHTML = '<p class="fd-empty">Load two files first. No tools found yet.</p>';
      return;
    }
    const rows = onlyChanged ? last.rows.filter(r => r.changed) : last.rows;
    const changedCount = last.rows.filter(r => r.changed).length;
    let html = fixtureHtml(last.fixture);
    html += `<div class="fd-toolbar">` +
      `<label><input type="checkbox" class="tt-only-changed"${onlyChanged ? ' checked' : ''}> Only tools with changes or warnings</label>` +
      `<span class="fd-count">${changedCount} of ${last.rows.length} tools changed or warned</span></div>`;
    html += `<div class="fd-table-wrap"><table class="fd-table"><thead><tr><th>Tool</th>`;
    for (const c of COLUMNS) html += `<th>${c.label}</th>`;
    html += `<th>Warnings</th></tr></thead><tbody>`;
    if (!rows.length) html += `<tr><td colspan="${COLUMNS.length + 2}" class="fd-none">No tool changes.</td></tr>`;
    rows.forEach((row, n) => {
      const idx = last.rows.indexOf(row);
      const only = !row.left ? '<span class="fd-only">only in right</span>' : !row.right ? '<span class="fd-only">only in left</span>' : '';
      html += `<tr class="${n % 2 ? 'fd-odd' : 'fd-even'}${row.changed ? ' fd-row-changed' : ''}">` +
        `<td class="fd-name"><a href="#" data-row="${idx}" title="Jump to this tool"><span class="fd-tool">T${row.tool}</span></a>${only}</td>`;
      for (const c of COLUMNS) html += cellHtml(row.cells[c.key], !row.left || !row.right);
      html += `<td class="tt-warn-cell">${warnHtml(row)}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    body.innerHTML = html;
  }

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'tools-overlay';
    overlay.className = 'popup-overlay';
    overlay.innerHTML =
      `<div class="popup-dialog feeds-dialog" role="dialog" aria-modal="true" aria-labelledby="tools-title">` +
      `<div class="info-head"><h2 id="tools-title">Tool Table</h2>` +
      `<button class="info-close" aria-label="Close">&#10005;</button></div>` +
      `<p class="fd-note">From the tool comment lines, length-check gauges and G100 tool calls. ` +
      `Changed values show <span class="fd-old">left</span> → <span class="fd-new">right</span> in red. ` +
      `A value in one file only is shown <span class="tt-dim">dim</span>, not flagged. Click a tool to jump to it.</p>` +
      `<div class="tools-body"></div></div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.info-close')) return close();
      const a = e.target.closest('.fd-name a');
      if (a) {
        e.preventDefault();
        const row = last.rows[+a.dataset.row];
        const line = t => t.callLine >= 0 ? t.callLine : t.line;
        if (row.left && line(row.left) >= 0) Editor.scrollToLine('left', line(row.left));
        if (row.right && line(row.right) >= 0) Editor.scrollToLine('right', line(row.right));
        close();
      }
    });
    overlay.addEventListener('change', (e) => {
      if (e.target.classList.contains('tt-only-changed')) { onlyChanged = e.target.checked; render(); }
    });
  }

  function open() {
    if (!overlay) build();
    const ctx = App.getDiffContext();
    last = ctx ? compare(ctx) : null;
    render();
    overlay.classList.add('open');
    overlay.querySelector('.info-close').focus();
  }

  function close() {
    if (overlay) overlay.classList.remove('open');
  }

  if (typeof document !== 'undefined') { // not in Node tests
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) close();
    });
    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('btn-tools');
      if (btn) btn.addEventListener('click', open);
    });
  }

  return { parseToolComment, analyzeFile, compare, open, close, COLUMNS };
})();
