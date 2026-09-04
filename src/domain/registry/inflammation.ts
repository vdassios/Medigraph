import type { MarkerDef } from '../types';

/**
 * Acute-phase and immune markers.
 *
 * Identity and canonical names from ΚΕΟΚΕΕ; printed variants from `ahfy-full`
 * pages 4 and 9. Total IgE is filed here rather than in a panel of its own:
 * the plan names no immunology file, and the fixture prints it beside CRP
 * under `ΑΝΟΣΟΛΟΓΙΚΕΣ ΕΞΕΤΑΣΕΙΣ`.
 */
export const INFLAMMATION_MARKERS: readonly MarkerDef[] = [
  {
    // ΚΕΟΚΕΕ 18.11.01.09.001. Not the high-sensitivity assay
    // (12.13.01.10.001), which is a separate orderable and a separate marker.
    id: 'crp',
    en: 'C-Reactive Protein',
    el: 'C-Αντιδρώσα πρωτεΐνη',
    abbreviations: ['CRP'],
    aliases: ['C-ΑΝΤΙΔΡΩΣΑ ΠΡΩΤΕΙΝΗ', 'C-Αντιδρώσα πρωτεϊνη (CRP) (CRP)'],
    canonicalUnit: 'mg/L',
    plausibleRange: [0.01, 1000],
  },
  {
    // ΚΕΟΚΕΕ 13.01.09.11.001 and .002 — the automated and manual methods of
    // one quantity. Both administrative names are carried, because a
    // laboratory that prints either is reporting the same measurement.
    // `ΤΚΕ` is Greek throughout, though it reads as Latin `TKE`.
    id: 'esr',
    en: 'Erythrocyte Sedimentation Rate',
    el: 'Ταχύτητα καθίζησης ερυθροκυττάρων',
    abbreviations: ['ESR', 'ΤΚΕ'],
    aliases: [
      'ΤΑΧΥΤΗΤΑ ΚΑΘΙΖΗΣΗΣ ΕΡΥΘΡΟΚΥΤΤΑΡΩΝ (ΑΥΤΟΜΑΤΟΠΟΙΗΜΕΝΗ)',
      'ΤΑΧΥΤΗΤΑ ΚΑΘΙΖΗΣΗΣ ΕΡΥΘΡΟΚΥΤΤΑΡΩΝ (ΧΕΙΡΟΚΙΝΗΤΗ)',
      'Ταχύτητα καθίζησης ερυθρών αιμοσφαιρίων (ΤΚΕ) (ΤΚΕ)',
    ],
    canonicalUnit: 'mm',
    plausibleRange: [0, 200],
  },
  {
    // ΚΕΟΚΕΕ 18.02.01.02.001 — total IgE, not the allergen-specific screen
    // (18.02.01.06.001). The seed's `ΑΝΟΣΟΣΦΑΙΡΙΝΗ Ε` ends in a Greek epsilon
    // and the fixture's `Ανοσοσφαιρίνη E` in a Latin `E`; both are stored as
    // printed, because nothing folds one into the other.
    id: 'ige',
    en: 'Immunoglobulin E, total',
    el: 'Ολική ανοσοσφαιρίνη Ε',
    abbreviations: ['IgE', 'IgE Total'],
    aliases: ['ΟΛΙΚΗ ΑΝΟΣΟΣΦΑΙΡΙΝΗ Ε', 'Ανοσοσφαιρίνη E (IGE) (IgE)'],
    canonicalUnit: 'IU/mL',
    plausibleRange: [0, 100000],
  },
];
