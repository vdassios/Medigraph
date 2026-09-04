import type { MarkerDef } from '../types';

/**
 * The lipid panel.
 *
 * Identity and canonical names from ΚΕΟΚΕΕ; printed variants from `ahfy-full`
 * pages 5 and 6. All four share `mg/dL`, and all four have an enumerated
 * `mmol/L` conversion in `units.ts`, so their ids are load-bearing there.
 */
export const LIPID_MARKERS: readonly MarkerDef[] = [
  {
    // ΚΕΟΚΕΕ 11.02.01.05.001
    id: 'cholesterol',
    en: 'Cholesterol',
    el: 'Χοληστερόλη',
    abbreviations: ['CHOL', 'TC'],
    aliases: ['ΧΟΛΗΣΤΕΡΟΛΗ', 'ΟΛΙΚΗ ΧΟΛΗΣΤΕΡΟΛΗ', 'Ολική χοληστερόλη (TC) (CHOL)'],
    canonicalUnit: 'mg/dL',
    plausibleRange: [10, 1000],
  },
  {
    // ΚΕΟΚΕΕ 11.02.01.15.001. The fixture writes the abbreviation with a
    // GREEK CAPITAL LETTER ETA where a reader sees a Latin `H`, so it is
    // stored as an escape and as printed. The all-Latin `HDL-C` is *not* here:
    // no fixture and no seed row spells it that way, and alias rule 4 admits
    // nothing else — its Latin sibling `LDL-C` is present only because the
    // same page does print that one.
    id: 'hdl',
    en: 'High Density Lipoprotein Cholesterol',
    el: 'HDL-Χοληστερόλη',
    abbreviations: ['HDL', '\u0397DL-C'],
    aliases: [
      'HDL-ΧΟΛΗΣΤΕΡΟΛΗ',
      'ΛΙΠΟΠΡΩΤΕΙΝΗ ΥΨΗΛΗΣ ΠΥΚΝΟΤΗΤΑΣ',
      'Χοληστερόλη υψηλής πυκνότητας λιποπρωτεϊνών (\u0397DL-C) (HDL)',
    ],
    canonicalUnit: 'mg/dL',
    plausibleRange: [1, 300],
  },
  {
    // ΚΕΟΚΕΕ 11.02.01.21.001. The fixture prints this one with a Latin `L`.
    id: 'ldl',
    en: 'Low Density Lipoprotein Cholesterol',
    el: 'LDL-Χοληστερόλη',
    abbreviations: ['LDL', 'LDL-C'],
    aliases: [
      'LDL-ΧΟΛΗΣΤΕΡΟΛΗ',
      'ΛΙΠΟΠΡΩΤΕΙΝΗ ΧΑΜΗΛΗΣ ΠΥΚΝΟΤΗΤΑΣ',
      'Χοληστερόλη χαμηλής πυκνότητας λιποπρωτεϊνών (LDL-C) (LDL)',
    ],
    canonicalUnit: 'mg/dL',
    plausibleRange: [1, 800],
  },
  {
    // ΚΕΟΚΕΕ 11.02.01.31.001, which carries no abbreviation; `TRIG` is the
    // fixture's.
    id: 'triglycerides',
    en: 'Triglycerides',
    el: 'Τριγλυκερίδια',
    abbreviations: ['TRIG'],
    aliases: ['ΤΡΙΓΛΥΚΕΡΙΔΙΑ', 'Τριγλυκερίδια (TRIG) (TRIG)'],
    canonicalUnit: 'mg/dL',
    plausibleRange: [1, 10000],
  },
];
