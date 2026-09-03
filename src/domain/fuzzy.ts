/**
 * Bounded edit distance for T4 marker matching.
 *
 * This module is the distance function and nothing else. Choosing a bound from
 * label length, checking abbreviation containment and breaking a tie on
 * `sectionHint` all belong to `anchors.ts`, which owns the four tiers.
 */

/**
 * Damerau–Levenshtein distance between `a` and `b`, giving up once the answer
 * is known to exceed `maxDistance`.
 *
 * Returns the true distance when it is within the bound, and `maxDistance + 1`
 * — a value the caller can only read as "further than you allowed" — when it is
 * not. Nothing above the bound is worth computing: T4 accepts a match or
 * rejects it, and never ranks two rejections.
 *
 * A negative `maxDistance` is treated as `0`.
 *
 * **Adjacent transpositions are counted once, and only once.** This is the
 * restricted (optimal string alignment) variant: a substring may not be edited
 * again after taking part in a transposition, so `ca`/`abc` scores 3 here where
 * the unrestricted algorithm scores 2. The restriction is deliberate. It never
 * reports a *smaller* distance than the unrestricted form, so it can only
 * reject a marginal match, never invent one — which is the direction this
 * registry wants to err in, because a wrong marker produces a wrong health
 * chart while a missed one produces a review prompt.
 */
export function damerauLevenshtein(a: string, b: string, maxDistance: number): number {
  const bound = Math.max(0, Math.trunc(maxDistance));
  const beyond = bound + 1;

  if (a === b) {
    return 0;
  }

  // Code points, not UTF-16 units: one wrong character must cost one edit, and
  // a surrogate pair split in half would cost two. Not grapheme clusters —
  // `normaliseLabel` has already stripped the combining marks that would make
  // the two differ, and a cluster-aware split would only add cost here.
  const source = Array.from(a);
  const target = Array.from(b);
  const n = source.length;
  const m = target.length;

  // Every edit changes the length by at most one, so this is decided already.
  if (Math.abs(n - m) > bound) {
    return beyond;
  }
  if (n === 0 || m === 0) {
    const distance = Math.max(n, m);
    return distance > bound ? beyond : distance;
  }

  // Three rolling rows: the transposition case reaches back two of each.
  let twoRowsBack = new Array<number>(m + 1).fill(beyond);
  let previous = new Array<number>(m + 1).fill(beyond);
  let current = new Array<number>(m + 1).fill(beyond);

  for (let j = 0; j <= Math.min(m, bound); j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= n; i += 1) {
    current.fill(beyond);
    current[0] = i > bound ? beyond : i;

    // Only cells within `bound` of the diagonal can hold a usable value, so the
    // work is O(n × bound) rather than O(n × m).
    const from = Math.max(1, i - bound);
    const to = Math.min(m, i + bound);
    let rowBest = current[0];

    for (let j = from; j <= to; j += 1) {
      const substitution = source[i - 1] === target[j - 1] ? 0 : 1;
      let best = Math.min(
        (previous[j] ?? beyond) + 1, // deletion
        (current[j - 1] ?? beyond) + 1, // insertion
        (previous[j - 1] ?? beyond) + substitution,
      );

      if (i > 1 && j > 1 && source[i - 1] === target[j - 2] && source[i - 2] === target[j - 1]) {
        best = Math.min(best, (twoRowsBack[j - 2] ?? beyond) + 1);
      }

      const clamped = Math.min(best, beyond);
      current[j] = clamped;
      rowBest = Math.min(rowBest, clamped);
    }

    // No cell in this row is within the bound, and a later row can only add to
    // it, so the answer can no longer land inside the bound.
    if (rowBest > bound) {
      return beyond;
    }

    [twoRowsBack, previous, current] = [previous, current, twoRowsBack];
  }

  return Math.min(previous[m] ?? beyond, beyond);
}
