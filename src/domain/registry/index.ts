import type { MarkerDef } from '../types';
import { BIOCHEMISTRY_MARKERS } from './biochemistry';
import { COAGULATION_MARKERS } from './coagulation';
import { HAEMATOLOGY_MARKERS } from './haematology';
import { HORMONE_MARKERS } from './hormones';
import { INFLAMMATION_MARKERS } from './inflammation';
import { LIPID_MARKERS } from './lipids';
import { URINALYSIS_MARKERS } from './urinalysis';
import { VITAMIN_MARKERS } from './vitamins';

/**
 * The registry's data version. It starts at 1 and increments **once per merged
 * change set** that alters any marker identity, abbreviation or alias, however
 * many entries that change set touches.
 *
 * `extract` stamps every `ExtractionResult` with the exact current value, and
 * fixture expectations require equality rather than compatibility: a result
 * produced by a different registry is a different result, and pretending
 * otherwise would let a stale fixture pass against a changed vocabulary.
 */
export const REGISTRY_VERSION = 1;

/**
 * Every canonical marker, in panel order.
 *
 * This is the seed authored under Task 1.6b-core: the markers the two Task 0.3
 * fixtures print, and nothing else. It is not the v1 coverage target — Task
 * 2.5r expands each panel from the Task 0.5a corpus, one issue per file.
 *
 * Registry coverage is parser quality (D5a), so this array is versioned data
 * with its own tests, not a lookup table.
 */
export const MARKERS: readonly MarkerDef[] = [
  ...HAEMATOLOGY_MARKERS,
  ...BIOCHEMISTRY_MARKERS,
  ...LIPID_MARKERS,
  ...HORMONE_MARKERS,
  ...VITAMIN_MARKERS,
  ...INFLAMMATION_MARKERS,
  ...COAGULATION_MARKERS,
  ...URINALYSIS_MARKERS,
];

export {
  BIOCHEMISTRY_MARKERS,
  COAGULATION_MARKERS,
  HAEMATOLOGY_MARKERS,
  HORMONE_MARKERS,
  INFLAMMATION_MARKERS,
  LIPID_MARKERS,
  URINALYSIS_MARKERS,
  VITAMIN_MARKERS,
};
