import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extract } from './extract';
import {
  applyProfileChange,
  applyProfileMerge,
  buildProfileChange,
  planProfileMerge,
  removeReport,
  resolveSameDayPrecision,
  setReportDate,
  stageExistingReportDate,
  targetExistingReport,
} from './profile';
import { canConfirm } from './review';
import type {
  CollectedAt,
  Conflict,
  ExtractionResult,
  Measurement,
  ParsedRow,
  Profile,
  Report,
  ReviewReportDraft,
  ReviewSession,
  TextItem,
} from './types';

const SEED = new URL('../../fixtures/seed/', import.meta.url);

function extracted(name: string): ExtractionResult {
  const parsed = JSON.parse(readFileSync(new URL(`${name}.textitems.json`, SEED), 'utf8')) as {
    fragmented: { pages: TextItem[][] };
  };

  return extract({
    sourceId: name,
    adapterId: 'pdf-text',
    tier: 'E0',
    pages: parsed.fragmented.pages,
  });
}

/** One draft per source, the way one attach batch proposes them. */
function draftOf(result: ExtractionResult, rows = result.rows): ReviewReportDraft {
  return {
    id: `draft-${result.sourceId}`,
    sourceIds: [result.sourceId],
    targetReportId: null,
    collectedAt: { date: result.collectionDate, time: null, precision: 'day' },
    dateConfirmed: true,
    rows: [...rows],
    conflicts: [],
  };
}

const DAY: CollectedAt = { date: '2025-05-14', time: null, precision: 'day' };
const OTHER_DAY: CollectedAt = { date: '2025-06-01', time: null, precision: 'day' };
const MORNING: CollectedAt = { date: '2025-05-14', time: '09:30', precision: 'minute' };
const EVENING: CollectedAt = { date: '2025-05-14', time: '18:05', precision: 'minute' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

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

function session(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    id: 'session-1',
    results: [],
    reportDrafts: [draft()],
    identifierResolutions: {},
    approvedUnknownRowIds: [],
    existingReportDateUpdates: {},
    samePersonConfirmed: null,
    ...overrides,
  };
}

function measurement(markerKey: string, overrides: Partial<Measurement> = {}): Measurement {
  return {
    markerKey,
    status: 'value',
    value: 1,
    comparator: null,
    textValue: null,
    unit: 'mg/dL',
    referenceRange: null,
    categoricalReference: null,
    sourceOrder: 0,
    ...overrides,
  };
}

function report(
  id: string,
  collectedAt: CollectedAt = DAY,
  measurements: Measurement[] = [],
): Report {
  return { id, collectedAt, measurements };
}

function profile(reports: Report[]): Profile {
  return { schemaVersion: 1, id: 'profile-1', reports };
}

describe('setReportDate', () => {
  it('sets the value and confirms it in one act', () => {
    // D6: the parse is near-certain, so this is one tap on a pre-filled value.
    // There is no path that stores a date the user has not looked at.
    const after = setReportDate(
      session({ reportDrafts: [draft({ dateConfirmed: false })] }),
      'draft-1',
      MORNING,
    );

    expect(after.reportDrafts[0]).toMatchObject({ collectedAt: MORNING, dateConfirmed: true });
  });

  it('stores a date the calendar does not have, and lets the gate refuse it', () => {
    // Silently rejecting what the user typed would leave them with no way to
    // see what was objected to. `canConfirm` owns the calendar question.
    const impossible: CollectedAt = { date: '2025-02-31', time: null, precision: 'day' };
    const after = setReportDate(session(), 'draft-1', impossible);

    expect(after.reportDrafts[0]?.collectedAt).toEqual(impossible);
    expect(canConfirm(after, null)).toBe(false);
  });

  it('returns the session unchanged for a draft it does not hold', () => {
    const before = session();

    expect(setReportDate(before, 'draft-9', MORNING)).toBe(before);
  });
});

describe('targetExistingReport', () => {
  it('aims a draft at an existing Report', () => {
    const after = targetExistingReport(session(), 'draft-1', 'report-1');

    expect(after.reportDrafts[0]?.targetReportId).toBe('report-1');
  });

  it('puts the draft back to proposing its own Report', () => {
    const targeted = targetExistingReport(session(), 'draft-1', 'report-1');

    expect(
      targetExistingReport(targeted, 'draft-1', null).reportDrafts[0]?.targetReportId,
    ).toBeNull();
  });

  it('keeps the session identity when the target does not move', () => {
    const before = targetExistingReport(session(), 'draft-1', 'report-1');

    expect(targetExistingReport(before, 'draft-1', 'report-1')).toBe(before);
    expect(targetExistingReport(before, 'draft-9', 'report-2')).toBe(before);
  });

  it('blocks Confirm when it would repeat a marker the target already holds', () => {
    // The plan wants this as a review question against the Report's own
    // Measurements, and `Conflict` names candidates by row id, so an
    // already-persisted Measurement cannot be one. It is a gate instead: the
    // user deletes the row or reassigns it, and no confirmed value is
    // overwritten without them saying so.
    const existing = profile([report('report-1', DAY, [measurement('glucose')])]);
    const after = targetExistingReport(
      session({ samePersonConfirmed: true }),
      'draft-1',
      'report-1',
    );

    expect(canConfirm(after, existing)).toBe(false);
  });

  it('allows a target holding no marker the draft brings', () => {
    const existing = profile([report('report-1', DAY, [measurement('urea')])]);
    const after = targetExistingReport(
      session({ samePersonConfirmed: true }),
      'draft-1',
      'report-1',
    );

    expect(canConfirm(after, existing)).toBe(true);
  });
});

describe('stageExistingReportDate', () => {
  it('stages a time on an existing Report', () => {
    const after = stageExistingReportDate(session(), 'report-1', EVENING);

    expect(after.existingReportDateUpdates).toEqual({ 'report-1': EVENING });
  });

  it('keeps the session identity when the staged time does not move', () => {
    const before = stageExistingReportDate(session(), 'report-1', EVENING);

    expect(stageExistingReportDate(before, 'report-1', { ...EVENING })).toBe(before);
  });
});

describe('buildProfileChange', () => {
  it('proposes one Report per document, never merged by date', () => {
    // Two documents sharing a collection date are two Reports. If the user
    // genuinely re-tested that day, both stand.
    const change = buildProfileChange(
      session({
        reportDrafts: [
          draft({ id: 'd1', collectedAt: MORNING }),
          draft({ id: 'd2', collectedAt: EVENING, rows: [row('r2', 'urea')] }),
        ],
      }),
      null,
    );

    expect(change.additions).toHaveLength(2);
    expect(change.additions.map((each) => each.collectedAt)).toEqual([MORNING, EVENING]);
  });

  it('creates a fresh UUID for every addition, and for nothing else', () => {
    const change = buildProfileChange(session(), null);
    const again = buildProfileChange(session(), null);

    expect(change.additions[0]?.id).toMatch(UUID);
    expect(change.additions[0]?.id).not.toBe(again.additions[0]?.id);
    expect(change.updates).toEqual([]);
  });

  it('appends a targeted draft to its Report instead of creating one', () => {
    const existing = profile([report('report-1', DAY, [measurement('urea')])]);
    const targeted = targetExistingReport(session(), 'draft-1', 'report-1');
    const change = buildProfileChange(targeted, existing);

    expect(change.additions).toEqual([]);
    expect(change.updates).toHaveLength(1);
    expect(change.updates[0]?.measurements.map((each) => each.markerKey)).toEqual([
      'urea',
      'glucose',
    ]);
  });

  it('emits a complete replacement Report, not a patch', () => {
    // The one IndexedDB transaction writes whole rows, so an interrupted
    // Confirm cannot leave a half-updated Report behind.
    const existing = profile([report('report-1', DAY, [measurement('urea')])]);
    const staged = stageExistingReportDate(session({ reportDrafts: [] }), 'report-1', MORNING);
    const change = buildProfileChange(staged, existing);

    expect(change.updates[0]).toEqual({
      id: 'report-1',
      collectedAt: MORNING,
      measurements: [measurement('urea')],
    });
  });

  it('leaves an untouched existing Report out of updates', () => {
    const existing = profile([report('report-1'), report('report-2', OTHER_DAY)]);

    expect(buildProfileChange(session({ reportDrafts: [] }), existing).updates).toEqual([]);
  });

  it('takes the chosen row when a duplicate marker was resolved by choosing', () => {
    const conflict: Conflict = {
      id: 'c1',
      markerKey: 'glucose',
      candidateRowIds: ['r1', 'r2'],
      resolution: { kind: 'choose', rowId: 'r2' },
    };
    const change = buildProfileChange(
      session({
        reportDrafts: [
          draft({
            rows: [row('r1', 'glucose', { value: 89 }), row('r2', 'glucose', { value: 91 })],
            conflicts: [conflict],
          }),
        ],
      }),
      null,
    );

    expect(change.additions[0]?.measurements).toEqual([
      expect.objectContaining({ markerKey: 'glucose', value: 91 }),
    ]);
  });

  it('takes the replacement Measurement when a duplicate was resolved by editing', () => {
    const edited = measurement('glucose', { value: 90 });
    const change = buildProfileChange(
      session({
        reportDrafts: [
          draft({
            rows: [row('r1', 'glucose', { value: 89 }), row('r2', 'glucose', { value: 91 })],
            conflicts: [
              {
                id: 'c1',
                markerKey: 'glucose',
                candidateRowIds: ['r1', 'r2'],
                resolution: { kind: 'edited', measurement: edited },
              },
            ],
          }),
        ],
      }),
      null,
    );

    expect(change.additions[0]?.measurements).toEqual([edited]);
  });

  it('carries a printed label only for a derived marker key', () => {
    // A canonical Measurement is named by the registry, so persisting its
    // printed label would keep source text for no reason (D7).
    const change = buildProfileChange(
      session({
        reportDrafts: [draft({ rows: [row('r1', 'glucose'), row('r2', 'x:νεοδεικτησ')] })],
      }),
      null,
    );
    const [canonical, unknown] = change.additions[0]?.measurements ?? [];

    expect(canonical).not.toHaveProperty('label');
    expect(unknown).toMatchObject({ label: 'label r2' });
  });
});

describe('applyProfileChange', () => {
  it('creates the first Profile from an empty device', () => {
    const change = buildProfileChange(session(), null);
    const built = applyProfileChange(null, change, false);

    expect(built.id).toMatch(UUID);
    expect(built.reports).toHaveLength(1);
  });

  it('refuses to append to a non-empty Profile without same-person confirmation', () => {
    // D8: the document carries the patient's ΑΜΚΑ and Medigraph deliberately
    // does not use it to answer this. The id is redacted at the D7 gate and
    // never compared.
    const existing = profile([report('report-1')]);
    const change = buildProfileChange(
      session({ reportDrafts: [draft({ collectedAt: OTHER_DAY })] }),
      existing,
    );

    expect(() => applyProfileChange(existing, change, false)).toThrow(/same-person-unconfirmed/u);
    expect(applyProfileChange(existing, change, true).reports).toHaveLength(2);
  });

  it('replaces an updated Report in place, keeping the Profile id', () => {
    const existing = profile([report('report-1'), report('report-2', OTHER_DAY)]);
    const staged = stageExistingReportDate(session({ reportDrafts: [] }), 'report-1', MORNING);
    const built = applyProfileChange(existing, buildProfileChange(staged, existing), true);

    expect(built.id).toBe('profile-1');
    expect(built.reports.map((each) => each.id)).toEqual(['report-1', 'report-2']);
    expect(built.reports[0]?.collectedAt).toEqual(MORNING);
  });

  it('refuses a change that would make the Profile invalid', () => {
    // Two Reports on one date with no times is exactly what the persisted
    // schema forbids, and applying it would leave the device unreadable.
    const existing = profile([report('report-1', DAY)]);
    const change = buildProfileChange(session(), existing);

    expect(() => applyProfileChange(existing, change, true)).toThrow(/invalid-profile/u);
  });

  it('accepts two Reports on one date once both name a distinct minute', () => {
    const existing = profile([report('report-1', MORNING)]);
    const change = buildProfileChange(
      session({ reportDrafts: [draft({ collectedAt: EVENING })] }),
      existing,
    );

    expect(applyProfileChange(existing, change, true).reports).toHaveLength(2);
  });
});

describe('planProfileMerge', () => {
  it('skips a Report that arrives identical', () => {
    const held = report('report-1', MORNING, [measurement('glucose')]);
    const plan = planProfileMerge(profile([held]), profile([{ ...held }]));

    expect(plan.duplicateReportIds).toEqual(['report-1']);
    expect(plan.additions).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('ignores measurement order when deciding two Reports are the same', () => {
    const held = report('report-1', MORNING, [measurement('glucose'), measurement('urea')]);
    const arriving = report('report-1', MORNING, [measurement('urea'), measurement('glucose')]);

    expect(planProfileMerge(profile([held]), profile([arriving])).duplicateReportIds).toEqual([
      'report-1',
    ]);
  });

  it('raises a typed conflict for one id carrying different content', () => {
    const held = report('report-1', MORNING, [measurement('glucose', { value: 89 })]);
    const arriving = report('report-1', MORNING, [measurement('glucose', { value: 91 })]);
    const plan = planProfileMerge(profile([held]), profile([arriving]));

    expect(plan.conflicts).toEqual([{ kind: 'report-id', existing: held, incoming: arriving }]);
    expect(plan.additions).toEqual([]);
  });

  it('adds a Report the Profile does not hold', () => {
    const plan = planProfileMerge(
      profile([report('report-1', MORNING)]),
      profile([report('report-2', OTHER_DAY)]),
    );

    expect(plan.additions.map((each) => each.id)).toEqual(['report-2']);
    expect(plan.conflicts).toEqual([]);
  });

  it('never merges two Reports because they share a date', () => {
    // Date equality is not identity: two laboratories on one morning are two
    // visits, and fusing them would lose one.
    const plan = planProfileMerge(
      profile([report('report-1', MORNING)]),
      profile([report('report-2', EVENING)]),
    );

    expect(plan.duplicateReportIds).toEqual([]);
    expect(plan.additions.map((each) => each.id)).toEqual(['report-2']);
  });

  it('raises a precision conflict when either Report on a shared date is day-precision', () => {
    const plan = planProfileMerge(
      profile([report('report-1', DAY)]),
      profile([report('report-2', MORNING)]),
    );

    expect(plan.conflicts).toEqual([
      {
        kind: 'same-day-precision',
        existing: report('report-1', DAY),
        incoming: report('report-2', MORNING),
      },
    ]);
  });
});

describe('resolveSameDayPrecision', () => {
  it('times both Reports in one step and clears the conflict', () => {
    // A date carrying two Reports needs a distinct minute on each, so
    // resolving only the incoming one would leave the pair as invalid.
    const existing = profile([report('report-1', DAY)]);
    const plan = planProfileMerge(existing, profile([report('report-2', DAY)]));
    const resolved = resolveSameDayPrecision(plan, 'report-1', 'report-2', '09:30', '18:05');

    expect(resolved.conflicts).toEqual([]);
    expect(resolved.updates).toEqual([report('report-1', MORNING)]);
    expect(resolved.additions).toEqual([report('report-2', EVENING)]);
  });

  it('returns the plan untouched when it names no conflict it holds', () => {
    const plan = planProfileMerge(
      profile([report('report-1', DAY)]),
      profile([report('report-2', OTHER_DAY)]),
    );

    expect(resolveSameDayPrecision(plan, 'report-1', 'report-2', '09:30', '18:05')).toBe(plan);
  });
});

describe('applyProfileMerge', () => {
  it('refuses a plan that still holds an id conflict', () => {
    const held = report('report-1', MORNING, [measurement('glucose', { value: 89 })]);
    const arriving = report('report-1', MORNING, [measurement('glucose', { value: 91 })]);
    const plan = planProfileMerge(profile([held]), profile([arriving]));

    expect(applyProfileMerge(profile([held]), plan)).toEqual({
      ok: false,
      error: 'report-id-conflict',
    });
  });

  it('refuses a plan that still holds a precision conflict', () => {
    const existing = profile([report('report-1', DAY)]);
    const plan = planProfileMerge(existing, profile([report('report-2', DAY)]));

    expect(applyProfileMerge(existing, plan)).toEqual({
      ok: false,
      error: 'same-day-precision-conflict',
    });
  });

  it('applies a resolved plan, staging the existing update with the addition', () => {
    const existing = profile([report('report-1', DAY)]);
    const plan = resolveSameDayPrecision(
      planProfileMerge(existing, profile([report('report-2', DAY)])),
      'report-1',
      'report-2',
      '09:30',
      '18:05',
    );
    const merged = applyProfileMerge(existing, plan);

    expect(merged.ok).toBe(true);
    expect(merged.ok && merged.profile.reports.map((each) => each.collectedAt)).toEqual([
      MORNING,
      EVENING,
    ]);
  });

  it('keeps the existing Profile id through a merge', () => {
    const existing = profile([report('report-1', MORNING)]);
    const merged = applyProfileMerge(
      existing,
      planProfileMerge(existing, profile([report('report-2', OTHER_DAY)])),
    );

    expect(merged.ok && merged.profile.id).toBe('profile-1');
  });

  it('writes nothing for a Report that arrived identical', () => {
    const held = report('report-1', MORNING, [measurement('glucose')]);
    const existing = profile([held]);
    const merged = applyProfileMerge(existing, planProfileMerge(existing, profile([{ ...held }])));

    expect(merged.ok && merged.profile.reports).toEqual([held]);
  });
});

describe('removeReport', () => {
  it('removes the named Report', () => {
    const after = removeReport(
      profile([report('report-1'), report('report-2', OTHER_DAY)]),
      'report-1',
    );

    expect(after?.reports.map((each) => each.id)).toEqual(['report-2']);
  });

  it('reports that there was nothing to remove', () => {
    // A delete confirmation needs to know this before it tells the user it
    // removed something.
    expect(removeReport(profile([report('report-1')]), 'report-9')).toBeNull();
  });

  it('leaves an empty Profile rather than no Profile', () => {
    expect(removeReport(profile([report('report-1')]), 'report-1')).toEqual(profile([]));
  });
});

describe('the seed documents', () => {
  it('proposes one Report per document, and creates none before Confirm', () => {
    // One document is exactly one Report (D6): a source is never split and
    // never merged, so two attached documents propose two Reports.
    const results = [extracted('ahfy-minimal'), extracted('ahfy-full')];
    const change = buildProfileChange(
      session({ results, reportDrafts: results.map((result) => draftOf(result)) }),
      null,
    );

    expect(change.additions).toHaveLength(2);
    expect(change.updates).toEqual([]);
    expect(change.additions.map((each) => each.collectedAt.date)).toEqual([
      '2024-07-08',
      '2025-05-14',
    ]);
    expect(change.additions.every((each) => UUID.test(each.id))).toBe(true);
  });

  it('refuses to write a document whose duplicate marker is unresolved', () => {
    // ahfy-full anchors `rbc` twice — once on the count, once on page 3's
    // nucleated red cells, which the seed registry does not carry. Confirm
    // requires exactly one Measurement per marker key, and the write refuses
    // rather than silently keeping whichever came first.
    const full = extracted('ahfy-full');
    const keys = full.rows.map((each) => each.markerKey);

    expect(keys.filter((key) => key === 'rbc')).toHaveLength(2);
    expect(() =>
      applyProfileChange(
        null,
        buildProfileChange(session({ reportDrafts: [draftOf(full)] }), null),
        false,
      ),
    ).toThrow(/repeats marker key rbc/u);
  });

  it('writes both Reports once the duplicate is resolved', () => {
    const minimal = extracted('ahfy-minimal');
    const full = extracted('ahfy-full');
    const deduplicated = full.rows.filter(
      (each, index) =>
        each.markerKey !== 'rbc' ||
        index === full.rows.findIndex((first) => first.markerKey === 'rbc'),
    );

    const change = buildProfileChange(
      session({ reportDrafts: [draftOf(minimal), draftOf(full, deduplicated)] }),
      null,
    );
    const built = applyProfileChange(null, change, false);

    expect(built.reports).toHaveLength(2);
    expect(built.reports[0]?.measurements).toHaveLength(minimal.rows.length);
    expect(built.reports[1]?.measurements).toHaveLength(deduplicated.length);
  });

  it('keeps two documents collected on one day apart until each names a time', () => {
    // Equal dates never auto-merge. Both stand, and the schema requires a
    // distinct minute on each before either can be written.
    const minimal = extracted('ahfy-minimal');
    const sameDay = { ...draftOf(minimal), id: 'draft-2' };
    const change = buildProfileChange(session({ reportDrafts: [draftOf(minimal), sameDay] }), null);

    expect(change.additions).toHaveLength(2);
    expect(() => applyProfileChange(null, change, false)).toThrow(/must be minute-precision/u);
  });
});
