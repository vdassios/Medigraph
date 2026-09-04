import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markerKey } from './markerKey';

const SEED = new URL('../../fixtures/seed/', import.meta.url);

interface ExpectedRow {
  label: string;
}

function expectedRows(name: string): ExpectedRow[] {
  const expected = JSON.parse(readFileSync(new URL(`${name}.expected.json`, SEED), 'utf8')) as {
    rows: ExpectedRow[];
  };
  return expected.rows;
}

/**
 * `ahfy-minimal` page 2: the bare Latin-code dialect, where the whole
 * `Περιγραφή` cell is the analyser's index name twice over.
 */
const MINIMAL_LABELS: [string, string][] = [
  ['WBC (WBC)', 'wbc'],
  ['RBC (RBC)', 'rbc'],
  ['HGB (HGB)', 'haemoglobin'],
  ['HCT (HCT)', 'hct'],
  ['MCV (MCV)', 'mcv'],
  ['MCH (MCH)', 'mch'],
  ['MCHC (MCHC)', 'mchc'],
  ['PLT (PLT)', 'plt'],
  ['NEUT% (NEUT%)', 'neutrophils-percent'],
  ['LYMP% (LYMP%)', 'lymphocytes-percent'],
  ['MONO% (MONO%)', 'monocytes-percent'],
  ['EOSI% (EOSI%)', 'eosinophils-percent'],
  ['BASO% (BASO%)', 'basophils-percent'],
  ['NEUT# (NEUT#)', 'neutrophils-absolute'],
  ['LYMP# (LYMP#)', 'lymphocytes-absolute'],
  ['MONO# (MONO#)', 'monocytes-absolute'],
  ['EOSI# (EOSI#)', 'eosinophils-absolute'],
  ['BASO# (BASO#)', 'basophils-absolute'],
  ['RDWSD (RDWSD)', 'rdw-sd'],
  ['MPV (MPV)', 'mpv'],
];

/**
 * `ahfy-full`: the Greek-name dialect. Every label is the printed cell with
 * the laboratory's wrap rejoined, which is what `rows.ts` hands the matcher.
 * `\u039C`, `\u0397`, `\u039F` and `\u00B5` are the Greek and micro characters
 * this document prints inside otherwise Latin abbreviations.
 */
const FULL_LABELS: [string, string][] = [
  ['Ερυθρά Αιμοσφαίρια (RBC) (RBC)', 'rbc'],
  ['Αιμοσφαιρίνη (HGB) (HGB)', 'haemoglobin'],
  ['Αιματοκρίτης (HCT) (HCT)', 'hct'],
  ['Μέσος Όγκος Ερυθρών (\u039CCV) (MCV)', 'mcv'],
  ['Μέση Περιεκτικότης HGB (MCH) (MCH)', 'mch'],
  ['Μέση Πυκνότης HGB (MCHC) (MCHC)', 'mchc'],
  ['Εύρος Κατανομής Ερυθρών (RDW) (RDW)', 'rdw'],
  ['Λευκά Αιμοσφαίρια (WBC) (WBC)', 'wbc'],
  ['Πολυμορφοπύρηνα Ουδετερόφιλα (NEUT) % (NEUT%)', 'neutrophils-percent'],
  ['Πολυμορφοπύρηνα Ουδετερόφιλα (NEUT#)', 'neutrophils-absolute'],
  ['Λεμφοκύτταρα (LYMPH) % (LYM%)', 'lymphocytes-percent'],
  ['Λεμφοκύτταρα (LYM#)', 'lymphocytes-absolute'],
  ['Μονοπύρηνα (MONO) % (MONO%)', 'monocytes-percent'],
  ['Μονοπύρηνα (MONO#)', 'monocytes-absolute'],
  ['Πολυμορφοπύρηνα Ηωσινόφιλα (EOS) % (EOS%)', 'eosinophils-percent'],
  ['Πολυμορφοπύρηνα Ηωσινόφιλα (EOS#)', 'eosinophils-absolute'],
  ['Πολυμορφοπύρηνα Βασεόφιλα (BASO) % (BASO%)', 'basophils-percent'],
  ['Πολυμορφοπύρηνα Βασεόφιλα (BASO#)', 'basophils-absolute'],
  ['Αιμοπετάλια (PLT) (PLT)', 'plt'],
  ['Μέσος Όγκος Αιμοπεταλίων (MPV) (MPV)', 'mpv'],
  ['Αιμοπεταλιοκρίτης (PCT) (PCT)', 'pct'],
  ['Ταχύτητα καθίζησης ερυθρών αιμοσφαιρίων (ΤΚΕ) (ΤΚΕ)', 'esr'],
  ['Γλυκόζη (GLUC) (GLUC)', 'glucose'],
  ['Ουρία (UREA) (UREA)', 'urea'],
  ['Κρεατινίνη (CREA) (CREA)', 'creatinine'],
  ['Ουρικό οξύ (UA) (UA)', 'uric-acid'],
  ['Ολική χοληστερόλη (TC) (CHOL)', 'cholesterol'],
  ['Τριγλυκερίδια (TRIG) (TRIG)', 'triglycerides'],
  ['Χοληστερόλη υψηλής πυκνότητας λιποπρωτεϊνών (\u0397DL-C) (HDL)', 'hdl'],
  ['Χοληστερόλη χαμηλής πυκνότητας λιποπρωτεϊνών (LDL-C) (LDL)', 'ldl'],
  ['Αμινοτρανσφεράση του ασπαρτικού οξέος (SGOT/AST) (AST (SGOT))', 'ast'],
  ['Αμινοτρανσφεράση αλανίνης (SGPT/ALT) (ALT (SGPT))', 'alt'],
  ['γ-Γλουταμυλοτρανσφεράση (γ-GT) (γ-GT)', 'ggt'],
  ['Αλκαλική φωσφατάση (ALP) (ALP)', 'alp'],
  ['Κρεατινική κινάση (CK) (CPK)', 'ck'],
  ['Μαγνήσιο (Mg) (Mg)', 'magnesium'],
  ['Σίδηρος ορού (Fe) (FE)', 'iron'],
  ['Φερριτίνη (FERR)', 'ferritin'],
  ['Γλυκοζυλιωμένη Αιμοσφαιρίνη (HbA1C) (HBA1c)', 'hba1c'],
  ['Βιταμίνη Β12 (Vit-B12)', 'vitamin-b12'],
  ['Φυλλικό οξύ (Folate acid)', 'folate'],
  ['25-υδροξυβιταμίνη D [25(\u039F\u0397)D] (Vit-D 25(\u039F\u0397))', 'vitamin-d'],
  ['Ανοσοσφαιρίνη E (IGE) (IgE)', 'ige'],
  ['C-Αντιδρώσα πρωτεϊνη (CRP) (CRP)', 'crp'],
  ['Τριιωδοθυρονίνη (T3) (T3)', 't3'],
  ['Ελεύθερη θυροξίνη (FT4) (FT4)', 'ft4'],
  ['Αντισώματα έναντι της θυρεοσφαιρίνης (anti-Tg) (Anti-TG)', 'anti-tg'],
  ['Αντισώ\u00B5ατα έναντι θυρεοειδικής υπεροξειδάσης (anti-TPO) (Anti-TPO)', 'anti-tpo'],
  ['Ειδικό προστατικό αντιγόνο (PSA) (PSA)', 'psa'],
  ['Χροιά (Χροιά)', 'urine-colour'],
  ['Όψη (Οψη)', 'urine-appearance'],
  ['Αντίδραση PH (PH)', 'urine-ph'],
  ['Ειδικό βάρος (Ειδικό βάρος)', 'urine-specific-gravity'],
  ['Λεύκωμα (Λεύκωμα)', 'urine-protein'],
  ['Σάκχαρο (Σάκχαρο)', 'urine-glucose'],
  ['Οξόνη (Οξόνη)', 'urine-ketones'],
  ['Αιμοσφαιρίνη (Αιμοσφαιρίνη)', 'urine-haemoglobin'],
  ['Χολερυθρίνη (Χολερυθρίνη)', 'urine-bilirubin'],
  ['Ουροχολινογόνο (Ουροχολινογόνο)', 'urine-urobilinogen'],
  ['Νιτρικά (Νιτρικά)', 'urine-nitrites'],
  ['Πυοσφαίρια (Πυοσφαίρια)', 'urine-leukocytes'],
  ['Ερυθρά αιμοσφαίρια (Ερυθρά αιμοσφ.)', 'urine-erythrocytes'],
];

/**
 * The one label in the fixture expectations that this module cannot resolve.
 *
 * `ahfy-full` wraps the urine erythrocyte cell across two lines, and the
 * expectation records the first line alone because it was derived by column
 * reconstruction, not by Medigraph's clustering. Rejoining the wrap is
 * `rows.ts`'s job (Task 1.8); rejoined, the cell resolves — the case directly
 * below proves it. Registering the truncation as an alias instead would be
 * inventing a label no laboratory prints.
 */
const WRAPPED_IN_EXPECTATIONS = 'Ερυθρά αιμοσφαίρια (Ερυθρά';

describe('markerKey', () => {
  it.each(MINIMAL_LABELS)('resolves the Latin-code label %j to %s', (label, id) => {
    expect(markerKey(label)).toBe(id);
  });

  it.each(FULL_LABELS)('resolves the Greek-name label %j to %s', (label, id) => {
    expect(markerKey(label)).toBe(id);
  });

  it.each(['ahfy-minimal', 'ahfy-full'])(
    'resolves every measured row the %s expectations record',
    (name) => {
      const unresolved = expectedRows(name)
        .map((row) => row.label)
        .filter((label) => label !== WRAPPED_IN_EXPECTATIONS)
        .filter((label) => markerKey(label).startsWith('x:'));

      expect(unresolved).toEqual([]);
    },
  );

  it('leaves a label the laboratory wrapped to rows.ts, not to an invented alias', () => {
    expect(markerKey(WRAPPED_IN_EXPECTATIONS)).toBe('x:ερυθρα-αιμοσφαιρια-ερυθρα');
    expect(markerKey('Ερυθρά αιμοσφαίρια (Ερυθρά αιμοσφ.)')).toBe('urine-erythrocytes');
  });

  it('resolves an abbreviation printed as the whole label', () => {
    expect(markerKey('MCV')).toBe('mcv');
    expect(markerKey('HbA1c')).toBe('hba1c');
    expect(markerKey('γ-GT')).toBe('ggt');
  });

  it('ignores case, accents, final sigma and surrounding space', () => {
    // normaliseLabel does this work; these assert the registry is indexed
    // through it rather than by raw string.
    expect(markerKey('  ΓΛΥΚΟΖΗ  ')).toBe('glucose');
    expect(markerKey('γλυκόζη')).toBe('glucose');
    expect(markerKey('ΟΥΡΙΚΟ ΟΞΥ')).toBe('uric-acid');
    expect(markerKey('Ουρικό Οξύ')).toBe('uric-acid');
  });

  describe('the labels two markers could claim', () => {
    it('reads the serum sugar and the urine dipstick sugar apart', () => {
      // `ΣΑΚΧΑΡΟ` is glucose's ΚΕΟΚΕΕ synonym; the dipstick row is matched by
      // its full printed cell. Neither may claim the other's form.
      expect(markerKey('ΣΑΚΧΑΡΟ')).toBe('glucose');
      expect(markerKey('Σάκχαρο (Σάκχαρο)')).toBe('urine-glucose');
    });

    it.each([
      ['Αιμοσφαιρίνη', 'blood count and urine dipstick'],
      ['Λεύκωμα', 'serum protein and urine dipstick'],
      ['Χολερυθρίνη', 'serum and urine bilirubin'],
      ['Ερυθρά αιμοσφαίρια', 'blood count and urine sediment'],
    ])('refuses the bare %j, which %s both print', (label) => {
      // The safe failure: an unknown marker reaches review with its printed
      // label intact. Guessing would put a dipstick result on a serum chart.
      expect(markerKey(label)).toMatch(/^x:/u);
    });

    it('does not transliterate a Greek letter inside a Latin abbreviation', () => {
      // `ahfy-full` prints `(ΜCV)` with a Greek capital mu. The all-Latin
      // spelling is a different string and stays unknown here; `anchors.ts`
      // catches it at the T1 tier, where the row's `(MCV)` token matches the
      // abbreviation directly.
      expect(markerKey('Μέσος Όγκος Ερυθρών (MCV)')).toMatch(/^x:/u);
      expect(markerKey('Μέσος Όγκος Ερυθρών (\u039CCV) (MCV)')).toBe('mcv');
    });
  });

  describe('unknown markers', () => {
    it.each([
      ['Άγνωστος Δείκτης', 'x:αγνωστοσ-δεικτησ'],
      ['Some Unknown Marker', 'x:some-unknown-marker'],
      ['  Λιπάση  ', 'x:λιπαση'],
      ['Anti-Xa (units/mL)', 'x:anti-xa-units-ml'],
      ['---', 'x:'],
      ['', 'x:'],
    ])('derives a stable key from %j', (label, key) => {
      expect(markerKey(label)).toBe(key);
    });

    it('keeps Unicode letters and numbers, collapsing every other run', () => {
      expect(markerKey('Βιταμίνη B6 / Β1 !!')).toBe('x:βιταμινη-b6-β1');
    });

    it('is stable across spellings that normalise alike', () => {
      expect(markerKey('ΟΜΟΚΥΣΤΕΪΝΗ')).toBe(markerKey('Ομοκυστεϊνη'));
      expect(markerKey('ΟΜΟΚΥΣΤΕΪΝΗ')).toBe(markerKey('ομοκυστεινη'));
    });
  });
});
