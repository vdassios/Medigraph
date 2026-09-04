import type { MarkerDef } from '../types';

/**
 * Vitamin and folate levels.
 *
 * Identity and canonical names from ΚΕΟΚΕΕ; printed variants from `ahfy-full`
 * pages 8 and 10.
 */
export const VITAMIN_MARKERS: readonly MarkerDef[] = [
  {
    // ΚΕΟΚΕΕ 12.07.02.04.001. The seed and the fixture both spell the vitamin
    // letter with a GREEK CAPITAL LETTER BETA, and `normaliseLabel` never
    // transliterates, so the Latin `B12` spelling lives in `abbreviations`.
    id: 'vitamin-b12',
    en: 'Vitamin B12',
    el: 'Βιταμίνη Β12',
    abbreviations: ['B12', 'Vit-B12'],
    aliases: ['ΒΙΤΑΜΙΝΗ Β12', 'ΚΥΑΝΟΚΟΒΑΛΑΜΙΝΗ', 'Βιταμίνη Β12 (Vit-B12)'],
    canonicalUnit: 'pg/mL',
    plausibleRange: [10, 50000],
  },
  {
    // ΚΕΟΚΕΕ 12.07.01.03.001. Serum folate, not the erythrocyte determination
    // (12.07.01.03.002), which is a separate orderable.
    id: 'folate',
    en: 'Folate',
    el: 'Φυλλικό οξύ',
    abbreviations: ['FA'],
    aliases: ['ΦΥΛΛΙΚΟ ΟΞΥ', 'Φυλλικό οξύ (Folate acid)'],
    canonicalUnit: 'ng/mL',
    plausibleRange: [0.1, 200],
  },
  {
    // ΚΕΟΚΕΕ splits this in two: 12.06.03.10.001 `25-Hydroxyvitamin D` — what
    // an analyser actually measures — and 12.07.02.05.001 `Vitamin D
    // (Cholecalciferol)`. A report never distinguishes them, so both sets of
    // names fold into this one marker. 1,25-dihydroxyvitamin D
    // (12.06.03.09.001) is a genuinely different test and is not seeded.
    // The fixture's `[25(ΟΗ)D]` spells `ΟΗ` in Greek capitals, and the ΚΕΟΚΕΕ
    // `25 YΔΡΟΞΥ-` opens with a Latin `Y`; both are written as escapes.
    id: 'vitamin-d',
    en: '25-Hydroxyvitamin D',
    el: '25 Υδροξυ-βιταμίνη D',
    abbreviations: ['25(OH)D', 'VitD'],
    aliases: [
      '25 \u0059ΔΡΟΞΥ-ΒΙΤΑΜΙΝΗ D',
      'ΒΙΤΑΜΙΝΗ D',
      'ΚΑΛΣΙΦΕΡΟΛΗ',
      '25-υδροξυβιταμίνη D [25(\u039F\u0397)D] (Vit-D 25(\u039F\u0397))',
    ],
    canonicalUnit: 'ng/mL',
    plausibleRange: [1, 500],
  },
];
