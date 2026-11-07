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
│   └── app.js          — UI wiring, settings, state, diff coordination
├── tests/
│   └── engine.test.js  — diff engine tests (run: node tests/engine.test.js)
└── CLAUDE.md
```

No build step. CDN imports only. Opens directly from disk.

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
  program (O number), other (any unrecognized letter, e.g. U/V/W)
- Comment tokens carry kind: 'paren' or 'semi' (parenComments / semiComments arrays)
- Tracks isBlank, isCommentOnly, blockDelete (leading whitespace allowed), raw text

**Modal G-code state tracking** (`trackModalState`):
- Tracks current motion mode across a file: G0/G1/G2/G3 and canned cycles
  (G73/G74/G76/G80-G89)
- Used in fingerprints for bare coordinate lines (no explicit G-code)
- Used in classifyTokens: a bare move under G0 vs under G1 is a critical diff

**Toolpath segmentation** (`segmentIntoToolpaths`) — Brother Speedio / Fusion 360:
- Pass 1 (primary): blank line followed by 2+ consecutive comment-only lines
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
- Pass 1: key-based LCS on "name|opType|T{toolNumber}" strings
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

**LCS engine**: Uint16Array DP table, standard backtrack

**Stats** (`countStats`): counts critical (incl. workoffset), minor, added, removed.
Not used by the UI — app.js counts only what is actually displayed.

### Editor (`editor.js`)

**Custom single-layer line-div editor** (no CodeMirror — built from scratch):
- Hidden textarea captures all input; display div renders styled line divs
- Each line div: gutter line number + syntax-highlighted content
- Alignment padding lines (blank spacers to keep both panes line-aligned)
- Toolpath separator rows inline in the display (with checkboxes)
- Fully editable — textarea handles all keyboard input including Tab (2 spaces)
- 300ms debounce on input before triggering diff

**Syntax highlighting** (`syntaxHighlightLine`):
- Applied via regex on each line's raw text
- Colors: G-codes (blue), M-codes (purple), T (red), H/D (red), F (orange),
  S (orange), X/Y (green), Z (teal), A/B/C (teal), I/J/K (cyan),
  macros/# (magenta), comments (gray italic), N-numbers (dim)
- Token diff highlighting: uses Unicode private-use sentinels (U+E000/E001)
  inserted into the raw string before HTML escaping, marks changed tokens
  with a token-diff span wrapper

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

**Scroll to line** (`scrollToLine`): accounts for alignment padding and separator rows

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
- Resets all per-toolpath state on each full re-diff (all shown, tolerance ON)
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
- Proportional colored tick marks for all visible diffs
- Clickable: click anywhere to jump both editors to nearest diff at that position

**Diff navigation**: F7 / Shift+F7 / Prev/Next buttons, skips tolerance and
disabled-toolpath ops

**Status bar**: Toolpaths L/R, Work offset count, Critical count, Minor count, Lines L/R,
line-count mismatch warning (>10% difference), cursor position

**Other**: New (clear both), Swap panes, Load Example (built-in test G-code)

---

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
| Motion mode | critical | Active G0/G1/G2/G3/canned mode differs (uses modal state) |
| Non-motion G-codes | critical | Any other G-code set difference |
| M-codes | critical | Any M-code set difference |
| Tool / offset call | critical | T, H, or D value difference |
| Spindle speed | critical | S value difference |
| Feed rate | critical | F value difference |
| Missing axis | critical | Axis or I/J/K present on one side only |
| Comment content | critical | Comment text difference (after ignore rules) |
| Macros | critical | Any # token difference |
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
