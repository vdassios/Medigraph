import type { MarkerDef } from '../types';

/**
 * Thyroid function, thyroid autoantibodies and the prostate antigen.
 *
 * PSA is a tumour marker, printed by `ahfy-full` under its own
 * `ΔΕΙΚΤΕΣ ΝΕΟΠΛΑΣΙΑΣ` heading. The plan's panel list has no tumour-marker
 * file, and PSA is an immunoassay of a glycoprotein, so it is filed here
 * rather than given a file the plan does not name.
 *
 * Identity and canonical names from ΚΕΟΚΕΕ; printed variants from `ahfy-full`
 * pages 10 and 11.
 */
export const HORMONE_MARKERS: readonly MarkerDef[] = [
  {
    // ΚΕΟΚΕΕ 12.04.01.05.001. Total T3, not the free (FT3) or reverse (rT3)
    // determination — those are separate ΚΕΟΚΕΕ entries and separate markers.
    id: 't3',
    en: 'Triiodothyronine',
    el: 'Τριιωδοθυρονίνη',
    abbreviations: ['T3', 'TT3'],
    aliases: ['ΤΡΙΙΩΔΟΘΥΡΟΝΙΝΗ', 'Τριιωδοθυρονίνη (T3) (T3)'],
    canonicalUnit: 'ng/dL',
    plausibleRange: [1, 1000],
  },
  {
    // ΚΕΟΚΕΕ 12.04.01.02.001
    id: 'ft4',
    en: 'Free Thyroxine',
    el: 'Ελεύθερη θυροξίνη',
    abbreviations: ['FT4'],
    aliases: ['ΕΛΕΥΘΕΡΗ ΘΥΡΟΞΙΝΗ', 'Ελεύθερη θυροξίνη (FT4) (FT4)'],
    canonicalUnit: 'ng/dL',
    plausibleRange: [0.01, 20],
  },
  {
    // ΚΕΟΚΕΕ 18.10.03.04.001
    id: 'anti-tg',
    en: 'Thyroglobulin Autoantibody',
    el: 'Αντισώματα έναντι της θυρεοσφαιρίνης',
    abbreviations: ['Anti-TG'],
    aliases: [
      'ΑΝΤΙΣΩΜΑΤΑ ΕΝΑΝΤΙ ΤΗΣ ΘΥΡΕΟΣΦΑΙΡΙΝΗΣ (Tg)',
      'ΑΝΤΙ-ΘΥΡΕΟΣΦΑΙΡΙΝΙΚΑ ΑΝΤΙΣΩΜΑΤΑ',
      'Αντισώματα έναντι της θυρεοσφαιρίνης (anti-Tg) (Anti-TG)',
    ],
    canonicalUnit: 'IU/mL',
    plausibleRange: [0, 100000],
  },
  {
    // ΚΕΟΚΕΕ 18.10.03.01.001. The fixture prints the Greek word for
    // "antibodies" with a MICRO SIGN where its mu belongs, so that alias
    // carries the character as an escape — nothing distinguishes the two by
    // eye. `normaliseLabel`'s NFKD pass folds U+00B5 to U+03BC, so both
    // spellings match: the escape is for the reviewer, not for the matcher.
    id: 'anti-tpo',
    en: 'Thyroid Peroxidase Antibodies',
    el: 'Αντισώματα έναντι θυρεοειδικής υπεροξειδάσης',
    abbreviations: ['Anti-TPO'],
    aliases: [
      'ΑΝΤΙΣΩΜΑΤΑ ΕΝΑΝΤΙ ΤΗΣ ΘΥΡΕΟΕΙΔΙΚΗΣ ΥΠΕΡΟΞΕΙΔΑΣΗΣ (TPO)',
      'ΑΝΤΙΜΙΚΡΟΣΩΜΙΑΚΑ ΑΝΤΙΣΩΜΑΤΑ',
      'Αντισώ\u00B5ατα έναντι θυρεοειδικής υπεροξειδάσης (anti-TPO) (Anti-TPO)',
    ],
    canonicalUnit: 'IU/mL',
    plausibleRange: [0, 100000],
  },
  {
    // ΚΕΟΚΕΕ 12.03.01.32.001 — total PSA. Free PSA (12.03.01.33.001) and the
    // free/total ratio are separate orderables and are not seeded here.
    id: 'psa',
    en: 'Total Prostatic Specific Antigen',
    el: 'Ολικό ειδικό προστατικό αντιγόνο',
    abbreviations: ['PSA', 'tPSA'],
    aliases: ['ΟΛΙΚΟ ΕΙΔΙΚΟ ΠΡΟΣΤΑΤΙΚΟ ΑΝΤΙΓΟΝΟ', 'Ειδικό προστατικό αντιγόνο (PSA) (PSA)'],
    canonicalUnit: 'ng/mL',
    plausibleRange: [0, 10000],
  },
];
