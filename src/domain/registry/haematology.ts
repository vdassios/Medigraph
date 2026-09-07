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
    aliases: ['RBC (RBC)', 'Ερυθρά Αιμοσφαίρια (RBC) (RBC)', 'Ερυθρά αιμοσφαίρια(RBC)'],
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
    aliases: ['HGB (HGB)', 'Αιμοσφαιρίνη (HGB) (HGB)', 'Αιμοσφαιρίνη (HGB)'],
    canonicalUnit: 'g/dL',
    plausibleRange: [1, 30],
  },
  {
    id: 'hct',
    en: 'Haematocrit',
    el: 'Αιματοκρίτης',
    abbreviations: ['HCT'],
    aliases: ['HCT (HCT)', 'Αιματοκρίτης (HCT) (HCT)', 'Αιματοκρίτης (HCT)'],
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
    aliases: [
      'MCV (MCV)',
      'Μέσος Όγκος Ερυθρών (\u039CCV) (MCV)',
      'Μέσος όγκος ερυθρών (MCV) (MCV)',
      'Μέσος όγκος Ερυθρών (MCV)',
    ],
    canonicalUnit: 'fL',
    plausibleRange: [30, 150],
  },
  {
    id: 'mch',
    en: 'Mean Corpuscular Haemoglobin',
    el: 'Μέση Περιεκτικότης HGB',
    abbreviations: ['MCH'],
    aliases: [
      'MCH (MCH)',
      'Μέση Περιεκτικότης HGB (MCH) (MCH)',
      'Μέση περιεκτικότητα αιμοσφαιρίνης (MCH) (MCH)',
      'Μέση περιεκ. Αιμοσφαιρίνης (MCH)',
    ],
    canonicalUnit: 'pg',
    plausibleRange: [5, 60],
  },
  {
    id: 'mchc',
    en: 'Mean Corpuscular Haemoglobin Concentration',
    el: 'Μέση Πυκνότης HGB',
    abbreviations: ['MCHC'],
    aliases: [
      'MCHC (MCHC)',
      'Μέση Πυκνότης HGB (MCHC) (MCHC)',
      'Μέση πυκνότητα αιμοσφαιρίνης (MCHC) (MCHC)',
      'Μέση πυκν. Αιμοσφαιρίνης (MCHC)',
    ],
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
    aliases: ['WBC (WBC)', 'Λευκά Αιμοσφαίρια (WBC) (WBC)', 'Λευκά αιμοσφαίρια (WBC)'],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [0.1, 500],
  },
  {
    id: 'neutrophils-percent',
    en: 'Neutrophils %',
    el: 'Πολυμορφοπύρηνα Ουδετερόφιλα %',
    // `NEU%` is ΙΑΣΩ's code for the same row; `NEUT%` is the other three.
    abbreviations: ['NEUT%', 'NEU%'],
    aliases: [
      'NEUT% (NEUT%)',
      'Πολυμορφοπύρηνα Ουδετερόφιλα (NEUT) % (NEUT%)',
      'Πολυμορφοπύρηνα (NEUT%) (NEUT%)',
      'Πολυμ. Ουδετερόφιλα(NEU%)',
    ],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'neutrophils-absolute',
    en: 'Neutrophils, absolute count',
    el: 'Πολυμορφοπύρηνα Ουδετερόφιλα #',
    // ΙΑΣΩ prints `NEU#`. The bare `NEUT` ΙΑΤΡΟΚΟΣΜΟΣ prints for the count is
    // deliberately not claimed here: ΒΙΟΙΑΤΡΙΚΗ prints the same bare code
    // inside its *percentage* label, `… (NEUT) % (NEUT%)`, so claiming it
    // anchors two markers on one row. The count is reached by the whole
    // printed cell at T2 instead — see the aliases below. A bare population
    // code names the population, not the count.
    abbreviations: ['NEUT#', 'NEU#'],
    aliases: [
      'NEUT# (NEUT#)',
      'Πολυμορφοπύρηνα Ουδετερόφιλα (NEUT#)',
      'Πολυμορφοπύρηνα (NEUT) (NEUT)',
      'Πολυμ. Ουδετερόφιλα(NEU#)',
    ],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [0, 500],
  },
  {
    id: 'lymphocytes-percent',
    en: 'Lymphocytes %',
    el: 'Λεμφοκύτταρα %',
    abbreviations: ['LYMP%', 'LYM%'],
    aliases: [
      'LYMP% (LYMP%)',
      'Λεμφοκύτταρα (LYMPH) % (LYM%)',
      'Λεμφοκύτταρα (LYM%) (LYM%)',
      'Λεμφοκύτταρα (LYM%)',
    ],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'lymphocytes-absolute',
    en: 'Lymphocytes, absolute count',
    el: 'Λεμφοκύτταρα #',
    abbreviations: ['LYMP#', 'LYM#'],
    aliases: ['LYMP# (LYMP#)', 'Λεμφοκύτταρα (LYM#)', 'Λεμφοκύτταρα (LYM) (LYM)'],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [0, 500],
  },
  {
    id: 'monocytes-percent',
    en: 'Monocytes %',
    el: 'Μονοπύρηνα %',
    abbreviations: ['MONO%', 'MON%'],
    aliases: [
      'MONO% (MONO%)',
      'Μονοπύρηνα (MONO) % (MONO%)',
      'Μονοπύρηνα (MON%) (MON%)',
      'Μονοκύτταρα(ΜΟΝΟ%)',
    ],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'monocytes-absolute',
    en: 'Monocytes, absolute count',
    el: 'Μονοπύρηνα #',
    // ΙΑΤΡΟΚΟΣΜΟΣ prints `(MON)` and, beside it, `(\u039C\u039F\u039D\u039F)` —
    // four Greek capitals folding to a bare `MONO`. Neither is claimed as an
    // abbreviation, for the reason `neutrophils-absolute` records; the whole
    // printed cell is aliased instead.
    abbreviations: ['MONO#'],
    aliases: [
      'MONO# (MONO#)',
      'Μονοπύρηνα (MONO#)',
      'Μονοπύρηνα (MON) (\u039C\u039F\u039D\u039F)',
      'Μονοκύτταρα (MONO#)',
    ],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [0, 500],
  },
  {
    id: 'eosinophils-percent',
    en: 'Eosinophils %',
    el: 'Πολυμορφοπύρηνα Ηωσινόφιλα %',
    abbreviations: ['EOSI%', 'EOS%'],
    aliases: [
      'EOSI% (EOSI%)',
      'Πολυμορφοπύρηνα Ηωσινόφιλα (EOS) % (EOS%)',
      'Ηωσινόφιλα (EOS%) (EOS%)',
      'Πολυμ. Ηωσινόφιλα (EOS%)',
    ],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'eosinophils-absolute',
    en: 'Eosinophils, absolute count',
    el: 'Πολυμορφοπύρηνα Ηωσινόφιλα #',
    // No bare `EOS`, for the reason `neutrophils-absolute` records.
    abbreviations: ['EOSI#', 'EOS#'],
    aliases: [
      'EOSI# (EOSI#)',
      'Πολυμορφοπύρηνα Ηωσινόφιλα (EOS#)',
      'Ηωσινόφιλα (EOS) (EOS)',
      'Πολυμ. Ηωσινόφιλα (EOS#)',
    ],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [0, 500],
  },
  {
    id: 'basophils-percent',
    en: 'Basophils %',
    el: 'Πολυμορφοπύρηνα Βασεόφιλα %',
    abbreviations: ['BASO%', 'BAS%'],
    aliases: [
      'BASO% (BASO%)',
      'Πολυμορφοπύρηνα Βασεόφιλα (BASO) % (BASO%)',
      'Βασεόφιλα (BAS%) (BAS%)',
      'Πολυμ. Βασεόφιλα (BASO%)',
    ],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'basophils-absolute',
    en: 'Basophils, absolute count',
    el: 'Πολυμορφοπύρηνα Βασεόφιλα #',
    abbreviations: ['BASO#'],
    aliases: [
      'BASO# (BASO#)',
      'Πολυμορφοπύρηνα Βασεόφιλα (BASO#)',
      'Βασεόφιλα (BAS) (BAS)',
      'Πολυμ. Βασεόφιλα (BASO#)',
    ],
    canonicalUnit: `10^3/${MICRO}L`,
    plausibleRange: [0, 500],
  },
  {
    id: 'plt',
    en: 'Platelets',
    el: 'Αιμοπετάλια',
    abbreviations: ['PLT'],
    aliases: ['PLT (PLT)', 'Αιμοπετάλια (PLT) (PLT)', 'Αιμοπετάλια (PLT)'],
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
    aliases: ['MPV (MPV)', 'Μέσος Όγκος Αιμοπεταλίων (MPV) (MPV)', 'Μέσος όγκος αιμ. (MPV)'],
    canonicalUnit: 'fL',
    plausibleRange: [2, 30],
  },
  {
    id: 'pct',
    en: 'Plateletcrit',
    el: 'Αιμοπεταλιοκρίτης',
    abbreviations: ['PCT'],
    aliases: ['Αιμοπεταλιοκρίτης (PCT) (PCT)', 'Αιμοπεταλιοκρίτης (PCT)'],
    canonicalUnit: '%',
    plausibleRange: [0.01, 5],
  },
  {
    id: 'pdw',
    en: 'Platelet Distribution Width',
    el: 'Εύρος Κατανομής Αιμοπεταλίων',
    // `PWD` is not a typo of ours: ΙΑΤΡΟΚΟΣΜΟΣ prints the letters transposed,
    // in both the label and the code, on every copy of this row. Alias rule 4
    // is about sourcing, not about the laboratory being right.
    abbreviations: ['PDW', 'PWD'],
    aliases: [
      'Εύρος Κατανομής Αιμοπεταλίων (PDW) (PDW)',
      'Εύρος κατανομής αιμοπεταλίων (PWD) (PWD)',
      'Εύρος καταν. αιμ. (PDW)',
    ],
    canonicalUnit: '%',
    plausibleRange: [1, 100],
  },
  {
    id: 'nrbc-percent',
    en: 'Nucleated Red Blood Cells %',
    el: 'Εμπύρηνα Ερυθρά %',
    abbreviations: ['NRBC%'],
    aliases: ['Εμπύρηνα Ερυθρά (NRBC%)', 'Εμπύρηνα RBC (ΕμπύρηναRBC)', 'Εμπύρηνα RBC'],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },

  // The immature and atypical white-cell rows a differential prints under its
  // own heading. ΒΙΟΙΑΤΡΙΚΗ prints them per cent and ΙΑΤΡΟΚΟΣΜΟΣ prints them
  // with no result at all, which is why the panel carries them: a row nobody
  // can name is a row review has to resolve by hand.
  {
    id: 'band-neutrophils',
    en: 'Band Neutrophils',
    el: 'Ραβδοπύρηνα',
    abbreviations: [],
    aliases: ['Ραβδοπύρηνα', 'Ραβδοπύρηνα (Ραβδοπύρηνα)', 'Ραβδοπύρηνα (ΡΑΒΔΟΠ)'],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'metamyelocytes',
    en: 'Metamyelocytes',
    el: 'Μεταμυελοκύτταρα',
    abbreviations: [],
    // ΒΙΟΙΑΤΡΙΚΗ prints the label unaccented and truncates its code.
    aliases: [
      'Μεταμυελοκύτταρα',
      'Μεταμυελοκύτταρα (Μεταμυελοκύτταρα)',
      'Μεταμυελοκυτταρα (Μεταμυελοκυτ)',
    ],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'myelocytes',
    en: 'Myelocytes',
    el: 'Μυελοκύτταρα',
    abbreviations: [],
    aliases: ['Μυελοκύτταρα', 'Μυελοκύτταρα (Μυελοκύτταρα)'],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'promyelocytes',
    en: 'Promyelocytes',
    el: 'Προμυελοκύτταρα',
    abbreviations: [],
    aliases: ['Προμυελοκύτταρα', 'Προμυελοκύτταρα (Προμυελοκύτταρα)'],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'blasts',
    en: 'Blasts',
    el: 'Βλάστες',
    abbreviations: [],
    // ΒΙΟΙΑΤΡΙΚΗ's code cell for this row reads `Βιβλιογραφία`, which names no
    // marker and is not aliased. The bare label reaches the row through T3.
    aliases: ['Βλάστες', 'Βλάστες (Βλάστες)'],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },
  {
    id: 'atypical-cells',
    en: 'Atypical Cells',
    el: 'Άτυπα Κύτταρα',
    abbreviations: [],
    aliases: ['Άτυπα Κύτταρα', 'Άτυπα Κύτταρα (Άτυπα Κύτταρα)'],
    canonicalUnit: '%',
    plausibleRange: [0, 100],
  },

  // Red-cell morphology. ΙΑΤΡΟΚΟΣΜΟΣ prints these with neither a unit nor a
  // result, so `canonicalUnit` is null — the plan's rule for a marker printed
  // without one — and no `plausibleRange` bounds a quantity nobody printed.
  {
    id: 'anisocytosis',
    en: 'Anisocytosis',
    el: 'Ανισοκυττάρωση',
    abbreviations: [],
    aliases: ['Ανισοκυττάρωση', 'Ανισοκυττάρωση (ΑΝΙΣΟΚΥΤΤ)'],
    canonicalUnit: null,
  },
  {
    id: 'anisochromia',
    en: 'Anisochromia',
    el: 'Ανισοχρωμία',
    abbreviations: [],
    aliases: ['Ανισοχρωμία', 'Ανισοχρωμία (ΑΝΙΣΟΧΡ)'],
    canonicalUnit: null,
  },
  {
    id: 'poikilocytosis',
    en: 'Poikilocytosis',
    el: 'Ποικιλοκυττάρωση',
    abbreviations: [],
    aliases: ['Ποικιλοκυττάρωση', 'Ποικιλοκυττάρωση (ΠΟΙΚΙΛΟΚΥΤ)'],
    canonicalUnit: null,
  },
  {
    id: 'target-cells',
    en: 'Target Cells',
    el: 'Στοχοκυττάρωση',
    abbreviations: [],
    aliases: ['Στοχοκυττάρωση', 'Στοχοκυττάρωση (ΣΤΟΧΟΚΥΤ)'],
    canonicalUnit: null,
  },
  {
    id: 'microcytosis',
    en: 'Microcytosis',
    el: 'Μικροκυττάρωση',
    abbreviations: [],
    // The printed code drops the iota — `ΜΚΡΟΚΥΤ`, not `ΜΙΚΡΟΚΥΤ`. Quoted as
    // printed, because that is the cell the parser has to match.
    aliases: ['Μικροκυττάρωση', 'Μικροκυττάρωση (ΜΚΡΟΚΥΤ)'],
    canonicalUnit: null,
  },
  {
    id: 'macrocytosis',
    en: 'Macrocytosis',
    el: 'Μακροκυττάρωση',
    abbreviations: [],
    aliases: ['Μακροκυττάρωση', 'Μακροκυττάρωση (ΜΑΚΡΟΚΥΤ)'],
    canonicalUnit: null,
  },
  {
    id: 'hypochromia',
    en: 'Hypochromia',
    el: 'Υποχρωμία',
    abbreviations: [],
    aliases: ['Υποχρωμία', 'Υποχρωμία (ΥΠΟΧΡ)'],
    canonicalUnit: null,
  },
  {
    id: 'basophilic-stippling',
    en: 'Basophilic Stippling',
    el: 'Βασεόφιλη στίξη',
    abbreviations: [],
    aliases: ['Βασεόφιλη στίξη', 'Βασεόφιλη στίξη (ΒΑΣΕΟΦ ΣΤ)'],
    canonicalUnit: null,
  },
];
