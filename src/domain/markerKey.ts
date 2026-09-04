import { MARKERS } from './registry';
import { normaliseLabel } from './text';

/**
 * Label to marker key.
 *
 * A hit returns the registry's stable canonical id; a miss returns a derived
 * `x:` key rather than nothing. Unknown markers are first-class — they chart
 * as well as canonical ones and simply have no canonical name — so this
 * function has no failure mode and never returns null.
 *
 * Matching is exact equality after `normaliseLabel`, over both the aliases and
 * the abbreviations of every entry. The fuzzier work — abbreviation
 * containment, whole-word alias containment, bounded edit distance and
 * `sectionHint` tie-breaking — belongs to the four tiers in `anchors.ts`,
 * which have a row's geometry and section to reason with. This module has a
 * string.
 */

/** Everything that is not a Unicode letter or number, in runs. */
const NON_KEY_RUN = /[^\p{L}\p{N}]+/gu;
const EDGE_DASHES = /^-+|-+$/gu;

/**
 * Normalised printed form to marker id.
 *
 * Built once at module load. Two markers claiming one form would collide
 * silently here, so `registry/index.test.ts` asserts that no normalised alias
 * or abbreviation is claimed twice — a registry invariant, checked where a
 * registry change is made rather than thrown at a user mid-review.
 */
const BY_PRINTED_FORM = new Map<string, string>();

for (const marker of MARKERS) {
  for (const printed of [...marker.aliases, ...marker.abbreviations]) {
    BY_PRINTED_FORM.set(normaliseLabel(printed), marker.id);
  }
}

export function markerKey(label: string): string {
  const normalised = normaliseLabel(label);
  const canonical = BY_PRINTED_FORM.get(normalised);

  if (canonical !== undefined) {
    return canonical;
  }

  return `x:${normalised.replace(NON_KEY_RUN, '-').replace(EDGE_DASHES, '')}`;
}
