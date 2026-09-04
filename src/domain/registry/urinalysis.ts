import type { MarkerDef } from '../types';

/**
 * The urine dipstick and sediment panel.
 *
 * ΚΕΟΚΕΕ orders the whole examination as one test, so it names none of these
 * rows; every alias is quoted from `ahfy-full` page 12, where the `Περιγραφή`
 * cell prints the row name followed by the laboratory's own short form in
 * parentheses.
 *
 * These markers are printed with no unit at all, so `canonicalUnit` is `null`.
 * Most are categorical: the result is a printed word (`Αρνητικό`, `Διαυγής`)
 * measured against the laboratory's printed expected value, never a number.
 *
 * **Five bare labels are withheld on purpose.** `Λεύκωμα`, `Σάκχαρο`,
 * `Αιμοσφαιρίνη`, `Χολερυθρίνη` and `Ερυθρά αιμοσφαίρια` each name a serum
 * marker as readily as a urine one, and `markerKey` matches a whole label with
 * no section context. Each entry therefore claims only the full printed cell,
 * which carries the laboratory's short form and is unambiguous. A label that
 * matches neither reading stays an unknown `x:` marker and reaches review,
 * which is the safe failure; silently charting a urine dipstick result as
 * serum glucose is not.
 */
const URINE_SECTION = 'Γενική εξέταση ούρων';

export const URINALYSIS_MARKERS: readonly MarkerDef[] = [
  {
    id: 'urine-colour',
    en: 'Urine Colour',
    el: 'Χροιά',
    abbreviations: [],
    aliases: ['Χροιά', 'Χροιά (Χροιά)'],
    canonicalUnit: null,
    sectionHint: URINE_SECTION,
  },
  {
    id: 'urine-appearance',
    en: 'Urine Appearance',
    el: 'Όψη',
    abbreviations: [],
    aliases: ['Όψη', 'Όψη (Οψη)'],
    canonicalUnit: null,
    sectionHint: URINE_SECTION,
  },
  {
    id: 'urine-ph',
    en: 'Urine pH',
    el: 'Αντίδραση PH',
    abbreviations: [],
    aliases: ['Αντίδραση PH', 'Αντίδραση PH (PH)'],
    canonicalUnit: null,
    plausibleRange: [0, 14],
    sectionHint: URINE_SECTION,
  },
  {
    id: 'urine-specific-gravity',
    en: 'Urine Specific Gravity',
    el: 'Ειδικό βάρος',
    abbreviations: [],
    aliases: ['Ειδικό βάρος', 'Ειδικό βάρος (Ειδικό βάρος)'],
    canonicalUnit: null,
    plausibleRange: [1000, 1100],
    sectionHint: URINE_SECTION,
  },
  {
    id: 'urine-protein',
    en: 'Urine Protein',
    el: 'Λεύκωμα',
    abbreviations: [],
    aliases: ['Λεύκωμα (Λεύκωμα)'],
    canonicalUnit: null,
    sectionHint: URINE_SECTION,
  },
  {
    id: 'urine-glucose',
    en: 'Urine Glucose',
    el: 'Σάκχαρο',
    abbreviations: [],
    aliases: ['Σάκχαρο (Σάκχαρο)'],
    canonicalUnit: null,
    sectionHint: URINE_SECTION,
  },
  {
    id: 'urine-ketones',
    en: 'Urine Ketones',
    el: 'Οξόνη',
    abbreviations: [],
    aliases: ['Οξόνη', 'Οξόνη (Οξόνη)'],
    canonicalUnit: null,
    sectionHint: URINE_SECTION,
  },
  {
    id: 'urine-haemoglobin',
    en: 'Urine Haemoglobin',
    el: 'Αιμοσφαιρίνη',
    abbreviations: [],
    aliases: ['Αιμοσφαιρίνη (Αιμοσφαιρίνη)'],
    canonicalUnit: null,
    sectionHint: URINE_SECTION,
  },
  {
    id: 'urine-bilirubin',
    en: 'Urine Bilirubin',
    el: 'Χολερυθρίνη',
    abbreviations: [],
    aliases: ['Χολερυθρίνη (Χολερυθρίνη)'],
    canonicalUnit: null,
    sectionHint: URINE_SECTION,
  },
  {
    id: 'urine-urobilinogen',
    en: 'Urine Urobilinogen',
    el: 'Ουροχολινογόνο',
    abbreviations: [],
    aliases: ['Ουροχολινογόνο', 'Ουροχολινογόνο (Ουροχολινογόνο)'],
    canonicalUnit: null,
    sectionHint: URINE_SECTION,
  },
  {
    id: 'urine-nitrites',
    en: 'Urine Nitrites',
    el: 'Νιτρικά',
    abbreviations: [],
    aliases: ['Νιτρικά', 'Νιτρικά (Νιτρικά)'],
    canonicalUnit: null,
    sectionHint: URINE_SECTION,
  },
  {
    id: 'urine-leukocytes',
    en: 'Urine Leukocytes',
    el: 'Πυοσφαίρια',
    abbreviations: [],
    aliases: ['Πυοσφαίρια', 'Πυοσφαίρια (Πυοσφαίρια)'],
    canonicalUnit: null,
    sectionHint: URINE_SECTION,
  },
  {
    id: 'urine-erythrocytes',
    en: 'Urine Erythrocytes',
    el: 'Ερυθρά αιμοσφαίρια',
    abbreviations: [],
    aliases: ['Ερυθρά αιμοσφαίρια (Ερυθρά αιμοσφ.)'],
    canonicalUnit: null,
    sectionHint: URINE_SECTION,
  },
];
