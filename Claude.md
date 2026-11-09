# CLAUDE.md — G-Code Compare Tool

## What This Tool Is

A browser-based G-code diff tool for CNC machinists. No build step, no backend,
no npm. Opens as a static HTML file in Chrome. Built for a Brother 3/5-axis mill
shop (Fusion 360 posts, G100 tool calls) but designed to be configurable for
other machines and controls.

The tool compares two G-code files: a known-good machine file (left) against a
freshly posted CAM file (right). The goal is to catch meaningful differences
quickly and safely. Missed differences can cause machine crashes — real money.
Accuracy and clarity are the top priority.

---

## File Structure

```
gcode-compare/
├── index.html          — layout, UI skeleton, loads all scripts
├── css/
│   └── style.css       — all styles (dark theme, deco colors, separator UI)
├── js/
│   ├── macro-eval.js   — #variable resolver (works out X#101, X[#1*2]); loaded before diff-engine
│   ├── diff-engine.js  — parser, toolpath segmentation, LCS, token classification
│   ├── editor.js       — single-layer line-div editor, rendering, decorations, hover hook
│   ├── app.js          — UI wiring, settings, state, diff coordination
│   ├── feeds.js        — Feeds & Speeds: per-toolpath feed/RPM analysis + popup
│   ├── tools.js        — Tool Table: tool list / gauge / usage / fixture compare + popup
│   ├── info.js         — in-app Info popup: what is / isn't checked
│   └── hover-help.js   — bottom info panel: meaning/values of G/M/words/#vars + Zappettini wiki links
├── posts/              — shop Fusion post processors (reference only, not loaded)
│   ├── Brother Speedio M multi-tasking - APW_v8_9_1.cps
│   └── Brother Speedio R - APW_R_v2.cps
├── Examples/           — O1158 (old layout), O1268 (new divider layout, R post)
├── tests/
│   └── engine.test.js  — diff engine tests (run: node tests/engine.test.js)
└── CLAUDE.md
```

No build step. CDN imports only. Opens directly from disk.

## Info Popup — Keep It Current (Required)

js/info.js holds the in-app "What is checked" popup (ⓘ button in the header).
It is what a new user relies on to know what the tool does and does not check.

**Every change that adds or changes a check, severity, filter, setting,
default, or limit must update js/info.js in the same commit.**

Sections (keep related items grouped in the right one):
- Quick start
- How it works — the passes (1 Read, 2 Split toolpaths, 3 Match toolpaths,
  4 Line up lines, 5 Compare, 6 Tolerance, F Your filters)
- Always checked — grouped: Motion and position / Tool and spindle /
  Work offsets / Program flow / Added-removed lines
- Feeds & Speeds — how each column is found (keep in sync with feeds.js)
- Tool Table — columns, warnings, red/dim rule (keep in sync with tools.js)
- Filters you control — Comparison rules table, Tolerance table, Show/hide
- Colours
- Variable values (what MacroEval works out / leaves unknown)
- Info panel (hover help)
- Not checked / limits — anything a user must NOT rely on
- Navigation

## Testing

Run `node tests/engine.test.js` after any change to diff-engine.js.
Plain Node, no npm. Add a test for every new rule.

---

## Current State — What Is Built and Working

### Diff Engine (`diff-engine.js`)

**Full token-aware G-code parser** (`parseGCodeLine`):
- Parses every token on a line into typed objects with character positions
- Token types: gCode, mCode, axis (X/Y/Z), rotary (A/B/C), arcParam (I/J/K),
  feed (F), spindle (S), tool (T), hOffset (H), dOffset (D), param (R/P/Q/L),
  macro (#), lineNumber (N), comment (paren and semicolon), blockDelete (/),
  program (O number), other (any unrecognized letter, e.g. U/V/W),
  expr (word with expression value: X[#101+1], X#101)
- Numbers: accepts 1.  .5  -.25  +1.  and a space after the letter (X 1.)
- Macro statements: two letters in a row outside comments (IF, GOTO, WHILE,
  SIN, ...) make the code part one macro token (isMacroStatement). GOTO10 is
  never read as a program number.
- Comment tokens carry kind: 'paren' or 'semi' (parenComments / semiComments arrays)
- Paren comments end at the matching ')' (nested brackets allowed)
- Tracks isBlank, isCommentOnly, blockDelete (leading whitespace allowed), raw text
- Characters that are not a word/comment/macro go to `unparsed` (string) and
  'unparsed' tokens — compared, never silently dropped
- Axis/rotary/arcParam/param tokens carry noDecimal (X1 vs X1.)

**Modal G-code state tracking** (`trackModalState`):
- Tracks current motion mode across a file: G0/G1/G2/G3 and canned cycles
  (G73/G74/G76/G80-G89)
- Used in fingerprints for bare coordinate lines (no explicit G-code)
- Used in classifyTokens: a bare move under G0 vs under G1 is a critical diff

**Line context** (`trackContext` / `lineContext`), value BEFORE each line:
- inc: G91 incremental active. pos X/Y/Z/A/B/C: last absolute value written.
  feed: active modal F. NaN = unknown.
- Position resets (unknown) after G10/G28/G30/G43/G44/G49/G52/G53/G53.1/G65/G66/
  G68/G68.2/G69/G92/G100, G54-G59, canned cycles, M6/M98/M99, G91, macros.
  F resets on G93/G94/G95 and in G93.
- `markJumpTargets`: N labels that a GOTO or M99 Pn targets get jumpTarget = true.

**Toolpath segmentation** (`segmentIntoToolpaths`) — Brother Speedio / Fusion 360.
Two post layouts. The new one is tried first (`segmentByDividers`):
- New layout (APW M post v8.8.1+, R post v2.1+): a divider comment
  `(----------)` (10+ dashes) starts each toolpath. Dividers with an M06 or no
  motion before the next divider (header tool list, tool-setting block) are skipped.
  The comment group directly above the first real code line (after the tool
  length check IF/GOTO block) is [job - tool desc], operation name, strategy.
  name = operation name, opType = strategy, jobTool = job/tool comment.
  startLine = anchorLine = divider line. layout = 'divider'.
- Old layout (layout = 'blank-comments'), used when no valid dividers:
- Pass 1 (primary): blank line followed by 2+ consecutive comment-only lines.
  Comments are [job - tool desc], operation name, [more]: name = 2nd comment.
- Pass 2: finds G100 tool call lines (with T and X/Y or S or M03/M04)
- Pass 3: associates each G100 to a comment-pair anchor within +20 lines forward
- Expands preamble backward from each anchor (up to 40 lines). Absorbs:
  blanks, comment-only lines, rapids (G0), lines with no G/M/axis word,
  G-codes G28/G53/G90/G49/G69/G54-G59/G53.1/G68.2,
  M-codes M05/M09/M298/M442-M445/M495/M01/M141. Stops at cutting moves.
- Detects and labels: preamble (Program Header), toolpath, program_end (M30)
- Each toolpath object: { id, type, name, opType, toolNumber, nNumber,
  spindleSpeed, startLine, anchorLine, g100Line, endLine }
- anchorLine = first comment line of the pair (toolpath name). g100Line = the
  associated G100 line or -1.
- Fallback to G100-only detection if no comment-pairs found
- Fallback to comment-based sections if no anchors at all

**Toolpath matching** (`matchToolpaths`):
- Pass 1: key-based LCS on "NAME|T{toolNumber}" (operation name + tool, so old
  and new layout files of the same job match)
- Pass 1b: content-similarity refinement when duplicate keys exist
- Pass 2: content similarity fallback (LCS on fingerprints, threshold 0.5,
  +0.1 boost for matching tool number)
- Pairs must not cross: keeps the longest non-crossing set of pairs; crossed
  pairs become unmatched
- Output is in file order: each unmatched toolpath sits just before the next
  matched pair that follows it in its own file
- Produces matched pairs { left, right } plus unmatched left/right entries

**Fingerprinting** (`fingerprint`):
- Structural signature for LCS matching: G-codes, M-codes, axis letters present,
  arc params, rotary, F/S/T/H/D presence, macro presence
- G/M codes always normalized here (G01 == G1) so equivalent lines pair up
- Comment-only lines use comment text (after ignore rules) for precise matching
- Bare coordinate lines prepend modal G-code

**Token-level classification** (`classifyTokens(parsedA, parsedB, rules, modalA, modalB)`):
- The ONE place where severity rules live (see Critical Difference Rules)
- Applies the comparison-rule settings (ignore comments, case, whitespace,
  N-numbers, block delete, normalize G/M)
- Returns { severity, tokenDiffs } — each diff has: field, severity, leftVal,
  rightVal, leftTokens, rightTokens (character positions for highlighting)
- Token diff severities: workoffset, critical, minor, coordinate, coordinate-z
- Line severity = highest of: workoffset > critical > coordinate-z > coordinate > minor

**One-sided lines** (`hasCriticalContent`): an added/removed line gets
alwaysShow when it carries critical content (M, T/H/D, S, F, comment, macro,
non-motion G, work offset, block delete, params). Plain moves do not count here (see One-sided moves).
Lines with G54-G59 get workOffset = true.

**One-sided moves**: an added/removed move (any line with axis, rotary or I/J/K
words: rapid, feed, arc, cycle position) inside a matched toolpath gets
alwaysShow (oneSidedOp with modal; op.rapid for G0, op.move otherwise).
Whole added/removed toolpaths do not.

**Tolerance classification** (`applyToleranceClassification`):
- Grades lines whose type is coordinate / coordinate-z by max delta:
  - <= minorThreshold: tolerance
  - <= majorThreshold: minor (amber)
  - >  majorThreshold: critical (red), overMajor = true, always surfaces
- Lines already critical / workoffset are never downgraded
- After this step no op has type coordinate / coordinate-z
- Sets op.alwaysShow on every critical / workoffset op

**Line alignment** (`alignLines`), per matched toolpath:
1. Identical lines at start and end are matched directly (fast path)
2. Middle <= 4M cells (left x right): weighted LCS. Same text scores 2,
   same fingerprint scores 1, so inserted lines line up exactly
3. Bigger: Myers O(ND) diff on exact text, then on fingerprints (max 2000 edits)
4. Last resort: pair lines in order — every line is still compared
- Int32 tables (no overflow). Toolpath similarity on huge toolpaths uses a
  count of shared line shapes instead of a full LCS.
- 70,000-line toolpath: about 1.3 s, 0.5 GB

**Pairing changed lines** (`classifyOps`): removed and added lines in the same
gap are paired only if they are the same kind (share at least half their word
letters, or both comment-only). Others stay as plain removed / added.

**Stats** (`countStats`): counts critical (incl. workoffset), minor, added, removed.
Not used by the UI — app.js counts only what is actually displayed.

### Editor (`editor.js`)

**Custom line-div editor** (no CodeMirror — built from scratch):
- Hidden textarea holds the text and takes keyboard input (never clicks)
- Virtual rendering: a row model (line / pad / sep rows) is rebuilt on change;
  only rows in and near the visible area are drawn as divs
- Clicks on the display are mapped to line + column by editor.js (row model,
  measured character width), then the textarea selection is set
- Current cursor line gets a subtle outline; typing/arrow keys keep it on screen
- Each line div: gutter line number + syntax-highlighted content
- Alignment padding rows (blank spacers to keep both panes line-aligned)
- Toolpath separator rows inline in the display (clickable checkboxes)
- Fully editable — textarea handles all keyboard input including Tab (2 spaces)
- 300ms debounce on input before triggering diff

**Syntax highlighting** (`syntaxHighlightLine`):
- Uses DiffEngine.parseGCodeLine tokens, so colors match what is compared
  (nothing colored inside comments, decimal point included)
- Classes: gcode-g, gcode-m, gcode-t, gcode-hd, gcode-f, gcode-s, gcode-xy,
  gcode-z, gcode-abc, gcode-ijk, gcode-param, gcode-macro, gcode-comment-*,
  gcode-line-number (colors in style.css)
- Changed tokens wrapped in a token-diff span (character ranges from tokenDiffs)

**Toolpath separator rows** (inline in editor display):
- Rendered as special editor-line tp-separator divs at anchorLine position
- Each row: Show/hide checkbox + Tolerance checkbox + label (N## | T## | desc)
- Placed at anchorLine (the toolpath's first comment line)
- Placeholder separators shown on opposite side when a toolpath is unmatched
- Event delegation handles clicks/changes (bound once, not per-render)

**Toolpath header bar** (sticky bar above each pane):
- Shows the current toolpath label as you scroll
- Tracks scroll position, updates via rAF-batched updateCurrentHeader
- Click to open/close dropdown of all toolpaths
- TOL master toggle button (starts active) to turn tolerance on/off for all
  toolpaths on both panes
- Both panes' dropdowns open and close in sync

**Toolpath dropdown**:
- Lists all detected toolpaths with Show/hide and Tolerance checkboxes
- Click a row to jump to that toolpath (closes dropdown after)

**Synchronized scrolling**: bidirectional, rAF-guarded against loops

**Drag and drop**: per-pane and global (drop anywhere to left pane, drop 2 to both)

**File I/O**: Open Left/Right buttons, Save Left/Right (browser download)

**Scroll to line** (`scrollToLine`): uses the row model (padding and separator rows)

**Row API**: getDisplayRow(side, line), getTotalRows(side) — used by the gutter

### App (`app.js`)

**Settings** (localStorage, versioned at SETTINGS_VERSION = 6):
- ignoreParenComments (default: OFF), ignoreSemiComments (ON),
  ignoreWhitespace (ON), ignoreCase (ON), normalizeGMCodes (ON),
  ignoreLineNumbers (ON), ignoreBlockDelete (OFF), decimalPointMatters (OFF)
- minorThreshold (default: 0.001), majorThreshold (default: 0.01)
- syncScroll (ON)
- Settings version bump clears stale saved settings
- All comparison-rule settings are passed to the engine and change results

**Per-toolpath state**:
- disabledToolpathIds: Set of toolpath IDs whose diffs are hidden
  (ops with alwaysShow still show through)
- toleranceOffIds: Set of toolpath IDs with tolerance turned OFF.
  Default: empty = tolerance ON for every toolpath.
  TOL off makes within-tolerance diffs show as minor.

**Diff execution** (`runDiff`):
- Splits text to lines, calls DiffEngine.computeSemanticDiff
- Keeps hide/TOL choices across re-diffs: toolpaths are matched by
  side + type|name|opType|tool + occurrence count. New clears them; Swap clears them.
- Calls applyDecorations

**Decoration application** (`applyDecorations`):
- Builds left/right decoration arrays and alignment padding from diff ops
- Hidden toolpath ops are skipped unless op.alwaysShow
- effectiveType: 'tolerance' becomes 'minor' when that toolpath's TOL is off;
  every other type passes through unchanged
- One-sided ops with workOffset are decorated as workoffset
- Builds leftSeparators / rightSeparators keyed by anchorLine
- Adds placeholder separators for unmatched toolpaths on the opposite side
- Equalizes total display line counts between panes (accounts for padding + separators)
- Updates center gutter diff markers
- Counts stats from what is actually decorated (hidden and tolerance diffs not counted)
- Updates status bar

**Center diff gutter** (`updateDiffMarkers`):
- Tick marks for the same diffs F7 visits, placed by display row (matches scroll position)
- Clickable: jumps both editors to the diff nearest the clicked row

**Diff navigation**: F7 / Shift+F7 / Prev/Next buttons, skips tolerance and
disabled-toolpath ops

**Status bar**: Toolpaths L/R, Work offset count, Critical count, Minor count, Lines L/R,
line-count mismatch warning (>10% difference); right side: control, units, privacy note, cursor pane + position

**Other**: New (clear both), Swap panes, Load Example (built-in test G-code)

---

### Macro variables (`macro-eval.js`)

- `MacroEval.resolveFile(parsed)` runs inside computeSemanticDiff on both files.
- Walks the file once. Values: number, null (vacant, #0), undefined (unknown).
- Reads per line (comments removed): `#n=expr`, `#[expr]=expr`, `IF[..]THEN`,
  `IF[..]GOTO n`, `GOTO n`, `WHILE[..]DOn` / `ENDn`, and G-code words with
  expressions. Maths: + - * / MOD AND OR XOR, brackets, SIN COS TAN ASIN ACOS
  ATAN (ATAN[a]/[b]) SQRT ABS ROUND FIX FUP LN EXP POW (degrees). EQ/NE tell
  vacant from 0. Float noise trimmed to 1e-9.
- Never runs loops. Unknown (honest) cases:
  - vars changed inside WHILE..END or a backward GOTO range: unknown from the
    loop start and after the loop end
  - forward GOTO with unknown condition: vars changed in the jumped-over lines
    become unknown at the label. Known-true: lines skipped (p.macroSkipped)
  - block delete `/` assignment: unknown if the value would change
  - G65 / G66 / M06: commons (#34+) unknown. M98 and unreadable macro lines: all unknown
  - indirect write with unknown index: all unknown. O-number line: new program, all unknown
  - unset vars are unknown, not vacant (machine may hold a value)
- Adds to parsed lines: `resolved` {letter: value}, `varRefs` {n: value before
  the line}, `assigned` {index, value}, `macroSkipped`, `jump` {targetN,
  targetLine, conditional, loop, kind 'goto'|'m99'}, `cond` {value 1/0/undefined,
  assumed}, `jumpSources` [lines], `alarmStop` (true, or 'maybe' on a / line
  reached by a tested jump).
- IF tests: `resolveFile(parsed, { assume })`, assume = Map line -> {raw, value}.
  Used only while the line text still equals raw. A tested IF counts as sure
  (also on / lines). app.js keeps `assumptions` per side, passes them as
  opts.assumeLeft / assumeRight to computeSemanticDiff, lists them in
  #test-banner (legend strip), prunes edited lines, clears on New / Swap.
- classifyTokens: letters with an expression on either side are compared once,
  in the expression section (skipped in axis / arc / F / S / T / H / D / param
  checks). Same text + different known value -> critical (exprValue-X).
  Different text + same known value -> minor (exprSame-X). Otherwise critical.
- app.js shows the values as a grey note after the line (`→ X1.5 Y?`,
  `→ #102 = 4`, `↷ skipped by GOTO`). Setting "Show variable values" (ON).

### Info panel (`hover-help.js`, `#info-panel` in index.html)

- Bottom panel like VS Code, between the panes and the status bar. No floating tip.
- Hidden until code is clicked. Click (Editor.setClickCallback) -> opens / expands
  the panel and pins that item. While open, hover (Editor.setHoverCallback,
  120 ms) shows what is under the mouse; leaving the code or entering the panel
  goes back to the pinned item so its buttons can be pressed.
- Header: ▾ collapse (or Esc / click header), ✕ close. Height via CSS var
  --panel-h on :root (0 / 24 / 160 px); #main height subtracts it. A window
  resize event redraws editors (Editor.refresh) and the gutter markers.
- Layout: left = values (rows) + buttons, right = meaning, explain, wiki link.
  Left column hides when empty. Columns stack under 700 px.
- lookup(side, line, text, col) finds the token (DiffEngine.parseGCodeLine).
- Tables: G, M, word letters, macro keywords, #variable ranges (Brother first,
  Fanuc fallback). Brother #5221+ / #7001+ work offsets, #11000+n tool length,
  #13000+n diameter (from the shop post notes), #3700 tool in spindle.
- Values come from the last compare (App.getDiffContext), only when the line text still matches.
- Values first (left) so experienced users are not slowed down.
- GOTO / IF / M99 P (flowInfo): test, result, target line, runs next. Buttons:
  Test TRUE / Test FALSE (only when the result is unknown or being tested),
  Clear test, Jump to line. N labels (labelInfo): lines that jump here.
- App.jumpTo(side, line, from): scroll, flash the line, show #jump-back for 15 s.
  Ctrl/Cmd+click on a GOTO jumps (Editor.setCtrlClickCallback).
- Each item links to a page on https://zappettiniconsulting.com/wiki/ (the author
  is a contact of the shop; keep the links pointing at real pages).

### Status bar (right side)

- Control (Brother), Units per file from first G20/G21 (red when they differ,
  "not in file" when neither file has one), "Files stay on this computer",
  pane + Ln/Col of the cursor.
- No-decimal check (`#stat-decimal`): ON/OFF of decimalPointMatters + count of
  lines with a non-zero X/Y/Z/A/B/C/I/J/K/R/Q word without a decimal
  (DiffEngine.noDecimalWords). Amber when OFF and count > 0. Click steps through
  them (jumpTo). Info only: does not change the compare. Keep
  decimalPointMatters default OFF (Dan's choice).
- Settings (`#stat-settings`): amber "Settings changed (n)" when any compare
  setting or threshold differs from DEFAULT_SETTINGS (SETTING_LABELS in
  app.js). Tooltip lists them. Click opens settings.

### Feeds & Speeds (`feeds.js`)

- Button "Feeds & Speeds" opens a popup table: one row per matched toolpath,
  left vs right, changed cells red (left struck → right), click name to jump.
- `Feeds.analyzeFile(parsed, toolpaths)` walks lines with machine state
  (position, motion mode, plane, G90/G91, canned cycle, modal F, RPM).
- Engagement = feed moves between two rapids. Entry moves: Z-only down = plunge,
  down + XY = ramp, vertical arc / G41-G42 = lead-in. Exit moves: Z-only up =
  retract, up + XY / vertical arc / G40 = lead-out. Middle: feed with most
  distance = cut; short different-feed runs before/after = lead-in/out (< 50% of
  distance); higher = transition; lower = other; post high feed 200 / 5000 = high feed.
- RPM: S on G100 or M03/M04 line, inherited by same-tool toolpaths. Ramp RPM: lone
  S line that differs. Cycle: F on G73-G89 lines.
- Every value is a Map value -> weight (distance); F list = every F with count.
- Feed types are best guesses (post does not write movement type). Exact labels
  would need the post's "Parametric feed" property (off today).
- App exposes `App.getDiffContext()` (engine result incl. leftParsed/rightParsed).

### Tool Table (`tools.js`)

- Button "Tool Table" opens a popup (reuses fd- table styles). `Tools.compare(ctx)`
  returns { rows, fixture }; `Tools.analyzeFile(parsed, toolpaths)` per file.
- Tool lines: comment-only `T<n> - ...`, parsed by `parseToolComment` into id
  (ID= or PRODID=), desc, ooh, holder (HLDR=), lc (-LC-n). Header list wins.
- Gauge from `CHECKING LENGTH OF TOOL n = GAUGE x`. Used = G100 calls (g100Line)
  + same-tool toolpaths.
- Warnings: not in header list, listed never used, H/D on G100 line != T.
- Red only when both sides have a value and it differs (numbers compared as numbers).
  One-sided value = dim. Fixture: same rule.

## Future Ideas (to-do)

Ideas from reviewing the Zappettini Macro Playground and wiki (Nov 2026).

1. **Overlay backplot** — draw left and right toolpaths in 3D on top of each
   other, differences in red. Rapids dashed, feeds solid. Dan has more ideas
   for this — ask before designing it.
2. **Variables, step 3 (hard)** — run loops (WHILE, backward GOTO), follow
   G65 / M98 into subprograms, pass G65 arguments. Ask Zappettini about his
   macro engine first.
3. **Compare assignment lines by value** — `#1=2*3` vs `#1=6` is still a text change.
4. **Welcome card** — short numbered "how to use" card on first open.
5. **Light theme** — toggle for bright shop-floor screens.
6. **Subprogram compare** — when a program calls `M98 P____`, open and compare
   that subprogram file too.
7. **Tolerance on variable words (look into)** — today `X#1` (#1 = 1.0) vs
   `X1.0004` is red (critical), while the same change between plain numbers is
   within tolerance. Decide whether axis / arc words with a known worked-out
   value should go through applyToleranceClassification like plain numbers.
   Safe as is, but noisier.
8. **Control / machine profiles** — pick a profile (e.g. Brother Speedio M,
   Brother R, Fanuc 0i, Haas, ...) that sets: G/M code meanings and wiki links
   (hover-help.js tables), system variable map (#5221 / #7001 / tool offset
   ranges), toolpath detection rules (G100, preamble codes, divider layout),
   macro rules (MacroEval: which calls clear which variables), default units
   and decimal rule. Status bar "Control:" shows the active profile. Today all
   of this is hard-coded for Brother (see "Machine-Specific Settings" below).

## What Is NOT Built Yet

### 1. Per-Toolpath Tolerance Threshold Override
Currently there is one global minor/major threshold pair. The plan is to allow
each toolpath row to have its own threshold override. The toleranceOffIds
infrastructure is in place but per-row threshold values are not.

### 2. Extended Work Offset Formats
G54.1 Pn is treated as a work offset change. G154 Pn is not handled yet.
Add later with a configurable format setting.

### 3. Machine-Specific Settings
The preamble code lists (PREAMBLE_CODES / PREAMBLE_MCODES) and the G100
tool-call rule are hardcoded for Brother in segmentIntoToolpaths.
Should be user-configurable in the settings panel.

### 4. Toolpath Navigator Scrolling Table
The dropdown list from the header bar is the current navigation UI. The
originally planned scrolling table panel (rows moving bottom-to-top as you
scroll through code) is not built. Evaluate whether the dropdown is sufficient.

---

## Critical Difference Rules

These diffs must always surface even when a toolpath's Show/Hide is OFF.
Enforced via op.alwaysShow, set in diff-engine.js. app.js only reads it.

All severity rules live in classifyTokens in diff-engine.js.
Do not scatter them. Do not duplicate them in app.js or editor.js.
This list will grow — add new rules to classifyTokens only.
(applyToleranceClassification only grades coordinate deltas by threshold.)

| Type | Severity | How Detected |
|---|---|---|
| Work offset | workoffset (purple) | G54-G59 change in non-motion G-code set |
| Work offset | workoffset (purple) | P (or P expression) change on a G54.1 line |
| Offset data | workoffset (purple) | Any axis/param change on G10, G52, or G92-with-axes lines (no tolerance). G92 S Q = spindle clamp, not offset |
| Motion mode | critical | Active G0/G1/G2/G3/canned mode differs (uses modal state). Two G100 lines compare explicit motion codes only (G100 positions itself) |
| Non-motion G-codes | critical | Any other G-code set difference |
| M-codes | critical | Any M-code set difference |
| Tool / offset call | critical | T, H, or D value difference |
| Spindle speed | critical | S value difference |
| Feed rate | critical | F value difference |
| Missing axis | critical | Axis or I/J/K present on one side only |
| Redundant word | minor | Axis or F on one side only, equal to the active value (plain move line, G90, position known) |
| Incremental move | critical | Any axis value change while G91 is active (errors add up) |
| Unparsed text | critical | Unreadable characters differ (stray *, X1..5) |
| No decimal | critical | Only with setting decimalPointMatters: X1 vs X1. on X/Y/Z/A/B/C/I/J/K/R/Q (zero exempt) |
| Jump label | critical | N label targeted by GOTO / M99 P differs (even with Ignore N-numbers) |
| Comment content | critical | Comment text difference (after ignore rules), by role — see Comment roles |
| Commented-out code | critical | (G0 Z1.) vs live G0 Z1.: paired (sameKind), field commentedOut + inner code diffs |
| Macros | critical | Any # token or macro statement (IF/GOTO/...) difference; numbers compared as numbers (5. = 5.0) |
| Expression words | critical | X[#101+1] / X#101 text difference (unless the worked-out values match) |
| Expression value | critical | Same expression text, different worked-out value (exprValue-X) |
| Expression same value | minor | Different text, same known value: X#101 vs X1.5 with #101 = 1.5 (exprSame-X) |
| Params / other words | critical | R/P/Q/L or unrecognized letter difference |
| Arc R | coordinate (tolerance) | R value change when both lines are G2/G3 (canned cycle R stays critical) |
| Block delete | critical | / on one side only (unless Ignore block delete) |
| Coordinate > major | critical | Max delta beyond majorThreshold |
| N-number | minor | Only when Ignore N-numbers is off |
| O-number | minor | Program number difference |
| Format | minor | G01 vs G1 (normalize off), case (ignore case off), whitespace (ignore whitespace off) — only when nothing else differs |

## Comment roles (`commentRole`, `markCommentRoles`)

- code: comment-only line whose text parses as G-code (commentedCode) -> critical
- tool: comment-only line starting `T<n> -` (header tool list, tool-setting block) -> critical
- note: any other comment, incl. inline comments on code lines -> critical
- label: dividers, and comment-only lines from a toolpath's anchorLine to its first
  real code line (length-check block skipped) -> not compared
- header: comment-only lines before the first code line of the file -> not compared
- fixture: (FIXTURE = ...) -> critical only when both sides are fixture lines and differ;
  one-sided = ignored. sameKind pairs a fixture line only with a fixture line.
A comment diff is skipped only when every side that has a compared comment is label/header.

## Severity Naming Convention

Diff engine op types (final, after tolerance):
- equal: no difference
- workoffset: work offset change (purple, highest tier)
- critical: critical field difference (red)
- minor: amber
- tolerance: within minor threshold (faint, not counted)
- added / removed: one-sided ops

coordinate / coordinate-z exist only inside the engine, before tolerance grading.

app.js maps these via decoType():
- critical maps to major (CSS class diff-bg-major)
- workoffset maps to workoffset (CSS class diff-bg-workoffset)
- any unknown type maps to major (never hidden by accident)

## Toolpath Segmentation Rules (Do Not Simplify)

Tuned for Fusion 360 posts on Brother Speedio. Key behaviors to preserve:

- G100 with T AND (X/Y or S or M03/M04) is the tool-change anchor for Brother.
  A bare G100 without these qualifiers is not a tool call.
- PREAMBLE_CODES / PREAMBLE_MCODES hold normalized codes (M5 not M05) and are
  checked with normCode.
- Preamble expansion absorbs inter-toolpath housekeeping lines (G28, G53, M05,
  M09, M298, rapids, blanks) into the preceding segment so they don't appear
  as orphaned lines between toolpaths.
- Cutting move detection (G1/G2/G3 with axis values) is the stop condition for
  backward preamble expansion.
- The comment-pair anchor (blank + comment + comment) is the primary trigger,
  not the G100. The G100 is associated forward within 20 lines.
- Same-tool re-calls (no G100, just a new comment pair) are detected as toolpaths
  with toolNumber inherited from the previous toolpath.
- anchorLine is used for separator placement (the first comment line of the pair).
  startLine includes the expanded preamble and is used for line range logic only.
  g100Line records the tool-call line.

---

## Visual Design

- Dark theme, industrial aesthetic (VS Code Dark+ style greys)
- Background: #1e1e1e, panels: #252526, text: #d4d4d4, accent: #0e639c
- Colors are CSS variables in :root in style.css
- Font: JetBrains Mono (Google Fonts @import in style.css), fallback Consolas, monospace
- No rounded corners. Functional, not decorative.
- Line height: 20px — used in scrollToLine and display height math.
  Do not change without updating both.

## Diff Highlight Colors

| Classification | CSS class | Background | Edge / marker |
|---|---|---|---|
| Work offset | diff-bg-workoffset | #33104a | #c040ff purple |
| Critical | diff-bg-major | #3b1111 | #c62828 red |
| Minor | diff-bg-minor | #2e2500 | #c89a10 amber |
| Within tolerance | diff-bg-tolerance | faint (rgba) | dotted grey |
| Added | diff-bg-added | #0d2818 | #3fb950 green |
| Removed | diff-bg-removed | #2d0e0e | #c62828 red |
| Token diff (inline) | token-diff | bright highlight on changed token only | |
| Disabled line | line-disabled | dimmed | |

---

## Things NOT to Build

- Accept/review workflow (dropped)
- Back-plotter / toolpath visualization (deferred indefinitely)
- Automatic noise detection (user controls noise via toolpath checkboxes)
- Fuzzy or AI-based diff
- Backend, server, npm, or build step of any kind
