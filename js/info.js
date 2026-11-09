/**
 * Info popup — "What is checked".
 *
 * RULE: every new check, filter, or setting must be described here in the
 * same change that adds it. This is what a new user relies on.
 *
 * Content is plain HTML in INFO_HTML below, grouped as:
 *   Quick start · The passes · Always checked · Filters you control ·
 *   Colours · Variable values · Info panel · Not checked / limits · Navigation
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
  <a href="#info-vars">Variables</a>
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
      Tracks the active motion mode (G0/G1/G2/G3/canned cycle) for lines that only have coordinates,
      G90/G91, the last position and the active F. Finds the N labels a GOTO or M99 P jumps to.
      Characters it cannot read (like <code>*</code> or <code>X1..5</code>) are kept and compared.</div></li>
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
      Coordinate-only changes (incl. arc R on G2/G3) are graded by size using the tolerance thresholds.
      Not in G91 (incremental) and not on offset lines (G10/G52/G92): there any change is flagged.</div></li>
    <li><span class="pass-num pass-filter">F</span><div><b>Your filters</b>
      Settings, tolerance and show/hide decide what is shown. Critical items always show.</div></li>
  </ol>
</section>

<section id="info-always" class="info-card">
  <h3>Always checked</h3>
  <p>These cannot be turned off. ${ALWAYS} = still shown inside a hidden toolpath.</p>

  <h4>Motion and position</h4>
  <table class="info-table info-rules">
    <tr><td>Motion mode change (G0 ↔ G1 ↔ G2/G3, canned cycles), incl. modal lines.
      Two <code>G100</code> lines compare only their own G-codes (G100 does its own positioning)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Axis or I/J/K on one side only</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Axis or F on one side only, but same as the value already active (e.g. <code>Z-.5</code> repeated)</td><td>${AMBER}</td><td></td></tr>
    <tr><td>X/Y/Z/A/B/C/I/J/K value change, and R on G2/G3 arcs</td><td>by size — see <a href="#info-filters">Tolerance</a></td><td>if over major</td></tr>
    <tr><td>Any axis value change in G91 (incremental) — errors add up</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Characters that are not a word (stray <code>*</code>, mistyped <code>X1..5</code>)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
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
    <tr><td>G10 (write offset), G52 (local shift), G92 with axes (preset): any value change, no tolerance</td><td>${PURPLE}</td><td>${ALWAYS}</td></tr>
  </table>

  <h4>Program flow</h4>
  <table class="info-table info-rules">
    <tr><td>M-codes (any added, removed, or changed)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Other G-codes (G43, G90/G91, G17, G28…)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Macros: #vars, IF/GOTO/WHILE, X[#101+1] (compared as text; numbers as numbers, <code>5.</code> = <code>5.0</code>)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Variable word, same text but a different worked-out value (<code>X#101</code> both sides, #101 set differently above)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Variable word vs number with the same known value (<code>X#101</code> vs <code>X1.5</code>, #101 = 1.5)</td><td>${AMBER}</td><td></td></tr>
    <tr><td>Variable word vs number when the value is unknown (machine value, loop, call)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>N label that a GOTO or M99 P jumps to (even with Ignore N-numbers on)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>R/P/Q/L (canned cycle R = retract plane) and any other letter (U, V, W, E…)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Program number O</td><td>${AMBER}</td><td></td></tr>
  </table>

  <h4>Comments</h4>
  <table class="info-table info-rules">
    <tr><td>Commented-out code, e.g. <code>(G0 Z1.)</code>. Paired with the live line it came from and marked; code changes inside are listed too</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Tool lines <code>(T33 - ID=… OOH=… HLDR=…)</code> in the header list and tool-setting block</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Notes: any other comment in the code, incl. comments at the end of a code line</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Fixture line <code>(FIXTURE = …)</code> — only when both files have one (older files don't)</td><td>${RED}</td><td>${ALWAYS}</td></tr>
    <tr><td>Not compared: the comment block at the top of the file (name, date, machine), dividers <code>(-----)</code>, and toolpath label comments (job/tool, operation, strategy, length-check title)</td><td>—</td><td></td></tr>
  </table>
  <p class="info-note">"Ignore comments ( )" / "Ignore comments ;" in Settings still turn off all comment checks of that type.</p>

  <h4>Added / removed lines</h4>
  <p>A line on one side only shows as ${GREEN} or ${BURG}. It still shows inside a hidden
  toolpath if it has an M, T, H, D, S, F, macro, comment, non-motion G, work offset, or <code>/</code>.
  An added or removed <b>move</b> (rapid, feed, arc, cycle position) inside a matched toolpath
  also always shows. Only a <b>whole</b> added or removed toolpath stays hidden when you hide it.</p>
</section>

<section id="info-filters" class="info-card">
  <h3>Filters you control</h3>

  <h4>Comparison rules <span class="info-where">⚙ Settings</span></h4>
  <table class="info-table">
    <tr><th>Setting</th><th>Default</th><th>When ON</th><th>When OFF</th></tr>
    <tr><td>Ignore comments ( )</td><td>${OFF}</td><td>( ) comments not compared</td><td>See <a href="#info-always">Comments</a></td></tr>
    <tr><td>Ignore comments ;</td><td>${ON}</td><td>; comments not compared</td><td>See <a href="#info-always">Comments</a></td></tr>
    <tr><td>Ignore whitespace</td><td>${ON}</td><td>Spaces don't matter</td><td>Spacing-only change = ${AMBER}</td></tr>
    <tr><td>Ignore case</td><td>${ON}</td><td>Upper/lower case don't matter</td><td>Case-only change = ${AMBER}</td></tr>
    <tr><td>Normalize G/M codes</td><td>${ON}</td><td>G01 = G1, M03 = M3</td><td>G01 vs G1 = ${AMBER}</td></tr>
    <tr><td>Ignore N-numbers</td><td>${ON}</td><td>N numbers not compared</td><td>N change = ${AMBER}</td></tr>
    <tr><td>Ignore block delete /</td><td>${OFF}</td><td>/ not compared</td><td>/ on one side = ${RED}</td></tr>
    <tr><td>No decimal: X1 ≠ X1.</td><td>${OFF}</td><td><code>X1</code> vs <code>X1.</code> = ${RED} (X/Y/Z/A/B/C/I/J/K/R/Q; zero never flagged). Use if your control reads X1 as 0.0001".
      Either way, the status bar <b>No-decimal check</b> shows ON/OFF and how many lines have a word without a decimal (amber when OFF and some are found). Click it to step through them.</td><td><code>X1</code> = <code>X1.</code></td></tr>
  </table>
  <p class="info-note">Number format otherwise never matters: <code>X1.</code> = <code>X1.0000</code> = <code>X+1</code>, <code>T01</code> = <code>T1</code>.</p>

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

<section id="info-tools" class="info-card">
  <h3>Tool Table <span class="info-where">Tool Table button</span></h3>
  <p>One row per tool number, left vs right, plus the fixture line at the top.
  Click a tool to jump to its tool call.</p>
  <table class="info-table info-kv">
    <tr><th>Column</th><th>How it is found</th></tr>
    <tr><td>ID, Description, OOH, Holder, LC</td><td>The tool comment line <code>(T33 - ID=… = desc - OOH=… - HLDR=… -LC-…)</code>. Header list first, tool-setting block fills gaps. Old posts: <code>PRODID=</code> is the ID.</td></tr>
    <tr><td>Gauge</td><td><code>(CHECKING LENGTH OF TOOL 62 = GAUGE 5.8865)</code></td></tr>
    <tr><td>Toolpaths</td><td>How many toolpaths use the tool (G100 calls + same-tool toolpaths). Info only.</td></tr>
  </table>
  <h4>Warnings (per file)</h4>
  <ul class="info-list">
    <li><b>not in header list</b> — tool is called but has no line in the header tool list.</li>
    <li><b>listed, never used</b> — in the tool list but never called.</li>
    <li><b>H33 ≠ T32 / D33 ≠ T32</b> — offset number on the G100 line does not match the tool.</li>
  </ul>
  <p class="info-note">A value is ${RED} only when <b>both</b> files have it and it differs (OOH <code>2</code> = <code>2.0</code>).
  A value in one file only is shown dim and not flagged. Same for the fixture line.</p>
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

<section id="info-vars" class="info-card">
  <h3>Variable values <span class="info-where">⚙ Show variable values</span></h3>
  <p>The tool reads each file top to bottom and works out what each <code>#variable</code> holds.
  Lines that use one get a grey note at the end, e.g. <code>→ X1.5 Z-0.25</code>. <code>?</code> = unknown.</p>
  <ul class="info-list">
    <li><b>Worked out:</b> <code>#101=1.5</code>, maths <code>+ - * /</code>, brackets, <code>SIN COS TAN ATAN SQRT ABS ROUND FIX FUP</code>
      (angles in degrees), <code>#[100+1]=</code>, <code>IF [..] THEN</code>, and a <code>GOTO</code> whose condition is known.</li>
    <li><b>Unknown (<code>?</code>):</b> machine values the file never sets (work offsets <code>#5221</code>, tool lengths <code>#11001</code>,
      positions), anything changed inside a loop (<code>WHILE</code> or a jump back), lines a GOTO may or may not skip,
      block delete <code>/</code> lines, and common variables (#100+) after <code>G65</code>, <code>G66</code>, <code>M06</code>.
      After <code>M98</code> everything is unknown.</li>
    <li><b>Skipped</b> lines (jumped over by a GOTO that is known to be taken) are marked <code>↷ skipped by GOTO</code>.</li>
    <li><b>IF lines</b> show their result: <code>→ true</code>, <code>→ false</code> or <code>→ ?</code> (needs a machine value).</li>
  </ul>
  <h4>Test an IF <span class="info-where">click the IF or GOTO</span></h4>
  <p>When only the machine knows the answer (e.g. <code>IF[#11032 LT 7.3086]</code> reads the tool length),
  the info panel offers <b>Test TRUE</b> and <b>Test FALSE</b>. The tool then treats that IF as your choice:
  values below update, jumped lines are marked skipped, an alarm line reached by the jump shows
  <code>⛔ alarm stops the program here</code>, and it jumps you to the line that would run next.
  Active tests are listed in the legend strip (<code>L35 = TRUE ✕</code>); click one to clear it, or <b>Clear all</b>.
  Tests also change what is compared. Editing that line, <b>New</b> or <b>Swap Panes</b> clears them.</p>
  <p class="info-note">Loops are not run. When the tool is not sure, the value is unknown and the change stays red.</p>
</section>

<section id="info-hover" class="info-card">
  <h3>Info panel <span class="info-where">bottom of the screen</span></h3>
  <p><b>Click</b> a G-code, M-code, word, macro keyword or <code>#variable</code>: the panel opens at the bottom
  and shows it. While the panel is open, <b>pointing</b> at code shows that code instead; move off the code
  and it goes back to what you clicked, so you can press its buttons.</p>
  <ul class="info-list">
    <li><b>Left side:</b> values on that line, and buttons (Jump, Test TRUE / FALSE).</li>
    <li><b>Right side:</b> what it means, and a link to the matching page on the
      <a href="https://zappettiniconsulting.com/wiki" target="_blank" rel="noopener noreferrer">Zappettini Consulting CNC wiki</a>.</li>
    <li><b>▾</b> (or <kbd>Esc</kbd>) folds it down to one line. <b>✕</b> closes it until you click code again.
      It stays hidden until you click something.</li>
  </ul>
  <p class="info-note">Meanings are for a Brother mill (Fanuc as backup).</p>
  <h4>Jumps</h4>
  <ul class="info-list">
    <li><b>GOTO / IF … GOTO / M99 P</b>: the panel shows the target line, the test result and which line runs next.
      <b>Jump to line …</b> takes you there. <kbd>Ctrl</kbd>+click (<kbd>⌘</kbd>+click on Mac) jumps straight away.</li>
    <li><b>N label</b> (e.g. <code>N98032</code>): the panel lists the lines that jump to it.</li>
    <li>After a jump, <b>← Back to line …</b> appears at the bottom for 15 seconds.</li>
  </ul>
</section>

<section id="info-limits" class="info-card info-warn">
  <h3>Not checked / limits</h3>
  <p>Don't rely on the tool for these:</p>
  <ul class="info-list">
    <li><b>No simulation.</b> It compares text, not toolpath shape. No backplot, no collision check.</li>
    <li><b>Assignment lines are compared as text.</b> <code>#1=2*3</code> vs <code>#1=6</code> still shows as a change
      (both work out to 6 — see the grey note). Only words like <code>X#1</code> are compared by value.</li>
    <li><b>Loops and subprograms are not run.</b> Values changed inside them are unknown.</li>
    <li><b>Modal states other than motion and G90/G91</b> (G20/G21, G17–G19, G43 active…) are only flagged
      on the line where they change, not on every line after.</li>
    <li><b>Repeated-word check</b> only trusts the last written value. After G28/G30/G53, G100, a work offset or
      rotation change, a canned cycle, G91 or a macro, a word on one side only is critical again.</li>
    <li><b>One tolerance for all axes.</b> Rotary A/B/C (degrees) and I/J/K use the same thresholds as X/Y/Z.</li>
    <li><b>Blank lines</b> are not compared.</li>
    <li><b>Top-of-file comments are not compared</b>, incl. a fixture line like <code>(FIXTURE = …)</code>. Tool lines there are.</li>
    <li><b>Commented-out code</b> is spotted when the comment reads as G-code (a G/M/T/S/F or axis word, nothing unreadable).
      A comment of plain words is a note.</li>
    <li><b>G92</b> counts as an offset only with axis words. <code>G92 S.. Q..</code> (spindle clamp in turning) is a normal G-code.</li>
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
      Warns if line counts differ by more than 10%. Right side: control, units per file
      (G20 inch / G21 mm — red if they differ), <b>No-decimal check</b> (ON/OFF + lines without a decimal; click to step
      through them), <b>Settings</b> (amber “⚠ Settings changed” when any compare setting or threshold is not the default —
      point at it for the list, click to open settings), and the pane, line and column of the cursor.</td></tr>
    <tr><td>Click code</td><td>Info panel at the bottom: value, meaning and a wiki link. Pointing updates it while open.</td></tr>
    <tr><td><kbd>Ctrl</kbd>+click a GOTO</td><td>Jump to the line it goes to. <b>← Back</b> returns.</td></tr>
    <tr><td>Feeds &amp; Speeds</td><td>Per-toolpath table of RPM and feeds, left vs right.</td></tr>
    <tr><td>Swap Panes / Save</td><td>Swap left and right. Save downloads the edited file, with the same line endings it came with (Windows CRLF stays CRLF).</td></tr>
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
