import type { CollectedAt, ReferenceRange, Series, SeriesPoint } from '../domain/types';
import { civilMillis, trendGeometry } from './trendGeometry';

/**
 * The Trend view's positions, as tables.
 *
 * Positions are fractions of the plot, so every expectation here is a number
 * that can be read off the input by hand — which is the point of computing
 * them away from the SVG that draws them.
 */

function day(date: string): CollectedAt {
  return { date, time: null, precision: 'day' };
}

function minute(date: string, time: string): CollectedAt {
  return { date, time, precision: 'minute' };
}

function point(collectedAt: CollectedAt, overrides: Partial<SeriesPoint> = {}): SeriesPoint {
  return {
    reportId: `rep-${collectedAt.date}`,
    collectedAt,
    status: 'value',
    value: 10,
    comparator: null,
    textValue: null,
    referenceRange: null,
    categoricalReference: null,
    nativeValue: 10,
    nativeUnit: 'mg/dL',
    nativeReferenceRange: null,
    ...overrides,
  };
}

function series(points: SeriesPoint[]): Series {
  return { id: 'glucose@mg/dL', markerKey: 'glucose', label: 'Glucose', unit: 'mg/dL', points };
}

function closed(min: number, max: number): ReferenceRange {
  return { kind: 'closed', min, max };
}

describe('time along x', () => {
  it('spaces points by elapsed time, not by their position in the array', () => {
    // 1 January, 2 January, 1 February: the first gap is one day of thirty-one.
    const geometry = trendGeometry(
      series([point(day('2025-01-01')), point(day('2025-01-02')), point(day('2025-02-01'))]),
    );

    expect(geometry.points.map((each) => each.x)).toEqual([0, 1 / 31, 1]);
  });

  it('reads a day-precision report at local noon, so it cannot slide onto another day', () => {
    const noon = new Date('2025-03-09T12:00:00').getTime();

    expect(civilMillis(day('2025-03-09'))).toBe(noon);
  });

  it('keeps two reports on one day in the order their minutes give', () => {
    const geometry = trendGeometry(
      series([point(minute('2025-01-01', '08:00')), point(minute('2025-01-01', '20:00'))]),
    );

    expect(geometry.points.map((each) => each.x)).toEqual([0, 1]);
  });

  it('centres a series with nothing to be proportional to', () => {
    expect(trendGeometry(series([point(day('2025-01-01'))])).points[0]?.x).toBe(0.5);
    expect(
      trendGeometry(
        series([point(minute('2025-01-01', '08:00')), point(minute('2025-01-01', '08:00'))]),
      ).points.map((each) => each.x),
    ).toEqual([0.5, 0.5]);
  });
});

describe('the stepped reference band', () => {
  it('holds each printed range until the next report, and no further', () => {
    const geometry = trendGeometry(
      series([
        point(day('2025-01-01'), { referenceRange: closed(70, 105) }),
        point(day('2025-01-03'), { referenceRange: closed(70, 110) }),
      ]),
    );

    // The first range fills the left padding, the last runs to the right edge,
    // and the step between them happens at the report that changed it.
    expect(geometry.bands.map((band) => [band.from, band.to])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it('steps at each report when there are three of them', () => {
    const geometry = trendGeometry(
      series([
        point(day('2025-01-01'), { referenceRange: closed(70, 105) }),
        point(day('2025-01-02'), { referenceRange: closed(70, 110) }),
        point(day('2025-01-03'), { referenceRange: closed(70, 120) }),
      ]),
    );

    expect(geometry.bands.map((band) => [band.from, band.to])).toEqual([
      [0, 0.5],
      [0.5, 1],
      [1, 1],
    ]);
  });

  it('opens a gap where a report printed no range, and restarts at the next that did', () => {
    const geometry = trendGeometry(
      series([
        point(day('2025-01-01'), { referenceRange: closed(70, 105) }),
        point(day('2025-01-02'), { referenceRange: null }),
        point(day('2025-01-03'), { referenceRange: closed(70, 110) }),
      ]),
    );

    expect(geometry.bands.map((band) => [band.from, band.to])).toEqual([
      [0, 0.5],
      [1, 1],
    ]);
  });

  it('leaves the left padding unshaded when the first report printed no range', () => {
    const geometry = trendGeometry(
      series([
        point(day('2025-01-01'), { referenceRange: null }),
        point(day('2025-01-03'), { referenceRange: closed(70, 105) }),
      ]),
    );

    expect(geometry.bands).toHaveLength(1);
    expect(geometry.bands[0]?.from).toBe(1);
  });

  it('shades only the side a one-sided range bounds', () => {
    const geometry = trendGeometry(
      series([
        point(day('2025-01-01'), {
          value: 50,
          referenceRange: { kind: 'minOnly', min: 40, comparator: '>=' },
        }),
      ]),
    );

    expect(geometry.bands[0]?.high).toBe(1);
    expect(geometry.bands[0]?.low).toBeGreaterThan(0);

    const above = trendGeometry(
      series([
        point(day('2025-01-01'), {
          value: 3,
          referenceRange: { kind: 'maxOnly', max: 5, comparator: '<' },
        }),
      ]),
    );

    expect(above.bands[0]?.low).toBe(0);
    expect(above.bands[0]?.high).toBeLessThan(1);
  });
});

describe('what the line may join', () => {
  it('joins consecutive exact points', () => {
    const geometry = trendGeometry(
      series([point(day('2025-01-01')), point(day('2025-01-02')), point(day('2025-01-03'))]),
    );

    expect(geometry.lines).toEqual([[0, 1, 2]]);
  });

  it('breaks at a missing report rather than interpolating across it', () => {
    const geometry = trendGeometry(
      series([
        point(day('2025-01-01')),
        point(day('2025-01-02'), { status: 'missing', value: null }),
        point(day('2025-01-03')),
      ]),
    );

    expect(geometry.lines).toEqual([]);
    expect(geometry.points[1]).toMatchObject({ kind: 'missing', y: null });
  });

  it('leaves a censored point off the line, since a bound is not a measurement', () => {
    const geometry = trendGeometry(
      series([
        point(day('2025-01-01')),
        point(day('2025-01-02'), { value: 0.1, comparator: '<' }),
        point(day('2025-01-03')),
        point(day('2025-01-04')),
      ]),
    );

    expect(geometry.lines).toEqual([[2, 3]]);
    expect(geometry.points[1]).toMatchObject({ kind: 'censored', status: 'unavailable' });
    // It still has a position: the bound it was reported at.
    expect(geometry.points[1]?.y).not.toBeNull();
  });

  it('draws no line for a single exact point', () => {
    expect(trendGeometry(series([point(day('2025-01-01'))])).lines).toEqual([]);
  });
});

describe('the y window', () => {
  it('includes the printed bounds, so a band is never off-screen', () => {
    const geometry = trendGeometry(
      series([point(day('2025-01-01'), { value: 200, referenceRange: closed(70, 105) })]),
    );
    const [low, high] = geometry.domain;

    expect(low).toBeLessThan(70);
    expect(high).toBeGreaterThan(200);
  });

  it('gives a flat series a window of its own rather than a degenerate one', () => {
    const geometry = trendGeometry(
      series([point(day('2025-01-01'), { value: 10 }), point(day('2025-01-02'), { value: 10 })]),
    );

    expect(geometry.domain[1]).toBeGreaterThan(geometry.domain[0]);
    expect(geometry.points.every((each) => each.y === 0.5)).toBe(true);
  });

  it('reports a series with nothing quantifiable as empty, and places no point', () => {
    const geometry = trendGeometry(
      series([
        point(day('2025-01-01'), { status: 'missing', value: null }),
        point(day('2025-01-02'), { status: 'missing', value: null }),
      ]),
    );

    expect(geometry.empty).toBe(true);
    expect(geometry.points.every((each) => each.y === null)).toBe(true);
  });
});

describe('direct labels', () => {
  it('labels the first and last quantifiable points only', () => {
    const geometry = trendGeometry(
      series([point(day('2025-01-01')), point(day('2025-02-01')), point(day('2025-03-01'))]),
    );

    expect(geometry.points.map((each) => each.labelled)).toEqual([true, false, true]);
  });

  it('drops the first label when the two would share the same space', () => {
    const geometry = trendGeometry(
      series([
        point(day('2025-01-01')),
        point(day('2025-01-02')),
        point(day('2025-03-01'), { status: 'missing', value: null }),
      ]),
    );

    // The two quantifiable points sit a day apart in a two-month plot.
    expect(geometry.points.map((each) => each.labelled)).toEqual([false, true, false]);
  });

  it('labels one point once when it is both the first and the last', () => {
    const geometry = trendGeometry(
      series([
        point(day('2025-01-01')),
        point(day('2025-02-01'), { status: 'missing', value: null }),
      ]),
    );

    expect(geometry.points.map((each) => each.labelled)).toEqual([true, false]);
  });
});

describe('status per point', () => {
  it('reads each point against the range printed on its own report', () => {
    const geometry = trendGeometry(
      series([
        point(day('2025-01-01'), { value: 90, referenceRange: closed(70, 105) }),
        point(day('2025-01-02'), { value: 200, referenceRange: closed(70, 105) }),
        point(day('2025-01-03'), { value: 200, referenceRange: closed(70, 300) }),
      ]),
    );

    // The third point is higher than the first and inside its own range: the
    // chart compares a value to its report, never to another report.
    expect(geometry.points.map((each) => each.status)).toEqual(['within', 'above', 'within']);
  });
});
