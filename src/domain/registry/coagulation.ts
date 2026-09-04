import type { MarkerDef } from '../types';

/**
 * Coagulation studies — PT, INR, APTT, fibrinogen and D-dimers.
 *
 * Deliberately empty. Neither Task 0.3 seed fixture orders a coagulation
 * study, and alias rule 4 admits nothing a fixture or the ΚΕΟΚΕΕ seed has not
 * shown, so there is nothing yet to author here. The panel is filled from the
 * Task 0.5a corpus under Task 2.5r; until then a printed coagulation row
 * extracts as an unknown `x:` marker and is reviewed like any other.
 */
export const COAGULATION_MARKERS: readonly MarkerDef[] = [];
