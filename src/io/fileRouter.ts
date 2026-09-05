import { validateAhfyDocument } from '../domain/ahfyDocument';
import { extract } from '../domain/extract';
import type { ExtractionResult } from '../domain/types';
import { extractPdfText, pdfTextAdapter } from './pdfText';

/**
 * The door every attached file comes through.
 *
 * One document is one Report, and exactly one class of document is accepted
 * (ADR-0013): the laboratory-results PDF a patient downloads from
 * myhealth.gov.gr. Everything else is turned away here, by name, before it can
 * be parsed under column roles it does not have — accepting a non-ΑΗΦΥ source
 * is a release blocker precisely because the failure is silent downstream.
 *
 *
 * **Failures are typed and scoped, never thrown.** A batch limit stops the run;
 * a bad file does not take its siblings with it. A user who attaches five
 * documents and one holiday photo gets four Reports and one named refusal, not
 * an empty screen.
 */

/** The batch caps. Attaching more is a mistake worth naming, not throttling. */
const MAX_FILES = 20;
const MAX_PAGES = 100;
const MAX_BYTES = 50 * 1024 * 1024;

/** Every PDF opens with this, whatever a file picker claims about its type. */
const PDF_MAGIC = '%PDF-';

export interface RouteProgress {
  sourceIndex: number;
  sourceCount: number;
  page: number;
  pageCount: number;
}

export type FileRouteErrorCode =
  | 'unsupported-type'
  | 'file-too-large'
  | 'too-many-files'
  | 'too-many-pages'
  | 'decode-failed'
  | 'not-ahfy-document'
  | 'cancelled';

export type RouteFailure =
  | { scope: 'batch'; code: 'too-many-files' | 'too-many-pages' | 'cancelled' }
  | {
      scope: 'source';
      sourceIndex: number;
      fileName: string;
      code: 'unsupported-type' | 'file-too-large' | 'decode-failed' | 'not-ahfy-document';
    };

export interface RouteBatchResult {
  results: ExtractionResult[];
  failures: RouteFailure[];
}

/**
 * Whether the bytes agree with the label.
 *
 * The MIME type is whatever the operating system attached to the file and the
 * magic is what the file actually is; a source is routed only when both say
 * PDF. The type half is asked of the adapter rather than restated here, so
 * there is one answer to "is this mine" and it cannot drift from the module
 * that would have to read it.
 */
async function isPdf(file: File): Promise<boolean> {
  if (!pdfTextAdapter.supports(file)) {
    return false;
  }

  const head = await file.slice(0, PDF_MAGIC.length).arrayBuffer();
  return new TextDecoder('latin1').decode(head) === PDF_MAGIC;
}

/**
 * Read the signal through a call, so narrowing cannot outsmart the caller.
 *
 * `signal.aborted` flips while the loop below is awaiting, and a compiler that
 * has seen one `if` on it will happily conclude the second is dead code.
 */
function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function sourceFailure(
  sourceIndex: number,
  file: File,
  code: 'unsupported-type' | 'file-too-large' | 'decode-failed' | 'not-ahfy-document',
): RouteFailure {
  return { scope: 'source', sourceIndex, fileName: file.name, code };
}

/**
 * Read a batch of attached files into `ExtractionResult`s.
 *
 * Sources are processed **one at a time**, in the order they were attached.
 * Sequential is not a simplification: each document's pages are released
 * before the next is decoded, so a batch's peak cost is one document rather
 * than twenty, and the running page budget can stop the batch at the source
 * that crosses it rather than after all of them have been decoded.
 *
 * Returns whatever succeeded alongside whatever failed. The only thing that
 * ends the run early is a batch-scoped failure — a limit, or the user
 * cancelling — and even then the sources already read are kept, because
 * throwing away work the user can see finished would be its own bug.
 */
export async function routeFiles(
  files: readonly File[],
  signal: AbortSignal,
  onProgress: (progress: RouteProgress) => void,
): Promise<RouteBatchResult> {
  const results: ExtractionResult[] = [];
  const failures: RouteFailure[] = [];

  if (files.length > MAX_FILES) {
    return { results, failures: [{ scope: 'batch', code: 'too-many-files' }] };
  }

  const sourceCount = files.length;
  let pagesRead = 0;

  for (const [sourceIndex, file] of files.entries()) {
    if (aborted(signal)) {
      failures.push({ scope: 'batch', code: 'cancelled' });
      return { results, failures };
    }

    onProgress({ sourceIndex, sourceCount, page: 0, pageCount: 0 });

    // Type before size: a photograph is the wrong kind of thing whatever it
    // weighs, and naming it `file-too-large` would send the user to compress
    // something this product would never read.
    if (!(await isPdf(file))) {
      failures.push(sourceFailure(sourceIndex, file, 'unsupported-type'));
      continue;
    }
    if (file.size > MAX_BYTES) {
      failures.push(sourceFailure(sourceIndex, file, 'file-too-large'));
      continue;
    }

    let pages;
    try {
      pages = await extractPdfText(file, signal);
    } catch (error) {
      // A cancelled decode is the user's answer, not the file's fault.
      if (aborted(signal) || (error instanceof DOMException && error.name === 'AbortError')) {
        failures.push({ scope: 'batch', code: 'cancelled' });
        return { results, failures };
      }
      failures.push(sourceFailure(sourceIndex, file, 'decode-failed'));
      continue;
    }

    // The page budget is spent by what was actually decoded, so a single
    // enormous document stops the batch at itself and the sources already
    // read survive.
    if (pagesRead + pages.length > MAX_PAGES) {
      failures.push({ scope: 'batch', code: 'too-many-pages' });
      return { results, failures };
    }
    pagesRead += pages.length;

    onProgress({ sourceIndex, sourceCount, page: pages.length, pageCount: pages.length });

    // Pass V is the gate. A source that fails it produces no rows and is
    // reported by name, because the alternative — reading it under column
    // roles it does not have — fails silently and looks like data.
    if (!validateAhfyDocument(pages).ok) {
      failures.push(sourceFailure(sourceIndex, file, 'not-ahfy-document'));
      continue;
    }

    results.push(
      extract({
        sourceId: crypto.randomUUID(),
        adapterId: pdfTextAdapter.id,
        tier: pdfTextAdapter.tier,
        pages,
      }),
    );
  }

  return { results, failures };
}
