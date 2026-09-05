import { validateProfile } from './types';
import type {
  CollectedAt,
  Measurement,
  ParsedRow,
  Profile,
  ProfileChange,
  ProfileMergeConflict,
  ProfileMergePlan,
  ProfileMergeResult,
  Report,
  ReviewReportDraft,
  ReviewSession,
} from './types';

/**
 * Report identity: turning a confirmed review session into Reports, and
 * merging one Profile into another.
 *
 * **One document is exactly one Report** (D6). A source is never split and
 * never merged, so there is no grouping flow here and no grouping gate;
 * attaching three documents proposes three Reports. Two documents sharing a
 * collection date are still two Reports — if the user genuinely re-tested that
 * day, both stand — and they may coexist only when every Report on that date
 * names a distinct minute.
 *
 * Nothing in this module decides anything on the user's behalf. The session
 * editors are total and immutable in `review.ts`'s sense, the builders run only
 * after `canConfirm`, and a merge that still holds a conflict refuses rather
 * than choosing.
 */

// ---------------------------------------------------------------------------
// Session edits
// ---------------------------------------------------------------------------

/** Apply `edit` to one draft, keeping the session's identity when nothing moves. */
function editDraft(
  session: ReviewSession,
  draftId: string,
  edit: (draft: ReviewReportDraft) => ReviewReportDraft,
): ReviewSession {
  const reportDrafts = session.reportDrafts.map((draft) =>
    draft.id === draftId ? edit(draft) : draft,
  );

  return reportDrafts.every((draft, index) => draft === session.reportDrafts[index])
    ? session
    : { ...session, reportDrafts };
}

/**
 * Confirm one draft's collection date (D6).
 *
 * The parse is near-certain — the repository prints the date under a fixed
 * label — so this is one tap on a pre-filled value rather than a choice among
 * candidates. Setting the value *is* the confirmation: there is no path that
 * stores a date without the user having looked at it.
 *
 * The value is stored as given, valid or not. `canConfirm` owns the calendar
 * question, and a date field that silently refused what the user typed would
 * leave them with no way to see what it objected to.
 */
export function setReportDate(
  session: ReviewSession,
  draftId: string,
  collectedAt: CollectedAt,
): ReviewSession {
  return editDraft(session, draftId, (draft) => ({ ...draft, collectedAt, dateConfirmed: true }));
}

/**
 * Aim a draft at an existing Report, or back at a new one.
 *
 * A later attach is a new Report even on the same date; only this explicit
 * selection adds Measurements to a Report that already exists. `null` puts the
 * draft back to proposing its own Report, which is what makes the choice
 * reversible before Confirm.
 *
 * The Report's own Measurements are not consulted here — this module is given
 * no Profile — so a draft carrying a marker key its target already holds is
 * caught by `canConfirm` instead, where the Profile is in hand.
 */
export function targetExistingReport(
  session: ReviewSession,
  draftId: string,
  reportId: string | null,
): ReviewSession {
  return editDraft(session, draftId, (draft) =>
    draft.targetReportId === reportId ? draft : { ...draft, targetReportId: reportId },
  );
}

/**
 * Stage a new time on an existing Report.
 *
 * Two Reports may share a date only when both name a distinct minute, and the
 * one already persisted may be the one that needs the time. Staging it here
 * keeps that update inside the same atomic Confirm as the additions, so the
 * Profile is never briefly invalid.
 */
export function stageExistingReportDate(
  session: ReviewSession,
  reportId: string,
  collectedAt: CollectedAt,
): ReviewSession {
  const existing = session.existingReportDateUpdates[reportId];
  if (existing !== undefined && sameMoment(existing, collectedAt)) {
    return session;
  }

  return {
    ...session,
    existingReportDateUpdates: { ...session.existingReportDateUpdates, [reportId]: collectedAt },
  };
}

function sameMoment(a: CollectedAt, b: CollectedAt): boolean {
  return a.date === b.date && a.time === b.time && a.precision === b.precision;
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

/**
 * The Measurement one reviewed row becomes.
 *
 * `label` travels only with a derived `x:` key. A canonical Measurement is
 * named by the registry, so carrying the printed label would persist source
 * text for no reason — and source text is the one thing D7 is about.
 */
function measurementOf(row: ParsedRow): Measurement {
  const measurement: Measurement = {
    markerKey: row.markerKey,
    status: row.status,
    value: row.value,
    comparator: row.comparator,
    textValue: row.textValue,
    unit: row.unit,
    referenceRange: row.referenceRange,
    categoricalReference: row.categoricalReference,
    sourceOrder: row.sourceOrder,
  };

  return row.markerKey.startsWith('x:') ? { ...measurement, label: row.label } : measurement;
}

/**
 * One Measurement per marker key, with every duplicate answered.
 *
 * A conflict's resolution is authoritative: `choose` names the surviving row
 * and `edited` supplies a replacement outright. Rows under an unresolved
 * conflict are dropped rather than guessed at — `canConfirm` has already
 * refused such a session, so reaching here with one is a caller error, and
 * emitting both would build a Report the schema rejects.
 */
function measurementsOf(draft: ReviewReportDraft): Measurement[] {
  const contested = new Map(draft.conflicts.map((conflict) => [conflict.markerKey, conflict]));
  const measurements: Measurement[] = [];
  const taken = new Set<string>();

  for (const row of draft.rows) {
    const conflict = contested.get(row.markerKey);

    if (conflict === undefined) {
      measurements.push(measurementOf(row));
      continue;
    }
    if (taken.has(row.markerKey)) {
      continue;
    }

    const { resolution } = conflict;
    if (resolution === null) {
      continue;
    }

    taken.add(row.markerKey);
    if (resolution.kind === 'edited') {
      measurements.push(resolution.measurement);
      continue;
    }

    const chosen = draft.rows.find((each) => each.id === resolution.rowId);
    if (chosen !== undefined) {
      measurements.push(measurementOf(chosen));
    }
  }

  return measurements;
}

/**
 * The Reports a confirmed session would write.
 *
 * Run only once `canConfirm` is true. Ids are created **here and only here**,
 * for additions alone: a draft aimed at an existing Report never mints one, and
 * nothing upstream of Confirm may hold a Report id, because an id created
 * before the user confirmed would outlive a Cancel.
 *
 * `updates` carry complete replacement Reports rather than patches, so the one
 * IndexedDB transaction `MedigraphApp` owns writes whole rows and an
 * interrupted Confirm cannot leave a half-updated Report behind.
 */
export function buildProfileChange(
  session: ReviewSession,
  existing: Profile | null,
): ProfileChange {
  const reports = existing?.reports ?? [];
  const additions: Report[] = [];
  const appended = new Map<string, Measurement[]>();

  for (const draft of session.reportDrafts) {
    const measurements = measurementsOf(draft);

    if (draft.targetReportId === null) {
      if (draft.collectedAt !== null) {
        additions.push({ id: newId(), collectedAt: draft.collectedAt, measurements });
      }
      continue;
    }

    appended.set(draft.targetReportId, [
      ...(appended.get(draft.targetReportId) ?? []),
      ...measurements,
    ]);
  }

  const updates = reports.flatMap((report) => {
    const added = appended.get(report.id) ?? [];
    const staged = session.existingReportDateUpdates[report.id];
    if (added.length === 0 && staged === undefined) {
      return [];
    }

    return [
      {
        ...report,
        collectedAt: staged ?? report.collectedAt,
        measurements: [...report.measurements, ...added],
      },
    ];
  });

  return { updates, additions };
}

/**
 * Write a change into a Profile, or refuse.
 *
 * Appending to a Profile that already holds Reports requires an explicit
 * same-person confirmation (D8). The document carries the patient's ΑΜΚΑ and
 * Medigraph deliberately does not use it to answer this: the id is redacted at
 * the D7 gate and never compared, because never processing a national id is
 * worth more than a verified answer.
 *
 * The result is validated before it is returned, so a caller cannot persist a
 * Profile the schema would reject — a repeated marker key, two day-precision
 * Reports on one date, an impossible calendar day.
 */
export function applyProfileChange(
  existing: Profile | null,
  change: ProfileChange,
  samePersonConfirmed: boolean,
): Profile {
  const reports = existing?.reports ?? [];

  if (reports.length > 0 && !samePersonConfirmed) {
    throw new Error('same-person-unconfirmed');
  }

  const replaced = new Map(change.updates.map((report) => [report.id, report]));

  return validateProfile({
    schemaVersion: 1,
    id: existing?.id ?? newId(),
    reports: [...reports.map((report) => replaced.get(report.id) ?? report), ...change.additions],
  });
}

// ---------------------------------------------------------------------------
// Import merge
// ---------------------------------------------------------------------------

/**
 * Plan a merge of one Profile into another, by Report id and never by date.
 *
 * Date equality is not identity: two laboratories on one morning are two
 * Reports, and merging them because they share a day would silently fuse two
 * visits. An id present on both sides with structurally identical content is
 * the same Report arriving twice and is skipped; the same id carrying
 * different content is a conflict Merge cannot resolve on its own.
 *
 * Distinct Reports that would land on one date raise a resolvable precision
 * conflict whenever either is day-precision — the persisted schema requires a
 * distinct minute on every Report sharing a date, and only the user knows
 * which time each was drawn.
 */
export function planProfileMerge(existing: Profile, incoming: Profile): ProfileMergePlan {
  const byId = new Map(existing.reports.map((report) => [report.id, report]));

  const duplicateReportIds: string[] = [];
  const additions: Report[] = [];
  const conflicts: ProfileMergeConflict[] = [];

  for (const report of incoming.reports) {
    const held = byId.get(report.id);

    if (held === undefined) {
      additions.push(report);
      continue;
    }
    if (identical(held, report)) {
      duplicateReportIds.push(report.id);
      continue;
    }

    conflicts.push({ kind: 'report-id', existing: held, incoming: report });
  }

  for (const addition of additions) {
    for (const held of existing.reports) {
      if (
        held.collectedAt.date === addition.collectedAt.date &&
        (held.collectedAt.precision === 'day' || addition.collectedAt.precision === 'day')
      ) {
        conflicts.push({ kind: 'same-day-precision', existing: held, incoming: addition });
      }
    }
  }

  return { duplicateReportIds, updates: [], additions, conflicts };
}

/** Structural equality of two validated Reports. */
function identical(a: Report, b: Report): boolean {
  return JSON.stringify(normalised(a)) === JSON.stringify(normalised(b));
}

function normalised(report: Report): unknown {
  return {
    id: report.id,
    collectedAt: report.collectedAt,
    measurements: [...report.measurements]
      .sort((x, y) => x.markerKey.localeCompare(y.markerKey))
      .map((measurement) => ({ ...measurement })),
  };
}

/**
 * Answer one same-day precision conflict by naming both times.
 *
 * Both sides move in one step because both must: a date carrying two Reports
 * needs a distinct minute on each, so resolving only the incoming one would
 * leave the pair as invalid as it was. The existing Report's new time is
 * staged into `updates`, which `applyProfileMerge` writes in the same
 * transaction as the addition.
 *
 * A plan naming neither Report is returned untouched, in `review.ts`'s sense:
 * a preview screen races against its own state.
 */
export function resolveSameDayPrecision(
  plan: ProfileMergePlan,
  existingReportId: string,
  incomingReportId: string,
  existingTime: string,
  incomingTime: string,
): ProfileMergePlan {
  const answered = plan.conflicts.find(
    (conflict) =>
      conflict.kind === 'same-day-precision' &&
      conflict.existing.id === existingReportId &&
      conflict.incoming.id === incomingReportId,
  );

  if (answered === undefined) {
    return plan;
  }

  const timed = (report: Report, time: string): Report => ({
    ...report,
    collectedAt: { date: report.collectedAt.date, time, precision: 'minute' },
  });

  const staged = timed(answered.existing, existingTime);
  const updates = [...plan.updates.filter((report) => report.id !== existingReportId), staged];

  return {
    ...plan,
    updates,
    additions: plan.additions.map((report) =>
      report.id === incomingReportId ? timed(report, incomingTime) : report,
    ),
    conflicts: plan.conflicts.filter((conflict) => conflict !== answered),
  };
}

/**
 * Apply a fully resolved plan, or report why it cannot be applied.
 *
 * A typed refusal rather than a throw: an unresolved merge is an ordinary
 * state of the import preview, not a programming error, and the preview has to
 * render which kind of blocker is left.
 */
export function applyProfileMerge(existing: Profile, plan: ProfileMergePlan): ProfileMergeResult {
  const blocking = plan.conflicts[0];
  if (blocking !== undefined) {
    return {
      ok: false,
      error: blocking.kind === 'report-id' ? 'report-id-conflict' : 'same-day-precision-conflict',
    };
  }

  const replaced = new Map(plan.updates.map((report) => [report.id, report]));

  return {
    ok: true,
    profile: validateProfile({
      schemaVersion: 1,
      id: existing.id,
      reports: [
        ...existing.reports.map((report) => replaced.get(report.id) ?? report),
        ...plan.additions,
      ],
    }),
  };
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Remove one Report.
 *
 * Returns `null` when the Profile holds no Report by that id. Every other
 * function that edits a session returns its input unchanged in that case; this
 * one is nullable in the contract, and the only thing the nullability can
 * carry is that there was nothing to delete — which a delete confirmation
 * needs to know before it tells the user it removed something.
 */
export function removeReport(profile: Profile, reportId: string): Profile | null {
  const reports = profile.reports.filter((report) => report.id !== reportId);

  return reports.length === profile.reports.length ? null : { ...profile, reports };
}

/** A Report or Profile id. Created only for something the user confirmed. */
function newId(): string {
  return crypto.randomUUID();
}
