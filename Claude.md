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
│   ├── diff-engine.js  — parser, toolpath segmentation, LCS, token classification
│   ├── editor.js       — single-layer line-div editor, rendering, decorations
│   ├── app.js          — UI wiring, settings, state, diff coordination
│   ├── feeds.js        — Feeds & Speeds: per-toolpath feed/RPM analysis + popup
│   └── info.js         — in-app Info popup: what is / isn't checked
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
- Filters you control — Comparison rules table, Tolerance table, Show/hide
- Colours
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

**Modal G-code state tracking** (`trackModalState`):
- Tracks current motion mode across a file: G0/G1/G2/G3 and canned cycles
  (G73/G74/G76/G80-G89)
- Used in fingerprints for bare coordinate lines (no explicit G-code)
- Used in classifyTokens: a bare move under G0 vs under G1 is a critical diff

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
non-motion G, work offset, block delete, params). Plain moves do not.
Lines with G54-G59 get workOffset = true.

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
  ignoreLineNumbers (ON), ignoreBlockDelete (OFF)
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
line-count mismatch warning (>10% difference), cursor position

**Other**: New (clear both), Swap panes, Load Example (built-in test G-code)

---

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
| Motion mode | critical | Active G0/G1/G2/G3/canned mode differs (uses modal state) |
| Non-motion G-codes | critical | Any other G-code set difference |
| M-codes | critical | Any M-code set difference |
| Tool / offset call | critical | T, H, or D value difference |
| Spindle speed | critical | S value difference |
| Feed rate | critical | F value difference |
| Missing axis | critical | Axis or I/J/K present on one side only |
| Comment content | critical | Comment text difference (after ignore rules) |
| Macros | critical | Any # token or macro statement (IF/GOTO/...) difference |
| Expression words | critical | X[#101+1] / X#101 text difference |
| Params / other words | critical | R/P/Q/L or unrecognized letter difference |
| Block delete | critical | / on one side only (unless Ignore block delete) |
| Coordinate > major | critical | Max delta beyond majorThreshold |
| N-number | minor | Only when Ignore N-numbers is off |
| O-number | minor | Program number difference |
| Format | minor | G01 vs G1 (normalize off), case (ignore case off), whitespace (ignore whitespace off) — only when nothing else differs |

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
