import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { parseNumber } from '../domain/numbers';
import { parseRange } from '../domain/ranges';
import { setReportDate, targetExistingReport, stageExistingReportDate } from '../domain/profile';
import { MARKERS } from '../domain/registry';
import {
  approveUnknownMarker,
  canConfirm,
  confirmSamePerson,
  deleteRow,
  editRowMeasurement,
  reassignMarker,
  resolveConflict,
  resolveIdentifier,
} from '../domain/review';
import { normaliseLabel } from '../domain/text';
import { normaliseUnit } from '../domain/units';
import type {
  CollectedAt,
  Conflict,
  MarkerDef,
  ParsedRow,
  Profile,
  Report,
  ReviewReportDraft,
  ReviewSession,
  SourceRef,
} from '../domain/types';
import type { EvidenceLookup } from './appState';
import type { Copy } from './i18n';
import { localisedDate, useCopy, useLanguage } from './i18n';

/**
 * The review transaction, on screen: every gate D6, D7 and D8 raise, and every
 * tool for answering them.
 *
 * **It decides nothing.** Each control calls one `review.ts` or `profile.ts`
 * function and hands the resulting session upward through `onChange`; Confirm
 * asks `canConfirm` rather than any opinion of its own, so no arrangement of
 * this screen can widen what the domain permits. The checklist beside Confirm
 * explains a refusal, and is deliberately separate from the refusal itself.
 *
 * **The only state it keeps is the state of an unfinished edit** — the text in
 * a field the user is still typing into, which row's evidence is open, which
 * marker search is showing. None of it is a Profile value: an edit becomes part
 * of the session when it is saved, and until then it exists nowhere else, so
 * abandoning it costs the record nothing.
 *
 * Every string it shows comes from `i18n.ts`, in the reader's language, and a
 * date is always shown with its ISO form beside it: `05/04` is April in one
 * country and May in another, and this screen is where a user confirms which
 * day a sample was taken.
 */

export interface ReviewTableProps {
  session: ReviewSession;
  existingProfile: Profile | null;
  onChange(session: ReviewSession): void;
  onInspectSource(sourceRef: SourceRef): EvidenceLookup;
  onConfirm(): void;
  onCancel(): void;
}

/** The text of one row's result, as it stands in the session. */
function printedValue(row: ParsedRow): string {
  if (row.status === 'categorical') {
    return row.textValue ?? '';
  }
  if (row.status === 'missing' || row.value === null) {
    return '—';
  }

  return `${row.comparator ?? ''}${String(row.value)}`;
}

function printedRange(row: ParsedRow): string {
  const range = row.referenceRange;
  if (range === null) {
    return row.categoricalReference ?? '';
  }
  if (range.kind === 'closed') {
    return `${String(range.min)}–${String(range.max)}`;
  }

  return range.kind === 'minOnly'
    ? `${range.comparator}${String(range.min)}`
    : `${range.comparator}${String(range.max)}`;
}

/**
 * Whether this row is one the user is being asked to look at (Task 4.2a).
 *
 * A row the parser is sure of and flagged nothing on is **pre-accepted**: it
 * collapses into a count with a disclosure, and Confirm accepts it with every
 * other. That is a change to how much has to be read, never to what may be
 * confirmed — the four questions that block Confirm keep their row on screen
 * regardless of confidence, because a gate nobody can see is not a gate.
 *
 * An approved unknown collapses, since it has been answered; its label stays
 * listed in the identifier panel, which is where free text heading into a
 * Profile is read.
 */
function needsReview(row: ParsedRow, session: ReviewSession, draft: ReviewReportDraft): boolean {
  if (row.confidence !== 'high' || row.flags.length > 0) {
    return true;
  }
  if (isUnknown(row.markerKey) && !session.approvedUnknownRowIds.includes(row.id)) {
    return true;
  }

  return draft.conflicts.some(
    (conflict) => conflict.resolution === null && conflict.candidateRowIds.includes(row.id),
  );
}

/** A row the user has not adjudicated yet sorts above one the parser is sure of. */
function reviewOrder(a: ParsedRow, b: ParsedRow): number {
  const weight = (row: ParsedRow): number =>
    (row.flags.length > 0 ? 0 : 2) + (row.confidence === 'low' ? 0 : 1);

  return weight(a) - weight(b) || a.sourceOrder - b.sourceOrder;
}

function isUnknown(markerKey: string): boolean {
  return markerKey.startsWith('x:');
}

/** The registry entries whose printed names match what the user typed. */
function searchMarkers(query: string): MarkerDef[] {
  const needle = normaliseLabel(query);
  if (needle === '') {
    return [];
  }

  return MARKERS.filter((marker) =>
    [marker.el, marker.en, ...marker.abbreviations, ...marker.aliases].some((name) =>
      normaliseLabel(name).includes(needle),
    ),
  ).slice(0, 8);
}

function markerName(markerKey: string, label: string): string {
  return MARKERS.find((marker) => marker.id === markerKey)?.el ?? label;
}

/** Every row whose free text carries an identifier the user has just named real. */
function rowsCarrying(session: ReviewSession, text: string): ParsedRow[] {
  if (text === '') {
    return [];
  }

  return session.reportDrafts.flatMap((draft) =>
    draft.rows.filter((row) =>
      [row.label, row.textValue, row.categoricalReference].some((field) => field?.includes(text)),
    ),
  );
}

/**
 * What is still standing between this session and Confirm.
 *
 * `canConfirm` is the authority and this list is the explanation — they are
 * deliberately separate. A checklist that could enable the button would be a
 * second gate, and the gate that shipped first would be the one nobody read.
 */
function blockers(
  session: ReviewSession,
  existing: Profile | null,
  copy: Copy['review'],
): string[] {
  const reasons: string[] = [];
  const unconfirmedDates = session.reportDrafts.filter((draft) => !draft.dateConfirmed).length;
  const unresolvedConflicts = session.reportDrafts.flatMap((draft) =>
    draft.conflicts.filter((conflict) => conflict.resolution === null),
  ).length;
  const openIdentifiers = session.results.flatMap((result) =>
    result.identifierCandidates.filter(
      (candidate) => session.identifierResolutions[candidate.id] === undefined,
    ),
  ).length;
  const unapproved = session.reportDrafts.flatMap((draft) =>
    draft.rows.filter(
      (row) => isUnknown(row.markerKey) && !session.approvedUnknownRowIds.includes(row.id),
    ),
  ).length;

  if (unconfirmedDates > 0) {
    reasons.push(copy.blockers.dates(unconfirmedDates));
  }
  if (openIdentifiers > 0) {
    reasons.push(copy.blockers.identifiers(openIdentifiers));
  }
  if (unresolvedConflicts > 0) {
    reasons.push(copy.blockers.conflicts(unresolvedConflicts));
  }
  if (unapproved > 0) {
    reasons.push(copy.blockers.unknowns(unapproved));
  }
  if ((existing?.reports.length ?? 0) > 0 && session.samePersonConfirmed !== true) {
    reasons.push(copy.blockers.samePerson);
  }
  if (session.reportDrafts.length === 0) {
    reasons.push(copy.blockers.nothing);
  }

  // Everything above is answered and Confirm is still shut: the remaining
  // gates are the ones only `canConfirm` can see — a date that is not a real
  // calendar day, two exams sharing a day with no distinct time, a draft aimed
  // at a Report that already holds one of its markers.
  if (reasons.length === 0 && !canConfirm(session, existing)) {
    reasons.push(copy.blockers.calendar);
  }

  return reasons;
}

/**
 * A screen region, plus the way it reports an edit the user has not saved.
 *
 * An open editor holding a changed value is not in the session, so Confirm
 * would write the value it replaced. The screen therefore refuses while one is
 * open — narrowing what the domain permits, never widening it, which is the
 * only direction a UI may move a gate.
 */
interface RegionProps {
  session: ReviewSession;
  existingProfile: Profile | null;
  onChange: (session: ReviewSession) => void;
  onInspectSource: (sourceRef: SourceRef) => EvidenceLookup;
  onConfirm: () => void;
  onCancel: () => void;
  onPending: (key: string, dirty: boolean) => void;
}

export function ReviewTable(props: ReviewTableProps): JSX.Element {
  const { session, existingProfile } = props;
  const copy = useCopy().review;
  const [pending, setPending] = useState<readonly string[]>([]);

  const onPending = (key: string, dirty: boolean): void => {
    setPending((open) =>
      dirty ? (open.includes(key) ? open : [...open, key]) : open.filter((each) => each !== key),
    );
  };

  // The exported props declare their callbacks as methods, which is how the
  // plan lists them; the regions below take them as properties so they can be
  // destructured without unbinding anything.
  const region: RegionProps = {
    session,
    existingProfile,
    onChange: (next) => {
      props.onChange(next);
    },
    onInspectSource: (ref) => props.onInspectSource(ref),
    onConfirm: () => {
      props.onConfirm();
    },
    onCancel: () => {
      props.onCancel();
    },
    onPending,
  };
  const reasons = blockers(session, existingProfile, copy);
  if (pending.length > 0) {
    reasons.push(copy.blockers.unsaved(pending.length));
  }

  return (
    <section
      class="review"
      data-testid="review"
      aria-labelledby="review-heading"
      // Surfaced so the walking slice can assert it from outside the app: a
      // result carrying a different vocabulary is a different result.
      data-registry-version={session.results.map((result) => result.registryVersion).join(',')}
    >
      <h2 id="review-heading">{copy.heading}</h2>

      <IdentifierPanel {...region} />

      {(existingProfile?.reports.length ?? 0) > 0 && <SamePersonGate {...region} />}

      {session.reportDrafts.map((draft) => (
        <DraftView key={draft.id} draft={draft} {...region} />
      ))}

      <footer class="review-actions">
        {reasons.length > 0 && (
          <div data-testid="blockers">
            <p>{copy.blockersTitle}</p>
            <ul>
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
        <button
          type="button"
          data-testid="confirm"
          disabled={!canConfirm(session, existingProfile) || pending.length > 0}
          onClick={() => {
            props.onConfirm();
          }}
        >
          {copy.confirm}
        </button>{' '}
        <button
          type="button"
          data-testid="cancel"
          onClick={() => {
            props.onCancel();
          }}
        >
          {copy.cancel}
        </button>
      </footer>
    </section>
  );
}

/**
 * The D7 gate, first on the screen because it is the one about the person.
 *
 * Every candidate the extractor found is answered explicitly — redact, delete
 * the rows carrying it, or say it was never an identifier — and nothing is
 * discharged by silence. `Redact` removes the text from the session's rows as
 * well as recording the answer, which is why an answer changed afterwards
 * cannot bring the text back and says so.
 *
 * The approved unknown labels sit in the same panel. They are the one path
 * source text takes into a stored Profile, so the place to read them is beside
 * the identifiers, not buried in a table of numbers.
 */
function IdentifierPanel({ session, onChange }: RegionProps): JSX.Element {
  const copy = useCopy().review;
  const candidates = session.results.flatMap((result) => result.identifierCandidates);
  const unknownRows = session.reportDrafts.flatMap((draft) =>
    draft.rows.filter((row) => isUnknown(row.markerKey)),
  );

  return (
    <section class="review-identifiers" data-testid="identifiers">
      <h3>{copy.identifiers}</h3>
      <p>{copy.identifiersHelp}</p>

      {candidates.length === 0 && <p data-testid="identifiers-empty">{copy.identifiersEmpty}</p>}

      <ul>
        {candidates.map((candidate) => {
          const answer = session.identifierResolutions[candidate.id];
          const affected = rowsCarrying(session, candidate.text);

          return (
            <li key={candidate.id} data-testid={`identifier-${candidate.id}`} data-answer={answer}>
              <span data-testid="identifier-kind">{copy.identifierKinds[candidate.kind]}</span>
              {/*
                Once it has been called real and removed, the screen stops
                echoing it. Leaving it on display would contradict the answer
                the user just gave and keep the text in the one place they
                asked for it to be gone from.
              */}
              {answer === 'redacted' ? null : (
                <>
                  : <span data-testid="identifier-text">{candidate.text}</span>
                </>
              )}{' '}
              {answer === undefined ? (
                <>
                  <button
                    type="button"
                    data-testid="redact-identifier"
                    onClick={() => {
                      onChange(resolveIdentifier(session, candidate.id, 'redacted'));
                    }}
                  >
                    {copy.redact}
                  </button>{' '}
                  <button
                    type="button"
                    data-testid="delete-identifier-rows"
                    onClick={() => {
                      const cleared = affected.reduce(
                        (next, row) => deleteRow(next, row.id),
                        session,
                      );
                      onChange(resolveIdentifier(cleared, candidate.id, 'deleted-row'));
                    }}
                  >
                    {copy.deleteRows(affected.length)}
                  </button>{' '}
                  <button
                    type="button"
                    data-testid="dismiss-identifier"
                    onClick={() => {
                      onChange(resolveIdentifier(session, candidate.id, 'false-positive'));
                    }}
                  >
                    {copy.dismiss}
                  </button>
                </>
              ) : (
                <span data-testid="identifier-answer">{copy.answered[answer]}</span>
              )}
            </li>
          );
        })}
      </ul>

      {unknownRows.length > 0 && (
        <div data-testid="free-text">
          <h4>{copy.freeText}</h4>
          <p>{copy.freeTextHelp}</p>
          <ul>
            {unknownRows.map((row) => (
              <li key={row.id} data-testid="free-text-label">
                {row.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** D8: an explicit, unverified question, asked of the user and never of the document. */
function SamePersonGate({ session, existingProfile, onChange }: RegionProps): JSX.Element {
  const copy = useCopy().review;
  const language = useLanguage();
  const reports = existingProfile?.reports ?? [];
  const latest = [...reports].sort((a, b) => a.collectedAt.date.localeCompare(b.collectedAt.date));

  return (
    <section class="review-same-person" data-testid="same-person">
      <p>
        {copy.stored(
          reports.length,
          localisedDate(latest.at(-1)?.collectedAt.date ?? '', language),
        )}
      </p>
      <label>
        <input
          type="checkbox"
          data-testid="confirm-same-person"
          checked={session.samePersonConfirmed === true}
          onChange={(event) => {
            onChange(confirmSamePerson(session, event.currentTarget.checked ? true : null));
          }}
        />{' '}
        {copy.samePerson}
      </label>
      <p>{copy.samePersonHelp}</p>
    </section>
  );
}

/** The `CollectedAt` a date field and an optional time field describe. */
function collectedAtOf(date: string, time: string): CollectedAt {
  return time === '' ? { date, time: null, precision: 'day' } : { date, time, precision: 'minute' };
}

/**
 * One document, one proposed Report (D6).
 *
 * The date is pre-filled from `Ημερομηνία Λήψης Δείγματος` and unconfirmed:
 * one tap on a value the user has looked at discharges it. Editing the field
 * reopens the question — that affordance is this screen's, which is why the
 * typed value is held here until the tap rather than written into the session
 * on every keystroke, where it would arrive already confirmed.
 */
function DraftView({ draft, ...props }: RegionProps & { draft: ReviewReportDraft }): JSX.Element {
  const { session, existingProfile, onChange, onPending } = props;
  const copy = useCopy().review;
  const language = useLanguage();
  const [date, setDate] = useState(draft.collectedAt?.date ?? '');
  const [time, setTime] = useState(draft.collectedAt?.time ?? '');

  const stored = draft.collectedAt;
  const dirty = date !== (stored?.date ?? '') || time !== (stored?.time ?? '');
  const sorted = [...draft.rows].sort(reviewOrder);
  const rows = sorted.filter((row) => needsReview(row, session, draft));
  const preAccepted = sorted.filter((row) => !needsReview(row, session, draft));
  const sameDay = (existingProfile?.reports ?? []).filter(
    (report) => report.collectedAt.date === date,
  );

  return (
    <article class="review-draft" data-testid={`draft-${draft.sourceIds.join('+')}`}>
      <h3>
        <SourceName draft={draft} {...props} />
      </h3>
      <p data-testid="draft-rows">{copy.rowCount(draft.rows.length)}</p>

      <p class="review-date">
        <label>
          {copy.dateLabel}{' '}
          <input
            type="date"
            data-testid="draft-date"
            value={date}
            onInput={(event) => {
              setDate(event.currentTarget.value);
              onPending(`${draft.id}:date`, true);
            }}
          />
        </label>{' '}
        <label>
          {copy.timeLabel}{' '}
          <input
            type="time"
            data-testid="draft-time"
            value={time}
            onInput={(event) => {
              setTime(event.currentTarget.value);
              onPending(`${draft.id}:date`, true);
            }}
          />
        </label>{' '}
        <button
          type="button"
          data-testid="confirm-date"
          disabled={date === '' || (draft.dateConfirmed && !dirty)}
          onClick={() => {
            onChange(setReportDate(session, draft.id, collectedAtOf(date, time)));
            onPending(`${draft.id}:date`, false);
          }}
        >
          {copy.confirmDate}
        </button>{' '}
        {draft.dateConfirmed && !dirty && (
          <span data-testid="date-confirmed">
            {copy.dateConfirmed} {localisedDate(date, language)}
          </span>
        )}
      </p>

      {sameDay.length > 0 && (
        <div data-testid="same-day">
          <p>{copy.sameDay(localisedDate(date, language))}</p>
          <ul>
            {sameDay.map((report) => (
              <li key={report.id}>
                <label>
                  {copy.storedTime}{' '}
                  <input
                    type="time"
                    data-testid={`stage-time-${report.id}`}
                    value={
                      session.existingReportDateUpdates[report.id]?.time ??
                      report.collectedAt.time ??
                      ''
                    }
                    onInput={(event) => {
                      onChange(
                        stageExistingReportDate(
                          session,
                          report.id,
                          collectedAtOf(report.collectedAt.date, event.currentTarget.value),
                        ),
                      );
                    }}
                  />
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(existingProfile?.reports.length ?? 0) > 0 && (
        <p>
          <label>
            {copy.targetLabel}{' '}
            <select
              data-testid="draft-target"
              value={draft.targetReportId ?? ''}
              onChange={(event) => {
                const chosen = event.currentTarget.value;
                onChange(targetExistingReport(session, draft.id, chosen === '' ? null : chosen));
              }}
            >
              <option value="">{copy.targetNew}</option>
              {(existingProfile?.reports ?? []).map((report: Report) => (
                <option key={report.id} value={report.id}>
                  {copy.targetExisting(localisedDate(report.collectedAt.date, language))}
                </option>
              ))}
            </select>
          </label>
        </p>
      )}

      {draft.conflicts.map((conflict) => (
        <ConflictView key={conflict.id} conflict={conflict} draft={draft} {...props} />
      ))}

      {rows.length > 0 ? (
        <RowTable rows={rows} triage="expanded" {...props} />
      ) : (
        <p data-testid="nothing-to-review">{copy.nothingToReview}</p>
      )}

      {preAccepted.length > 0 && (
        <details class="review-pre-accepted" data-testid="pre-accepted">
          <summary>
            <span data-testid="pre-accepted-count">{preAccepted.length}</span>{' '}
            {copy.preAccepted(preAccepted.length).replace(`${String(preAccepted.length)} `, '')}
          </summary>
          <RowTable rows={preAccepted} triage="pre-accepted" {...props} />
        </details>
      )}
    </article>
  );
}

/** The document a draft came from, named by the evidence the island still holds. */
function SourceName({
  draft,
  onInspectSource,
}: RegionProps & { draft: ReviewReportDraft }): JSX.Element {
  const copy = useCopy().review;
  const ref = draft.rows.find((row) => row.sourceRef !== undefined)?.sourceRef;
  const found = ref === undefined ? null : onInspectSource(ref);

  return (
    <span data-testid="draft-source">
      {found?.kind === 'evidence' ? found.resource.file.name : copy.document}
    </span>
  );
}

/**
 * A marker two rows claim, and the one Measurement that may survive it.
 *
 * "Keep both" is not a resolution: a Report holds one Measurement per marker
 * key. The screen offers choose, and offers correction by editing a candidate
 * before choosing it — so no Measurement is ever constructed outside the
 * domain, which is where the rule about what a Measurement may hold lives.
 */
function ConflictView({
  conflict,
  draft,
  session,
  onChange,
}: RegionProps & { conflict: Conflict; draft: ReviewReportDraft }): JSX.Element {
  const copy = useCopy().review;
  const candidates = draft.rows.filter((row) => conflict.candidateRowIds.includes(row.id));
  const { resolution } = conflict;

  return (
    <div class="review-conflict" data-testid={`conflict-${conflict.markerKey}`}>
      <p>{copy.conflict(markerName(conflict.markerKey, conflict.markerKey), candidates.length)}</p>

      {resolution === null ? (
        <ul>
          {candidates.map((row) => (
            <li key={row.id}>
              {printedValue(row)} {row.unit ?? ''}{' '}
              <button
                type="button"
                data-testid={`resolve-conflict-${conflict.markerKey}`}
                onClick={() => {
                  onChange(
                    resolveConflict(session, conflict.id, { kind: 'choose', rowId: row.id }),
                  );
                }}
              >
                {copy.keepThis}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          <span data-testid="conflict-answer">{copy.conflictAnswered}</span>{' '}
          <button
            type="button"
            data-testid="change-conflict"
            onClick={() => {
              onChange(resolveConflict(session, conflict.id, null));
            }}
          >
            {copy.changeConflict}
          </button>
        </p>
      )}
    </div>
  );
}

/** One parsed row, and every tool review has for disagreeing with it. */
function RowView({
  row,
  triage,
  ...props
}: RegionProps & { row: ParsedRow; triage: 'expanded' | 'pre-accepted' }): JSX.Element {
  const { session, onChange, onPending } = props;
  const copy = useCopy().review;
  const [editing, setEditing] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  // Where focus goes when a panel this row opened closes again. A keyboard
  // user who cancels an edit must land back on the control they opened it
  // with, not on the document body with their place in the table lost.
  const editRef = useRef<HTMLButtonElement | null>(null);
  const reassignRef = useRef<HTMLButtonElement | null>(null);

  const unknown = isUnknown(row.markerKey);
  const approved = session.approvedUnknownRowIds.includes(row.id);

  return (
    <tr
      data-testid={`row-${row.id}`}
      data-triage={triage}
      data-confidence={row.confidence}
      data-flagged={row.flags.length > 0 ? 'true' : 'false'}
    >
      <th scope="row">
        <span data-testid="row-marker">{markerName(row.markerKey, row.label)}</span>
        {unknown && (
          <>
            {' '}
            <span data-testid="row-unknown">{copy.unknownMarker}</span>
            {approved && <span data-testid="row-approved"> — {copy.approvedMarker}</span>}
          </>
        )}
        {row.flags.map((flag) => (
          <span key={flag} data-testid={`row-flag-${flag}`}>
            {' '}
            {copy.flags[flag]}
          </span>
        ))}
      </th>
      <td data-testid="row-value">{printedValue(row)}</td>
      <td data-testid="row-unit">{row.unit ?? ''}</td>
      <td data-testid="row-range">{printedRange(row)}</td>
      <td>
        {unknown && !approved && (
          <>
            <button
              type="button"
              data-testid="approve-unknown"
              onClick={() => {
                onChange(approveUnknownMarker(session, row.id));
              }}
            >
              {copy.approve}
            </button>{' '}
          </>
        )}
        <button
          type="button"
          data-testid="reassign-row"
          ref={reassignRef}
          onClick={() => {
            setReassigning(!reassigning);
          }}
        >
          {copy.reassign}
        </button>{' '}
        <button
          type="button"
          data-testid="edit-row"
          ref={editRef}
          onClick={() => {
            setEditing(!editing);
            onPending(`${row.id}:edit`, false);
          }}
        >
          {copy.edit}
        </button>{' '}
        <button
          type="button"
          data-testid="delete-row"
          onClick={() => {
            onChange(deleteRow(session, row.id));
          }}
        >
          {copy.remove}
        </button>{' '}
        {row.sourceRef !== undefined && (
          <button
            type="button"
            data-testid="inspect-source"
            onClick={() => {
              setInspecting(!inspecting);
            }}
          >
            {copy.inspect}
          </button>
        )}
        {reassigning && (
          <ReassignPanel
            row={row}
            {...props}
            onDone={() => {
              setReassigning(false);
              reassignRef.current?.focus();
            }}
          />
        )}
        {editing && (
          <RowEditor
            row={row}
            {...props}
            onDone={() => {
              setEditing(false);
              onPending(`${row.id}:edit`, false);
              editRef.current?.focus();
            }}
          />
        )}
        {/*
          The crop opens with the editor as well as on request (Task 4.2a):
          correcting a value is exactly the moment the document is worth
          seeing, and a correction made from memory is a worse record than the
          parse it replaces. One element either way — two would be two answers
          to the same question.
        */}
        {(inspecting || editing) && row.sourceRef !== undefined && (
          <EvidenceView sourceRef={row.sourceRef} {...props} />
        )}
      </td>
    </tr>
  );
}

/**
 * Give a row a different marker, by searching the registry the parser used.
 *
 * Reassigning to a canonical marker withdraws any unknown approval the row
 * held, and reassigning to the key derived from its own label approves it: the
 * domain does both, so this panel only has to name what the user picked.
 */
function ReassignPanel({
  row,
  session,
  onChange,
  onDone,
}: RegionProps & { row: ParsedRow; onDone: () => void }): JSX.Element {
  const copy = useCopy().review;
  const [query, setQuery] = useState('');
  const matches = searchMarkers(query);

  return (
    <div class="review-reassign" data-testid="reassign-panel">
      <label>
        {copy.reassignSearch}{' '}
        <input
          type="search"
          data-testid="reassign-search"
          value={query}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
          }}
        />
      </label>
      <ul>
        {matches.map((marker) => (
          <li key={marker.id}>
            <button
              type="button"
              data-testid={`reassign-to-${marker.id}`}
              onClick={() => {
                onChange(reassignMarker(session, row.id, marker.id, null));
                onDone();
              }}
            >
              {marker.el} ({marker.en})
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Correct what the parser read, in the shapes a Measurement may take.
 *
 * The inputs are the printed forms — `<75`, `4,2`, `12-15` — read by the same
 * `parseNumber` and `parseRange` the extractor used, so a value typed here and
 * a value read from the document go through one parser. Save stays shut while
 * the fields do not describe a Measurement the schema would accept, because
 * the alternative is a refusal at Confirm, where the only answer available is
 * to reject the whole batch.
 */
function RowEditor({
  row,
  session,
  onChange,
  onPending,
  onDone,
}: RegionProps & { row: ParsedRow; onDone: () => void }): JSX.Element {
  const copy = useCopy().review;
  const [status, setStatus] = useState<ParsedRow['status']>(row.status);
  const [value, setValue] = useState(row.value === null ? '' : String(row.value));
  const [text, setText] = useState(row.textValue ?? '');
  const [unit, setUnit] = useState(row.unit ?? '');
  const [range, setRange] = useState('');

  const tokens = (input: string): string[] => input.trim().split(/\s+/u).filter(Boolean);
  const parsedValue = parseNumber(tokens(value));
  const parsedRange = range.trim() === '' ? null : parseRange(tokens(range));
  const complete =
    status === 'missing' ||
    (status === 'value' && parsedValue !== null) ||
    (status === 'categorical' && text.trim() !== '');

  const dirty = (): void => {
    onPending(`${row.id}:edit`, true);
  };

  return (
    <div class="review-editor" data-testid="row-editor">
      <label>
        {copy.resultKind}{' '}
        <select
          data-testid="edit-status"
          value={status}
          onChange={(event) => {
            setStatus(event.currentTarget.value as ParsedRow['status']);
            dirty();
          }}
        >
          {(['value', 'categorical', 'missing'] as const).map((each) => (
            <option key={each} value={each}>
              {copy.kinds[each]}
            </option>
          ))}
        </select>
      </label>
      {status === 'value' && (
        <>
          <label>
            {copy.valueLabel}{' '}
            <input
              type="text"
              inputMode="decimal"
              data-testid="edit-value"
              value={value}
              onInput={(event) => {
                setValue(event.currentTarget.value);
                dirty();
              }}
            />
          </label>
          <label>
            {copy.unitLabel}{' '}
            <input
              type="text"
              data-testid="edit-unit"
              value={unit}
              onInput={(event) => {
                setUnit(event.currentTarget.value);
                dirty();
              }}
            />
          </label>
          <label>
            {copy.rangeLabel}{' '}
            <input
              type="text"
              data-testid="edit-range"
              value={range}
              placeholder={printedRange(row)}
              onInput={(event) => {
                setRange(event.currentTarget.value);
                dirty();
              }}
            />
          </label>
        </>
      )}
      {status === 'categorical' && (
        <label>
          {copy.textLabel}{' '}
          <input
            type="text"
            data-testid="edit-text"
            value={text}
            onInput={(event) => {
              setText(event.currentTarget.value);
              dirty();
            }}
          />
        </label>
      )}
      <button
        type="button"
        data-testid="save-row"
        disabled={!complete}
        onClick={() => {
          onChange(
            editRowMeasurement(session, row.id, {
              status,
              value: parsedValue?.value ?? null,
              comparator: parsedValue?.comparator ?? null,
              textValue: text.trim() === '' ? null : text.trim(),
              unit: unit.trim() === '' ? null : normaliseUnit(unit),
              referenceRange: range.trim() === '' ? row.referenceRange : parsedRange,
              categoricalReference: row.categoricalReference,
            }),
          );
          onDone();
        }}
      >
        {copy.save}
      </button>{' '}
      <button
        type="button"
        data-testid="cancel-row-edit"
        onClick={() => {
          onDone();
        }}
      >
        {copy.cancelEdit}
      </button>
    </div>
  );
}

/**
 * What the document says where this row came from.
 *
 * There is no rasteriser in the product — E1 died with ADR-0013 and nothing
 * else draws a PDF page — so the evidence beside a row is the source text the
 * extractor read on that page, plus the document and page it is in. It is
 * asked of the island rather than read from a map this component holds: a
 * child that could hold the map could keep a reference into it past release.
 *
 * Every refusal renders, because each says something different. A page outside
 * the document is a bug worth seeing; an adapter that never had evidence is
 * not the same thing, and neither is a batch whose evidence has been released.
 */
function EvidenceView({
  sourceRef,
  session,
  onInspectSource,
}: RegionProps & { sourceRef: SourceRef }): JSX.Element {
  const copy = useCopy().review;
  const found = onInspectSource(sourceRef);
  const page = session.results.find((result) => result.sourceId === sourceRef.sourceId)
    ?.evidencePages?.[sourceRef.page - 1];

  const box = sourceRef.box;
  const line =
    page === undefined
      ? []
      : page
          .filter(
            (item) => box === undefined || (item.y < box.y + box.h && item.y + item.h > box.y),
          )
          .map((item) => item.text);

  return (
    <div class="review-evidence" data-testid="evidence" data-kind={found.kind}>
      {found.kind === 'evidence' ? (
        <>
          <p data-testid="evidence-source">
            {copy.evidencePage(found.resource.file.name, found.page)}
          </p>
          {line.length > 0 && <p data-testid="evidence-line">{line.join(' ')}</p>}
        </>
      ) : (
        <p data-testid="evidence-unavailable">
          {found.kind === 'unavailable'
            ? copy.evidenceUnavailable
            : found.kind === 'unknown-page'
              ? copy.evidenceUnknownPage
              : copy.evidenceClosed}
        </p>
      )}
    </div>
  );
}

/**
 * One group of rows: the ones review is asking about, or the pre-accepted ones
 * behind their disclosure.
 *
 * Both groups get the same controls. Batch acceptance is a default, not a
 * restriction: a row inside the disclosure can still be corrected, reassigned
 * or deleted one at a time (Task 4.2a's per-row exception).
 */
function RowTable({
  rows,
  triage,
  ...props
}: RegionProps & { rows: readonly ParsedRow[]; triage: 'expanded' | 'pre-accepted' }): JSX.Element {
  const copy = useCopy().review;

  return (
    <table class="review-rows" data-testid={`rows-${triage}`}>
      <thead>
        <tr>
          <th scope="col">{copy.columns.marker}</th>
          <th scope="col">{copy.columns.result}</th>
          <th scope="col">{copy.columns.unit}</th>
          <th scope="col">{copy.columns.range}</th>
          <th scope="col">{copy.columns.actions}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <RowView key={row.id} row={row} triage={triage} {...props} />
        ))}
      </tbody>
    </table>
  );
}
