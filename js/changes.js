/**
 * Changes — one summary of what actually changed, grouped so a repeated
 * change reads as one decision (e.g. "F30 → F31.4 (+5%) ×22").
 *
 * The grouping itself is DiffEngine.summarizeChanges; this file only shows it.
 *   Feed changes   every F change in the file, biggest % change first
 *   By toolpath    status tags + feeds, uniform shifts, lead-in, recalculated, other
 * Click any item to jump to its first line.
 */
const Changes = (() => {
  let overlay = null;
  let summaries = [];
  let ops = [];
  let showUnchanged = false;

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = v => (typeof v === 'number' ? String(+v.toFixed(4)) : (v === null || v === undefined ? '—' : String(v)));

  function tpLabel(tp) {
    if (!tp) return '';
    if (tp.type === 'preamble') return 'Program Header';
    if (tp.type === 'program_end') return 'Program End';
    const t = tp.toolNumber !== null && tp.toolNumber !== undefined ? 'T' + tp.toolNumber : '';
    return `${tp.nNumber ? `<span class="ch-n">${esc(tp.nNumber)}</span> ` : ''}<span class="fd-tool">${esc(t)}</span> ${esc(tp.name || 'Section ' + tp.id)}` +
      (tp.opType ? ` <span class="fd-strategy">${esc(tp.opType)}</span>` : '');
  }

  function pctHtml(pct) {
    if (pct === null || pct === undefined) return '';
    const big = Math.abs(pct) >= 20;
    const sign = pct > 0 ? '+' : '';
    return `<span class="ch-pct${big ? ' ch-pct-big' : ''}">${sign}${pct.toFixed(0)}%</span>`;
  }

  function feedHtml(f) {
    const fv = v => (typeof v === 'number' ? 'F' + num(v) : 'no F');
    return `<span class="fd-old">${esc(fv(f.from))}</span><span class="fd-arrow">→</span>` +
      `<span class="fd-new">${esc(fv(f.to))}</span> ${pctHtml(f.pct)} <small>×${f.count}</small>`;
  }

  function tagHtml(tag) {
    const cls = tag === 'no change' ? 'ch-tag-ok' : /recalculated|only in/.test(tag) ? 'ch-tag-big' : '';
    return `<span class="ch-tag ${cls}">${esc(tag)}</span>`;
  }

  const link = (at, html) => `<a href="#" class="ch-jump" data-op="${at}">${html}</a>`;

  function render() {
    const body = overlay.querySelector('.changes-body');
    if (!summaries.length) {
      body.innerHTML = '<p class="fd-empty">Load two files first.</p>';
      return;
    }
    const changed = summaries.filter(s => !s.tags.includes('no change'));
    let html = `<div class="fd-toolbar"><label><input type="checkbox" class="ch-show-all"${showUnchanged ? ' checked' : ''}> Show unchanged toolpaths</label>` +
      `<span class="fd-count">${changed.length} of ${summaries.length} toolpaths changed</span></div>`;

    // Every feed change in the file, biggest % first
    const feeds = [];
    summaries.forEach(s => s.feeds.forEach(f => feeds.push({ f, s })));
    feeds.sort((a, b) => Math.abs(b.f.pct ?? 1e9) - Math.abs(a.f.pct ?? 1e9));
    html += `<h3 class="ch-head">Feed changes</h3>`;
    if (!feeds.length) html += `<p class="fd-none">No feed changes.</p>`;
    else {
      html += `<table class="fd-table ch-table"><tbody>`;
      feeds.forEach(({ f, s }, n) => {
        html += `<tr class="${n % 2 ? 'fd-odd' : 'fd-even'}"><td>${link(f.first, feedHtml(f))}</td><td class="fd-name">${tpLabel(s.left || s.right)}</td></tr>`;
      });
      html += `</tbody></table>`;
    }

    html += `<h3 class="ch-head">By toolpath</h3><table class="fd-table ch-table"><thead><tr><th>Toolpath</th><th>Status</th><th>Details</th></tr></thead><tbody>`;
    const rows = showUnchanged ? summaries : changed;
    rows.forEach((s, n) => {
      const items = [];
      for (const f of s.feeds) items.push(link(f.first, feedHtml(f)));
      for (const sh of s.shifts) {
        items.push(link(sh.first, `<b>${sh.axis}</b> ${sh.delta > 0 ? '+' : ''}${esc(num(sh.delta))} on ${sh.count} of ${sh.total} ${sh.axis} lines`));
      }
      if (s.leadIn) items.push(link(s.leadIn.first, `Lead-in / lead-out changed (${s.leadIn.count} line${s.leadIn.count === 1 ? '' : 's'})`));
      if (s.recalculated) items.push(`<span class="ch-warn">Many moves exist on one side only — toolpath was likely recalculated</span>`);
      if (s.other) items.push(link(s.otherFirst, `${s.other} other changed line${s.other === 1 ? '' : 's'}`));
      html += `<tr class="${n % 2 ? 'fd-odd' : 'fd-even'}"><td class="fd-name">${tpLabel(s.left || s.right)}</td>` +
        `<td>${s.tags.map(tagHtml).join(' ')}</td><td class="ch-items">${items.join('<br>') || '<span class="fd-none">—</span>'}</td></tr>`;
    });
    html += `</tbody></table>`;
    body.innerHTML = html;
  }

  function jump(at) {
    const op = ops[at];
    if (!op) return;
    if (op.leftIdx !== undefined) App.jumpTo('left', op.leftIdx);
    if (op.rightIdx !== undefined) App.jumpTo('right', op.rightIdx);
  }

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'changes-overlay';
    overlay.className = 'popup-overlay';
    overlay.innerHTML =
      `<div class="popup-dialog changes-dialog" role="dialog" aria-modal="true" aria-labelledby="changes-title">` +
      `<div class="info-head"><h2 id="changes-title">Changes</h2>` +
      `<button class="info-close" aria-label="Close">&#10005;</button></div>` +
      `<p class="fd-note">Repeated changes are grouped. <b>Shift</b> = one axis moved by the same amount on many lines ` +
      `(at least the minor threshold). <b>Lead-in</b> = vertical arc (G18/G19) swapped for straight moves or the other way. ` +
      `Click an item to jump to its first line.</p>` +
      `<div class="changes-body"></div></div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.info-close')) return close();
      const a = e.target.closest('.ch-jump');
      if (a) { e.preventDefault(); jump(+a.dataset.op); close(); }
    });
    overlay.addEventListener('change', (e) => {
      if (e.target.classList.contains('ch-show-all')) { showUnchanged = e.target.checked; render(); }
    });
  }

  function open() {
    if (!overlay) build();
    const ctx = App.getDiffContext();
    summaries = ctx ? App.getSummaries() : [];
    ops = ctx ? ctx.ops : [];
    render();
    overlay.classList.add('open');
    overlay.querySelector('.info-close').focus();
  }

  function close() {
    if (overlay) overlay.classList.remove('open');
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) close();
    });
    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('btn-changes');
      if (btn) btn.addEventListener('click', open);
    });
  }

  return { open, close };
})();
