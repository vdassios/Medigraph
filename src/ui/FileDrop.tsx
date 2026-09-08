import type { JSX, TargetedDragEvent } from 'preact';
import { useState } from 'preact/hooks';
import type { RouteFailure, RouteProgress } from '../io/fileRouter';
import { ROUTE_LIMITS } from '../io/fileRouter';
import type { Copy } from './i18n';
import { useCopy } from './i18n';

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
 * Every string it shows comes from `i18n.ts`, in the reader's language. Each
 * is a whole sentence: a message assembled from clauses cannot be translated,
 * because word order is the first thing another language changes.
 */

export interface FileDropProps {
  disabled: boolean;
  progress: RouteProgress | null;
  failures: RouteFailure[];
  onFiles(files: File[]): void;
  onCancel(): void;
}

const MEGABYTES = ROUTE_LIMITS.maxBytes / (1024 * 1024);

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
function describeProgress(progress: RouteProgress, copy: Copy['attach']): string {
  const source = progress.sourceIndex + 1;

  return progress.pageCount === 0
    ? copy.reading(source, progress.sourceCount)
    : copy.pages(source, progress.sourceCount, progress.page, progress.pageCount);
}

export function FileDrop(props: FileDropProps): JSX.Element {
  const { disabled, progress, failures } = props;
  const copy = useCopy().attach;
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
      <h2 id="file-drop-heading">{copy.heading}</h2>
      <p data-testid="attach-instructions">{copy.instructions}</p>
      <p data-testid="attach-limits">
        {copy.limits(ROUTE_LIMITS.maxFiles, ROUTE_LIMITS.maxPages, MEGABYTES)}
      </p>
      <p>
        <label>
          {copy.choose}{' '}
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
          {progress === null ? '' : describeProgress(progress, copy)}
        </span>{' '}
        {progress !== null && (
          <button
            type="button"
            data-testid="attach-cancel"
            onClick={() => {
              props.onCancel();
            }}
          >
            {copy.stop}
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
              <FailureText code={failure.code} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What one refusal says to the person who attached the file.
 *
 * A rejected source is told what Medigraph accepts and where that document
 * comes from, and is never told its own file is broken: the paper history and
 * the loose laboratory PDF are outside this product's scope, not defective
 * (ADR-0013). The batch limits and a cancellation say what survived, because a
 * source already read is kept and a message implying otherwise would send the
 * user to re-attach documents that are already in the review.
 */
function FailureText({ code }: { code: RouteFailure['code'] }): JSX.Element {
  const copy = useCopy().attach.failures;

  switch (code) {
    case 'too-many-files':
      return <>{copy['too-many-files'](ROUTE_LIMITS.maxFiles)}</>;
    case 'too-many-pages':
      return <>{copy['too-many-pages'](ROUTE_LIMITS.maxPages)}</>;
    case 'file-too-large':
      return <>{copy['file-too-large'](MEGABYTES)}</>;
    default:
      return <>{copy[code]()}</>;
  }
}
