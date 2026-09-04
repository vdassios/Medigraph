import type {
  CollectedAt,
  Conflict,
  IdentifierResolution,
  ParsedRow,
  Profile,
  ReviewReportDraft,
  ReviewSession,
} from './types';
import { isValidCollectedAt } from './types';

/**
 * The review transaction: every edit a user makes to a draft, and the gates
 * that decide whether Confirm may run at all (D6, D7).
 *
 * Every function here is total and immutable. It returns a new session and
 * leaves the one it was given untouched, down to the drafts and rows it did
 * not need to change, which keep their identity so a caller can tell what
 * moved. An edit naming something the session does not hold — an unknown row,
 * candidate or conflict — returns the session unchanged rather than throwing:
 * a review screen races against its own state, and a stale click is not an
 * exception.
 *
 * Nothing here builds a Report. Turning a confirmed session into Reports is
 * `profile.ts`'s work, and it runs only once `canConfirm` is true.
 */

/** A derived marker key, and so a row carrying free text into the Profile. */
function isUnknown(markerKey: string): boolean {
  return markerKey.startsWith('x:');
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Recompute a draft's duplicate-marker conflicts from its current rows.
 *
 * One conflict per marker key held by more than one row, in the order the rows
 * first mention it. A conflict that survives keeps its id, so a rebuild never
 * renames a question the UI is already showing; a new one is named for the
 * draft and the key it is about, which is unique within the draft.
 *
 * A resolution survives only while its candidate set does. A different set is a
 * different question, so the old answer is dropped and Confirm blocks until the
 * user answers again — keeping it could leave a `choose` pointing at a row that
 * is no longer a candidate.
 */
function withRebuiltConflicts(draft: ReviewReportDraft): ReviewReportDraft {
  const rowIdsByMarker = new Map<string, string[]>();

  for (const row of draft.rows) {
    const rowIds = rowIdsByMarker.get(row.markerKey) ?? [];
    rowIds.push(row.id);
    rowIdsByMarker.set(row.markerKey, rowIds);
  }

  const conflicts: Conflict[] = [];

  for (const [markerKey, candidateRowIds] of rowIdsByMarker) {
    if (candidateRowIds.length < 2) {
      continue;
    }

    const prior = draft.conflicts.find((conflict) => conflict.markerKey === markerKey);
    const answered = prior !== undefined && sameSequence(prior.candidateRowIds, candidateRowIds);

    conflicts.push({
      id: prior?.id ?? `${draft.id}:conflict:${markerKey}`,
      markerKey,
      candidateRowIds,
      resolution: answered ? prior.resolution : null,
    });
  }

  return { ...draft, conflicts };
}

/** Apply `edit` to every draft, keeping the identity of those it leaves alone. */
function editDrafts(
  session: ReviewSession,
  edit: (draft: ReviewReportDraft) => ReviewReportDraft,
): ReviewSession {
  const reportDrafts = session.reportDrafts.map(edit);
  return reportDrafts.every((draft, index) => draft === session.reportDrafts[index])
    ? session
    : { ...session, reportDrafts };
}

function withApproval(session: ReviewSession, rowId: string, approved: boolean): ReviewSession {
  if (session.approvedUnknownRowIds.includes(rowId) === approved) {
    return session;
  }

  return {
    ...session,
    approvedUnknownRowIds: approved
      ? [...session.approvedUnknownRowIds, rowId]
      : session.approvedUnknownRowIds.filter((id) => id !== rowId),
  };
}

/**
 * Rewrite the rows of the draft holding `rowId`, then rebuild its conflicts and
 * set the row's unknown-marker approval.
 *
 * Only the draft holding the row is rebuilt. Rebuilding one this edit did not
 * touch would be a no-op at best, and at worst would silently rewrite conflicts
 * built elsewhere.
 */
function editRow(
  session: ReviewSession,
  rowId: string,
  approved: boolean,
  rewrite: (rows: readonly ParsedRow[]) => ParsedRow[],
): ReviewSession {
  const edited = editDrafts(session, (draft) =>
    draft.rows.some((row) => row.id === rowId)
      ? withRebuiltConflicts({ ...draft, rows: rewrite(draft.rows) })
      : draft,
  );

  return edited === session ? session : withApproval(edited, rowId, approved);
}

/**
 * Give one row a different marker key.
 *
 * Reassigning **to** a derived `x:` key approves that unknown: the key is
 * derived from the label, so naming the label the user accepts is the same act
 * as accepting it, and `approvedUnknownLabel` replaces the printed label when
 * supplied. Reassigning to a canonical key withdraws any approval the row
 * held — a canonical Measurement carries no label, so there is nothing left to
 * approve — and ignores `approvedUnknownLabel`.
 *
 * Either way the draft's conflicts are rebuilt immediately, because moving a
 * row between marker keys is exactly what creates and resolves duplicates.
 */
export function reassignMarker(
  session: ReviewSession,
  rowId: string,
  markerKey: string,
  approvedUnknownLabel: string | null,
): ReviewSession {
  const unknown = isUnknown(markerKey);
  const label = unknown ? approvedUnknownLabel : null;

  return editRow(session, rowId, unknown, (rows) =>
    rows.map((row) => (row.id === rowId ? { ...row, markerKey, label: label ?? row.label } : row)),
  );
}

/**
 * Accept a row the parser keyed as an unknown marker, printed label and all.
 *
 * Only a derived `x:` row can be approved; a canonical row has nothing to
 * approve and the session comes back unchanged. No conflict rebuild is needed
 * either, because approval moves no row between marker keys.
 */
export function approveUnknownMarker(session: ReviewSession, rowId: string): ReviewSession {
  const row = session.reportDrafts.flatMap((draft) => draft.rows).find((each) => each.id === rowId);

  return row !== undefined && isUnknown(row.markerKey)
    ? withApproval(session, rowId, true)
    : session;
}

/** Drop one row from its draft, withdrawing its approval and rebuilding conflicts. */
export function deleteRow(session: ReviewSession, rowId: string): ReviewSession {
  return editRow(session, rowId, false, (rows) => rows.filter((row) => row.id !== rowId));
}

/** Remove every occurrence of `text` from one field, or leave it null. */
function scrubbed(field: string, text: string): string;
function scrubbed(field: string | null, text: string): string | null;
function scrubbed(field: string | null, text: string): string | null {
  if (field?.includes(text) !== true) {
    return field;
  }

  return field.split(text).join('').replace(/\s+/gu, ' ').trim();
}

/**
 * Take one identifier candidate off the D7 gate.
 *
 * `redacted` also removes the candidate's text from every draft row's free
 * text — the printed label, a categorical result and the reference string a
 * laboratory printed beside it. An approved unknown label is the one path
 * source text takes into a Profile, so an identifier the user has just called
 * real must not survive inside one. `deleted-row` and `false-positive` record
 * the answer and change no row: deleting is `deleteRow`'s job, and a false
 * positive was never an identifier to begin with.
 */
export function resolveIdentifier(
  session: ReviewSession,
  candidateId: string,
  resolution: IdentifierResolution,
): ReviewSession {
  const candidate = session.results
    .flatMap((result) => result.identifierCandidates)
    .find((identifier) => identifier.id === candidateId);

  if (candidate === undefined) {
    return session;
  }

  const recorded: ReviewSession = {
    ...session,
    identifierResolutions: { ...session.identifierResolutions, [candidateId]: resolution },
  };

  if (resolution !== 'redacted' || candidate.text === '') {
    return recorded;
  }

  return editDrafts(recorded, (draft) => {
    const rows = draft.rows.map((row) => {
      const label = scrubbed(row.label, candidate.text);
      const textValue = scrubbed(row.textValue, candidate.text);
      const categoricalReference = scrubbed(row.categoricalReference, candidate.text);

      return label === row.label &&
        textValue === row.textValue &&
        categoricalReference === row.categoricalReference
        ? row
        : { ...row, label, textValue, categoricalReference };
    });

    return rows.every((row, index) => row === draft.rows[index]) ? draft : { ...draft, rows };
  });
}

/**
 * Answer one duplicate-marker conflict, or withdraw the answer with `null`.
 *
 * A `choose` naming a row that is not one of the conflict's candidates is
 * refused outright: storing it would satisfy the gate with an answer no Report
 * can be built from.
 */
export function resolveConflict(
  session: ReviewSession,
  conflictId: string,
  resolution: Conflict['resolution'],
): ReviewSession {
  return editDrafts(session, (draft) => {
    const target = draft.conflicts.find((conflict) => conflict.id === conflictId);
    if (target === undefined) {
      return draft;
    }

    if (resolution?.kind === 'choose' && !target.candidateRowIds.includes(resolution.rowId)) {
      return draft;
    }

    const conflicts = draft.conflicts.map((conflict) =>
      conflict.id === conflictId ? { ...conflict, resolution } : conflict,
    );

    return { ...draft, conflicts };
  });
}

/** The Report identities the session proposes, each with the date it would carry. */
function proposedDates(session: ReviewSession, existing: Profile | null): CollectedAt[] {
  const dates: CollectedAt[] = [];

  for (const report of existing?.reports ?? []) {
    dates.push(session.existingReportDateUpdates[report.id] ?? report.collectedAt);
  }

  for (const draft of session.reportDrafts) {
    // A draft aimed at an existing Report adds Measurements to it and creates
    // no second Report, so it proposes no date of its own.
    if (draft.targetReportId === null && draft.collectedAt !== null) {
      dates.push(draft.collectedAt);
    }
  }

  return dates;
}

/**
 * Two Reports may share a date only when both name a distinct minute.
 *
 * The persisted schema is the authority on this rule; it is asked again here
 * because Confirm has to be blocked before any Report exists to validate.
 */
function satisfiesSameDayPrecision(dates: readonly CollectedAt[]): boolean {
  const timesByDate = new Map<string, (string | null)[]>();

  for (const { date, time } of dates) {
    const times = timesByDate.get(date) ?? [];
    times.push(time);
    timesByDate.set(date, times);
  }

  return [...timesByDate.values()].every(
    (times) => times.length < 2 || (!times.includes(null) && new Set(times).size === times.length),
  );
}

/**
 * Whether the single atomic Confirm may run (D6, D7).
 *
 * Every gate below blocks it, and none of them is discharged by any extractor,
 * by Pass V's pre-applied redactions, or by confidence: they are the user's
 * answers, and this function only asks whether all of them are in.
 *
 * A session proposing nothing cannot be confirmed. There is no Report to
 * write, and enabling the one irreversible action in the product to do nothing
 * is worse than leaving it disabled.
 */
export function canConfirm(session: ReviewSession, existing: Profile | null): boolean {
  if (session.reportDrafts.length === 0) {
    return false;
  }

  // D6: the collection date is presented for confirmation, never assumed.
  const datesConfirmed = session.reportDrafts.every(
    (draft) =>
      draft.collectedAt !== null && draft.dateConfirmed && isValidCollectedAt(draft.collectedAt),
  );

  // Every duplicate marker has exactly one surviving Measurement.
  const conflictsResolved = session.reportDrafts.every((draft) =>
    draft.conflicts.every((conflict) => conflict.resolution !== null),
  );

  // D7: every candidate is redacted, deleted or dismissed — no silent pass.
  const identifiersResolved = session.results.every((result) =>
    result.identifierCandidates.every(
      (candidate) => session.identifierResolutions[candidate.id] !== undefined,
    ),
  );

  // The one free-text path into a Profile is a label the user approved.
  const unknownsApproved = session.reportDrafts.every((draft) =>
    draft.rows.every(
      (row) => !isUnknown(row.markerKey) || session.approvedUnknownRowIds.includes(row.id),
    ),
  );

  const targetsExist = session.reportDrafts.every(
    (draft) =>
      draft.targetReportId === null ||
      (existing?.reports ?? []).some((report) => report.id === draft.targetReportId),
  );

  // D8: appending to someone's existing history is an explicit, unverified
  // question. The document's ΑΜΚΑ could answer it and is deliberately not used.
  const samePersonSettled =
    (existing?.reports.length ?? 0) === 0 || session.samePersonConfirmed === true;

  const stagedDatesValid = Object.values(session.existingReportDateUpdates).every((collectedAt) =>
    isValidCollectedAt(collectedAt),
  );

  return (
    datesConfirmed &&
    conflictsResolved &&
    identifiersResolved &&
    unknownsApproved &&
    targetsExist &&
    samePersonSettled &&
    stagedDatesValid &&
    satisfiesSameDayPrecision(proposedDates(session, existing))
  );
}
