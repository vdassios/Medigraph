import type { JSX, TargetedDragEvent } from 'preact';
import { useState } from 'preact/hooks';
import type { FileRouteErrorCode, RouteFailure, RouteProgress } from '../io/fileRouter';
import { ROUTE_LIMITS } from '../io/fileRouter';

/**
 * The attach surface: the one place a document enters the app.
 *
 * It holds no batch, reads no file and knows nothing about extraction. Files
 * are handed upward exactly as the browser gave them — same objects, same
 * order — because `routeFiles` is the single gate that decides what a source
 * is (D1a), and a second opinion here could only ever disagree with it.
 *
 * **The limits are surfaced, not enforced.** `ROUTE_LIMITS` is read from the
 * router so the copy states the caps the router will actually apply; a caller
 * that crosses one gets the typed `RouteFailure` back and it is rendered
 * below. Re-checking the count here would put two answers in the product to
 * the same question, and the wrong one would be the one the user reads.
 *
 * **No camera.** ADR-0013 deleted every recognition path, so the input carries
 * no `capture` attribute and the product asks for no camera permission: on a
 * phone this opens the file picker, which is where a downloaded ΑΗΦΥ PDF is.
 *
 * **The copy is Greek and inline, and is not staying that way.** Task 4.6 puts
 * every string in `el` and `en` behind the language toggle. Until it lands, each
 * user-facing string in this component sits in one of three places —
 * `FAILURE_TEXT`, `describeProgress` or the JSX below — so lifting them is a
 * move rather than a hunt. Each is a whole sentence: a message assembled from
 * clauses cannot be translated, because word order is the first thing another
 * language changes.
 */

export interface FileDropProps {
  disabled: boolean;
  progress: RouteProgress | null;
  failures: RouteFailure[];
  onFiles(files: File[]): void;
  onCancel(): void;
}

const MEGABYTES = ROUTE_LIMITS.maxBytes / (1024 * 1024);

/**
 * What each refusal says to the person who attached the file.
 *
 * A rejected source is told what Medigraph accepts and where that document
 * comes from, and is never told its own file is broken: the paper history and
 * the loose laboratory PDF are outside this product's scope, not defective
 * (ADR-0013). The two batch limits and a cancellation say what survived,
 * because a source already read is kept and a message implying otherwise would
 * send the user to re-attach documents that are already in the review.
 */
const FAILURE_TEXT: Record<FileRouteErrorCode, string> = {
  'too-many-files': `Επισυνάψατε περισσότερα από ${String(ROUTE_LIMITS.maxFiles)} αρχεία, οπότε δεν διαβάστηκε κανένα. Δοκιμάστε ξανά με λιγότερα.`,
  'too-many-pages': `Η επισύναψη ξεπέρασε τις ${String(ROUTE_LIMITS.maxPages)} σελίδες και σταμάτησε εδώ. Όσα έγγραφα διαβάστηκαν πριν από αυτό παραμένουν.`,
  cancelled: 'Η ανάγνωση διακόπηκε. Όσα έγγραφα είχαν ήδη διαβαστεί παραμένουν.',
  'unsupported-type':
    'Δεν είναι αρχείο PDF. Το Medigraph διαβάζει μόνο το PDF των εξετάσεων που κατεβάζετε από τον Ατομικό Ηλεκτρονικό Φάκελο Υγείας (myhealth.gov.gr).',
  'file-too-large': `Ξεπερνά τα ${String(MEGABYTES)} MB και δεν διαβάστηκε.`,
  'decode-failed':
    'Το PDF δεν άνοιξε. Κατεβάστε το ξανά από το myhealth.gov.gr και επισυνάψτε το όπως είναι.',
  'not-ahfy-document':
    'Δεν είναι έγγραφο ΑΗΦΥ. Κατεβάστε τις εξετάσεις σας σε PDF από το myhealth.gov.gr και επισυνάψτε το αρχείο χωρίς αλλαγές.',
};

/** One key per failure, so two refusals of the same kind both render. */
function failureKey(failure: RouteFailure): string {
  return failure.scope === 'source'
    ? `source:${String(failure.sourceIndex)}:${failure.code}`
    : `batch:${failure.code}`;
}

/**
 * What the batch is doing, in the two moments the router reports.
 *
 * `onProgress` fires at nought pages and again at the page count decode
 * returned, so there is no honest per-page count to print before the document
 * has been decoded — and printing a page number the router has not reached
 * would be a progress bar that invents its own progress.
 */
function describeProgress(progress: RouteProgress): string {
  const source = String(progress.sourceIndex + 1);
  const count = String(progress.sourceCount);

  // Two whole sentences rather than a shared prefix and two endings: Task 4.6
  // has to be able to translate each of these as a unit.
  return progress.pageCount === 0
    ? `Ανάγνωση εγγράφου ${source} από ${count}…`
    : `Έγγραφο ${source} από ${count}: ${String(progress.page)} από ${String(progress.pageCount)} σελίδες`;
}

export function FileDrop(props: FileDropProps): JSX.Element {
  const { disabled, progress, failures } = props;
  const [dragging, setDragging] = useState(false);

  // Held as plain functions rather than `useCallback`: nothing below this
  // component is memoised, so a stable identity would buy a re-render nobody
  // is avoiding, and the props are read through `props` so the two callbacks
  // are always called against the object they arrived on.
  const hand = (chosen: FileList | null): void => {
    const files = [...(chosen ?? [])];
    if (files.length > 0) {
      props.onFiles(files);
    }
  };

  /**
   * A drop is always intercepted, and only sometimes accepted.
   *
   * `preventDefault` runs even while disabled: the browser's own default is to
   * navigate to the dropped PDF, which would abandon an open review and lose
   * the transaction. Swallowing the drop is the lesser of the two, and the
   * screen already says why nothing may be attached right now.
   */
  const drop = (event: TargetedDragEvent<HTMLElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) {
      hand(event.dataTransfer?.files ?? null);
    }
  };

  return (
    <section
      class="file-drop"
      data-testid="file-drop"
      aria-labelledby="file-drop-heading"
      // The only state this component keeps, and it is presentational: the
      // attribute is where the styling pass hangs the drop-target highlight.
      data-dragging={dragging ? 'true' : 'false'}
      onDragEnter={() => {
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        // `dragleave` also fires when the pointer crosses from this section
        // into one of its own children, so the flag is cleared only once the
        // pointer has actually left the surface. Without the check the target
        // flickers off every time the pointer passes over the heading.
        const left = event.relatedTarget;
        if (!(left instanceof Node) || !event.currentTarget.contains(left)) {
          setDragging(false);
        }
      }}
      onDrop={drop}
    >
      <h2 id="file-drop-heading">Επισύναψη εγγράφου</h2>
      <p data-testid="attach-instructions">
        Σύρετε εδώ το PDF των εξετάσεών σας ή επιλέξτε το από τη συσκευή σας. Το Medigraph διαβάζει
        μόνο τα έγγραφα που κατεβάζετε από τον Ατομικό Ηλεκτρονικό Φάκελο Υγείας (myhealth.gov.gr).
      </p>
      <p data-testid="attach-limits">
        Έως {ROUTE_LIMITS.maxFiles} αρχεία κάθε φορά, {ROUTE_LIMITS.maxPages} σελίδες συνολικά, έως{' '}
        {MEGABYTES} MB ανά αρχείο.
      </p>
      <p>
        <label>
          Επιλογή αρχείων{' '}
          <input
            data-testid="attach"
            type="file"
            accept="application/pdf"
            multiple
            disabled={disabled}
            onChange={(event) => {
              hand(event.currentTarget.files);
            }}
          />
        </label>
      </p>

      {/*
        The live region is in the document from the first render rather than
        inserted with the first progress event: a `role="status"` that appears
        along with its own text is announced inconsistently, and this one has
        exactly one job — to say what is happening while the screen is
        otherwise unresponsive.
      */}
      <p class="file-drop-progress">
        <span data-testid="attach-progress" role="status">
          {progress === null ? '' : describeProgress(progress)}
        </span>{' '}
        {progress !== null && (
          <button
            type="button"
            data-testid="attach-cancel"
            onClick={() => {
              props.onCancel();
            }}
          >
            Διακοπή
          </button>
        )}
      </p>

      {failures.length > 0 && (
        <ul data-testid="failures">
          {failures.map((failure) => (
            <li key={failureKey(failure)} data-testid={`failure-${failure.code}`}>
              {failure.scope === 'source' && (
                <>
                  <span data-testid="failure-file">{failure.fileName}</span>:{' '}
                </>
              )}
              {FAILURE_TEXT[failure.code]}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
