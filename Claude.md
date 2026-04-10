# CLAUDE.md — G-Code Compare Tool

## What This Tool Is

A browser-based G-code diff tool for CNC machinists. No build step, no backend,
no npm. Opens as a static HTML file. Built for a Brother 3/5-axis mill shop but
designed to be configurable for other machines and controls.

The tool compares two G-code files: a known-good machine file (left) against a
freshly posted CAM file (right). The goal is to catch meaningful differences
quickly and safely. Missed differences can cause machine crashes — $10k–$100k
damage — so accuracy and clarity are the top priority.

-----

## Current State (as of last session)

### Working

- Single HTML file, CDN imports only, opens from disk
- Two editable CodeMirror panes (left = Machine File, right = CAM File)
- G-code aware diff engine:
  - `canonicalize()` strips noise per active ignore rules
  - `classifyDifference()` classifies diffs as major / minor / equal using numeric tolerance
  - LCS-based line diff
- Inline token highlighting: only the differing token within a line is highlighted
  (e.g. X1.3454 vs X1.2334 — only the value lights up, not the whole line)
- Diff classification colors (major = deep red, minor = amber, added = teal,
  removed = burgundy)
- Tolerance sliders (minor threshold, major threshold), configurable, step 0.0001
- Ignore rules: comments, whitespace, case, G/M normalization, line numbers,
  block delete
- Center minimap/scrollbar showing diff density across the whole file
- Settings panel with localStorage persistence
- Load Example button with test G-code covering all diff types
- Drag and drop file loading

### Dropped / Not Building

- Phase 2 accept/review workflow — removed entirely
- Phase 3 back-plotter — deferred indefinitely
- Phase 4 advanced features — deferred indefinitely

-----

## What to Build Next

### 1. Toolpath Segmentation (highest priority)

Detect toolpath boundaries and break both files into labeled segments. This is
the foundation for everything else below.

#### Detection Logic — Two Passes

**Pass 1 — Primary signal (most reliable):**
A new toolpath starts when there is:

- 1 blank line, followed by
- 2 consecutive comment-only lines (lines containing only parenthetical comments,
  no G or M codes)

This is the most common pattern from Fusion 360 posts on Brother machines.

**Pass 2 — Corroborating signals (use to confirm or catch missed boundaries):**
After Pass 1, scan for any of these within ±3 lines of an existing boundary, or
as standalone boundary triggers if Pass 1 missed them:

|Signal                 |Notes                                                               |
|-----------------------|--------------------------------------------------------------------|
|N-block resequence     |Jump or reset in N numbers (e.g. N9999 → N10)                       |
|Z-home move            |Configurable string, default: `G28 G91 Z0` or `G53 Z0.`             |
|Tool change            |Line containing `M06` or `M6`, usually paired with `T##`            |
|M298                   |Brother-specific, on by default, configurable off                   |
|Standalone comment line|Only a comment, no G/M code — corroborating only, not a solo trigger|

**Manual NC / interruptions:**
If a boundary signal fires but no tool change is found within ±5 lines, treat
it as a **section break** (not a full toolpath). Still collapsible and visible
in the navigator, but styled differently — lighter header, no T## shown.

#### Toolpath Header Format

Each detected segment gets a header row:

```
N## | T## — (first comment line text) | (second comment line text)
```

Example: `N10 | T42 — ADAPTIVE ROUGH XY | 6MM FLAT ENDMILL`

If any field is missing, omit it gracefully. Don’t show `T## | undefined`.

-----

### 2. Toolpath Navigator Panel

A persistent panel (below or beside the editors) that lists all detected
toolpath segments as rows in a scrollable table.

#### Behavior

- As the user scrolls the code, the navigator highlights the row corresponding
  to the current toolpath in view
- The active row floats or scrolls within the navigator to stay visible
- Clicking a row jumps both editors to that toolpath’s start line
- Both left and right panes share one navigator (they are synced already)

#### Per-Row Controls

Each row in the navigator has:

|Control            |Purpose                                                                                                                                                     |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Checkbox — Compare |When OFF: suppress all diffs in this toolpath EXCEPT critical differences (see below). Lines still visible, not collapsed unless user also enables collapse.|
|Checkbox — Collapse|When ON: collapse this toolpath’s lines to a single summary row in the editor view                                                                          |
|Tolerance override |Optional per-toolpath major/minor threshold override (can inherit global default)                                                                           |

The navigator replaces the settings panel checkbox list for per-toolpath control.
Global tolerance sliders remain in settings as the default for all toolpaths.

-----

### 3. Critical Differences — Always Surface, Never Suppress

Even when a toolpath’s Compare checkbox is OFF, these difference types must
always be detected and shown. They get their own distinct highlight color
(bright orange or magenta — must visually stand apart from normal major/minor).

|Critical Type                             |Detection Logic                                                                                                                                                                           |
|------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Work offset change                        |Any change to G54–G59 on a line. Extended formats (G154 Pn, G54.n) are future — for now handle standard G54–G59 only. Work offset changes must be very visually loud.                     |
|Spindle speed                             |Any difference in S## value on a line                                                                                                                                                     |
|Tool / offset call                        |Any difference involving T##, H##, or D##                                                                                                                                                 |
|Feed rate                                 |Any difference in F## value on a line                                                                                                                                                     |
|Comment content                           |Any line where the comment text differs between files (even if the G/M code part is the same). A commented-out line in the machine file vs. an active line in CAM is especially important.|
|Macro variables                           |Any line containing # (macro variable reference). Any difference in #-based expressions, assignments, or conditionals. Flag the whole line as critical if any # token differs.            |
|Missing or extra line at toolpath boundary|A line present in one file but not the other within ±2 lines of a toolpath boundary                                                                                                       |


> These rules will grow over time. Keep them in a separate configurable data
> structure (object or array) so new rules can be added without refactoring.

-----

## Diff Engine Rules (Do Not Change Without Review)

### canonicalize() — current implementation

```javascript
function canonicalize(line, rules) {
  let s = line;
  if (rules.ignoreParenComments)  s = s.replace(/\([^)]*\)/g, '');
  if (rules.ignoreSemiComments)   s = s.replace(/;.*$/, '');
  if (rules.ignoreLineNumbers)    s = s.replace(/^N\d+\s*/i, '');
  if (rules.ignoreBlockDelete)    s = s.replace(/^\//,'');
  if (rules.ignoreCase)           s = s.toLowerCase();
  if (rules.normalizeGMCodes)     s = s.replace(/([gGmM])0+(\d)/g, '$1$2');
  if (rules.ignoreWhitespace)     s = s.replace(/\s+/g, ' ').trim();
  return s;
}
```

### classifyDifference() — current implementation

```javascript
function classifyDifference(canonLineA, canonLineB, minorEps, majorEps) {
  const numRegex = /-?\d+\.?\d*/g;
  const numsA = [...canonLineA.matchAll(numRegex)].map(m => parseFloat(m[0]));
  const numsB = [...canonLineB.matchAll(numRegex)].map(m => parseFloat(m[0]));
  const skeletonA = canonLineA.replace(numRegex, '###');
  const skeletonB = canonLineB.replace(numRegex, '###');
  if (skeletonA !== skeletonB) return 'major';
  if (numsA.length !== numsB.length) return 'major';
  let worstSeverity = 'equal';
  for (let i = 0; i < numsA.length; i++) {
    const delta = Math.abs(numsA[i] - numsB[i]);
    if (delta <= minorEps) continue;
    else if (delta <= majorEps) worstSeverity = 'minor';
    else return 'major';
  }
  return worstSeverity;
}
```

Do not modify these without flagging it. They are the core of the tool and
changes here affect everything downstream.

-----

## Configurable Settings (User-Facing)

### Global (applies to all toolpaths unless overridden)

|Setting                  |Default|Notes                       |
|-------------------------|-------|----------------------------|
|Minor threshold          |0.0002 |Step 0.0001                 |
|Major threshold          |0.0005 |Step 0.0001, must be > minor|
|Ignore paren comments    |ON     |                            |
|Ignore semicolon comments|ON     |                            |
|Ignore whitespace        |ON     |                            |
|Ignore case              |ON     |                            |
|Normalize G/M codes      |ON     |G01→G1, M06→M6              |
|Ignore line numbers      |OFF    |                            |
|Ignore block delete      |OFF    |                            |
|Synchronized scrolling   |ON     |                            |

### Machine-Specific (in settings panel)

|Setting                |Default     |Notes                               |
|-----------------------|------------|------------------------------------|
|Z-home string          |`G28 G91 Z0`|Used for toolpath boundary detection|
|Z-home string 2        |`G53 Z0.`   |Second common pattern               |
|M298 as boundary signal|ON          |Brother-specific, can disable       |

-----

## File Structure

```
gcode-compare/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── diff-engine.js      — canonicalize, classifyDifference, LCS
│   ├── toolpath.js         — boundary detection, segment data structure
│   ├── editor.js           — CodeMirror setup, syntax highlighting, drag-drop
│   └── app.js              — UI wiring, settings, state, navigator panel
├── CLAUDE.md
├── README.md
└── .gitignore
```

-----

## Visual Design

- Dark theme, industrial aesthetic
- Background: `#1a1a2e`
- Panel borders: `#2a2a3e`
- Text: `#e0e0e0`
- Font: JetBrains Mono (Google Fonts CDN), fallback Consolas, monospace
- No rounded corners. Functional, not decorative.

### Diff Highlight Colors

|Classification         |Color                  |Notes                                    |
|-----------------------|-----------------------|-----------------------------------------|
|Major difference       |`#5c2626` deep red     |Large numeric or structural change       |
|Minor difference       |`#4a3f20` amber        |Within major threshold                   |
|Added line             |`#1a3a4a` dark teal    |Only in one file                         |
|Removed line           |`#3d1f2f` burgundy     |Missing from one file                    |
|**Critical difference**|`#7a3a00` bright orange|Always shown even in suppressed toolpaths|
|Equal                  |none                   |                                         |

-----

## What Not to Build

- No accept/review workflow
- No back-plotter or toolpath visualization
- No backend, no server, no npm, no build step
- No automatic noise detection — the user controls what is noise via the
  toolpath navigator checkboxes and tolerance settings
- No fuzzy matching or AI-based diff

-----

## Notes on Extensibility

- Critical difference rules should live in a single config object so new rule
  types can be added without touching diff pipeline code
- Toolpath boundary signals should be an array of detector functions so new
  signal types (machine-specific) can be added later
- Work offset extended formats (G154 Pn, G54.n, etc.) will be added later —
  keep the work offset detector as its own function, not inline logic
