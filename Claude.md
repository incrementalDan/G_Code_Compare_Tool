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
└── CLAUDE.md
```

No build step. CDN imports only. Opens directly from disk.

---

## Current State — What Is Built and Working

### Diff Engine (`diff-engine.js`)

**Full token-aware G-code parser** (`parseGCodeLine`):
- Parses every token on a line into typed objects with character positions
- Token types: gCode, mCode, axis (X/Y/Z), rotary (A/B/C), arcParam (I/J/K),
  feed (F), spindle (S), tool (T), hOffset (H), dOffset (D), param (R/P/Q/L),
  macro (#), lineNumber (N), comment (paren and semicolon), blockDelete (/),
  program (O number)
- Tracks isBlank, isCommentOnly, blockDelete flags per line

**Modal G-code state tracking** (`trackModalState`):
- Tracks current motion mode (G0/G1/G2/G3) across a file
- Used in fingerprints for bare coordinate lines (no explicit G-code)

**Toolpath segmentation** (`segmentIntoToolpaths`) — Brother Speedio / Fusion 360:
- Pass 1 (primary): blank line followed by 2+ consecutive comment-only lines
- Pass 2: associates G100 tool call lines (with X/Y or S or M03/M04) to
  comment-pair anchors within +20 lines forward
- Expands preamble backward from each anchor (up to 40 lines): absorbs
  G28/G53/M05/M09/M298/rapids/blanks into the segment, stops at cutting moves
- Detects and labels: preamble (Program Header), toolpath, program_end (M30)
- Each toolpath object: { id, type, name, opType, toolNumber, nNumber,
  spindleSpeed, startLine, anchorLine, endLine }
- Fallback to G100-only detection if no comment-pairs found
- Fallback to comment-based sections if no anchors at all

**Toolpath matching** (`matchToolpaths`):
- Pass 1: key-based LCS on "name|opType|T{toolNumber}" strings
- Pass 1b: content-similarity refinement when duplicate keys exist
- Pass 2: content similarity fallback (LCS on fingerprints, threshold 0.5,
  +0.1 boost for matching tool number)
- Produces matched pairs { left, right } plus unmatched left/right entries

**Fingerprinting** (`fingerprint`):
- Structural signature for LCS matching: G-codes, M-codes, axis letters present,
  arc params, rotary, F/S/T/H/D presence, macro presence
- Comment-only lines use full comment text for precise matching
- Bare coordinate lines prepend modal G-code

**Token-level classification** (`classifyTokens`):
- Compares parsed token fields between two matched lines
- Returns tokenDiffs array — each diff has: field, severity, leftVal, rightVal,
  leftTokens, rightTokens (with character positions for highlighting)
- Severity levels:
  - critical: M-codes, T/H/D offsets, spindle S, feed F, comments, macros,
    non-motion G-code changes, structural differences
  - coordinate: X/Y/A/B/C/I/J/K value differences
  - coordinate-z: Z value differences (treated same as coordinate currently)
  - equal: no difference
- Motion code interchange (G0/G1/G2/G3 only) classified as minor not critical

**Tolerance classification** (`applyToleranceClassification`):
- Post-processes coordinate diffs using minorThreshold / majorThreshold
- If max delta <= minorThreshold: tolerance (hidden by default)
- If max delta <= majorThreshold: minor (amber)
- If max delta > majorThreshold: critical (red)
- Critical token diffs (feed, spindle, etc.) are never downgraded by tolerance

**LCS engine**: Uint16Array DP table, standard backtrack

**Stats** (`countStats`): counts critical, minor, added, removed ops

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
- Placeholder separators shown on opposite side when a toolpath is unmatched
- Event delegation handles clicks/changes (bound once, not per-render)

**Toolpath header bar** (sticky bar above each pane):
- Shows the current toolpath label as you scroll
- Tracks scroll position, updates via rAF-batched updateCurrentHeader
- Click to open/close dropdown of all toolpaths
- TOL master toggle button to enable/disable tolerance filtering for all toolpaths
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

**Per-toolpath state**:
- disabledToolpathIds: Set of toolpath IDs whose diffs are suppressed
  (structural critical diffs always show through regardless)
- toleranceEnabledIds: Set of toolpath IDs where tolerance classification
  is active (default: OFF for all — must be explicitly enabled per toolpath
  or via master toggle)

**Diff execution** (`runDiff`):
- Splits text to lines, calls DiffEngine.computeSemanticDiff
- Resets all per-toolpath state on each full re-diff
- Calls applyDecorations

**Decoration application** (`applyDecorations`):
- Builds left/right decoration arrays and alignment padding from diff ops
- Applies isOpDisabled check: disabled toolpath ops are skipped unless
  hasStructuralCritical (feed, spindle, tool, offsets, M-codes, comments, macros)
- effectiveType: returns tolerance-classified type if tolerance enabled for
  that toolpath, otherwise returns raw pre-tolerance type
- Builds leftSeparators / rightSeparators keyed by anchorLine
- Adds placeholder separators for unmatched toolpaths on the opposite side
- Equalizes total display line counts between panes (accounts for padding + separators)
- Updates center gutter diff markers
- Updates status bar (toolpath counts, critical/minor counts, line counts)

**Center diff gutter** (`updateDiffMarkers`):
- Proportional colored tick marks for all visible diffs
- Clickable: click anywhere to jump both editors to nearest diff at that position

**Diff navigation**: F7 / Shift+F7 / Prev/Next buttons, skips tolerance and
disabled-toolpath ops

**Status bar**: Toolpaths L/R, Critical count, Minor count, Lines L/R,
line-count mismatch warning (>10% difference), cursor position

**Other**: New (clear both), Swap panes, Load Example (built-in test G-code)

---

## What Is NOT Built Yet

### 1. Per-Toolpath Tolerance Threshold Override
Currently there is one global minor/major threshold pair. The plan is to allow
each toolpath row to have its own threshold override. The toleranceEnabledIds
infrastructure is in place but per-row threshold values are not.

### 2. Work Offset Critical Detection
Work offset changes (G54-G59) need a distinct visual treatment that stands apart
from normal critical diffs. Currently caught by the G-code diff but not given
their own highlight tier. Must always surface even in disabled toolpaths.

### 3. Extended Work Offset Formats
G154 Pn, G54.n — not yet handled. Add later with a configurable format setting.

### 4. Machine-Specific Settings
Z-home string (default: G28 G91 Z0 / G53 Z0.) is hardcoded in segmentation.
Should be user-configurable in the settings panel.

### 5. Toolpath Navigator Scrolling Table
The dropdown list from the header bar is the current navigation UI. The
originally planned scrolling table panel (rows moving bottom-to-top as you
scroll through code) is not built. Evaluate whether the dropdown is sufficient.

---

## Critical Difference Rules

These diffs must always surface even when a toolpath's Show/Hide is OFF.
Currently enforced via hasStructuralCritical in app.js.

All critical rules live in classifyTokens in diff-engine.js.
Do not scatter them. Do not duplicate them in app.js or editor.js.
This list will grow — add new rules to classifyTokens only.

| Type | How Detected |
|---|---|
| Work offset | G54-G59 G-code change (needs dedicated highlight tier — not yet) |
| Spindle speed | S value difference |
| Tool / offset call | T, H, or D value difference |
| Feed rate | F value difference |
| Comment content | Any comment text difference, including commented-out lines |
| Macros | Any # token difference |
| M-codes | Any M-code set difference |
| Non-motion G-codes | G-code changes that are not G0/G1/G2/G3 interchange |

---

## Severity Naming Convention

Diff engine internal severities:
- equal: no difference
- critical: structural or critical field difference (red)
- coordinate: numeric coordinate difference (subject to tolerance)
- coordinate-z: Z-axis difference (same as coordinate currently)
- minor: after tolerance — within major threshold (amber)
- tolerance: after tolerance — within minor threshold (hidden)
- added / removed: one-sided ops

app.js maps these via decoType():
- critical maps to major (CSS class suffix diff-bg-major)
- coordinate / coordinate-z are reclassified by applyToleranceClassification
  to minor, tolerance, or critical before decorations are applied

---

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
- anchorLine is used for separator placement (the visible comment line).
  startLine includes the expanded preamble and is used for line range logic only.

---

## Visual Design

- Dark theme, industrial aesthetic
- Background: #1a1a2e, panels: #2a2a3e, text: #e0e0e0
- Font: JetBrains Mono (Google Fonts CDN), fallback Consolas, monospace
- No rounded corners. Functional, not decorative.
- Line height: 20px — used in scrollToLine and display height math.
  Do not change without updating both.

## Diff Highlight Colors

| Classification | CSS class | Color |
|---|---|---|
| Critical | diff-bg-major | #5c2626 deep red |
| Minor | diff-bg-minor | #4a3f20 amber |
| Within tolerance | diff-bg-tolerance | subtle (see style.css) |
| Added | diff-bg-added | #1a3a4a dark teal |
| Removed | diff-bg-removed | #3d1f2f burgundy |
| Token diff (inline) | token-diff | bright highlight on changed token only |
| Disabled line | line-disabled | dimmed |

---

## Things NOT to Build

- Accept/review workflow (dropped)
- Back-plotter / toolpath visualization (deferred indefinitely)
- Automatic noise detection (user controls noise via toolpath checkboxes)
- Fuzzy or AI-based diff
- Backend, server, npm, or build step of any kind
