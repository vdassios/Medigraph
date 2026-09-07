import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extract } from './extract';
import { buildSeries } from './series';
import { normaliseUnit } from './units';
import type { CollectedAt, Measurement, Profile, Report, TextItem } from './types';

const SEED = new URL('../../fixtures/seed/', import.meta.url);

/** The seed documents, carried through extraction into one Profile. */
function seedProfile(): Profile {
  const reports = ['ahfy-minimal', 'ahfy-full'].map((name, index) => {
    const parsed = JSON.parse(readFileSync(new URL(`${name}.textitems.json`, SEED), 'utf8')) as {
      fragmented: { pages: TextItem[][] };
    };
    const result = extract({
      sourceId: name,
      adapterId: 'pdf-text',
      tier: 'E0',
      pages: parsed.fragmented.pages,
    });

    const seen = new Set<string>();
    return report(
      `report-${String(index)}`,
      { date: result.collectionDate, time: null, precision: 'day' },
      result.rows.flatMap((row) => {
        if (seen.has(row.markerKey)) {
          return [];
        }
        seen.add(row.markerKey);
        return [
          {
            markerKey: row.markerKey,
            status: row.status,
            value: row.value,
            comparator: row.comparator,
            textValue: row.textValue,
            unit: row.unit,
            referenceRange: row.referenceRange,
            categoricalReference: row.categoricalReference,
            sourceOrder: row.sourceOrder,
          },
        ];
      }),
    );
  });

  return profile(reports);
}

const JANUARY: CollectedAt = { date: '2025-01-10', time: null, precision: 'day' };
const MARCH: CollectedAt = { date: '2025-03-04', time: null, precision: 'day' };
const MAY: CollectedAt = { date: '2025-05-14', time: null, precision: 'day' };
const MORNING: CollectedAt = { date: '2025-05-14', time: '09:30', precision: 'minute' };
const EVENING: CollectedAt = { date: '2025-05-14', time: '18:05', precision: 'minute' };

function measurement(markerKey: string, overrides: Partial<Measurement> = {}): Measurement {
  return {
    markerKey,
    status: 'value',
    value: 1,
    comparator: null,
    textValue: null,
    unit: null,
    referenceRange: null,
    categoricalReference: null,
    sourceOrder: 0,
    ...overrides,
  };
}

function report(id: string, collectedAt: CollectedAt, measurements: Measurement[]): Report {
  return { id, collectedAt, measurements };
}

function profile(reports: Report[]): Profile {
  return { schemaVersion: 1, id: 'profile-1', reports };
}

describe('buildSeries', () => {
  describe('ordering', () => {
    it('orders points by local civil date whatever order the Reports are stored in', () => {
      const built = buildSeries(
        profile([
          report('r2', MAY, [measurement('glucose', { value: 91, unit: 'mg/dL' })]),
          report('r1', JANUARY, [measurement('glucose', { value: 89, unit: 'mg/dL' })]),
          report('r3', MARCH, [measurement('glucose', { value: 90, unit: 'mg/dL' })]),
        ]),
      );

      expect(built[0]?.points.map((each) => each.value)).toEqual([89, 90, 91]);
    });

    it('orders two Reports collected on one day by their minute', () => {
      const built = buildSeries(
        profile([
          report('r2', EVENING, [measurement('glucose', { value: 91, unit: 'mg/dL' })]),
          report('r1', MORNING, [measurement('glucose', { value: 89, unit: 'mg/dL' })]),
        ]),
      );

      expect(built[0]?.points.map((each) => each.reportId)).toEqual(['r1', 'r2']);
    });

    it('applies no timezone: the printed civil values are the order', () => {
      const built = buildSeries(
        profile([
          report('r1', { date: '2025-05-14', time: '23:50', precision: 'minute' }, [
            measurement('glucose', { value: 89, unit: 'mg/dL' }),
          ]),
          report('r2', { date: '2025-05-15', time: '00:10', precision: 'minute' }, [
            measurement('glucose', { value: 91, unit: 'mg/dL' }),
          ]),
        ]),
      );

      expect(built[0]?.points.map((each) => each.reportId)).toEqual(['r1', 'r2']);
    });

    it('returns series in the order the documents printed their markers', () => {
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [
            measurement('glucose', { unit: 'mg/dL' }),
            measurement('urea', { unit: 'mg/dL' }),
          ]),
          report('r2', MAY, [measurement('creatinine', { unit: 'mg/dL' })]),
        ]),
      );

      expect(built.map((each) => each.markerKey)).toEqual(['glucose', 'urea', 'creatinine']);
    });

    it('is deterministic: the same Profile yields the same arrays', () => {
      const source = profile([
        report('r1', MAY, [measurement('glucose', { unit: 'mg/dL' })]),
        report('r2', JANUARY, [measurement('glucose', { unit: 'mg/dL' })]),
      ]);

      expect(buildSeries(source)).toEqual(buildSeries(source));
    });

    it('builds nothing from a Profile holding no Reports', () => {
      expect(buildSeries(profile([]))).toEqual([]);
    });
  });

  describe('unit conversion', () => {
    it('states a canonical marker in its registry unit, converting the value', () => {
      // The registry states glucose in mg/dL, so an mmol/L reading is divided
      // by the same factor that would multiply the other way.
      const built = buildSeries(
        profile([report('r1', JANUARY, [measurement('glucose', { value: 5, unit: 'mmol/L' })])]),
      );

      expect(built[0]?.unit).toBe('mg/dL');
      expect(built[0]?.points[0]?.value).toBeCloseTo(5 / 0.05551, 6);
    });

    it('converts the reference bounds by the same factor as the value', () => {
      // The value must never move relative to its own range: a result inside
      // its interval before conversion is inside it afterwards.
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [
            measurement('glucose', {
              value: 5,
              unit: 'mmol/L',
              referenceRange: { kind: 'closed', min: 4, max: 6 },
            }),
          ]),
        ]),
      );
      const point = built[0]?.points[0];

      expect(point?.referenceRange).toEqual({
        kind: 'closed',
        min: 4 / 0.05551,
        max: 6 / 0.05551,
      });
      expect(point?.value).toBeGreaterThan(
        point?.referenceRange?.kind === 'closed' ? point.referenceRange.min : Number.NaN,
      );
    });

    it('converts a one-sided bound and leaves its comparator alone', () => {
      // The factor is positive, so the direction of the inequality cannot move.
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [
            measurement('glucose', {
              value: 5,
              unit: 'mmol/L',
              referenceRange: { kind: 'maxOnly', comparator: '<', max: 6 },
            }),
          ]),
        ]),
      );

      expect(built[0]?.points[0]?.referenceRange).toEqual({
        kind: 'maxOnly',
        comparator: '<',
        max: 6 / 0.05551,
      });
    });

    it('keeps a result comparator through conversion', () => {
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [
            measurement('glucose', { value: 5, comparator: '<', unit: 'mmol/L' }),
          ]),
        ]),
      );

      expect(built[0]?.points[0]?.comparator).toBe('<');
    });

    it('preserves the document’s own numbers alongside the converted ones', () => {
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [
            measurement('glucose', {
              value: 5,
              unit: 'mmol/L',
              referenceRange: { kind: 'closed', min: 4, max: 6 },
            }),
          ]),
        ]),
      );

      expect(built[0]?.points[0]).toMatchObject({
        nativeValue: 5,
        nativeUnit: 'mmol/L',
        nativeReferenceRange: { kind: 'closed', min: 4, max: 6 },
      });
    });

    it('converts nothing when the unit is already the registry’s', () => {
      const built = buildSeries(
        profile([report('r1', JANUARY, [measurement('glucose', { value: 89, unit: 'mg/dL' })])]),
      );

      expect(built[0]?.points[0]).toMatchObject({ value: 89, nativeValue: 89 });
    });

    it('folds a printed unit before comparing it', () => {
      // `k/μl` and `x10^3 / μL` are one unit, so they are one series.
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [measurement('wbc', { value: 6.93, unit: 'k/μl' })]),
          report('r2', MAY, [measurement('wbc', { value: 5.03, unit: 'x10^3 / μL' })]),
        ]),
      );

      expect(built).toHaveLength(1);
      expect(built[0]?.unit).toBe(normaliseUnit('x10^3/μL'));
    });
  });

  describe('splitting', () => {
    it('splits a unit that neither matches nor converts', () => {
      // Never plot mismatched units on one axis (D12). A number nobody can
      // reconcile is not the same quantity, so it gets its own axis.
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [measurement('ferritin', { value: 45, unit: 'ng/mL' })]),
          report('r2', MAY, [measurement('ferritin', { value: 99, unit: 'mm' })]),
        ]),
      );

      expect(built.map((each) => each.id)).toEqual(['ferritin@ng/mL', 'ferritin@mm']);
      expect(new Set(built.map((each) => each.unit)).size).toBe(2);
    });

    it('gives an unknown marker one series per native unit, converting none', () => {
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [measurement('x:novel', { value: 1, unit: 'mg/dL' })]),
          report('r2', MAY, [measurement('x:novel', { value: 2, unit: 'mmol/L' })]),
        ]),
      );

      expect(built.map((each) => each.id)).toEqual(['x:novel@mg/dL', 'x:novel@mmol/L']);
      expect(built.map((each) => each.points[0]?.value)).toEqual([1, 2]);
    });

    it('makes “no unit” its own group for an unknown marker', () => {
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [measurement('x:novel', { value: 1, unit: '%' })]),
          report('r2', MAY, [measurement('x:novel', { value: 2 })]),
        ]),
      );

      expect(built.map((each) => each.id)).toEqual(['x:novel@%', 'x:novel@none']);
      expect(built[1]?.unit).toBeNull();
    });

    it('never mixes two normalised units in one series', () => {
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [measurement('ferritin', { value: 45, unit: 'ng/mL' })]),
          report('r2', MARCH, [measurement('ferritin', { value: 99, unit: 'mm' })]),
          report('r3', MAY, [measurement('ferritin', { value: 50, unit: 'ng/mL' })]),
        ]),
      );

      for (const series of built) {
        const units = new Set(
          series.points.map((point) =>
            point.nativeUnit === null ? null : normaliseUnit(point.nativeUnit),
          ),
        );
        expect(units.size).toBe(1);
      }
    });

    it('never splits a marker on a measurement that carries no value', () => {
      // A blank result cell has no unit to reconcile. Splitting on its absence
      // would strand the gap in a series of its own — and the gap is the point.
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [measurement('glucose', { value: 89, unit: 'mg/dL' })]),
          report('r2', MAY, [
            measurement('glucose', { status: 'missing', value: null, unit: null }),
          ]),
        ]),
      );

      expect(built).toHaveLength(1);
      expect(built[0]?.points.map((each) => each.status)).toEqual(['value', 'missing']);
    });
  });

  describe('measurements that are not numbers', () => {
    it('keeps a categorical result unconverted, in the unitless group (D15)', () => {
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [
            measurement('urine-glucose', {
              status: 'categorical',
              value: null,
              textValue: 'Αρνητικό',
              categoricalReference: 'Αρνητικό',
            }),
          ]),
        ]),
      );

      expect(built[0]).toMatchObject({ id: 'urine-glucose@none', unit: null });
      expect(built[0]?.points[0]).toMatchObject({
        status: 'categorical',
        value: null,
        textValue: 'Αρνητικό',
        categoricalReference: 'Αρνητικό',
      });
    });

    it('keeps a printed range beside a missing result', () => {
      const range = { kind: 'closed', min: 0.5, max: 2.5 } as const;
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [
            measurement('reticulocytes', { status: 'missing', value: null, referenceRange: range }),
          ]),
        ]),
      );

      expect(built[0]?.points[0]).toMatchObject({
        status: 'missing',
        value: null,
        comparator: null,
        referenceRange: range,
      });
    });

    it('synthesises no point for a Report that did not report the marker', () => {
      // The gap is a fact about the document, not a value to interpolate.
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [measurement('glucose', { unit: 'mg/dL' })]),
          report('r2', MAY, [measurement('urea', { unit: 'mg/dL' })]),
        ]),
      );

      expect(built.map((each) => each.points.length)).toEqual([1, 1]);
      expect(built[0]?.points.map((each) => each.reportId)).toEqual(['r1']);
    });
  });

  describe('the series it names', () => {
    it('names a canonical marker from the registry, not from source text', () => {
      // The printed label is deliberately not persisted for a canonical
      // Measurement (D7), so the registry is the only name there is.
      const built = buildSeries(
        profile([report('r1', JANUARY, [measurement('glucose', { unit: 'mg/dL' })])]),
      );

      expect(built[0]?.label).toBe('Glucose');
    });

    it('names an unknown marker with the label the user approved', () => {
      const built = buildSeries(
        profile([
          report('r1', JANUARY, [measurement('x:novel', { label: 'Νεοδείκτης (ND)', unit: '%' })]),
        ]),
      );

      expect(built[0]?.label).toBe('Νεοδείκτης (ND)');
    });

    it('identifies a series by its marker and its unit', () => {
      const built = buildSeries(
        profile([report('r1', JANUARY, [measurement('glucose', { unit: 'mg/dL' })])]),
      );

      expect(built[0]?.id).toBe('glucose@mg/dL');
    });
  });
});

describe('the seed documents', () => {
  it('never mixes two normalised units in one series', () => {
    // The load-bearing invariant (D12), asserted on the real documents rather
    // than only on tables written to make it true.
    for (const series of buildSeries(seedProfile())) {
      const units = new Set(
        series.points.map((point) =>
          point.nativeUnit === null ? null : normaliseUnit(point.nativeUnit),
        ),
      );

      expect(units.size, `${series.id} mixes ${[...units].join(', ')}`).toBeLessThanOrEqual(1);
    }
  });

  it('aligns the markers both documents report into one series each', () => {
    // The two seed laboratories share the CBC and print it differently —
    // `k/μl` against `x10^3 / μL`, comma decimals against period ones. Every
    // one of them still lands on a single axis.
    const built = buildSeries(seedProfile());
    const shared = built.filter((series) => series.points.length > 1);

    expect(shared.length).toBeGreaterThan(10);
    expect(shared.every((series) => series.points.length === 2)).toBe(true);
    expect(
      shared.every((series) =>
        series.points.every(
          (point, index) => index === 0 || point.collectedAt.date >= '2024-07-08',
        ),
      ),
    ).toBe(true);
  });

  it('keeps the urine panel as unitless categorical series', () => {
    const urine = buildSeries(seedProfile()).filter((series) =>
      series.markerKey.startsWith('urine-'),
    );

    expect(urine.some((series) => series.points[0]?.status === 'categorical')).toBe(true);
    expect(urine.filter((series) => series.unit !== null)).toEqual([]);
  });

  it('no longer carries the pH gloss as a unit', () => {
    // `Αντίδραση PH` prints `6.3 Όξινη`. D15 takes the number and discards the
    // gloss; the read-out used to store it as the unit because the outward
    // search read the token after the number, and it surfaced here. Reading
    // the unit from the column Pass V bound closes it — the urine pH row
    // prints nothing in that column, so the series has no unit at all.
    const ph = buildSeries(seedProfile()).find((series) => series.markerKey === 'urine-ph');

    expect(ph).toMatchObject({ unit: null });
    expect(ph?.points[0]).toMatchObject({ value: 6.3, nativeUnit: null });
  });
});
