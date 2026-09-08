// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { CollectedAt, Measurement, Profile, ReferenceRange, Report } from '../domain/types';
import { PanelView } from './PanelView';

/**
 * The Panel view as a reader meets it.
 *
 * The arithmetic has its own table in `panelMeter.test.ts`; what is asserted
 * here is everything a person would notice — what each row says, in what
 * order, and what it refuses to say. The D13 rule is testable and is tested:
 * no row may carry a word about severity, and nothing may draw a position for
 * a value the laboratory did not pin down.
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

const DAY: CollectedAt = { date: '2025-05-14', time: null, precision: 'day' };

function measurement(markerKey: string, overrides: Partial<Measurement> = {}): Measurement {
  return {
    markerKey,
    status: 'value',
    value: 10,
    comparator: null,
    textValue: null,
    unit: 'mg/dL',
    referenceRange: null,
    categoricalReference: null,
    sourceOrder: 0,
    ...overrides,
  };
}

function closed(min: number, max: number): ReferenceRange {
  return { kind: 'closed', min, max };
}

function report(id: string, measurements: Measurement[], collectedAt: CollectedAt = DAY): Report {
  return { id, collectedAt, measurements };
}

function profileOf(reports: Report[]): Profile {
  return { schemaVersion: 1, id: 'profile-1', reports };
}

interface Options {
  profile?: Profile;
  reportId?: string;
  onSelectReport?: (reportId: string) => void;
  onSelectSeries?: (seriesId: string) => void;
}

function mount(options: Options = {}): void {
  const profile = options.profile ?? profileOf([report('rep-1', [measurement('glucose')])]);
  void act(() => {
    render(
      <PanelView
        profile={profile}
        reportId={options.reportId ?? profile.reports[0]?.id ?? ''}
        onSelectReport={options.onSelectReport ?? ((): undefined => undefined)}
        onSelectSeries={options.onSelectSeries ?? ((): undefined => undefined)}
      />,
      host,
    );
  });
}

function find(testId: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

function all(testId: string): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
}

function text(testId: string): string {
  return find(testId)?.textContent.replace(/\s+/gu, ' ').trim() ?? '';
}

function rowIds(): string[] {
  return [...host.querySelectorAll<HTMLElement>('[data-testid^="panel-row-"]')].map(
    (each) => each.getAttribute('data-testid') ?? '',
  );
}

describe('what a row says', () => {
  it('states the value, the unit and the range the laboratory printed', () => {
    mount({
      profile: profileOf([
        report('rep-1', [measurement('glucose', { value: 92, referenceRange: closed(70, 105) })]),
      ]),
    });

    expect(text('row-name')).toBe('Γλυκόζη');
    expect(text('row-value')).toBe('92 mg/dL');
    expect(text('row-range')).toBe('70–105');
    expect(text('row-status')).toContain('εντός των τιμών αναφοράς');
  });

  it('renders a missing result as a dash, not a zero, and keeps its range', () => {
    mount({
      profile: profileOf([
        report('rep-1', [
          measurement('glucose', {
            status: 'missing',
            value: null,
            referenceRange: closed(70, 105),
          }),
        ]),
      ]),
    });

    expect(text('row-value')).toBe('— mg/dL');
    expect(text('row-range')).toBe('70–105');
    expect(find('row-meter')).toBeNull();
  });

  it('prints a categorical result and the string the laboratory expected', () => {
    mount({
      profile: profileOf([
        report('rep-1', [
          measurement('urine-glucose', {
            status: 'categorical',
            value: null,
            unit: null,
            textValue: 'Αρνητικό',
            categoricalReference: 'Αρνητικό',
          }),
        ]),
      ]),
    });

    expect(text('row-value')).toBe('Αρνητικό');
    expect(text('row-range')).toBe('Αρνητικό');
    expect(text('row-status')).toContain('χωρίς σύγκριση');
  });

  it('says a comparison cannot be made for a censored value, and draws no dot', () => {
    mount({
      profile: profileOf([
        report('rep-1', [
          measurement('ferritin', {
            value: 0.1,
            comparator: '<',
            referenceRange: closed(30, 400),
          }),
        ]),
      ]),
    });

    expect(text('row-value')).toBe('<0.1 mg/dL');
    expect(text('row-status')).toContain('χωρίς σύγκριση');
    expect(find('row-meter')).toBeNull();
  });

  it('says so when no range was printed', () => {
    mount();

    expect(text('row-range')).toContain('δεν τύπωσε τιμές αναφοράς');
    expect(find('row-meter')).toBeNull();
  });

  it('carries status in words and an icon, never in colour alone', () => {
    mount({
      profile: profileOf([
        report('rep-1', [measurement('glucose', { value: 200, referenceRange: closed(70, 105) })]),
      ]),
    });
    const status = find('row-status');

    expect(status?.getAttribute('data-status')).toBe('above');
    expect(status?.textContent).toContain('↑');
    expect(status?.textContent).toContain('πάνω από τις τιμές αναφοράς');
  });

  it('never characterises a value beyond the range that was printed', () => {
    mount({
      profile: profileOf([
        report('rep-1', [measurement('glucose', { value: 400, referenceRange: closed(70, 105) })]),
      ]),
    });

    // D13: no severity, no judgement, no distance-outside heuristic.
    expect(text('panel-rows')).not.toMatch(/υψηλ|χαμηλ|κίνδυν|σοβαρ|φυσιολογικ/iu);
  });
});

describe('the meter', () => {
  it('draws the band the printed range describes', () => {
    mount({
      profile: profileOf([
        report('rep-1', [measurement('glucose', { value: 92, referenceRange: closed(70, 105) })]),
      ]),
    });
    const meter = find('row-meter');

    expect(meter?.getAttribute('data-kind')).toBe('closed');
    expect(meter?.getAttribute('data-clamped')).toBe('none');
    expect(meter?.querySelector('circle')).not.toBeNull();
  });

  it('turns a value outside its own domain into an end arrow', () => {
    mount({
      profile: profileOf([
        report('rep-1', [measurement('glucose', { value: 900, referenceRange: closed(70, 105) })]),
      ]),
    });

    expect(find('row-meter')?.getAttribute('data-clamped')).toBe('high');
    expect(find('row-meter')?.querySelector('polygon')).not.toBeNull();
    expect(find('row-meter')?.querySelector('circle')).toBeNull();
  });

  it('is hidden from assistive technology, which reads the sentence instead', () => {
    mount({
      profile: profileOf([
        report('rep-1', [measurement('glucose', { value: 92, referenceRange: closed(70, 105) })]),
      ]),
    });

    expect(find('row-meter')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('reading order', () => {
  it('puts what the printed range put outside first, then source order, then missing', () => {
    mount({
      profile: profileOf([
        report('rep-1', [
          measurement('glucose', { sourceOrder: 0, value: 92, referenceRange: closed(70, 105) }),
          measurement('ferritin', { sourceOrder: 1, status: 'missing', value: null }),
          measurement('urea', { sourceOrder: 2, value: 5, referenceRange: closed(17, 43) }),
          measurement('creatinine', {
            sourceOrder: 3,
            value: 0.9,
            referenceRange: closed(0.5, 1.1),
          }),
        ]),
      ]),
    });

    expect(rowIds()).toEqual([
      'panel-row-urea',
      'panel-row-glucose',
      'panel-row-creatinine',
      'panel-row-ferritin',
    ]);
  });

  it('keeps a missing row visible and tappable', () => {
    const chosen: string[] = [];
    mount({
      profile: profileOf([
        report('rep-1', [measurement('glucose', { status: 'missing', value: null })]),
      ]),
      onSelectSeries: (id) => chosen.push(id),
    });

    void act(() => {
      find('panel-row-glucose')?.click();
    });

    expect(chosen).toEqual(['glucose@mg/dL']);
  });
});

describe('choosing what to look at', () => {
  const twoReports = profileOf([
    report('rep-1', [measurement('glucose', { value: 92 })]),
    report('rep-2', [measurement('glucose', { value: 88 })], {
      date: '2025-08-01',
      time: null,
      precision: 'day',
    }),
  ]);

  it('offers every stored Report and marks the one on screen', () => {
    mount({ profile: twoReports, reportId: 'rep-2' });

    expect(all('panel-reports')).toHaveLength(1);
    expect(find('select-report-rep-2')?.getAttribute('aria-current')).toBe('true');
    expect(find('select-report-rep-1')?.getAttribute('aria-current')).toBeNull();
  });

  it('asks the parent to change Report rather than changing it itself', () => {
    const asked: string[] = [];
    mount({ profile: twoReports, reportId: 'rep-2', onSelectReport: (id) => asked.push(id) });

    void act(() => {
      find('select-report-rep-1')?.click();
    });

    expect(asked).toEqual(['rep-1']);
    // Still showing what it was given: the parent owns the selection.
    expect(find('select-report-rep-2')?.getAttribute('aria-current')).toBe('true');
  });

  it('opens the series the row belongs to', () => {
    const chosen: string[] = [];
    mount({
      profile: profileOf([report('rep-1', [measurement('glucose', { value: 92, unit: 'mg/dL' })])]),
      onSelectSeries: (id) => chosen.push(id),
    });

    void act(() => {
      find('panel-row-glucose')?.click();
    });

    expect(chosen).toEqual(['glucose@mg/dL']);
  });

  it('names the unit and warns when one marker was reported in two of them', () => {
    // An unknown marker has no canonical unit to fold into, so two printed
    // units are two Series. Overlaying them would put two quantities on one
    // axis, which is the one thing a split must never become.
    const split = profileOf([
      report('rep-1', [measurement('x:kappa', { value: 1, unit: 'mg/dL' })]),
      report('rep-2', [measurement('x:kappa', { value: 2, unit: 'g/L' })], {
        date: '2025-08-01',
        time: null,
        precision: 'day',
      }),
    ]);
    mount({ profile: split, reportId: 'rep-1' });

    expect(text('row-name')).toContain('(mg/dL)');
    expect(text('row-split-unit')).toContain('δεν συγχωνεύονται');
  });

  it('does not warn about a marker the registry folded into one unit', () => {
    const folded = profileOf([
      report('rep-1', [measurement('glucose', { value: 92, unit: 'mg/dL' })]),
      report('rep-2', [measurement('glucose', { value: 5, unit: 'mmol/L' })], {
        date: '2025-08-01',
        time: null,
        precision: 'day',
      }),
    ]);
    mount({ profile: folded, reportId: 'rep-1' });

    expect(find('row-split-unit')).toBeNull();
  });
});

describe('empty states', () => {
  it('says a Profile holds nothing yet', () => {
    mount({ profile: profileOf([]), reportId: '' });

    expect(text('panel-empty')).toContain('Δεν υπάρχει καμία αποθηκευμένη εξέταση');
    expect(rowIds()).toEqual([]);
  });

  it('says a stored Report holds no results', () => {
    mount({ profile: profileOf([report('rep-1', [])]) });

    expect(text('panel-empty-report')).toContain('δεν περιέχει κανένα αποτέλεσμα');
  });
});

describe('the standing disclaimer', () => {
  it('is present, and says what the product does and does not do', () => {
    mount();
    const disclaimer = text('panel-disclaimer');

    expect(disclaimer).toContain('Δεν τα ερμηνεύει');
    expect(disclaimer).toContain('δεν αποτελεί ιατρική συμβουλή');
  });
});
