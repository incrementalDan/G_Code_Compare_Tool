/**
 * Feeds & Speeds — per-toolpath summary and left/right comparison.
 *
 * The NC code does not say which feed is which (Fusion knows, the post does not
 * write it), so feed types are worked out from how the tool moves:
 *
 *   Spindle RPM  S on the G100 / M03 line (or inherited from the previous toolpath)  exact
 *   Ramp RPM     a lone S line (no M03/G100) that differs from the spindle RPM        exact
 *   Plunge       Z-only feed move going down, at the start of an engagement
 *   Ramp         feed move going down in Z while moving X/Y, at the start of an engagement
 *   Lead-in      start of an engagement: vertical-plane arc (G18/G19), G41/G42 move,
 *                or short different-feed moves before the main cut feed
 *   Cut          the feed that covers the most distance in each engagement
 *   Lead-out     end of an engagement: vertical-plane arc, G40 move, rising X/Y/Z move,
 *                or short different-feed moves after the main cut feed
 *   Transition   feed higher than the cut feed inside an engagement
 *   High feed    the post's high feedrate (200 inch / 5000 mm), used for linking
 *   Retract      Z-only feed move going up
 *   Cycle        feed on a drilling / tapping cycle line (G73-G89)
 *   Other        feed lower than the cut feed inside an engagement (reduced feed)
 *
 * An "engagement" is the run of feed moves between two rapid (G0) moves.
 * RULE: if these rules change, update js/info.js (Feeds & Speeds section).
 */

const Feeds = (() => {
  const EPS = 1e-5;
  const COLUMNS = [
    { key: 'rpm', label: 'RPM', exact: true },
    { key: 'rampRpm', label: 'Ramp RPM', exact: true },
    { key: 'plunge', label: 'Plunge' },
    { key: 'ramp', label: 'Ramp' },
    { key: 'leadIn', label: 'Lead-in' },
    { key: 'cut', label: 'Cut' },
    { key: 'leadOut', label: 'Lead-out' },
    { key: 'transition', label: 'Transition' },
    { key: 'highFeed', label: 'High feed' },
    { key: 'retract', label: 'Retract' },
    { key: 'cycle', label: 'Cycle' },
    { key: 'other', label: 'Other' }
  ];

  const num = c => parseFloat(String(c).replace(/^[A-Z]/i, ''));
  const round = v => Math.round(v * 10000) / 10000;

  // =====================================================
  // Analysis
  // =====================================================

  function emptyResult() {
    const r = { rpm: new Map(), rampRpm: new Map(), allF: new Map() };
    for (const c of COLUMNS) if (!r[c.key]) r[c.key] = new Map();
    return r;
  }

  function add(map, value, amount) {
    const v = round(value);
    map.set(v, (map.get(v) || 0) + (amount || 1));
  }

  /**
   * Analyze every toolpath in one file.
   * Returns Map toolpathId -> result (Maps of value -> weight per column).
   */
  function analyzeFile(parsed, toolpaths) {
    const out = new Map();
    const metric = parsed.some(p => p.gCodes.some(g => num(g) === 21));
    const highFeedrate = metric ? 5000 : 200;

    // Machine state carried through the whole file
    const st = { x: null, y: null, z: null, motion: null, cycle: false, f: null,
                 plane: 17, incremental: false, rpm: null };

    for (const tp of toolpaths) {
      const res = emptyResult();
      out.set(tp.id, res);
      if (tp.type !== 'toolpath') { runLines(parsed, tp, st, null, highFeedrate); continue; }
      runLines(parsed, tp, st, res, highFeedrate);
    }
    return out;
  }

  function runLines(parsed, tp, st, res, highFeedrate) {
    let mainRpm = null;
    let segment = [];
    const segments = [];
    const endSegment = () => { if (segment.length) segments.push(segment); segment = []; };

    for (let i = tp.startLine; i <= tp.endLine && i < parsed.length; i++) {
      const p = parsed[i];
      if (p.isBlank || p.isCommentOnly || p.isMacroStatement) continue;
      const codes = p.gCodes.map(num);
      const ms = p.mCodes.map(num);

      for (const c of codes) {
        if (c === 17 || c === 18 || c === 19) st.plane = c;
        if (c === 90) st.incremental = false;
        if (c === 91) st.incremental = true;
        if (c === 80) st.cycle = false;
        if (c >= 73 && c <= 89 && c !== 80) st.cycle = true;
        if (c >= 0 && c <= 3) { st.motion = c; st.cycle = false; }
      }
      if (p.feed !== null) {
        st.f = p.feed;
        if (res) add(res.allF, p.feed);
      }

      // Spindle
      if (p.spindle !== null) {
        const toolCall = codes.includes(100) || ms.includes(3) || ms.includes(4);
        if (toolCall || mainRpm === null && st.rpm === null) {
          mainRpm = p.spindle; st.rpm = p.spindle;
        } else if (res && Math.abs(p.spindle - (mainRpm ?? st.rpm)) > EPS) {
          add(res.rampRpm, p.spindle);
        }
      }

      const hasAxes = 'X' in p.axes || 'Y' in p.axes || 'Z' in p.axes;
      if (!hasAxes) continue;

      // Moves that don't follow the normal coordinates
      if (codes.includes(28) || codes.includes(53) || st.incremental) {
        if (codes.includes(28) || codes.includes(53)) { st.x = st.y = st.z = null; }
        endSegment();
        continue;
      }

      const nx = p.axes.X ?? st.x, ny = p.axes.Y ?? st.y, nz = p.axes.Z ?? st.z;

      if (st.cycle) {
        if (res && st.f !== null) add(res.cycle, st.f);
        st.x = nx; st.y = ny; // cycle returns to R/initial Z
        endSegment();
        continue;
      }

      if (codes.includes(100) || st.motion === 0 || st.motion === null) {
        endSegment();
        st.x = nx; st.y = ny; st.z = nz;
        continue;
      }

      // Feed move (G1/G2/G3)
      const known = st.x !== null && st.y !== null && st.z !== null;
      const dx = known ? nx - st.x : 0, dy = known ? ny - st.y : 0, dz = known ? nz - st.z : 0;
      const dxy = Math.hypot(dx, dy);
      const isArc = st.motion === 2 || st.motion === 3;
      segment.push({
        f: st.f,
        dz, dxy,
        len: Math.hypot(dxy, dz) || EPS,
        vertArc: isArc && st.plane !== 17,
        compOn: codes.includes(41) || codes.includes(42),
        compOff: codes.includes(40)
      });
      st.x = nx; st.y = ny; st.z = nz;
    }
    endSegment();

    if (!res) return;
    if (mainRpm === null && st.rpm !== null) mainRpm = st.rpm; // same-tool toolpath inherits
    if (mainRpm !== null) add(res.rpm, mainRpm);

    for (const seg of segments) classifySegment(seg, res, highFeedrate);
  }

  function classifySegment(seg, res, highFeedrate) {
    const put = (key, m) => { if (m.f !== null) add(res[key], m.f, m.len); };
    const isHigh = m => m.f !== null && Math.abs(m.f - highFeedrate) < EPS;

    // Entry moves
    let a = 0;
    while (a < seg.length) {
      const m = seg[a];
      if (isHigh(m)) break;
      if (m.vertArc || m.compOn) put('leadIn', m);
      else if (m.dz < -EPS && m.dxy < EPS) put('plunge', m);
      else if (m.dz < -EPS) put('ramp', m);
      else break;
      a++;
    }
    // Exit moves
    let b = seg.length - 1;
    while (b >= a) {
      const m = seg[b];
      if (isHigh(m)) break;
      if (m.vertArc || m.compOff) put('leadOut', m);
      else if (m.dz > EPS && m.dxy < EPS) put('retract', m);
      else if (m.dz > EPS) put('leadOut', m);
      else break;
      b--;
    }

    const mid = seg.slice(a, b + 1);
    if (!mid.length) return;

    // Main cut feed = most distance (ignoring high feed links)
    const byF = new Map();
    let total = 0;
    for (const m of mid) {
      if (m.f === null || isHigh(m)) continue;
      byF.set(m.f, (byF.get(m.f) || 0) + m.len);
      total += m.len;
    }
    let cutF = null, best = -1;
    for (const [f, l] of byF) if (l > best) { best = l; cutF = f; }

    // Short different-feed runs right before / after the main cut = leads
    let s = 0, sLen = 0;
    while (s < mid.length && mid[s].f !== cutF && !isHigh(mid[s])) { sLen += mid[s].len; s++; }
    let e = mid.length - 1, eLen = 0;
    while (e > s && mid[e].f !== cutF && !isHigh(mid[e])) { eLen += mid[e].len; e--; }
    const leadsOk = len => len < 0.5 * total;

    mid.forEach((m, idx) => {
      if (isHigh(m)) return put('highFeed', m);
      if (idx < s && leadsOk(sLen)) return put('leadIn', m);
      if (idx > e && leadsOk(eLen)) return put('leadOut', m);
      if (m.f === cutF) return put('cut', m);
      if (cutF !== null && m.f > cutF) return put('transition', m);
      return put('other', m);
    });
  }

  // =====================================================
  // Comparison
  // =====================================================

  /** Values of a column, biggest weight first. */
  function values(map) {
    return [...map.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);
  }

  function sameSet(a, b) {
    if (a.size !== b.size) return false;
    for (const k of a.keys()) if (!b.has(k)) return false;
    return true;
  }

  /**
   * Build comparison rows from tpMatches.
   * Each row: { left, right, cells: {key: {left:[...], right:[...], changed}}, changed, allF }
   */
  function compare(ctx) {
    const leftRes = analyzeFile(ctx.leftParsed, ctx.leftToolpaths);
    const rightRes = analyzeFile(ctx.rightParsed, ctx.rightToolpaths);
    const rows = [];
    for (const m of ctx.tpMatches) {
      const tp = m.left || m.right;
      if (tp.type !== 'toolpath') continue;
      const L = m.left ? leftRes.get(m.left.id) : null;
      const R = m.right ? rightRes.get(m.right.id) : null;
      const row = { left: m.left, right: m.right, cells: {}, changed: !L || !R };
      for (const c of COLUMNS) {
        const lm = L ? L[c.key] : new Map(), rm = R ? R[c.key] : new Map();
        const changed = !!L && !!R && !sameSet(lm, rm);
        row.cells[c.key] = { left: values(lm), right: values(rm), changed };
        if (changed) row.changed = true;
      }
      const lf = L ? L.allF : new Map(), rf = R ? R.allF : new Map();
      row.allF = { left: lf, right: rf, changed: !!L && !!R && !sameSet(lf, rf) };
      if (row.allF.changed) row.changed = true;
      rows.push(row);
    }
    return rows;
  }

  // =====================================================
  // Popup
  // =====================================================

  let overlay = null;
  let onlyChanged = false;
  let lastRows = [];

  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = arr => arr.length ? arr.map(v => String(v)).join(' / ') : '';

  function tpLabel(tp) {
    if (!tp) return '';
    const t = tp.toolNumber !== null && tp.toolNumber !== undefined ? 'T' + tp.toolNumber : '';
    return `<span class="fd-tool">${esc(t)}</span> ${esc(tp.name || 'Section ' + tp.id)}` +
      (tp.opType ? ` <span class="fd-strategy">${esc(tp.opType)}</span>` : '');
  }

  function cellHtml(cell) {
    const l = fmt(cell.left), r = fmt(cell.right);
    if (!cell.changed) return `<td>${esc(l || r) || '<span class="fd-none">—</span>'}</td>`;
    return `<td class="fd-changed"><span class="fd-old">${esc(l || '—')}</span>` +
      `<span class="fd-arrow">→</span><span class="fd-new">${esc(r || '—')}</span></td>`;
  }

  function allFHtml(row) {
    const side = (map, cls) => {
      if (!map.size) return '<span class="fd-none">—</span>';
      return [...map.entries()].sort((x, y) => x[0] - y[0])
        .map(([f, n]) => `<span class="fd-fchip ${cls}">F${esc(f)} <small>×${n}</small></span>`).join(' ');
    };
    return `<div class="fd-allf"><div><b>Left</b> ${side(row.allF.left, '')}</div>` +
      `<div><b>Right</b> ${side(row.allF.right, '')}</div></div>`;
  }

  function render() {
    const body = overlay.querySelector('.feeds-body');
    if (!lastRows.length) {
      body.innerHTML = '<p class="fd-empty">Load two files first. No toolpaths found yet.</p>';
      return;
    }
    const rows = onlyChanged ? lastRows.filter(r => r.changed) : lastRows;
    const changedCount = lastRows.filter(r => r.changed).length;
    let html = `<div class="fd-toolbar">` +
      `<label><input type="checkbox" class="fd-only-changed"${onlyChanged ? ' checked' : ''}> Only toolpaths with changes</label>` +
      `<span class="fd-count">${changedCount} of ${lastRows.length} toolpaths changed</span></div>`;
    html += `<div class="fd-table-wrap"><table class="fd-table"><thead><tr><th>Toolpath</th>`;
    for (const c of COLUMNS) html += `<th${c.exact ? ' class="fd-exact"' : ''}>${c.label}</th>`;
    html += `<th>All F</th></tr></thead><tbody>`;
    if (!rows.length) html += `<tr><td colspan="${COLUMNS.length + 2}" class="fd-none">No changes in feeds or speeds.</td></tr>`;
    rows.forEach((row, n) => {
      const idx = lastRows.indexOf(row);
      const stripe = n % 2 ? 'fd-odd' : 'fd-even';
      const only = !row.left ? '<span class="fd-only">only in right</span>' : !row.right ? '<span class="fd-only">only in left</span>' : '';
      html += `<tr class="${stripe}${row.changed ? ' fd-row-changed' : ''}">` +
        `<td class="fd-name"><a href="#" data-row="${idx}" title="Jump to this toolpath">${tpLabel(row.left || row.right)}</a>${only}</td>`;
      for (const c of COLUMNS) html += cellHtml(row.cells[c.key]);
      html += `<td><button class="fd-allf-btn${row.allF.changed ? ' fd-changed-btn' : ''}" data-row="${idx}">F list</button></td></tr>`;
      html += `<tr class="fd-allf-row ${stripe}" data-for="${idx}" hidden><td colspan="${COLUMNS.length + 2}">${allFHtml(row)}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    body.innerHTML = html;
  }

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'feeds-overlay';
    overlay.className = 'popup-overlay';
    overlay.innerHTML =
      `<div class="popup-dialog feeds-dialog" role="dialog" aria-modal="true" aria-labelledby="feeds-title">` +
      `<div class="info-head"><h2 id="feeds-title">Feeds &amp; Speeds</h2>` +
      `<button class="info-close" aria-label="Close">&#10005;</button></div>` +
      `<p class="fd-note">RPM and Ramp RPM are exact. Feed types are <b>likely</b> — worked out from how the tool moves. ` +
      `Changed values show <span class="fd-old">left</span> → <span class="fd-new">right</span>. ` +
      `<b>F list</b> shows every feed used, so nothing is hidden.</p>` +
      `<div class="feeds-body"></div></div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.info-close')) return close();
      const btn = e.target.closest('.fd-allf-btn');
      if (btn) {
        const tr = overlay.querySelector(`.fd-allf-row[data-for="${btn.dataset.row}"]`);
        tr.hidden = !tr.hidden;
        return;
      }
      const a = e.target.closest('.fd-name a');
      if (a) {
        e.preventDefault();
        const row = lastRows[+a.dataset.row];
        const line = tp => tp.anchorLine >= 0 ? tp.anchorLine : tp.startLine;
        if (row.left) Editor.scrollToLine('left', line(row.left));
        if (row.right) Editor.scrollToLine('right', line(row.right));
        close();
      }
    });
    overlay.addEventListener('change', (e) => {
      if (e.target.classList.contains('fd-only-changed')) { onlyChanged = e.target.checked; render(); }
    });
  }

  function open() {
    if (!overlay) build();
    const ctx = App.getDiffContext();
    lastRows = ctx ? compare(ctx) : [];
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
      const btn = document.getElementById('btn-feeds');
      if (btn) btn.addEventListener('click', open);
    });
  }

  return { analyzeFile, compare, open, close, COLUMNS };
})();
