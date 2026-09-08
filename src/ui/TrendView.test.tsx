// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { CollectedAt, ReferenceRange, Series, SeriesPoint } from '../domain/types';
import { TrendView } from './TrendView';

/**
 * The Trend view as a reader meets it.
 *
 * The positions are `trendGeometry`'s and are tested there. What is asserted
 * here is what the view says: that the table carries every value the plot
 * draws, that a bound is never drawn as a measurement, and that no word in the
 * view characterises the shape of the line (D13).
 */

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function day(date: string): CollectedAt {
  return { date, time: null, precision: 'day' };
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

function closed(min: number, max: number): ReferenceRange {
  return { kind: 'closed', min, max };
}

function series(points: SeriesPoint[], overrides: Partial<Series> = {}): Series {
  return {
    id: 'glucose@mg/dL',
    markerKey: 'glucose',
    label: 'Glucose',
    unit: 'mg/dL',
    points,
    ...overrides,
  };
}

function mount(current: Series, onBack: () => void = (): undefined => undefined): void {
  void act(() => {
    render(<TrendView series={current} onBack={onBack} />, host);
  });
}

function find(testId: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

function all(selector: string): Element[] {
  return [...host.querySelectorAll(selector)];
}

function text(testId: string): string {
  return find(testId)?.textContent.replace(/\s+/gu, ' ').trim() ?? '';
}

function click(testId: string): void {
  void act(() => {
    find(testId)?.click();
  });
}

describe('what the chart draws', () => {
  const twoPoints = series([
    point(day('2025-01-01'), { value: 92, referenceRange: closed(70, 105) }),
    point(day('2025-03-01'), { value: 120, referenceRange: closed(70, 105) }),
  ]);

  it('names the marker and its unit, and never a direction', () => {
    mount(twoPoints);

    expect(text('trend-title')).toBe('Γλυκόζη (mg/dL)');
    expect(text('trend')).not.toMatch(/αυξ|μειών|βελτ|χειροτ|τάση|ρυθμ/iu);
  });

  it('joins the exact points with one line', () => {
    mount(twoPoints);

    expect(all('polyline.trend-line')).toHaveLength(1);
  });

  it('draws the range the laboratory printed as a band', () => {
    mount(twoPoints);

    expect(all('rect.trend-band').length).toBeGreaterThan(0);
  });

  it('breaks the line at a report that carried no value', () => {
    mount(
      series([
        point(day('2025-01-01')),
        point(day('2025-02-01'), { status: 'missing', value: null }),
        point(day('2025-03-01')),
      ]),
    );

    expect(all('polyline.trend-line')).toHaveLength(0);
    expect(find('trend-point-1')).toBeNull();
  });

  it('draws a censored result hollow, at its bound, with the comparator it was reported with', () => {
    mount(
      series([
        point(day('2025-01-01'), { value: 0.1, comparator: '<', referenceRange: closed(1, 5) }),
        point(day('2025-02-01'), { value: 3 }),
      ]),
    );
    const censored = find('trend-point-0');

    expect(censored?.getAttribute('data-kind')).toBe('censored');
    expect(censored?.querySelector('circle.trend-mark-hollow')).not.toBeNull();
    expect(censored?.textContent).toContain('<');
    expect(censored?.querySelector('title')?.textContent).toContain('ακριβής τιμή είναι άγνωστη');
    // A bound is not a measurement, so nothing joins it to the next point.
    expect(all('polyline.trend-line')).toHaveLength(0);
  });

  it('labels the first and last quantifiable points, not every one', () => {
    mount(series([point(day('2025-01-01')), point(day('2025-02-01')), point(day('2025-03-01'))]));

    expect(find('trend-label-0')).not.toBeNull();
    expect(find('trend-label-1')).toBeNull();
    expect(find('trend-label-2')).not.toBeNull();
  });

  it('says so when a marker has no reported value at all', () => {
    mount(
      series([
        point(day('2025-01-01'), { status: 'missing', value: null }),
        point(day('2025-02-01'), { status: 'missing', value: null }),
      ]),
    );

    expect(text('trend-no-values')).toContain('Καμία καταγεγραμμένη τιμή');
    expect(all('circle.trend-mark')).toHaveLength(0);
  });

  it('draws a single reported value as a dot with no line', () => {
    mount(series([point(day('2025-01-01'), { value: 92, referenceRange: closed(70, 105) })]));

    expect(all('circle.trend-mark')).toHaveLength(1);
    expect(all('polyline.trend-line')).toHaveLength(0);
    expect(all('rect.trend-band')).toHaveLength(1);
  });
});

describe('the table', () => {
  it('carries every point the plot has, in the five stated columns', () => {
    mount(
      series([
        point(day('2025-01-01'), { value: 92, referenceRange: closed(70, 105) }),
        point(day('2025-02-01'), { value: 0.1, comparator: '<' }),
        point(day('2025-03-01'), { status: 'missing', value: null }),
      ]),
    );

    click('trend-table-toggle');

    const rows = all('[data-testid="trend-row"]');
    expect(rows).toHaveLength(3);
    expect(all('[data-testid="trend-table"] thead th').map((each) => each.textContent)).toEqual([
      'Ημερομηνία',
      'Τιμή που αναφέρθηκε',
      'Μονάδα',
      'Τιμές αναφοράς',
      'Σύγκριση',
    ]);
    expect(rows[0]?.textContent).toContain('92');
    expect(rows[0]?.textContent).toContain('70–105');
    expect(rows[0]?.textContent).toContain('εντός των τιμών αναφοράς');
    // A bound and a missing report are printed as what they are.
    expect(rows[1]?.textContent).toContain('<0.1');
    expect(rows[1]?.textContent).toContain('χωρίς σύγκριση');
    expect(rows[2]?.textContent).toContain('—');
  });

  it('replaces the figure rather than sitting beside it', () => {
    mount(series([point(day('2025-01-01'))]));
    expect(find('trend-figure')).not.toBeNull();

    click('trend-table-toggle');

    expect(find('trend-figure')).toBeNull();
    expect(find('trend-table')).not.toBeNull();
  });
});

describe('the frame around it', () => {
  it('labels the figure with its title and summary rather than leaving the SVG bare', () => {
    mount(series([point(day('2025-01-01'))]));

    expect(find('trend-figure')?.getAttribute('aria-labelledby')).toBe('trend-title trend-summary');
    expect(find('trend-plot')?.getAttribute('role')).toBe('img');
  });

  it('carries the standing disclaimer, and hands Back to the parent', () => {
    let back = 0;
    mount(series([point(day('2025-01-01'))]), () => {
      back += 1;
    });

    expect(text('trend-disclaimer')).toContain('δεν αποτελεί ιατρική συμβουλή');

    click('trend-back');

    expect(back).toBe(1);
  });
});
