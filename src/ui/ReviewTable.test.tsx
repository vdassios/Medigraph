// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { canConfirm } from '../domain/review';
import type {
  CollectedAt,
  Conflict,
  ExtractionResult,
  IdentifierCandidate,
  ParsedRow,
  Profile,
  Report,
  ReviewReportDraft,
  ReviewSession,
} from '../domain/types';
import type { EvidenceLookup } from './appState';
import { ReviewTable } from './ReviewTable';

/**
 * The review screen, driven the way a person drives it.
 *
 * Every test below asserts one of two things: that a gate refuses Confirm
 * until it is answered, or that answering it goes through the domain rather
 * than around it. The second is what makes the first worth anything — a screen
 * that built its own sessions could satisfy `canConfirm` while writing
 * something else.
 */

const DAY: CollectedAt = { date: '2025-05-14', time: null, precision: 'day' };

let host: HTMLDivElement;
let sessions: ReviewSession[];

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  sessions = [];
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function row(id: string, markerKey: string, overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    id,
    label: `Ετικέτα ${id}`,
    markerKey,
    status: 'value',
    value: 1,
    comparator: null,
    textValue: null,
    unit: 'mg/dL',
    referenceRange: null,
    categoricalReference: null,
    confidence: 'high',
    source: 'anchor',
    section: null,
    flags: [],
    sourceOrder: 0,
    ...overrides,
  };
}

function draft(overrides: Partial<ReviewReportDraft> = {}): ReviewReportDraft {
  return {
    id: 'draft:s1',
    sourceIds: ['s1'],
    targetReportId: null,
    collectedAt: DAY,
    dateConfirmed: false,
    rows: [row('r1', 'glucose')],
    conflicts: [],
    ...overrides,
  };
}

function result(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    sourceId: 's1',
    adapterId: 'pdf-text',
    tier: 'E0',
    registryVersion: 2,
    rows: [],
    collectionDate: '2025-05-14',
    resultDate: null,
    identifierCandidates: [],
    unrecognised: [],
    evidenceAvailable: true,
    ...overrides,
  };
}

function session(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    id: 'review:s1',
    results: [result()],
    reportDrafts: [draft()],
    identifierResolutions: {},
    approvedUnknownRowIds: [],
    existingReportDateUpdates: {},
    samePersonConfirmed: null,
    ...overrides,
  };
}

function profile(reports: Report[]): Profile {
  return { schemaVersion: 1, id: 'profile-1', reports };
}

const EVIDENCE: EvidenceLookup = {
  kind: 'evidence',
  resource: {
    file: new File([], 'εξετάσεις.pdf', { type: 'application/pdf' }),
    objectUrls: new Set(),
    bitmaps: new Set(),
  },
  page: 1,
};

interface Options {
  session?: ReviewSession;
  existingProfile?: Profile | null;
  lookup?: EvidenceLookup;
  onConfirm?: () => void;
  onCancel?: () => void;
}

/**
 * Mount the table, and re-render it with whatever session it hands back.
 *
 * The component is controlled: it owns no session, so a test that swallowed
 * `onChange` would be asserting against a screen frozen at its first render.
 */
function mount(options: Options = {}): void {
  const existingProfile = options.existingProfile ?? null;
  const paint = (current: ReviewSession): void => {
    void act(() => {
      render(
        <ReviewTable
          session={current}
          existingProfile={existingProfile}
          onChange={(next) => {
            sessions.push(next);
            paint(next);
          }}
          onInspectSource={() => options.lookup ?? EVIDENCE}
          onConfirm={options.onConfirm ?? ((): undefined => undefined)}
          onCancel={options.onCancel ?? ((): undefined => undefined)}
        />,
        host,
      );
    });
  };

  paint(options.session ?? session());
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

function click(testId: string): void {
  void act(() => {
    find(testId)?.click();
  });
}

function type(testId: string, value: string): void {
  const field = find(testId) as HTMLInputElement | HTMLSelectElement | null;
  if (field === null) {
    throw new Error(`no field ${testId}`);
  }
  void act(() => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** The session as it stands after every change the screen has handed upward. */
function current(fallback: ReviewSession): ReviewSession {
  return sessions.at(-1) ?? fallback;
}

function confirmEnabled(): boolean {
  return !(find('confirm') as HTMLButtonElement).disabled;
}

describe('the date gate (D6)', () => {
  it('holds Confirm until the pre-filled date is confirmed', () => {
    mount();
    expect(confirmEnabled()).toBe(false);
    expect(text('blockers')).toContain('1 ημερομηνίες');

    click('confirm-date');

    expect(current(session()).reportDrafts[0]?.dateConfirmed).toBe(true);
    expect(confirmEnabled()).toBe(true);
  });

  it('reopens the question when the date is edited, and refuses the unsaved edit', () => {
    mount();
    click('confirm-date');
    expect(confirmEnabled()).toBe(true);

    type('draft-date', '2025-06-01');

    // The typed date is not in the session yet, so Confirm would write the old
    // one. The screen refuses rather than committing what is not on screen.
    expect(confirmEnabled()).toBe(false);
    expect(text('blockers')).toContain('δεν έχουν αποθηκευτεί');

    click('confirm-date');

    expect(current(session()).reportDrafts[0]?.collectedAt).toEqual({
      date: '2025-06-01',
      time: null,
      precision: 'day',
    });
    expect(confirmEnabled()).toBe(true);
  });

  it('records a time as minute precision, which is what a shared day needs', () => {
    mount();
    type('draft-time', '09:30');
    click('confirm-date');

    expect(current(session()).reportDrafts[0]?.collectedAt).toEqual({
      date: '2025-05-14',
      time: '09:30',
      precision: 'minute',
    });
  });
});

describe('the identifier gate (D7)', () => {
  const candidate: IdentifierCandidate = {
    id: 'cand-1',
    kind: 'national-id',
    text: '12345678901',
    knownPosition: false,
  };

  function withCandidate(rows: ParsedRow[] = [row('r1', 'glucose')]): ReviewSession {
    return session({
      results: [result({ identifierCandidates: [candidate] })],
      reportDrafts: [draft({ dateConfirmed: true, rows })],
    });
  }

  it('shows every candidate and holds Confirm until each is answered', () => {
    mount({ session: withCandidate() });

    expect(text('identifier-text')).toBe('12345678901');
    expect(confirmEnabled()).toBe(false);
    expect(text('blockers')).toContain('1 προσωπικά στοιχεία');

    click('redact-identifier');

    expect(current(withCandidate()).identifierResolutions['cand-1']).toBe('redacted');
    expect(confirmEnabled()).toBe(true);
  });

  it('redacts the text out of the rows that carry it', () => {
    const carrying = withCandidate([
      row('r1', 'x:kappa', { label: 'Ασθενής 12345678901' }),
      row('r2', 'glucose'),
    ]);
    mount({ session: carrying });

    click('redact-identifier');

    const rows = current(carrying).reportDrafts[0]?.rows ?? [];
    expect(rows[0]?.label).toBe('Ασθενής');
    expect(rows[1]?.label).toBe('Ετικέτα r2');
  });

  it('deletes the rows carrying it, and keeps their siblings', () => {
    const carrying = withCandidate([
      row('r1', 'x:kappa', { label: 'Ασθενής 12345678901' }),
      row('r2', 'glucose'),
    ]);
    mount({ session: carrying });

    click('delete-identifier-rows');

    const after = current(carrying);
    expect(after.reportDrafts[0]?.rows.map((each) => each.id)).toEqual(['r2']);
    expect(after.identifierResolutions['cand-1']).toBe('deleted-row');
  });

  it('records a false positive without touching a row', () => {
    const carrying = withCandidate();
    mount({ session: carrying });

    click('dismiss-identifier');

    const after = current(carrying);
    expect(after.identifierResolutions['cand-1']).toBe('false-positive');
    expect(after.reportDrafts[0]?.rows).toHaveLength(1);
  });

  it('always shows the free text an approved unknown label would store', () => {
    mount({
      session: session({
        reportDrafts: [
          draft({ dateConfirmed: true, rows: [row('r1', 'x:kappa', { label: 'Κάππα ουρίας' })] }),
        ],
      }),
    });

    expect(all('free-text-label').map((each) => each.textContent)).toEqual(['Κάππα ουρίας']);
  });
});

describe('unknown markers', () => {
  const unknown = session({
    reportDrafts: [draft({ dateConfirmed: true, rows: [row('r1', 'x:kappa')] })],
  });

  it('holds Confirm until the label is explicitly approved', () => {
    mount({ session: unknown });
    expect(confirmEnabled()).toBe(false);
    expect(text('blockers')).toContain('1 άγνωστοι δείκτες');

    click('approve-unknown');

    expect(current(unknown).approvedUnknownRowIds).toEqual(['r1']);
    expect(confirmEnabled()).toBe(true);
  });

  it('reassigns to a canonical marker found by search, which also clears the gate', () => {
    mount({ session: unknown });

    click('reassign-row');
    type('reassign-search', 'γλυκόζη');
    click('reassign-to-glucose');

    const rows = current(unknown).reportDrafts[0]?.rows ?? [];
    expect(rows[0]?.markerKey).toBe('glucose');
    expect(confirmEnabled()).toBe(true);
  });
});

describe('duplicate markers', () => {
  const conflict: Conflict = {
    id: 'draft:s1:conflict:glucose',
    markerKey: 'glucose',
    candidateRowIds: ['r1', 'r2'],
    resolution: null,
  };
  const duplicated = session({
    reportDrafts: [
      draft({
        dateConfirmed: true,
        rows: [row('r1', 'glucose', { value: 5 }), row('r2', 'glucose', { value: 6 })],
        conflicts: [conflict],
      }),
    ],
  });

  it('holds Confirm until one candidate is kept', () => {
    mount({ session: duplicated });
    expect(confirmEnabled()).toBe(false);

    click('resolve-conflict-glucose');

    expect(current(duplicated).reportDrafts[0]?.conflicts[0]?.resolution).toEqual({
      kind: 'choose',
      rowId: 'r1',
    });
    expect(confirmEnabled()).toBe(true);
  });

  it('lets the choice be withdrawn, which shuts Confirm again', () => {
    mount({ session: duplicated });
    click('resolve-conflict-glucose');

    click('change-conflict');

    expect(current(duplicated).reportDrafts[0]?.conflicts[0]?.resolution).toBeNull();
    expect(confirmEnabled()).toBe(false);
  });

  it('offers no choose control once the question is answered', () => {
    mount({ session: duplicated });
    click('resolve-conflict-glucose');

    expect(all('resolve-conflict-glucose')).toHaveLength(0);
  });
});

describe('correcting a row', () => {
  const flagged = session({
    reportDrafts: [
      draft({
        dateConfirmed: true,
        rows: [row('r1', 'glucose', { value: 990, flags: ['implausible-value'] })],
      }),
    ],
  });

  it('sends the corrected value through the domain and closes the editor', () => {
    mount({ session: flagged });

    click('edit-row');
    type('edit-value', '9,90');
    click('save-row');

    expect(current(flagged).reportDrafts[0]?.rows[0]?.value).toBe(9.9);
    expect(find('row-editor')).toBeNull();
  });

  it('reads a comparator the way the document prints it', () => {
    mount({ session: flagged });

    click('edit-row');
    type('edit-value', '<75');
    click('save-row');

    expect(current(flagged).reportDrafts[0]?.rows[0]).toMatchObject({
      value: 75,
      comparator: '<',
    });
  });

  it('refuses to save a numeric row with nothing numeric in it', () => {
    mount({ session: flagged });

    click('edit-row');
    type('edit-value', 'περίπου πέντε');

    expect((find('save-row') as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses Confirm while an edit is open and unsaved', () => {
    mount({ session: flagged });
    expect(confirmEnabled()).toBe(true);

    click('edit-row');
    type('edit-value', '9,90');

    expect(confirmEnabled()).toBe(false);

    click('cancel-row-edit');

    expect(confirmEnabled()).toBe(true);
    expect(current(flagged).reportDrafts[0]?.rows[0]?.value).toBe(990);
  });

  it('deletes a row outright', () => {
    mount({ session: flagged });

    click('delete-row');

    expect(current(flagged).reportDrafts[0]?.rows).toHaveLength(0);
  });
});

describe('the same-person gate (D8)', () => {
  const existing = profile([
    {
      id: 'rep-1',
      collectedAt: { date: '2025-01-02', time: null, precision: 'day' },
      measurements: [],
    },
  ]);
  const ready = session({ reportDrafts: [draft({ dateConfirmed: true })] });

  it('is absent when the Profile is empty', () => {
    mount({ session: ready });

    expect(find('same-person')).toBeNull();
    expect(confirmEnabled()).toBe(true);
  });

  it('holds Confirm until the user answers it', () => {
    mount({ session: ready, existingProfile: existing });
    expect(confirmEnabled()).toBe(false);
    expect(text('blockers')).toContain('ίδιο πρόσωπο');

    click('confirm-same-person');

    expect(current(ready).samePersonConfirmed).toBe(true);
    expect(confirmEnabled()).toBe(true);
  });

  it('can be withdrawn, which shuts Confirm again', () => {
    mount({ session: ready, existingProfile: existing });
    click('confirm-same-person');

    click('confirm-same-person');

    expect(current(ready).samePersonConfirmed).toBeNull();
    expect(confirmEnabled()).toBe(false);
  });
});

describe('two exams on one day', () => {
  const existing = profile([{ id: 'rep-1', collectedAt: DAY, measurements: [] }]);
  const ready = session({
    reportDrafts: [draft({ dateConfirmed: true })],
    samePersonConfirmed: true,
  });

  it('refuses both at day precision, and says which rule is unmet', () => {
    mount({ session: ready, existingProfile: existing });

    expect(canConfirm(ready, existing)).toBe(false);
    expect(confirmEnabled()).toBe(false);
    expect(text('blockers')).toContain('ίδια ημερομηνία');
  });

  it('is cleared by staging a time on the stored exam and one on this one', () => {
    mount({ session: ready, existingProfile: existing });

    type('stage-time-rep-1', '08:00');
    type('draft-time', '17:15');
    click('confirm-date');

    const after = current(ready);
    expect(after.existingReportDateUpdates['rep-1']).toEqual({
      date: '2025-05-14',
      time: '08:00',
      precision: 'minute',
    });
    expect(confirmEnabled()).toBe(true);
  });
});

describe('what the screen shows', () => {
  it('puts a flagged low-confidence row above a clean one', () => {
    mount({
      session: session({
        reportDrafts: [
          draft({
            dateConfirmed: true,
            rows: [
              row('clean', 'glucose', { sourceOrder: 0 }),
              row('flagged', 'ferritin', {
                sourceOrder: 1,
                confidence: 'low',
                flags: ['implausible-value'],
              }),
            ],
          }),
        ],
      }),
    });

    // The flagged row is the one review is asking about; the clean one has
    // collapsed into the pre-accepted group behind it.
    expect(all('row-marker').map((each) => each.textContent)).toEqual(['Φερριτίνη', 'Γλυκόζη']);
    expect(find('row-flagged')?.getAttribute('data-triage')).toBe('expanded');
    expect(find('row-clean')?.getAttribute('data-triage')).toBe('pre-accepted');
  });

  it('opens the source beside a row, and asks the island for it', () => {
    mount({
      session: session({
        reportDrafts: [
          draft({
            dateConfirmed: true,
            rows: [row('r1', 'glucose', { sourceRef: { sourceId: 's1', page: 1 } })],
          }),
        ],
      }),
    });

    expect(find('evidence')).toBeNull();

    click('inspect-source');

    expect(find('evidence')?.getAttribute('data-kind')).toBe('evidence');
    expect(text('evidence-source')).toContain('εξετάσεις.pdf');
  });

  it('says what it cannot show, rather than showing nothing', () => {
    mount({
      session: session({
        reportDrafts: [
          draft({
            dateConfirmed: true,
            rows: [row('r1', 'glucose', { sourceRef: { sourceId: 's1', page: 9 } })],
          }),
        ],
      }),
      lookup: { kind: 'unknown-page' },
    });

    click('inspect-source');

    expect(find('evidence')?.getAttribute('data-kind')).toBe('unknown-page');
    expect(text('evidence-unavailable')).toContain('δεν υπάρχει στο έγγραφο');
  });

  it('carries the registry version the results were read under', () => {
    mount();

    expect(find('review')?.getAttribute('data-registry-version')).toBe('2');
  });

  it('refuses a session that proposes nothing', () => {
    mount({ session: session({ reportDrafts: [] }) });

    expect(confirmEnabled()).toBe(false);
    expect(text('blockers')).toContain('Δεν υπάρχει τίποτα προς οριστικοποίηση');
  });
});

describe('confidence triage (4.2a)', () => {
  function rowsOf(triage: string): string[] {
    return [...host.querySelectorAll<HTMLElement>(`[data-triage="${triage}"]`)].map(
      (each) => each.getAttribute('data-testid') ?? '',
    );
  }

  const clean = [
    row('a', 'glucose', { sourceOrder: 0 }),
    row('b', 'ferritin', { sourceOrder: 1 }),
    row('c', 'urea', { sourceOrder: 2 }),
  ];

  it('collapses every row the parser is sure of into one count', () => {
    mount({ session: session({ reportDrafts: [draft({ dateConfirmed: true, rows: clean })] }) });

    expect(text('pre-accepted-count')).toBe('3');
    expect(find('rows-expanded')).toBeNull();
    expect(find('nothing-to-review')).not.toBeNull();
    expect(confirmEnabled()).toBe(true);
  });

  it('keeps the disclosure open to per-row correction', () => {
    const ready = session({ reportDrafts: [draft({ dateConfirmed: true, rows: clean })] });
    mount({ session: ready });

    // The controls inside the disclosure are the same controls: batch
    // acceptance is a default, not a restriction.
    void act(() => {
      host
        .querySelector<HTMLElement>('[data-testid="pre-accepted"] [data-testid="delete-row"]')
        ?.click();
    });

    expect(current(ready).reportDrafts[0]?.rows.map((each) => each.id)).toEqual(['b', 'c']);
  });

  it('never collapses a flagged or low-confidence row', () => {
    mount({
      session: session({
        reportDrafts: [
          draft({
            dateConfirmed: true,
            rows: [
              row('clean', 'glucose'),
              row('flagged', 'ferritin', { flags: ['unrecognised-unit'] }),
              row('unsure', 'urea', { confidence: 'medium' }),
            ],
          }),
        ],
      }),
    });

    expect(rowsOf('expanded').sort()).toEqual(['row-flagged', 'row-unsure']);
    expect(rowsOf('pre-accepted')).toEqual(['row-clean']);
  });

  it('never collapses an unknown marker until it is approved', () => {
    const unknown = session({
      reportDrafts: [draft({ dateConfirmed: true, rows: [row('r1', 'x:kappa')] })],
    });
    mount({ session: unknown });

    expect(rowsOf('expanded')).toEqual(['row-r1']);
    expect(confirmEnabled()).toBe(false);

    click('approve-unknown');

    expect(rowsOf('pre-accepted')).toEqual(['row-r1']);
    expect(confirmEnabled()).toBe(true);
  });

  it('never collapses a row a conflict is still asking about', () => {
    const duplicated = session({
      reportDrafts: [
        draft({
          dateConfirmed: true,
          rows: [row('r1', 'glucose', { value: 5 }), row('r2', 'glucose', { value: 6 })],
          conflicts: [
            {
              id: 'c1',
              markerKey: 'glucose',
              candidateRowIds: ['r1', 'r2'],
              resolution: null,
            },
          ],
        }),
      ],
    });
    mount({ session: duplicated });

    expect(rowsOf('expanded').sort()).toEqual(['row-r1', 'row-r2']);

    click('resolve-conflict-glucose');

    expect(rowsOf('pre-accepted').sort()).toEqual(['row-r1', 'row-r2']);
  });
});

describe('inline correction (4.2a)', () => {
  const flagged = session({
    reportDrafts: [
      draft({
        dateConfirmed: true,
        rows: [
          row('r1', 'glucose', {
            flags: ['implausible-value'],
            sourceRef: { sourceId: 's1', page: 1 },
          }),
        ],
      }),
    ],
  });

  it('opens the source beside the field, without asking for it separately', () => {
    mount({ session: flagged });
    expect(find('evidence')).toBeNull();

    click('edit-row');

    expect(find('row-editor')).not.toBeNull();
    expect(find('evidence')?.getAttribute('data-kind')).toBe('evidence');
  });

  it('closes the source with the editor', () => {
    mount({ session: flagged });
    click('edit-row');

    click('cancel-row-edit');

    expect(find('evidence')).toBeNull();
  });

  it('shows one crop, not two, when the row is also being inspected', () => {
    mount({ session: flagged });
    click('inspect-source');
    click('edit-row');

    expect(all('evidence')).toHaveLength(1);
  });
});

describe('the two terminal actions', () => {
  it('hands Confirm to the parent, which owns the transaction', () => {
    let confirmed = 0;
    mount({
      session: session({ reportDrafts: [draft({ dateConfirmed: true })] }),
      onConfirm: () => {
        confirmed += 1;
      },
    });

    click('confirm');

    expect(confirmed).toBe(1);
  });

  it('hands Cancel to the parent while every gate is still open', () => {
    let cancelled = 0;
    mount({
      onCancel: () => {
        cancelled += 1;
      },
    });

    click('cancel');

    expect(cancelled).toBe(1);
  });
});
