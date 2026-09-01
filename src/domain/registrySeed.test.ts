import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const seedDir = new URL('../../fixtures/registry-seed/', import.meta.url);
const workbook = readFileSync(new URL('keokee-v5.xlsx', seedDir));
const keokeeTsv = readFileSync(new URL('keokee.tsv', seedDir), 'utf8');

/** ΚΕΟΚΕΕ v5, April 2016, as published by the Greek Ministry of Health. */
const WORKBOOK_SHA256 = 'd73ef10530de0453ad5f4a4d04d06e7672a8c5a30cbf06fe269bcf4143642418';

const HEADER = 'grCode\ten\tabbreviation\tel\totherName';
const GR_CODE = /^1[1238](\.\d+){4}$/;

const lines = keokeeTsv.split('\n');
const header = lines[0];
const rows = lines.slice(1).filter((line) => line !== '');
const fields = rows.map((line) => line.split('\t'));

/**
 * Twenty rows quoted from the upstream workbook. They must survive extraction
 * byte-for-byte: the boundary row of each category, the abbreviation pairs the T1
 * tier depends on, and markers that carry an alternative name.
 */
const SPOT_ROWS = [
  "11.01.01.01.001\t5'-Nucleotidase\tNTP\t5-ΝΟΥΚΛΕΟΤΙΔΑΣΗ\t",
  '11.01.01.03.001\tAlanine Amino-Transferase\tALT/SGPT\tΑΜΙΝΟΤΡΑΝΣΦΕΡΑΣΗ ΑΛΑΝΙΝΗΣ\t',
  '11.01.01.10.001\tAspartate Amino-Transferase\tAST/SGOT\tΑΣΠΑΡΤΙΚΗ ΑΜΙΝΟΤΡΑΝΣΦΕΡΑΣΗ\t',
  '11.01.01.16.001\tGamma Glutamyltransferase\tγ-GT\tγ-ΓΛΟΥΤΑΜΥΛΟΤΡΑΝΣΦΕΡΑΣΗ\t',
  '11.02.01.05.001\tCholesterol\tCHOL\tΧΟΛΗΣΤΕΡΟΛΗ\tΟΛΙΚΗ ΧΟΛΗΣΤΕΡΟΛΗ',
  '11.02.01.07.001\tCreatinine\tCREAT\tΚΡΕΑΤΙΝΙΝΗ\t',
  '11.02.01.13.001\tGlucose\tGLU\tΓΛΥΚΟΖΗ\tΣΑΚΧΑΡΟ',
  '11.02.01.14.001\tGlycosylated/Glycated Haemoglobin\tHbA1c\tΓΛΥΚΟΖΥΛΙΩΜΕΝΗ ΑΙΜΟΣΦΑΙΡΙΝΗ\tΓΛΥΚΙΩΜΕΝΗ ΑΙΜΟΣΦΑΙΡΙΝΗ',
  '11.02.01.31.001\tTriglycerides\t\tΤΡΙΓΛΥΚΕΡΙΔΙΑ\t',
  '11.02.01.32.001\tUric Acid\t\tΟΥΡΙΚΟ ΟΞΥ\t',
  '11.90.90.90.900\tOther Other Clinical Chemistry tests\t\tΑΛΛΕΣ ΕΞΕΤΑΣΕΙΣ ΚΛΙΝΙΚΗΣ ΧΗΜΕΙΑΣ-ΒΙΟΧΗΜΕΙΑΣ ΠΟΥ ΔΕΝ ΑΝΑΦΕΡΟΝΤΑΙ ΑΛΛΟΥ\t',
  '12.01.03.01.001\tuAlbumin\t\tΑΛΒΟΥΜΙΝΗ ΟΥΡΩΝ\tΛΕΥΚΩΜΑΤΙΝΗ ΟΥΡΩΝ',
  '12.04.01.11.001\tThyroid Stimulating Hormone\tTSH\tΘΥΡΕΟΕΙΔΟΤΡΟΠΟΣ ΟΡΜΟΝΗ\t',
  '12.07.01.02.001\tFerritin\t\tΦΕΡΡΙΤΙΝΗ\t',
  '12.07.02.04.001\tVitamin B12\tB12\tΒΙΤΑΜΙΝΗ Β12\tΚΥΑΝΟΚΟΒΑΛΑΜΙΝΗ',
  '12.90.90.90.900\tOther Other Immunochemistry tests\t\tΑΛΛΕΣ ΑΝΟΣΟΧΗΜΙΚΕΣ ΕΞΕΤΑΣΕΙΣ ΠΟΥ ΔΕΝ ΑΝΑΦΕΡΟΝΤΑΙ ΑΛΛΟΥ\t',
  '13.01.01.01.001\tComplete Blood Count\tCBC-3\tΠΛΗΡΗΣ ΓΕΝΙΚΗ ΑΙΜΑΤΟΣ ΜΕ ΔΙΑΧΩΡΙΣΜΟ 3 ΥΠΟΠΛΗΘΥΣΜΩΝ ΛΕΥΚΟΚΥΤΤΑΡΩΝ\t',
  '13.90.90.90.900\tUnclassifiable and Other Haematology\t\tΑΛΛΕΣ ΕΞΕΤΑΣΕΙΣ ΑΙΜΑΤΟΛΟΓΙΑΣ ΠΟΥ ΔΕΝ ΑΝΑΦΕΡΟΝΤΑΙ ΑΛΛΟΥ\t',
  '18.01.01.01.001\tImmunoglobulin A\tIgA\tΑΝΟΣΟΣΦΑΙΡΙΝΗ Α\t',
  '18.90.90.90.900\tOTHER OTHER IMMUNOLOGY TESTS\t\tΑΛΛΕΣ ΑΝΟΣΟΛΟΓΙΚΕΣ ΕΞΕΤΑΣΕΙΣ ΠΟΥ ΔΕΝ ΑΝΑΦΕΡΟΝΤΑΙ ΑΛΛΟΥ\t',
];

describe('ΚΕΟΚΕΕ marker seed', () => {
  it('was extracted from the published upstream workbook', () => {
    expect(createHash('sha256').update(workbook).digest('hex')).toBe(WORKBOOK_SHA256);
  });

  it('has the agreed header and at least 890 rows', () => {
    expect(header).toBe(HEADER);
    expect(rows.length).toBeGreaterThanOrEqual(890);
    expect(rows).toHaveLength(896);
  });

  it('carries only leaf codes from the four quantitative categories', () => {
    const bad = fields.filter(([code]) => !GR_CODE.test(code ?? ''));
    expect(bad).toEqual([]);
  });

  it('counts each category as the catalogue does', () => {
    const perCategory = new Map<string, number>();
    for (const [code] of fields) {
      const category = (code ?? '').slice(0, 2);
      perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
    }
    expect(Object.fromEntries(perCategory)).toEqual({
      '11': 131,
      '12': 328,
      '13': 270,
      '18': 167,
    });
  });

  it('gives every row exactly five fields and a unique code', () => {
    expect(fields.every((row) => row.length === 5)).toBe(true);
    expect(new Set(fields.map(([code]) => code)).size).toBe(fields.length);
  });

  it('never leaves a name empty and never leaves whitespace on a field', () => {
    for (const [code, en, abbreviation, el, otherName] of fields) {
      expect(en, code).not.toBe('');
      expect(el, code).not.toBe('');
      for (const field of [code, en, abbreviation, el, otherName]) {
        expect(field).toBe((field ?? '').trim());
      }
    }
  });

  it('keeps the optional columns as sparse as the catalogue is', () => {
    expect(fields.filter(([, , abbreviation]) => abbreviation !== '')).toHaveLength(435);
    expect(fields.filter((row) => row[4] !== '')).toHaveLength(73);
  });

  it('reproduces twenty upstream rows byte-for-byte', () => {
    expect(SPOT_ROWS).toHaveLength(20);
    for (const row of SPOT_ROWS) {
      expect(rows, row.split('\t')[0]).toContain(row);
    }
  });

  it('emits no MarkerDef — this is vocabulary, not a registry', () => {
    expect(keokeeTsv).not.toContain('markerKey');
    expect(keokeeTsv).not.toContain('canonical');
  });
});
