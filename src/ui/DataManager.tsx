import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { resolveSameDayPrecision } from '../domain/profile';
import type { Profile, ProfileMergePlan, Report } from '../domain/types';
import type { Language } from './i18n';
import type { ImportPreview, MedigraphReadError } from '../io/fileFormat';
import { localisedDate, useCopy, useLanguage } from './i18n';
import '../styles/viz.css';

/**
 * Everything the user can do to their own stored record: take a copy of it,
 * bring one back, remove one Report, or remove all of it.
 *
 * **Nothing here writes.** Every path ends in a callback the island performs,
 * because the island owns IndexedDB, the service worker and the object URLs
 * (D2). What this component owns is the sequence: what a user is told before a
 * destructive action, and the fact that they had to choose it.
 *
 * **No destructive default.** Import against an existing Profile offers
 * Cancel, Replace and Merge with nothing preselected, and Replace needs a
 * second, explicit confirmation naming what it erases. A screen that
 * preselected Replace would let a mis-tap end a history that has no backup by
 * design — the export nudge exists precisely because we do not keep one.
 *
 * Every string it shows comes from `i18n.ts`, in the reader's language.
 */

export interface DataManagerProps {
  profile: Profile | null;
  persistenceGranted: boolean | null;
  /** The parsed file waiting for a decision, held by the island (Task 4.5). */
  preview: ImportPreview | null;
  /** Why the last file could not be read, if it could not. */
  importError: MedigraphReadError | null;
  onExport(): void;
  onImport(file: File): void;
  onCancelImport(): void;
  onReplace(): void;
  onMerge(plan: ProfileMergePlan): void;
  onDeleteReport(reportId: string): void;
  onClearAll(): void;
}

function reportDate(report: Report, language: Language): string {
  const { date, time } = report.collectedAt;
  const localised = localisedDate(date, language);

  return time === null ? localised : `${localised} ${time}`;
}

export function DataManager(props: DataManagerProps): JSX.Element {
  const { profile, persistenceGranted, preview, importError } = props;
  const copy = useCopy().data;
  const reports = profile?.reports ?? [];

  return (
    <section class="viz-root data-manager" data-testid="data-manager">
      <h2>{copy.heading}</h2>

      {reports.length === 0 && <p data-testid="data-empty">{copy.empty}</p>}

      <h3>{copy.exportHeading}</h3>
      <p data-testid="export-warning">{copy.exportWarning}</p>
      <p>
        <button
          type="button"
          data-testid="export"
          disabled={profile === null}
          onClick={() => {
            props.onExport();
          }}
        >
          {copy.exportAction}
        </button>
      </p>
      <p data-testid="persistence">
        {persistenceGranted === true
          ? copy.persistence.granted
          : persistenceGranted === false
            ? copy.persistence.denied
            : copy.persistence.unknown}
      </p>

      <h3>{copy.importHeading}</h3>
      <p>
        <label>
          {copy.importAction}{' '}
          <input
            type="file"
            data-testid="import"
            accept=".medigraph,application/json"
            onChange={(event) => {
              const [file] = [...(event.currentTarget.files ?? [])];
              if (file !== undefined) {
                props.onImport(file);
              }
            }}
          />
        </label>
      </p>

      {importError !== null && <p data-testid="import-error">{copy.errors[importError]}</p>}

      {preview !== null && <ImportDecision {...props} preview={preview} />}

      {reports.length > 0 && (
        <>
          <h3>{copy.reportsHeading}</h3>
          <ul data-testid="stored-reports">
            {reports.map((report) => (
              <StoredReport key={report.id} report={report} {...props} />
            ))}
          </ul>
        </>
      )}

      <ClearEverything {...props} />
    </section>
  );
}

/**
 * The decision a parsed file waits for.
 *
 * Against an empty Profile there is nothing to lose, so the choice is Cancel
 * or Import. Against an existing one it is Cancel, Replace or Merge with
 * nothing preselected — and Replace, which erases a history no server holds a
 * copy of, asks a second time and names the number it is about to remove.
 */
function ImportDecision(props: DataManagerProps & { preview: ImportPreview }): JSX.Element {
  const { profile, preview } = props;
  const copy = useCopy().data;
  const language = useLanguage();
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [samePerson, setSamePerson] = useState(false);
  const [plan, setPlan] = useState<ProfileMergePlan | null>(preview.plan);
  const existing = profile?.reports ?? [];

  const idConflicts = (plan?.conflicts ?? []).filter((each) => each.kind === 'report-id');
  const sameDayConflicts = (plan?.conflicts ?? []).filter(
    (each) => each.kind === 'same-day-precision',
  );

  return (
    <div class="import-preview" data-testid="import-preview">
      <h3>{copy.previewHeading}</h3>
      <p data-testid="preview-summary">
        {copy.previewSummary(
          preview.profile.reports.length,
          localisedDate(preview.profile.reports.at(0)?.collectedAt.date ?? '', language),
          localisedDate(preview.profile.reports.at(-1)?.collectedAt.date ?? '', language),
        )}
      </p>

      {existing.length > 0 && (
        <p>
          <label>
            <input
              type="checkbox"
              data-testid="import-same-person"
              checked={samePerson}
              onChange={(event) => {
                setSamePerson(event.currentTarget.checked);
              }}
            />{' '}
            {copy.samePerson}
          </label>
        </p>
      )}

      {idConflicts.length > 0 && <p data-testid="merge-blocked">{copy.mergeBlocked}</p>}

      {sameDayConflicts.length > 0 && (
        <div data-testid="same-day-conflicts">
          <p>{copy.sameDay}</p>
          {sameDayConflicts.map((conflict) => (
            <SameDayFields
              key={`${conflict.existing.id}:${conflict.incoming.id}`}
              conflict={conflict}
              onResolve={(existingTime, incomingTime) => {
                if (plan !== null) {
                  setPlan(
                    resolveSameDayPrecision(
                      plan,
                      conflict.existing.id,
                      conflict.incoming.id,
                      existingTime,
                      incomingTime,
                    ),
                  );
                }
              }}
            />
          ))}
        </div>
      )}

      <p>
        <button
          type="button"
          data-testid="cancel-import"
          onClick={() => {
            props.onCancelImport();
          }}
        >
          {copy.cancel}
        </button>{' '}
        {existing.length === 0 ? (
          <button
            type="button"
            data-testid="accept-import"
            onClick={() => {
              props.onReplace();
            }}
          >
            {copy.importEmpty}
          </button>
        ) : (
          <>
            <button
              type="button"
              data-testid="merge-import"
              disabled={
                !samePerson ||
                plan === null ||
                idConflicts.length > 0 ||
                sameDayConflicts.length > 0
              }
              onClick={() => {
                if (plan !== null) {
                  props.onMerge(plan);
                }
              }}
            >
              {copy.merge}
            </button>{' '}
            <button
              type="button"
              data-testid="replace-import"
              disabled={!samePerson}
              onClick={() => {
                setConfirmingReplace(true);
              }}
            >
              {copy.replace}
            </button>
          </>
        )}
      </p>

      {confirmingReplace && (
        <p data-testid="replace-confirm">
          {copy.replaceConfirm(existing.length)}{' '}
          <button
            type="button"
            data-testid="replace-confirmed"
            onClick={() => {
              props.onReplace();
            }}
          >
            {copy.replaceConfirmAction}
          </button>
        </p>
      )}
    </div>
  );
}

/** Two reports on one day, and the minute each of them needs. */
function SameDayFields({
  conflict,
  onResolve,
}: {
  conflict: { existing: Report; incoming: Report };
  onResolve: (existingTime: string, incomingTime: string) => void;
}): JSX.Element {
  const copy = useCopy().data;
  const [stored, setStored] = useState(conflict.existing.collectedAt.time ?? '');
  const [incoming, setIncoming] = useState(conflict.incoming.collectedAt.time ?? '');

  return (
    <p data-testid={`same-day-${conflict.existing.id}`}>
      <label>
        {copy.storedTime}{' '}
        <input
          type="time"
          data-testid={`same-day-stored-${conflict.existing.id}`}
          value={stored}
          onInput={(event) => {
            setStored(event.currentTarget.value);
            if (event.currentTarget.value !== '' && incoming !== '') {
              onResolve(event.currentTarget.value, incoming);
            }
          }}
        />
      </label>{' '}
      <label>
        {copy.incomingTime}{' '}
        <input
          type="time"
          data-testid={`same-day-incoming-${conflict.incoming.id}`}
          value={incoming}
          onInput={(event) => {
            setIncoming(event.currentTarget.value);
            if (stored !== '' && event.currentTarget.value !== '') {
              onResolve(stored, event.currentTarget.value);
            }
          }}
        />
      </label>
    </p>
  );
}

/** One stored Report, and the two taps it takes to remove it. */
function StoredReport(props: DataManagerProps & { report: Report }): JSX.Element {
  const { report } = props;
  const copy = useCopy().data;
  const language = useLanguage();
  const [confirming, setConfirming] = useState(false);

  return (
    <li data-testid={`stored-report-${report.id}`}>
      {copy.reportLine(reportDate(report, language), report.measurements.length)}{' '}
      {confirming ? (
        <button
          type="button"
          data-testid={`delete-report-confirmed-${report.id}`}
          onClick={() => {
            props.onDeleteReport(report.id);
          }}
        >
          {copy.deleteReportConfirm}
        </button>
      ) : (
        <button
          type="button"
          data-testid={`delete-report-${report.id}`}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {copy.deleteReport}
        </button>
      )}
    </li>
  );
}

/**
 * The end of everything stored here, behind one deliberate confirmation.
 *
 * The island performs it: the Profile, the IndexedDB database, the cached
 * assets and the service worker itself all go, because a worker left
 * registered would serve the app to a device its owner has just cleared.
 */
function ClearEverything(props: DataManagerProps): JSX.Element {
  const copy = useCopy().data;
  const [confirming, setConfirming] = useState(false);

  return (
    <p>
      {confirming ? (
        <span data-testid="clear-all-confirm">
          {copy.clearAllConfirm}{' '}
          <button
            type="button"
            data-testid="clear-all-confirmed"
            onClick={() => {
              props.onClearAll();
            }}
          >
            {copy.clearAllAction}
          </button>
        </span>
      ) : (
        <button
          type="button"
          data-testid="clear-all"
          onClick={() => {
            setConfirming(true);
          }}
        >
          {copy.clearAll}
        </button>
      )}
    </p>
  );
}
