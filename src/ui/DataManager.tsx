import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { resolveSameDayPrecision } from '../domain/profile';
import type { Profile, ProfileMergePlan, Report } from '../domain/types';
import type { ImportPreview, MedigraphReadError } from '../io/fileFormat';
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
 * The copy is Greek and inline until Task 4.6's `el`/`en` toggle.
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

const TEXT = {
  heading: 'Τα δεδομένα σας',
  exportHeading: 'Αντίγραφο των δεδομένων σας',
  exportWarning:
    'Το αρχείο που κατεβάζετε είναι απλό κείμενο και περιέχει ολόκληρο το ιατρικό σας ιστορικό, χωρίς κρυπτογράφηση. Όποιος το ανοίξει το διαβάζει. Φυλάξτε το όπως θα φυλάγατε τα ίδια τα χαρτιά των εξετάσεων.',
  exportAction: 'Λήψη αρχείου .medigraph',
  importHeading: 'Εισαγωγή αρχείου .medigraph',
  importAction: 'Επιλογή αρχείου',
  previewHeading: 'Τι περιέχει το αρχείο',
  cancel: 'Ακύρωση',
  importEmpty: 'Εισαγωγή',
  replace: 'Αντικατάσταση όλων',
  merge: 'Συγχώνευση με τα υπάρχοντα',
  replaceConfirmPrefix: 'Η αντικατάσταση διαγράφει οριστικά ',
  replaceConfirmSuffix:
    ' αποθηκευμένες εξετάσεις από αυτή τη συσκευή. Δεν υπάρχει αντίγραφο εκτός συσκευής.',
  replaceConfirmAction: 'Ναι, αντικατάσταση',
  samePerson: 'Το αρχείο αφορά το ίδιο πρόσωπο με το ιστορικό που είναι ήδη αποθηκευμένο.',
  mergeBlocked:
    'Το αρχείο περιέχει εξέταση με το ίδιο αναγνωριστικό αλλά διαφορετικό περιεχόμενο. Η συγχώνευση δεν μπορεί να αποφασίσει ποια ισχύει.',
  sameDay:
    'Δύο εξετάσεις πέφτουν την ίδια ημέρα. Δώστε διαφορετική ώρα στην καθεμία για να ξεχωρίζουν.',
  storedTime: 'Ώρα της αποθηκευμένης',
  incomingTime: 'Ώρα αυτής που εισάγετε',
  reportsHeading: 'Αποθηκευμένες εξετάσεις',
  deleteReport: 'Διαγραφή',
  deleteReportConfirm: 'Ναι, διαγραφή αυτής της εξέτασης',
  clearAll: 'Διαγραφή όλων από αυτή τη συσκευή',
  clearAllConfirm:
    'Διαγράφονται οριστικά όλες οι εξετάσεις, η τοπική βάση και η προσωρινή μνήμη της εφαρμογής από αυτή τη συσκευή.',
  clearAllAction: 'Ναι, διαγραφή όλων',
  empty:
    'Δεν υπάρχει τίποτα αποθηκευμένο ακόμη. Επισυνάψτε ένα έγγραφο ΑΗΦΥ από το myhealth.gov.gr ή εισαγάγετε ένα αρχείο .medigraph.',
  persistenceDenied:
    'Ο browser δεν εγγυάται τη διατήρηση των δεδομένων: μπορεί να τα διαγράψει όταν χρειαστεί χώρο. Κρατήστε ένα αντίγραφο με τη Λήψη παραπάνω.',
  persistenceGranted:
    'Ο browser έχει σημειώσει τα δεδομένα ως μόνιμα. Μπορούν και πάλι να χαθούν αν διαγράψετε τα δεδομένα περιήγησης, οπότε κρατήστε ένα αντίγραφο.',
  persistenceUnknown:
    'Ο browser δεν απάντησε αν θα διατηρήσει τα δεδομένα. Κρατήστε ένα αντίγραφο με τη Λήψη παραπάνω.',
} as const;

const ERROR_TEXT: Record<MedigraphReadError, string> = {
  'file-too-large': 'Το αρχείο είναι πολύ μεγάλο για αρχείο .medigraph.',
  'malformed-json': 'Το αρχείο δεν διαβάζεται· δεν είναι έγκυρο JSON.',
  'not-medigraph': 'Δεν είναι αρχείο .medigraph.',
  'unsupported-version': 'Το αρχείο γράφτηκε από νεότερη έκδοση του Medigraph.',
  'invalid-profile': 'Τα περιεχόμενα δεν είναι έγκυρο ιστορικό Medigraph.',
};

function reportDate(report: Report): string {
  const { date, time } = report.collectedAt;

  return time === null ? date : `${date} ${time}`;
}

export function DataManager(props: DataManagerProps): JSX.Element {
  const { profile, persistenceGranted, preview, importError } = props;
  const reports = profile?.reports ?? [];

  return (
    <section class="viz-root data-manager" data-testid="data-manager">
      <h2>{TEXT.heading}</h2>

      {reports.length === 0 && <p data-testid="data-empty">{TEXT.empty}</p>}

      <h3>{TEXT.exportHeading}</h3>
      <p data-testid="export-warning">{TEXT.exportWarning}</p>
      <p>
        <button
          type="button"
          data-testid="export"
          disabled={profile === null}
          onClick={() => {
            props.onExport();
          }}
        >
          {TEXT.exportAction}
        </button>
      </p>
      <p data-testid="persistence">
        {persistenceGranted === true
          ? TEXT.persistenceGranted
          : persistenceGranted === false
            ? TEXT.persistenceDenied
            : TEXT.persistenceUnknown}
      </p>

      <h3>{TEXT.importHeading}</h3>
      <p>
        <label>
          {TEXT.importAction}{' '}
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

      {importError !== null && <p data-testid="import-error">{ERROR_TEXT[importError]}</p>}

      {preview !== null && <ImportDecision {...props} preview={preview} />}

      {reports.length > 0 && (
        <>
          <h3>{TEXT.reportsHeading}</h3>
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
      <h3>{TEXT.previewHeading}</h3>
      <p data-testid="preview-summary">
        Το αρχείο περιέχει {preview.profile.reports.length} εξετάσεις, από{' '}
        {preview.profile.reports.at(0)?.collectedAt.date ?? '—'} έως{' '}
        {preview.profile.reports.at(-1)?.collectedAt.date ?? '—'}.
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
            {TEXT.samePerson}
          </label>
        </p>
      )}

      {idConflicts.length > 0 && <p data-testid="merge-blocked">{TEXT.mergeBlocked}</p>}

      {sameDayConflicts.length > 0 && (
        <div data-testid="same-day-conflicts">
          <p>{TEXT.sameDay}</p>
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
          {TEXT.cancel}
        </button>{' '}
        {existing.length === 0 ? (
          <button
            type="button"
            data-testid="accept-import"
            onClick={() => {
              props.onReplace();
            }}
          >
            {TEXT.importEmpty}
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
              {TEXT.merge}
            </button>{' '}
            <button
              type="button"
              data-testid="replace-import"
              disabled={!samePerson}
              onClick={() => {
                setConfirmingReplace(true);
              }}
            >
              {TEXT.replace}
            </button>
          </>
        )}
      </p>

      {confirmingReplace && (
        <p data-testid="replace-confirm">
          {TEXT.replaceConfirmPrefix}
          {existing.length}
          {TEXT.replaceConfirmSuffix}{' '}
          <button
            type="button"
            data-testid="replace-confirmed"
            onClick={() => {
              props.onReplace();
            }}
          >
            {TEXT.replaceConfirmAction}
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
  const [stored, setStored] = useState(conflict.existing.collectedAt.time ?? '');
  const [incoming, setIncoming] = useState(conflict.incoming.collectedAt.time ?? '');

  return (
    <p data-testid={`same-day-${conflict.existing.id}`}>
      <label>
        {TEXT.storedTime}{' '}
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
        {TEXT.incomingTime}{' '}
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
  const [confirming, setConfirming] = useState(false);

  return (
    <li data-testid={`stored-report-${report.id}`}>
      {reportDate(report)} — {report.measurements.length} αποτελέσματα{' '}
      {confirming ? (
        <button
          type="button"
          data-testid={`delete-report-confirmed-${report.id}`}
          onClick={() => {
            props.onDeleteReport(report.id);
          }}
        >
          {TEXT.deleteReportConfirm}
        </button>
      ) : (
        <button
          type="button"
          data-testid={`delete-report-${report.id}`}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {TEXT.deleteReport}
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
  const [confirming, setConfirming] = useState(false);

  return (
    <p>
      {confirming ? (
        <span data-testid="clear-all-confirm">
          {TEXT.clearAllConfirm}{' '}
          <button
            type="button"
            data-testid="clear-all-confirmed"
            onClick={() => {
              props.onClearAll();
            }}
          >
            {TEXT.clearAllAction}
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
          {TEXT.clearAll}
        </button>
      )}
    </p>
  );
}
