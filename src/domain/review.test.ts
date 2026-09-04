import { describe, expect, it } from 'vitest';
import {
  approveUnknownMarker,
  canConfirm,
  deleteRow,
  reassignMarker,
  resolveConflict,
  resolveIdentifier,
} from './review';
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
} from './types';

const DAY: CollectedAt = { date: '2025-05-14', time: null, precision: 'day' };
const MORNING: CollectedAt = { date: '2025-05-14', time: '09:30', precision: 'minute' };
const EVENING: CollectedAt = { date: '2025-05-14', time: '18:05', precision: 'minute' };

function row(id: string, markerKey: string, overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    id,
    label: `label ${id}`,
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
    id: 'draft-1',
    sourceIds: ['s1'],
    targetReportId: null,
    collectedAt: DAY,
    dateConfirmed: true,
    rows: [row('r1', 'glucose')],
    conflicts: [],
    ...overrides,
  };
}

function result(candidates: IdentifierCandidate[] = []): ExtractionResult {
  return {
    sourceId: 's1',
    adapterId: 'pdf-text',
    tier: 'E0',
    registryVersion: 1,
    rows: [],
    collectionDate: '2025-05-14',
    resultDate: null,
    identifierCandidates: candidates,
    unrecognised: [],
    evidenceAvailable: false,
  };
}

function session(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    id: 'session-1',
    results: [result()],
    reportDrafts: [draft()],
    identifierResolutions: {},
    approvedUnknownRowIds: [],
    existingReportDateUpdates: {},
    samePersonConfirmed: null,
    ...overrides,
  };
}

function report(id: string, collectedAt: CollectedAt = DAY): Report {
  return { id, collectedAt, measurements: [] };
}

function profile(reports: Report[]): Profile {
  return { schemaVersion: 1, id: 'profile-1', reports };
}

function conflictOf(session_: ReviewSession, index = 0): Conflict | undefined {
  return session_.reportDrafts[0]?.conflicts[index];
}

/** A session whose every gate is already open, so one change closes exactly one. */
function confirmable(): ReviewSession {
  return session({ reportDrafts: [draft({ collectedAt: MORNING })] });
}

describe('immutability', () => {
  it.each([
    ['reassignMarker', (s: ReviewSession) => reassignMarker(s, 'r1', 'x:new', 'New')],
    ['approveUnknownMarker', (s: ReviewSession) => approveUnknownMarker(s, 'r1')],
    ['deleteRow', (s: ReviewSession) => deleteRow(s, 'r1')],
    ['resolveIdentifier', (s: ReviewSession) => resolveIdentifier(s, 'c1', 'redacted')],
    ['resolveConflict', (s: ReviewSession) => resolveConflict(s, 'k1', null)],
  ])('%s leaves the session it was given untouched', (_name, edit) => {
    const before = session({
      results: [result([{ id: 'c1', kind: 'name', text: 'label r1' }])],
      reportDrafts: [draft({ rows: [row('r1', 'x:old')] })],
    });
    const snapshot = structuredClone(before);

    edit(before);

    expect(before).toEqual(snapshot);
  });

  it('returns the same session when the edit names nothing it holds', () => {
    const before = session();

    expect(reassignMarker(before, 'missing', 'glucose', null)).toBe(before);
    expect(approveUnknownMarker(before, 'missing')).toBe(before);
    expect(deleteRow(before, 'missing')).toBe(before);
    expect(resolveIdentifier(before, 'missing', 'redacted')).toBe(before);
    expect(resolveConflict(before, 'missing', null)).toBe(before);
  });

  it('keeps the identity of drafts an edit does not touch', () => {
    const untouched = draft({ id: 'draft-2', rows: [row('r2', 'urea')] });
    const before = session({ reportDrafts: [draft(), untouched] });

    const after = deleteRow(before, 'r1');

    expect(after.reportDrafts[1]).toBe(untouched);
    expect(after.reportDrafts[0]).not.toBe(before.reportDrafts[0]);
  });
});

describe('reassignMarker', () => {
  it('gives the row its new key', () => {
    const after = reassignMarker(session(), 'r1', 'urea', null);

    expect(after.reportDrafts[0]?.rows[0]?.markerKey).toBe('urea');
  });

  it('approves the unknown it reassigns to, and takes its label', () => {
    // The key is derived from the label, so naming the label the user accepts
    // is the same act as accepting it.
    const after = reassignMarker(session(), 'r1', 'x:λιπαση', 'Λιπάση');

    expect(after.approvedUnknownRowIds).toEqual(['r1']);
    expect(after.reportDrafts[0]?.rows[0]?.label).toBe('Λιπάση');
  });

  it('approves an unknown reassignment that supplies no label', () => {
    const after = reassignMarker(session(), 'r1', 'x:λιπαση', null);

    expect(after.approvedUnknownRowIds).toEqual(['r1']);
    expect(after.reportDrafts[0]?.rows[0]?.label).toBe('label r1');
  });

  it('withdraws approval when the row becomes canonical, and ignores the label', () => {
    const before = session({
      reportDrafts: [draft({ rows: [row('r1', 'x:old')] })],
      approvedUnknownRowIds: ['r1'],
    });

    const after = reassignMarker(before, 'r1', 'glucose', 'Ignored');

    expect(after.approvedUnknownRowIds).toEqual([]);
    expect(after.reportDrafts[0]?.rows[0]?.label).toBe('label r1');
  });

  it('creates a duplicate conflict the moment two rows share a key', () => {
    const before = session({
      reportDrafts: [draft({ rows: [row('r1', 'glucose'), row('r2', 'urea')] })],
    });

    const after = reassignMarker(before, 'r2', 'glucose', null);

    expect(conflictOf(after)).toEqual({
      id: 'draft-1:conflict:glucose',
      markerKey: 'glucose',
      candidateRowIds: ['r1', 'r2'],
      resolution: null,
    });
  });

  it('removes a conflict the moment the rows stop sharing a key', () => {
    const before = session({
      reportDrafts: [
        draft({
          rows: [row('r1', 'glucose'), row('r2', 'glucose')],
          conflicts: [
            {
              id: 'k1',
              markerKey: 'glucose',
              candidateRowIds: ['r1', 'r2'],
              resolution: { kind: 'choose', rowId: 'r1' },
            },
          ],
        }),
      ],
    });

    const after = reassignMarker(before, 'r2', 'urea', null);

    expect(after.reportDrafts[0]?.conflicts).toEqual([]);
  });

  it('keeps the id of a conflict that survives a rebuild', () => {
    const before = session({
      reportDrafts: [
        draft({
          rows: [row('r1', 'glucose'), row('r2', 'glucose'), row('r3', 'urea')],
          conflicts: [
            {
              id: 'built-by-2.6',
              markerKey: 'glucose',
              candidateRowIds: ['r1', 'r2'],
              resolution: null,
            },
          ],
        }),
      ],
    });

    const after = reassignMarker(before, 'r3', 'creatinine', null);

    expect(conflictOf(after)?.id).toBe('built-by-2.6');
  });

  it('drops a resolution once the question changes', () => {
    // r3 joining makes this a different question, and the old answer could
    // leave a `choose` pointing outside the candidate set.
    const before = session({
      reportDrafts: [
        draft({
          rows: [row('r1', 'glucose'), row('r2', 'glucose'), row('r3', 'urea')],
          conflicts: [
            {
              id: 'k1',
              markerKey: 'glucose',
              candidateRowIds: ['r1', 'r2'],
              resolution: { kind: 'choose', rowId: 'r1' },
            },
          ],
        }),
      ],
    });

    const after = reassignMarker(before, 'r3', 'glucose', null);

    expect(conflictOf(after)?.candidateRowIds).toEqual(['r1', 'r2', 'r3']);
    expect(conflictOf(after)?.resolution).toBeNull();
  });
});

describe('approveUnknownMarker', () => {
  it('approves a derived row once, however often it is asked', () => {
    const before = session({ reportDrafts: [draft({ rows: [row('r1', 'x:λιπαση')] })] });

    const once = approveUnknownMarker(before, 'r1');

    expect(once.approvedUnknownRowIds).toEqual(['r1']);
    expect(approveUnknownMarker(once, 'r1')).toBe(once);
  });

  it('refuses a canonical row, which has no label to approve', () => {
    const before = session();

    expect(approveUnknownMarker(before, 'r1')).toBe(before);
  });
});

describe('deleteRow', () => {
  it('drops the row and withdraws its approval', () => {
    const before = session({
      reportDrafts: [draft({ rows: [row('r1', 'x:old'), row('r2', 'urea')] })],
      approvedUnknownRowIds: ['r1'],
    });

    const after = deleteRow(before, 'r1');

    expect(after.reportDrafts[0]?.rows.map((each) => each.id)).toEqual(['r2']);
    expect(after.approvedUnknownRowIds).toEqual([]);
  });

  it('resolves a conflict by leaving only one candidate', () => {
    const before = session({
      reportDrafts: [
        draft({
          rows: [row('r1', 'glucose'), row('r2', 'glucose')],
          conflicts: [
            { id: 'k1', markerKey: 'glucose', candidateRowIds: ['r1', 'r2'], resolution: null },
          ],
        }),
      ],
    });

    expect(deleteRow(before, 'r2').reportDrafts[0]?.conflicts).toEqual([]);
  });
});

describe('resolveIdentifier', () => {
  const candidate: IdentifierCandidate = { id: 'c1', kind: 'name', text: 'ΠΑΠΑΔΟΠΟΥΛΟΣ' };

  function withCandidate(rows: ParsedRow[]): ReviewSession {
    return session({ results: [result([candidate])], reportDrafts: [draft({ rows })] });
  }

  it.each(['redacted', 'deleted-row', 'false-positive'] as const)('records %s', (resolution) => {
    const after = resolveIdentifier(withCandidate([row('r1', 'glucose')]), 'c1', resolution);

    expect(after.identifierResolutions).toEqual({ c1: resolution });
  });

  it('removes redacted text from a label, a result and a printed reference', () => {
    // An approved unknown label is the one path source text takes into a
    // Profile, so an identifier the user just called real must not survive it.
    const before = withCandidate([
      row('r1', 'x:one', { label: 'Σχόλιο ΠΑΠΑΔΟΠΟΥΛΟΣ ιατρού' }),
      row('r2', 'x:two', {
        status: 'categorical',
        textValue: 'ΠΑΠΑΔΟΠΟΥΛΟΣ',
        categoricalReference: 'Αρνητικό ΠΑΠΑΔΟΠΟΥΛΟΣ',
      }),
    ]);

    const rows = resolveIdentifier(before, 'c1', 'redacted').reportDrafts[0]?.rows ?? [];

    expect(rows[0]?.label).toBe('Σχόλιο ιατρού');
    expect(rows[1]?.textValue).toBe('');
    expect(rows[1]?.categoricalReference).toBe('Αρνητικό');
  });

  it.each(['deleted-row', 'false-positive'] as const)(
    'leaves the rows alone for %s',
    (resolution) => {
      // Deleting is deleteRow's job, and a false positive was never an identifier.
      const before = withCandidate([row('r1', 'x:one', { label: 'ΠΑΠΑΔΟΠΟΥΛΟΣ' })]);

      const after = resolveIdentifier(before, 'c1', resolution);

      expect(after.reportDrafts).toBe(before.reportDrafts);
    },
  );

  it('leaves a row the text does not appear in untouched', () => {
    const before = withCandidate([row('r1', 'glucose')]);

    expect(resolveIdentifier(before, 'c1', 'redacted').reportDrafts).toBe(before.reportDrafts);
  });
});

describe('resolveConflict', () => {
  function withConflict(resolution: Conflict['resolution'] = null): ReviewSession {
    return session({
      reportDrafts: [
        draft({
          rows: [row('r1', 'glucose'), row('r2', 'glucose')],
          conflicts: [
            { id: 'k1', markerKey: 'glucose', candidateRowIds: ['r1', 'r2'], resolution },
          ],
        }),
      ],
    });
  }

  it('records a choice among the candidates', () => {
    const after = resolveConflict(withConflict(), 'k1', { kind: 'choose', rowId: 'r2' });

    expect(conflictOf(after)?.resolution).toEqual({ kind: 'choose', rowId: 'r2' });
  });

  it('records an edited replacement Measurement', () => {
    const measurement = {
      markerKey: 'glucose',
      status: 'value' as const,
      value: 94,
      comparator: null,
      textValue: null,
      unit: 'mg/dL',
      referenceRange: null,
      categoricalReference: null,
      sourceOrder: 0,
    };

    const after = resolveConflict(withConflict(), 'k1', { kind: 'edited', measurement });

    expect(conflictOf(after)?.resolution).toEqual({ kind: 'edited', measurement });
  });

  it('lets an answer be withdrawn', () => {
    const before = withConflict({ kind: 'choose', rowId: 'r1' });

    expect(conflictOf(resolveConflict(before, 'k1', null))?.resolution).toBeNull();
  });

  it('refuses a choice outside the candidate set', () => {
    // Storing it would satisfy the gate with an answer no Report can be built
    // from.
    const before = withConflict();

    expect(resolveConflict(before, 'k1', { kind: 'choose', rowId: 'r9' })).toBe(before);
  });
});

describe('canConfirm', () => {
  it('opens when every gate is answered', () => {
    expect(canConfirm(confirmable(), null)).toBe(true);
  });

  it('refuses a session that proposes nothing', () => {
    expect(canConfirm(session({ reportDrafts: [] }), null)).toBe(false);
  });

  describe('one unanswered gate at a time', () => {
    it.each([
      [
        'an unconfirmed date',
        session({ reportDrafts: [draft({ collectedAt: MORNING, dateConfirmed: false })] }),
      ],
      ['a missing date', session({ reportDrafts: [draft({ collectedAt: null })] })],
      [
        'a date the calendar does not have',
        session({
          reportDrafts: [
            draft({ collectedAt: { date: '2025-02-30', time: null, precision: 'day' } }),
          ],
        }),
      ],
      [
        'an unresolved conflict',
        session({
          reportDrafts: [
            draft({
              rows: [row('r1', 'glucose'), row('r2', 'glucose')],
              conflicts: [
                { id: 'k1', markerKey: 'glucose', candidateRowIds: ['r1', 'r2'], resolution: null },
              ],
            }),
          ],
        }),
      ],
      [
        'an unresolved identifier',
        session({ results: [result([{ id: 'c1', kind: 'name', text: 'ΕΛΕΝΗ' }])] }),
      ],
      [
        'an unapproved unknown marker',
        session({ reportDrafts: [draft({ rows: [row('r1', 'x:λιπαση')] })] }),
      ],
      [
        'a staged date the calendar does not have',
        session({
          existingReportDateUpdates: {
            'report-1': { date: '2025-13-01', time: null, precision: 'day' },
          },
        }),
      ],
    ])('blocks on %s', (_name, blocked) => {
      expect(canConfirm(blocked, null)).toBe(false);
    });

    it('blocks on a target Report that does not exist', () => {
      const blocked = session({ reportDrafts: [draft({ targetReportId: 'nope' })] });

      expect(canConfirm(blocked, profile([report('report-1')]))).toBe(false);
    });

    it('opens once the target Report exists and the person is confirmed', () => {
      const open = session({
        reportDrafts: [draft({ targetReportId: 'report-1' })],
        samePersonConfirmed: true,
      });

      expect(canConfirm(open, profile([report('report-1')]))).toBe(true);
    });
  });

  describe('same-person confirmation', () => {
    it('is not asked of an empty Profile', () => {
      expect(canConfirm(confirmable(), profile([]))).toBe(true);
      expect(canConfirm(confirmable(), null)).toBe(true);
    });

    it.each([
      ['unanswered', null],
      ['answered no', false],
    ])('blocks an append to a non-empty Profile while %s', (_name, samePersonConfirmed) => {
      const blocked = { ...confirmable(), samePersonConfirmed };

      expect(canConfirm(blocked, profile([report('report-1', EVENING)]))).toBe(false);
    });

    it('opens once the user says it is the same person', () => {
      const open = { ...confirmable(), samePersonConfirmed: true };

      expect(canConfirm(open, profile([report('report-1', EVENING)]))).toBe(true);
    });
  });

  describe('same-day precision', () => {
    it('blocks two same-day drafts while either names only a day', () => {
      const blocked = session({
        reportDrafts: [
          draft({ id: 'd1', collectedAt: DAY }),
          draft({ id: 'd2', collectedAt: MORNING }),
        ],
      });

      expect(canConfirm(blocked, null)).toBe(false);
    });

    it('blocks two same-day drafts that name the same minute', () => {
      const blocked = session({
        reportDrafts: [
          draft({ id: 'd1', collectedAt: MORNING }),
          draft({ id: 'd2', collectedAt: MORNING }),
        ],
      });

      expect(canConfirm(blocked, null)).toBe(false);
    });

    it('opens for two same-day drafts at distinct minutes', () => {
      const open = session({
        reportDrafts: [
          draft({ id: 'd1', collectedAt: MORNING }),
          draft({ id: 'd2', collectedAt: EVENING }),
        ],
      });

      expect(canConfirm(open, null)).toBe(true);
    });

    it('opens for two drafts on different days', () => {
      const open = session({
        reportDrafts: [
          draft({ id: 'd1', collectedAt: DAY }),
          draft({ id: 'd2', collectedAt: { date: '2025-05-15', time: null, precision: 'day' } }),
        ],
      });

      expect(canConfirm(open, null)).toBe(true);
    });

    it('counts the Reports already in the Profile', () => {
      const blocked = { ...confirmable(), samePersonConfirmed: true };

      expect(canConfirm(blocked, profile([report('report-1', DAY)]))).toBe(false);
    });

    it('reads a staged update instead of the date the Report carries', () => {
      // Staging the existing Report to a distinct minute is exactly how review
      // clears this collision.
      const staged: ReviewSession = {
        ...confirmable(),
        samePersonConfirmed: true,
        existingReportDateUpdates: { 'report-1': EVENING },
      };

      expect(canConfirm(staged, profile([report('report-1', DAY)]))).toBe(true);
    });

    it('does not count a draft aimed at an existing Report as a second one', () => {
      // It adds Measurements to that Report and creates no new identity.
      const open: ReviewSession = {
        ...confirmable(),
        samePersonConfirmed: true,
        reportDrafts: [draft({ targetReportId: 'report-1', collectedAt: DAY })],
      };

      expect(canConfirm(open, profile([report('report-1', DAY)]))).toBe(true);
    });
  });
});
