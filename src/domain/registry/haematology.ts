import type { MarkerDef } from '../types';

/**
 * Canonical micro sign: U+00B5 MICRO SIGN, never U+03BC GREEK SMALL LETTER MU,
 * written as an escape for the reason `units.ts` gives — the two are
 * indistinguishable in a diff, and `normaliseUnit` folds only to this one.
 */
const MICRO = '\u00B5';

/**
 * The complete-blood-count panel.
 *
 * ΚΕΟΚΕΕ carries no entry for any of these: it is an *ordering* nomenclature,
 * so the CBC is the single orderable `13.01.01.01.001 ΠΛΗΡΗΣ ΓΕΝΙΚΗ ΑΙΜΑΤΟΣ`
 * and the indices it reports are not separately orderable. Every alias below is
 * therefore quoted from a seed fixture's `Περιγραφή` cell — `ahfy-minimal`
 * page 2 for the bare Latin-code dialect, `ahfy-full` page 2 for the Greek one.
 *
 * `plausibleRange` is a sanity bound in `canonicalUnit`, never a reference
 * range: a value outside it is kept, flagged and reviewed, never rejected.
 */
export const HAEMATOLOGY_MARKERS: readonly MarkerDef[] = [
  {
    id: 'rbc',
    en: 'Red Blood Cells',
    el: 'Ερυθρά Αιμοσφαίρια',
    abbreviations: ['RBC'],
    aliases: ['RBC (RBC)', 'Ερυθρά Αιμοσφαίρια (RBC) (RBC)'],
    canonicalUnit: `10^6/${MICRO}L`,
    plausibleRange: [0.5, 12],
  },
  {
    id: 'haemoglobin',
    en: 'Haemoglobin',
    el: 'Αιμοσφαιρίνη',
    // `Hb` is ΚΕΟΚΕΕ 13.01.02.01.001; `HGB` is both fixtures.
    abbreviations: ['HGB', 'Hb'],
    // The bare `Αιμοσφαιρίνη` is deliberately absent: the urinalysis panel
    // prints it for the dipstick blood result. Neither marker may claim it.
    aliases: ['HGB (HGB)', 'Αιμοσφαιρίνη (HGB) (HGB)'],
    canonicalUnit: 'g/dL',
    plausibleRange: [1, 30],
  },
  {
    id: 'hct',
    en: 'Haematocrit',
    el: 'Αιματοκρίτης',
    abbreviations: ['HCT'],
    aliases: ['HCT (HCT)', 'Αιματοκρίτης (HCT) (HCT)'],
    canonicalUnit: '%',
    plausibleRange: [1, 80],
  },
  {
    id: 'mcv',
    en: 'Mean Corpuscular Volume',
    el: 'Μέσος Όγκος Ερυθρών',
    abbreviations: ['MCV'],
    // `Μ` is GREEK CAPITAL LETTER MU, as `ahfy-full` prints it inside an
    // otherwise Latin abbreviation. Written as an escape because no reviewer
    // can tell it from `M` by eye, and `normaliseLabel` never transliterates.
    aliases: ['MCV (MCV)', 'Μέσος Όγκος Ερυθρών (\u039CCV) (MCV)'],
    canonicalUnit: 'fL',
    plausibleRange: [30, 150],
  },
  {
    id: 'mch',
    en: 'Mean Corpuscular Haemoglobin',
    el: 'Μέση Περιεκτικότης HGB',
    abbreviations: ['MCH'],
    aliases: ['MCH (MCH)', 'Μέση Περιεκτικότης HGB (MCH) (MCH)'],
    canonicalUnit: 'pg',
    plausibleRange: [5, 60],
  },
  {
    id: 'mchc',
    en: 'Mean Corpuscular Haemoglobin Concentration',
    el: 'Μέση Πυκνότης HGB',
    abbreviations: ['MCHC'],
    aliases: ['MCHC (MCHC)', 'Μέση Πυκνότης HGB (MCHC) (MCHC)'],
    canonicalUnit: 'g/dL',
    plausibleRange: [10, 50],
  },
  {
    id: 'rdw',
    en: 'Red Cell Distribution Width',
    el: 'Εύρος Κατανομής Ερυθρών',
    abbreviations: ['RDW'],
    aliases: ['Εύρος Κατανομής Ερυθρών (RDW) (RDW)'],
    canonicalUnit: '%',
    plausibleRange: [5, 40],
  },
  {
    id: 'rdw-sd',
    en: 'Red Cell Distribution Width (Standard Deviation)',
    el: 'Εύρος Κατανομής Ερυθρών (SD)',
    // A different quantity from `rdw`, printed in femtolitres rather than per
    // cent, so the two are separate markers and never one series.
    abbreviations: ['RDWSD'],
    aliases: ['RDWSD (RDWSD)'],
    canonicalUnit: 'fL',
    plausibleRange: [10, 150],
  },
  {
    id: 'wbc',
    en: 'White Blood Cells',
    el: 'Λευκά Αιμοσφαίρια',
    abbreviations: ['WBC'],
    aliases: ['WBC (WBC)', 'Λευκά Αιμοσφαίρια (WBC) (WBC)'],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [0.1, 500],
  },
  {
    id: 'neutrophils-percent',
    en: 'Neutrophils %',
    el: 'Πολυμορφοπύρηνα Ουδετερόφιλα %',
    abbreviations: ['NEUT%'],
    aliases: ['NEUT% (NEUT%)', 'Πολυμορφοπύρηνα Ουδετερόφιλα (NEUT) % (NEUT%)'],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'neutrophils-absolute',
    en: 'Neutrophils, absolute count',
    el: 'Πολυμορφοπύρηνα Ουδετερόφιλα #',
    abbreviations: ['NEUT#'],
    aliases: ['NEUT# (NEUT#)', 'Πολυμορφοπύρηνα Ουδετερόφιλα (NEUT#)'],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [0, 500],
  },
  {
    id: 'lymphocytes-percent',
    en: 'Lymphocytes %',
    el: 'Λεμφοκύτταρα %',
    abbreviations: ['LYMP%', 'LYM%'],
    aliases: ['LYMP% (LYMP%)', 'Λεμφοκύτταρα (LYMPH) % (LYM%)'],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'lymphocytes-absolute',
    en: 'Lymphocytes, absolute count',
    el: 'Λεμφοκύτταρα #',
    abbreviations: ['LYMP#', 'LYM#'],
    aliases: ['LYMP# (LYMP#)', 'Λεμφοκύτταρα (LYM#)'],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [0, 500],
  },
  {
    id: 'monocytes-percent',
    en: 'Monocytes %',
    el: 'Μονοπύρηνα %',
    abbreviations: ['MONO%'],
    aliases: ['MONO% (MONO%)', 'Μονοπύρηνα (MONO) % (MONO%)'],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'monocytes-absolute',
    en: 'Monocytes, absolute count',
    el: 'Μονοπύρηνα #',
    abbreviations: ['MONO#'],
    aliases: ['MONO# (MONO#)', 'Μονοπύρηνα (MONO#)'],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [0, 500],
  },
  {
    id: 'eosinophils-percent',
    en: 'Eosinophils %',
    el: 'Πολυμορφοπύρηνα Ηωσινόφιλα %',
    abbreviations: ['EOSI%', 'EOS%'],
    aliases: ['EOSI% (EOSI%)', 'Πολυμορφοπύρηνα Ηωσινόφιλα (EOS) % (EOS%)'],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'eosinophils-absolute',
    en: 'Eosinophils, absolute count',
    el: 'Πολυμορφοπύρηνα Ηωσινόφιλα #',
    abbreviations: ['EOSI#', 'EOS#'],
    aliases: ['EOSI# (EOSI#)', 'Πολυμορφοπύρηνα Ηωσινόφιλα (EOS#)'],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [0, 500],
  },
  {
    id: 'basophils-percent',
    en: 'Basophils %',
    el: 'Πολυμορφοπύρηνα Βασεόφιλα %',
    abbreviations: ['BASO%'],
    aliases: ['BASO% (BASO%)', 'Πολυμορφοπύρηνα Βασεόφιλα (BASO) % (BASO%)'],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'basophils-absolute',
    en: 'Basophils, absolute count',
    el: 'Πολυμορφοπύρηνα Βασεόφιλα #',
    abbreviations: ['BASO#'],
    aliases: ['BASO# (BASO#)', 'Πολυμορφοπύρηνα Βασεόφιλα (BASO#)'],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [0, 500],
  },
  {
    id: 'plt',
    en: 'Platelets',
    el: 'Αιμοπετάλια',
    abbreviations: ['PLT'],
    aliases: ['PLT (PLT)', 'Αιμοπετάλια (PLT) (PLT)'],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [1, 5000],
  },
  {
    id: 'mpv',
    en: 'Mean Platelet Volume',
    el: 'Μέσος Όγκος Αιμοπεταλίων',
    abbreviations: ['MPV'],
    // `ahfy-full` prefixes this cell with a footnote asterisk (`* Μέσος …`).
    // The asterisk is presentation, so the alias is the label without it.
    aliases: ['MPV (MPV)', 'Μέσος Όγκος Αιμοπεταλίων (MPV) (MPV)'],
    canonicalUnit: 'fL',
    plausibleRange: [2, 30],
  },
  {
    id: 'pct',
    en: 'Plateletcrit',
    el: 'Αιμοπεταλιοκρίτης',
    abbreviations: ['PCT'],
    aliases: ['Αιμοπεταλιοκρίτης (PCT) (PCT)'],
    canonicalUnit: '%',
    plausibleRange: [0.01, 5],
  },
];
