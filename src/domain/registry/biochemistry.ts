import type { MarkerDef } from '../types';

/** Canonical micro sign: U+00B5, never U+03BC. See `units.ts`. */
const MICRO = '\u00B5';

/**
 * The routine clinical-chemistry panel.
 *
 * Identity, canonical Greek/English name and abbreviation come from ΚΕΟΚΕΕ
 * (the grCode is quoted on each entry); the printed alias variants come from
 * the `ahfy-full` seed fixture, pages 5, 7 and 8. ΚΕΟΚΕΕ names are
 * administrative — no laboratory prints `ΑΜΙΝΟΤΡΑΝΣΦΕΡΑΣΗ ΑΛΑΝΙΝΗΣ` — so both
 * sources are needed and neither is enough alone.
 */
export const BIOCHEMISTRY_MARKERS: readonly MarkerDef[] = [
  {
    // ΚΕΟΚΕΕ 11.02.01.13.001
    id: 'glucose',
    en: 'Glucose',
    el: 'Γλυκόζη',
    abbreviations: ['GLU', 'GLUC'],
    // `ΣΑΚΧΑΡΟ` is this marker's ΚΕΟΚΕΕ `Άλλη Ονομασία`, so serum sugar keeps
    // it. The urinalysis dipstick row prints `Σάκχαρο (Σάκχαρο)` and is
    // matched by that full cell alone — the two must never share an alias.
    aliases: ['ΓΛΥΚΟΖΗ', 'ΣΑΚΧΑΡΟ', 'Γλυκόζη (GLUC) (GLUC)'],
    canonicalUnit: 'mg/dL',
    plausibleRange: [10, 2000],
  },
  {
    // ΚΕΟΚΕΕ 11.02.01.04.001
    id: 'urea',
    en: 'Urea',
    el: 'Ουρία',
    abbreviations: ['UREA'],
    aliases: ['ΟΥΡΙΑ', 'Ουρία (UREA) (UREA)'],
    canonicalUnit: 'mg/dL',
    plausibleRange: [1, 500],
  },
  {
    // ΚΕΟΚΕΕ 11.02.01.07.001
    id: 'creatinine',
    en: 'Creatinine',
    el: 'Κρεατινίνη',
    abbreviations: ['CREAT', 'CREA'],
    aliases: ['ΚΡΕΑΤΙΝΙΝΗ', 'Κρεατινίνη (CREA) (CREA)'],
    canonicalUnit: 'mg/dL',
    plausibleRange: [0.1, 25],
  },
  {
    // ΚΕΟΚΕΕ 11.02.01.32.001, which carries no abbreviation; `UA` is the
    // fixture's.
    id: 'uric-acid',
    en: 'Uric Acid',
    el: 'Ουρικό οξύ',
    abbreviations: ['UA'],
    aliases: ['ΟΥΡΙΚΟ ΟΞΥ', 'Ουρικό οξύ (UA) (UA)'],
    canonicalUnit: 'mg/dL',
    plausibleRange: [0.1, 30],
  },
  {
    // ΚΕΟΚΕΕ 11.01.01.10.001, whose `Συντομογραφία` is the pair `AST/SGOT`.
    id: 'ast',
    en: 'Aspartate Amino-Transferase',
    el: 'Ασπαρτική αμινοτρανσφεράση',
    abbreviations: ['AST', 'SGOT', 'AST/SGOT'],
    aliases: [
      'ΑΣΠΑΡΤΙΚΗ ΑΜΙΝΟΤΡΑΝΣΦΕΡΑΣΗ',
      'Αμινοτρανσφεράση του ασπαρτικού οξέος (SGOT/AST) (AST (SGOT))',
    ],
    canonicalUnit: 'U/L',
    plausibleRange: [1, 20000],
  },
  {
    // ΚΕΟΚΕΕ 11.01.01.03.001
    id: 'alt',
    en: 'Alanine Amino-Transferase',
    el: 'Αμινοτρανσφεράση αλανίνης',
    abbreviations: ['ALT', 'SGPT', 'ALT/SGPT'],
    aliases: ['ΑΜΙΝΟΤΡΑΝΣΦΕΡΑΣΗ ΑΛΑΝΙΝΗΣ', 'Αμινοτρανσφεράση αλανίνης (SGPT/ALT) (ALT (SGPT))'],
    canonicalUnit: 'U/L',
    plausibleRange: [1, 20000],
  },
  {
    // ΚΕΟΚΕΕ 11.01.01.16.001. The gamma is GREEK SMALL LETTER GAMMA in both
    // the seed and the fixture, and `normaliseLabel` never transliterates it,
    // so a laboratory printing `GGT` stays unmatched until the corpus shows
    // that spelling.
    id: 'ggt',
    en: 'Gamma Glutamyltransferase',
    el: 'γ-Γλουταμυλοτρανσφεράση',
    abbreviations: ['γ-GT'],
    aliases: ['γ-ΓΛΟΥΤΑΜΥΛΟΤΡΑΝΣΦΕΡΑΣΗ', 'γ-Γλουταμυλοτρανσφεράση (γ-GT) (γ-GT)'],
    canonicalUnit: 'U/L',
    plausibleRange: [1, 5000],
  },
  {
    // ΚΕΟΚΕΕ 11.01.01.05.001, whose `Συντομογραφία` is `ALP/AP`. The bare `AP`
    // is left out: two letters are too short to anchor a T1 match safely.
    id: 'alp',
    en: 'Alkaline Phosphatase',
    el: 'Αλκαλική φωσφατάση',
    abbreviations: ['ALP', 'ALP/AP'],
    aliases: ['ΑΛΚΑΛΙΚΗ ΦΩΣΦΑΤΑΣΗ', 'Αλκαλική φωσφατάση (ALP) (ALP)'],
    canonicalUnit: 'U/L',
    plausibleRange: [1, 5000],
  },
  {
    // ΚΕΟΚΕΕ 11.01.01.13.001, whose `Άλλη Ονομασία` is `CPK` — the spelling the
    // fixture prints in the abbreviation cell.
    id: 'ck',
    en: 'Creatine Kinase',
    el: 'Κρεατινική κινάση',
    abbreviations: ['CK', 'CPK'],
    aliases: ['ΚΡΕΑΤΙΝΙΚΗ ΚΙΝΑΣΗ', 'Κρεατινική κινάση (CK) (CPK)'],
    canonicalUnit: 'U/L',
    plausibleRange: [1, 100000],
  },
  {
    // ΚΕΟΚΕΕ 11.03.01.07.001
    id: 'magnesium',
    en: 'Magnesium',
    el: 'Μαγνήσιο',
    abbreviations: ['Mg'],
    aliases: ['ΜΑΓΝΗΣΙΟ', 'Μαγνήσιο (Mg) (Mg)'],
    canonicalUnit: 'mg/dL',
    plausibleRange: [0.1, 10],
  },
  {
    // ΚΕΟΚΕΕ 11.02.01.16.001
    id: 'iron',
    en: 'Iron',
    el: 'Σίδηρος',
    abbreviations: ['Fe'],
    aliases: ['ΣΙΔΗΡΟΣ', 'Σίδηρος ορού (Fe) (FE)'],
    canonicalUnit: `${MICRO}g/dL`,
    plausibleRange: [1, 1000],
  },
  {
    // ΚΕΟΚΕΕ 12.07.01.02.001, which carries no abbreviation; `FERR` is the
    // fixture's. Filed with iron studies rather than in vitamins.
    id: 'ferritin',
    en: 'Ferritin',
    el: 'Φερριτίνη',
    abbreviations: ['FERR'],
    aliases: ['ΦΕΡΡΙΤΙΝΗ', 'Φερριτίνη (FERR)'],
    canonicalUnit: 'ng/mL',
    plausibleRange: [0.1, 100000],
  },
  {
    // ΚΕΟΚΕΕ 11.02.01.14.001
    id: 'hba1c',
    en: 'Glycated Haemoglobin',
    el: 'Γλυκοζυλιωμένη Αιμοσφαιρίνη',
    abbreviations: ['HbA1c'],
    aliases: [
      'ΓΛΥΚΟΖΥΛΙΩΜΕΝΗ ΑΙΜΟΣΦΑΙΡΙΝΗ',
      'ΓΛΥΚΙΩΜΕΝΗ ΑΙΜΟΣΦΑΙΡΙΝΗ',
      'Γλυκοζυλιωμένη Αιμοσφαιρίνη (HbA1C) (HBA1c)',
    ],
    canonicalUnit: '%',
    plausibleRange: [1, 25],
  },
];
