/**
 * Info popup — "What is checked".
 *
 * RULE: every new check, filter, or setting must be described here in the
 * same change that adds it. This is what a new user relies on.
 *
 * Content is plain HTML in INFO_HTML below, grouped as:
 *   Quick start · The passes · Always checked · Filters you control ·
 *   Colours · Not checked / limits · Navigation
 */

const Info = (() => {

  // Small helpers to keep the content readable
  const chip = (cls, text) => `<span class="info-chip ${cls}">${text}</span>`;
  const RED = chip('chip-critical', 'Critical');
  const PURPLE = chip('chip-workoffset', 'Work offset');
  const AMBER = chip('chip-minor', 'Minor');
  const FAINT = chip('chip-tolerance', 'Within tol.');
  const GREEN = chip('chip-added', 'Added');
  const BURG = chip('chip-removed', 'Removed');
  const ON = '<span class="info-default on">ON</span>';
  const OFF = '<span class="info-default off">OFF</span>';
  const ALWAYS = '<span class="info-tag always">Always shows</span>';

  const INFO_HTML = `
<nav class="info-toc">
  <a href="#info-start">Quick start</a>
  <a href="#info-passes">The passes</a>
  <a href="#info-always">Always checked</a>
  <a href="#info-filters">Filters</a>
  <a href="#info-feeds">Feeds &amp; Speeds</a>
  <a href="#info-colors">Colours</a>
  <a href="#info-limits">Not checked</a>
  <a href="#info-nav">Navigation</a>
</nav>

<section id="info-start" class="info-card">
  <h3>Quick start</h3>
  <ol class="info-steps">
    <li><b>Left</b> = known-good machine file. <b>Right</b> = new CAM post.</li>
    <li>Open, drag-drop, or paste each file. The compare runs by itself.</li>
    <li>Check the status bar counts, then step through diffs with <kbd>F7</kbd>.</li>
  </ol>
  <p class="info-note">Goal: catch every change that can affect the machine.
  When unsure, the tool shows a diff rather than hiding it.</p>
</section>

<section id="info-passes" class="info-card">
  <h3>How it works — the passes</h3>
  <p>Both files run through the same stations, in order.</p>
  <ol class="info-passes">
    <li><span class="pass-num">1</span><div><b>Read every line</b>
      Splits each line into words: G, M, X/Y/Z, A/B/C, I/J/K, F, S, T, H, D,
      R/P/Q/L, N, O, macros (#, IF, GOTO…), comments, block delete <code>/</code>.
      Numbers like <code>1.</code> <code>.5</code> <code>-.25</code> <code>+1.</code> and <code>X 1.</code> are read.
      Tracks the active motion mode (G0/G1/G2/G3/canned cycle) for lines that only have coordinates.</div></li>
    <li><span class="pass-num">2</span><div><b>Split into toolpaths</b>
      Two post layouts are recognised:
      <ul class="info-list">
        <li><b>New</b> (APW M post v8.8.1+, R post v2.1+): each toolpath starts at a divider
          comment <code>(-----)</code>. The comments just above the first code line are
          job/tool, <b>operation name</b>, <b>strategy</b>. Dividers in the header tool list and
          tool-setting block (followed by <code>M06</code>) are skipped.</li>
        <li><b>Old</b>: a blank line then 2+ comment lines: job/tool, then <b>operation name</b>.
          Setup lines before it (G28, G53, M05, M09, rapids…) join that toolpath.</li>
      </ul>
      A <code>G100</code> with T and X/Y, S, or M3/M4 gives the tool number. Toolpaths with no
      G100 keep the previous tool. Also finds the Program Header and Program End (M30).</div></li>
    <li><span class="pass-num">3</span><div><b>Match toolpaths</b>
      Pairs left and right toolpaths by operation name + tool, so an old-layout file matches a
      new-layout file of the same job.
      Leftovers are paired if their content is at least 50% alike (+10% for same tool).
      Unmatched ones show as <i>(not in file)</i> on the other side.</div></li>
    <li><span class="pass-num">4</span><div><b>Line up lines</b>
      Inside each matched toolpath, lines are lined up. Identical lines are preferred,
      so an inserted line lands in the right place. Changed lines are only compared
      to lines of the same kind; others show as ${GREEN} / ${BURG}.</div></li>
    <li><span class="pass-num">5</span><div><b>Compare each line pair</b>
      Every word is compared. See <a href="#info-always">Always checked</a>.</div></li>
    <li><span class="pass-num">6</span><div><b>Grade coordinate changes</b>
      Coordinate-only changes are graded by size using the tolerance thresholds.</div></li>
    <li><span class="pass-num pass-filter">F</span><div><b>Your filters</b>
      Settings, tolerance and show/hide decide what is shown. Critical items always show.</div></li>
  </ol>
</section>

<section id="info-always" class="info-card">
  <h3>Always checked</h3>
  <p>These cannot be turned off. ${ALWAYS} = still shown inside a hidden toolpath.</p>

  <h4>Motion and position</h4>
  <table class="info-table info-rules">
    <tr><td>Motion mode change (G0 ↔ G1 ↔ G2/G3, canned cycles), incl. modal lines</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Axis or I/J/K on one side only</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>X/Y/Z/A/B/C/I/J/K value change</td><td>by size — see <a href="#info-filters">Tolerance</a></td><td>if over major</td></tr>
  </table>

  <h4>Tool and spindle</h4>
  <table class="info-table info-rules">
    <tr><td>Tool T, length offset H, diameter offset D</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Spindle speed S</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Feed F</td><td>${RED}</td><td>${ALWAYS}</td></tr>
  </table>

  <h4>Work offsets</h4>
  <table class="info-table info-rules">
    <tr><td>G54–G59 change</td><td>${PURPLE}</td><td>${ALWAYS}</td></tr>
    <tr><td>G54.1 P number change (P2 → P3, P#153)</td><td>${PURPLE}</td><td>${ALWAYS}</td></tr>
  </table>

  <h4>Program flow</h4>
  <table class="info-table info-rules">
    <tr><td>M-codes (any added, removed, or changed)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Other G-codes (G43, G90/G91, G17, G28…)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Macros: #vars, IF/GOTO/WHILE, X[#101+1] (compared as text)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>R/P/Q/L and any other letter (U, V, W, E…)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Program number O</td><td>${AMBER}</td><td></td></tr>
  </table>

  <h4>Added / removed lines</h4>
  <p>A line on one side only shows as ${GREEN} or ${BURG}. It still shows inside a hidden
  toolpath if it has an M, T, H, D, S, F, macro, comment, non-motion G, work offset, or <code>/</code>.
  Plain moves in a hidden toolpath stay hidden.</p>
</section>

<section id="info-filters" class="info-card">
  <h3>Filters you control</h3>

  <h4>Comparison rules <span class="info-where">⚙ Settings</span></h4>
  <table class="info-table">
    <tr><th>Setting</th><th>Default</th><th>When ON</th><th>When OFF</th></tr>
    <tr><td>Ignore comments ( )</td><td>${OFF}</td><td>( ) comments not compared</td><td>Comment change = ${RED}</td></tr>
    <tr><td>Ignore comments ;</td><td>${ON}</td><td>; comments not compared</td><td>Comment change = ${RED}</td></tr>
    <tr><td>Ignore whitespace</td><td>${ON}</td><td>Spaces don't matter</td><td>Spacing-only change = ${AMBER}</td></tr>
    <tr><td>Ignore case</td><td>${ON}</td><td>Upper/lower case don't matter</td><td>Case-only change = ${AMBER}</td></tr>
    <tr><td>Normalize G/M codes</td><td>${ON}</td><td>G01 = G1, M03 = M3</td><td>G01 vs G1 = ${AMBER}</td></tr>
    <tr><td>Ignore N-numbers</td><td>${ON}</td><td>N numbers not compared</td><td>N change = ${AMBER}</td></tr>
    <tr><td>Ignore block delete /</td><td>${OFF}</td><td>/ not compared</td><td>/ on one side = ${RED}</td></tr>
  </table>
  <p class="info-note">Number format never matters: <code>X1.</code> = <code>X1.0000</code> = <code>X+1</code>, <code>T01</code> = <code>T1</code>.</p>

  <h4>Tolerance <span class="info-where">⚙ Settings + TOL</span></h4>
  <p>Uses the biggest coordinate change on the line.</p>
  <table class="info-table">
    <tr><th>Change size</th><th>TOL on (default)</th><th>TOL off</th></tr>
    <tr><td>≤ Minor threshold (default 0.001)</td><td>${FAINT} not counted</td><td>${AMBER}</td></tr>
    <tr><td>≤ Major threshold (default 0.01)</td><td>${AMBER}</td><td>${AMBER}</td></tr>
    <tr><td>&gt; Major threshold</td><td>${RED} ${ALWAYS}</td><td>${RED} ${ALWAYS}</td></tr>
  </table>
  <p>TOL is set per toolpath (box on each toolpath row) or for all at once (TOL button in the header bar).</p>

  <h4>Show / hide toolpath <span class="info-where">☑ on each toolpath row</span></h4>
  <p>Untick to hide that toolpath's diffs and dim its lines. Use it for toolpaths you
  already reviewed or expect to change. Anything marked ${ALWAYS} still shows.
  Each side has its own box.</p>
  <p class="info-note">Your hide and TOL choices are kept when you edit or re-compare.
  <b>New</b> and <b>Swap Panes</b> clear them.</p>
</section>

<section id="info-feeds" class="info-card">
  <h3>Feeds &amp; Speeds <span class="info-where">Feeds &amp; Speeds button</span></h3>
  <p>A summary table: one row per toolpath, left vs right. Changed values show in red as
  <span class="fd-old">left</span> → <span class="fd-new">right</span>. Click a toolpath name to jump to it.
  Every F and S change is also flagged line by line in the main view.</p>
  <table class="info-table info-kv">
    <tr><th>Column</th><th>How it is found</th></tr>
    <tr><td>RPM <span class="info-default on">EXACT</span></td><td>S on the G100 / M03 line. Toolpaths with no tool call keep the previous RPM.</td></tr>
    <tr><td>Ramp RPM <span class="info-default on">EXACT</span></td><td>A lone S line (no M03 / G100) with a different RPM.</td></tr>
    <tr><td>Plunge</td><td>Z-only feed move going down, at the start of a cut.</td></tr>
    <tr><td>Ramp</td><td>Feed move going down while moving X/Y (incl. helix), at the start of a cut.</td></tr>
    <tr><td>Lead-in</td><td>Start of a cut: vertical arc (G18/G19), G41/G42 move, or short moves at a different feed before the main cut feed.</td></tr>
    <tr><td>Cut</td><td>The feed covering the most distance in each cut.</td></tr>
    <tr><td>Lead-out</td><td>End of a cut: vertical arc, G40 move, rising move, or short different-feed moves after the main cut feed.</td></tr>
    <tr><td>Transition</td><td>Feed higher than the cut feed, inside a cut.</td></tr>
    <tr><td>High feed</td><td>The post's high feedrate (200 inch / 5000 mm).</td></tr>
    <tr><td>Retract</td><td>Z-only feed move going up.</td></tr>
    <tr><td>Cycle</td><td>Feed on a drill / tap cycle (G73–G89).</td></tr>
    <tr><td>Other</td><td>Feed lower than the cut feed, inside a cut (reduced feed).</td></tr>
    <tr><td>F list</td><td>Every F value in the toolpath with how many times it appears. Nothing is hidden.</td></tr>
  </table>
  <p class="info-note">A "cut" here means the feed moves between two rapid (G0) moves.
  Feed types other than RPM are <b>likely</b>, not certain: the NC code does not say which feed is which.
  Use the F list when a value looks wrong.</p>
</section>

<section id="info-colors" class="info-card">
  <h3>Colours</h3>
  <table class="info-table info-kv info-colors">
    <tr><td>${PURPLE}</td><td>Work offset changed. Highest priority.</td></tr>
    <tr><td>${RED}</td><td>Can change what the machine does. Check every one.</td></tr>
    <tr><td>${AMBER}</td><td>Small coordinate change, or format-only change.</td></tr>
    <tr><td>${FAINT}</td><td>Coordinate change within tolerance. Not counted.</td></tr>
    <tr><td>${GREEN}</td><td>Line only in the right (new) file.</td></tr>
    <tr><td>${BURG}</td><td>Line only in the left (machine) file.</td></tr>
    <tr><td><span class="token-diff">X1.5</span></td><td>The exact word that changed.</td></tr>
    <tr><td><span class="info-chip chip-disabled">dimmed</span></td><td>Line in a hidden toolpath.</td></tr>
  </table>
</section>

<section id="info-limits" class="info-card info-warn">
  <h3>Not checked / limits</h3>
  <p>Don't rely on the tool for these:</p>
  <ul class="info-list">
    <li><b>No simulation.</b> It compares text, not toolpath shape. No backplot, no collision check.</li>
    <li><b>Macro math is not calculated.</b> <code>#1=2*3</code> vs <code>#1=6</code> shows as a change.</li>
    <li><b>Modal states other than motion</b> (G90/G91, G20/G21, G17–G19, G43 active…) are only flagged
      on the line where they change, not on every line after.</li>
    <li><b>Missing axis = critical</b> even when the machine would stay in the same place.</li>
    <li><b>One tolerance for all axes.</b> Rotary A/B/C (degrees) and I/J/K use the same thresholds as X/Y/Z.</li>
    <li><b>Blank lines</b> are not compared.</li>
    <li><b>Stray characters</b> that are not a letter + number (like <code>%</code> or a lone <code>X</code>) are skipped.</li>
    <li><b>Toolpath detection</b> is tuned for Fusion 360 posts on Brother (G100 tool calls).
      Other posts fall back to G100-only or comment-based sections. Check toolpath labels look right.</li>
    <li><b>Very different large toolpaths</b> (thousands of edits) are compared line by line in order.
      Everything still shows, but pairing may be off.</li>
    <li><b>Work offsets G154 Pn</b> are compared as normal G/P words, not as work offsets.</li>
    <li><b>Feed types are guesses.</b> Feeds &amp; Speeds labels (plunge, ramp, lead-in…) come from tool motion.
      RPM and Ramp RPM are exact.</li>
    <li><b>Hidden toolpaths</b> also dim the setup lines just above their separator (they belong to it).</li>
  </ul>
</section>

<section id="info-nav" class="info-card">
  <h3>Navigation</h3>
  <table class="info-table info-kv">
    <tr><td><kbd>F7</kbd> / <kbd>Shift</kbd>+<kbd>F7</kbd> or ▲ ▼</td><td>Next / previous diff (skips within-tolerance and hidden)</td></tr>
    <tr><td>Centre gutter</td><td>Marks show where diffs are. Click to jump.</td></tr>
    <tr><td>Toolpath header bar</td><td>Shows the current toolpath. Click for the list; click a row to jump.</td></tr>
    <tr><td>Status bar</td><td>Toolpath counts, Work offset / Critical / Minor counts, line counts.
      Warns if line counts differ by more than 10%.</td></tr>
    <tr><td>Feeds &amp; Speeds</td><td>Per-toolpath table of RPM and feeds, left vs right.</td></tr>
    <tr><td>Swap Panes / Save</td><td>Swap left and right. Save downloads the edited file.</td></tr>
  </table>
</section>
`;

  let overlay = null;

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'info-overlay';
    overlay.innerHTML =
      `<div id="info-dialog" role="dialog" aria-modal="true" aria-labelledby="info-title">` +
      `<div class="info-head"><h2 id="info-title">What is checked</h2>` +
      `<button class="info-close" aria-label="Close">&#10005;</button></div>` +
      `<div class="info-body">${INFO_HTML}</div></div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.info-close')) close();
      // In-popup links scroll inside the popup
      const a = e.target.closest('a[href^="#info-"]');
      if (a) {
        e.preventDefault();
        const target = overlay.querySelector(a.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  function open() {
    if (!overlay) build();
    overlay.classList.add('open');
    overlay.querySelector('.info-close').focus();
  }

  function close() {
    if (overlay) overlay.classList.remove('open');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) close();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('info-toggle');
    if (btn) btn.addEventListener('click', open);
  });

  return { open, close };
})();
