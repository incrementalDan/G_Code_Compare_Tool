/**
 * G-Code Diff Engine
 * Canonicalization, LCS diff, and tolerance classification
 */

const DiffEngine = (() => {

  /**
   * Canonicalize a G-code line based on active ignore rules.
   */
  function canonicalize(line, rules) {
    let s = line;
    if (rules.ignoreParenComments)   s = s.replace(/\([^)]*\)/g, '');
    if (rules.ignoreSemiComments)    s = s.replace(/;.*$/, '');
    if (rules.ignoreLineNumbers)     s = s.replace(/^N\d+\s*/i, '');
    if (rules.ignoreBlockDelete)     s = s.replace(/^\//, '');
    if (rules.ignoreCase)            s = s.toLowerCase();
    if (rules.normalizeGMCodes)      s = s.replace(/([gGmMtT])0+(\d)/g, '$1$2');
    if (rules.ignoreWhitespace)      s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  /**
   * Classify the difference between two canonical lines.
   * Returns 'equal', 'minor', or 'major'.
   */
  function classifyDifference(canonLineA, canonLineB, minorEps, majorEps) {
    if (canonLineA === canonLineB) return 'equal';

    const numRegex = /-?\d+\.?\d*/g;
    const numsA = [...canonLineA.matchAll(numRegex)].map(m => parseFloat(m[0]));
    const numsB = [...canonLineB.matchAll(numRegex)].map(m => parseFloat(m[0]));
    const skeletonA = canonLineA.replace(numRegex, '###');
    const skeletonB = canonLineB.replace(numRegex, '###');

    // If the non-numeric structure differs, it's structural/major
    if (skeletonA !== skeletonB) return 'major';
    // If different count of numbers, it's structural
    if (numsA.length !== numsB.length) return 'major';

    const FP_EPS = 1e-10; // guard against floating-point rounding
    let worstSeverity = 'equal';
    for (let i = 0; i < numsA.length; i++) {
      const delta = Math.abs(numsA[i] - numsB[i]);
      if (delta <= minorEps + FP_EPS) {
        continue;
      } else if (delta <= majorEps + FP_EPS) {
        worstSeverity = 'minor';
      } else {
        return 'major';
      }
    }
    return worstSeverity;
  }

  /**
   * LCS-based line diff.
   * Returns an array of diff operations: { type, leftIdx, rightIdx }
   * type: 'equal' | 'added' | 'removed' | 'minor' | 'major'
   */
  function computeDiff(leftLines, rightLines, rules, minorEps, majorEps) {
    const leftCanon = leftLines.map(l => canonicalize(l, rules));
    const rightCanon = rightLines.map(l => canonicalize(l, rules));

    const n = leftCanon.length;
    const m = rightCanon.length;

    // Build LCS table
    const lcsLengths = buildLCSTable(leftCanon, rightCanon, n, m);

    // Backtrack to get diff operations
    const ops = backtrackLCS(leftCanon, rightCanon, lcsLengths, n, m);

    // Classify differences — group consecutive removes/adds and pair them
    return classifyOps(ops, leftCanon, rightCanon, leftLines, rightLines, minorEps, majorEps);
  }

  function buildLCSTable(leftCanon, rightCanon, n, m) {
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      dp[i] = new Uint16Array(m + 1);
    }

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (leftCanon[i - 1] === rightCanon[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = dp[i - 1][j] > dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
        }
      }
    }
    return dp;
  }

  function backtrackLCS(leftCanon, rightCanon, dp, n, m) {
    const ops = [];
    let i = n, j = m;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && leftCanon[i - 1] === rightCanon[j - 1]) {
        ops.push({ type: 'equal', leftIdx: i - 1, rightIdx: j - 1 });
        i--; j--;
      } else if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) {
        // Prefer removes first so they pair with subsequent adds
        ops.push({ type: 'removed', leftIdx: i - 1 });
        i--;
      } else {
        ops.push({ type: 'added', rightIdx: j - 1 });
        j--;
      }
    }

    return ops.reverse();
  }

  function classifyOps(ops, leftCanon, rightCanon, leftLines, rightLines, minorEps, majorEps) {
    const result = [];
    let i = 0;

    while (i < ops.length) {
      if (ops[i].type === 'equal') {
        result.push({
          type: 'equal',
          leftIdx: ops[i].leftIdx,
          rightIdx: ops[i].rightIdx,
          leftLine: leftLines[ops[i].leftIdx],
          rightLine: rightLines[ops[i].rightIdx]
        });
        i++;
        continue;
      }

      // Collect a contiguous block of non-equal ops (removes and adds)
      const removes = [];
      const adds = [];
      while (i < ops.length && ops[i].type !== 'equal') {
        if (ops[i].type === 'removed') removes.push(ops[i]);
        else if (ops[i].type === 'added') adds.push(ops[i]);
        i++;
      }

      // Pair removes with adds line-by-line, classify each pair
      const pairCount = Math.min(removes.length, adds.length);
      for (let p = 0; p < pairCount; p++) {
        const r = removes[p];
        const a = adds[p];
        const severity = classifyDifference(
          leftCanon[r.leftIdx], rightCanon[a.rightIdx],
          minorEps, majorEps
        );
        result.push({
          type: severity === 'equal' ? 'equal' : severity,
          leftIdx: r.leftIdx,
          rightIdx: a.rightIdx,
          leftLine: leftLines[r.leftIdx],
          rightLine: rightLines[a.rightIdx]
        });
      }

      // Remaining unpaired removes
      for (let p = pairCount; p < removes.length; p++) {
        result.push({
          type: 'removed',
          leftIdx: removes[p].leftIdx,
          leftLine: leftLines[removes[p].leftIdx]
        });
      }

      // Remaining unpaired adds
      for (let p = pairCount; p < adds.length; p++) {
        result.push({
          type: 'added',
          rightIdx: adds[p].rightIdx,
          rightLine: rightLines[adds[p].rightIdx]
        });
      }
    }

    return result;
  }

  /**
   * Count diff statistics.
   */
  function countStats(diffResult) {
    let major = 0, minor = 0, added = 0, removed = 0;
    for (const op of diffResult) {
      if (op.type === 'major') major++;
      else if (op.type === 'minor') minor++;
      else if (op.type === 'added') added++;
      else if (op.type === 'removed') removed++;
    }
    return { major, minor, added, removed };
  }

  return { canonicalize, classifyDifference, computeDiff, countStats };
})();
