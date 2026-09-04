import { parseDocumentDate } from './dates';
import { clusterRows } from './rows';
import { normaliseLabel } from './text';
import type { Column, ColumnRole, Rect, Row, TemplateZone, TextItem } from './types';

/**
 * PASS V — document validation.
 *
 * Runs once per source before anything is parsed, and is a **gate**: a source
 * that fails produces no rows, no partial result and no fallback parse, only a
 * reason the UI can use to name the one accepted document class (D14).
 *
 * On acceptance it supplies what the template already fixes — the five column
 * roles, the two dates, the issuing laboratory, the six identifier positions
 * and the section titles — and nothing else. It creates, alters and suppresses
 * no value, no `ParseFlag` and no `Confidence`; it does not confirm the date;
 * and it does not discharge the D7 scrub, because a pre-applied redaction is a
 * resolution the user must still see and may reverse.
 */

/** The repository's own title, on page one of every ΑΗΦΥ document. */
const TITLE = 'Αποτελέσματα Εργαστηριακών Εξετάσεων';

/** The twelve first-page metadata labels, in the order the repository prints them. */
const METADATA_LABELS = [
  'Αρ. Υπόθεσης',
  'ΑΜΚΑ',
  'Επώνυμο',
  'Όνομα',
  'Αριθμός Παραγγελίας',
  'Ημερομηνία Λήψης Δείγματος',
  'Ημερομηνία Αποτελέσματος',
  'Επώνυμο Ιατρού',
  'Όνομα Ιατρού',
  'ΑΜΚΑ Ιατρού',
  'Ειδικότητα Ιατρού',
  'Επωνυμία Εργαστηρίου',
];

/**
 * The five column headings, in printed order, each with the role it binds.
 *
 * Two of them print across two lines. Only the first word is looked up, since
 * `Μονάδα`/`Μέτρησης` and `Φυσιολογικές`/`Τιμές` are stacked at one x — which
 * is the x that binds the column.
 */
const HEADINGS: readonly (readonly [ColumnRole, string])[] = [
  ['label', 'Περιγραφή'],
  ['value', 'Αποτέλεσμα'],
  ['unit', 'Μονάδα Μέτρησης'],
  ['range', 'Φυσιολογικές Τιμές'],
  ['notes', 'Παρατηρήσεις'],
];

/**
 * The six positions the validator pre-resolves as redacted.
 *
 * Not the same list as `identifiers.ts` detects: the case number, the order
 * number and the per-page `Κωδικός` are identifier candidates too, but the
 * template does not pre-resolve them, so they reach the user unanswered.
 * `Επωνυμία Εργαστηρίου` is not an identifier at all — it is kept as the
 * Report's laboratory label.
 */
const IDENTIFIER_LABELS = [
  'ΑΜΚΑ',
  'Επώνυμο',
  'Όνομα',
  'Επώνυμο Ιατρού',
  'Όνομα Ιατρού',
  'ΑΜΚΑ Ιατρού',
];

const COLLECTION_DATE_LABEL = 'Ημερομηνία Λήψης Δείγματος';
const RESULT_DATE_LABEL = 'Ημερομηνία Αποτελέσματος';
const LABORATORY_LABEL = 'Επωνυμία Εργαστηρίου';

/** The verification code heading every page. Corroborating only, never required. */
const PAGE_HEADER_LABEL = 'Κωδικός';

/** The right edge of the last column, in page-normalised coordinates. */
const PAGE_RIGHT_EDGE = 1;

export interface AhfyDocument {
  columns: Record<ColumnRole, Column>;
  collectionDate: string; // ISO, from Ημερομηνία Λήψης Δείγματος
  resultDate: string | null; // from Ημερομηνία Αποτελέσματος
  issuingLaboratory: string; // from Επωνυμία Εργαστηρίου; not an identifier
  identifierZones: readonly TemplateZone[];
  sectionTitles: readonly { page: number; y: number; title: string }[];
}

export type AhfyValidation =
  | { ok: true; document: AhfyDocument }
  | { ok: false; reason: 'missing-title' | 'missing-metadata' | 'missing-table' | 'missing-date' };

function rowText(row: Row): string {
  return row.items.map((item) => item.text).join(' ');
}

interface LabelledField {
  label: string;
  value: string;
  rect: Rect;
}

/**
 * Read one `<label>: <value>` metadata row.
 *
 * The label is everything before the row's first colon, matched whole after
 * `normaliseLabel`, so `ΑΜΚΑ Ιατρού` is never read as `ΑΜΚΑ`. The rect covers
 * the items after the last one ending in a colon — the value alone when the
 * adapter fragments the line, and the whole line when it does not, which for a
 * redaction zone errs in the safe direction.
 */
function labelledField(row: Row): LabelledField | undefined {
  const text = rowText(row);
  const colon = text.indexOf(':');
  if (colon <= 0) {
    return undefined;
  }

  const lastLabelItem = row.items.findLastIndex((item) => item.text.trimEnd().endsWith(':'));
  const valueItems = row.items.slice(lastLabelItem + 1);

  return {
    label: normaliseLabel(text.slice(0, colon)),
    value: text.slice(colon + 1).trim(),
    rect: boundingBox(valueItems.length > 0 ? valueItems : row.items),
  };
}

function boundingBox(items: readonly TextItem[]): Rect {
  const [first] = items;
  if (first === undefined) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  let x = first.x;
  let y = first.y;
  let right = first.x + first.w;
  let bottom = first.y + first.h;

  for (const item of items) {
    x = Math.min(x, item.x);
    y = Math.min(y, item.y);
    right = Math.max(right, item.x + item.w);
    bottom = Math.max(bottom, item.y + item.h);
  }

  return { x, y, w: right - x, h: bottom - y };
}

/** Whether one row carries all five column headings, in any arrangement. */
function isTableHeader(row: Row): boolean {
  const text = normaliseLabel(rowText(row));
  return HEADINGS.every(([, heading]) => text.includes(normaliseLabel(heading)));
}

/**
 * Bind the five columns to the header row's own x positions.
 *
 * Never inferred and never scored: each column runs from its heading to the
 * next, and the last to the edge of the page.
 */
function bindColumns(header: Row): Record<ColumnRole, Column> | undefined {
  const positions: number[] = [];

  for (const [, heading] of HEADINGS) {
    const [firstWord = ''] = normaliseLabel(heading).split(' ');
    // Leftmost item opening with the heading's first word: the items are
    // x-ordered, and a laboratory may print `Μονάδα Μέτρησης` as one item or
    // as two stacked at the same x.
    const item = header.items.find((candidate) =>
      normaliseLabel(candidate.text).startsWith(firstWord),
    );
    if (item === undefined) {
      return undefined;
    }
    positions.push(item.x);
  }

  const columns: Partial<Record<ColumnRole, Column>> = {};

  for (const [index, [role]] of HEADINGS.entries()) {
    columns[role] = {
      role,
      xMin: positions[index] ?? 0,
      xMax: positions[index + 1] ?? PAGE_RIGHT_EDGE,
    };
  }

  return columns as Record<ColumnRole, Column>;
}

/** Whether any item of the row prints inside the given column. */
function fills(row: Row, column: Column): boolean {
  return row.items.some((item) => item.x >= column.xMin && item.x < column.xMax);
}

/**
 * A row the table contains but a measurement is not (V4).
 *
 * Value, unit and range all empty. Its text becomes the current `sectionHint`
 * and no `ParsedRow` is emitted for it. One row is one marker: what counts as a
 * row is `rows.ts`'s question, already answered, so a title the laboratory
 * wrapped across two printed lines arrives here as two markers rather than
 * being re-clustered under a second, looser rule.
 *
 * The banner headings need no special case — their letters are spaced across
 * the full page width, so they fill the value column and are not markers.
 */
function isSectionMarker(row: Row, columns: Record<ColumnRole, Column>): boolean {
  return !fills(row, columns.value) && !fills(row, columns.unit) && !fills(row, columns.range);
}

/**
 * Validate one source as an ΑΗΦΥ document, and on acceptance bind what the
 * template fixes.
 *
 * **Takes the adapter's positioned items**, one array per page, as `pdfText.ts`
 * emits them. Column roles are bound from the header's x positions, so a page
 * collapsed into one whole-line item per printed line carries no position to
 * bind from and is rejected `missing-table`. That is the fail-closed behaviour
 * working as specified — a source Pass V cannot bind columns for is a source
 * nothing may be read from — but it is a real shape requirement on the caller.
 *
 * `Producer` and the per-page `Κωδικός` header are deliberately not consulted:
 * a re-saved PDF loses its metadata while remaining a valid document, so
 * neither is sufficient and neither is required.
 */
export function validateAhfyDocument(pages: readonly TextItem[][]): AhfyValidation {
  // Row ids are internal here; nothing this function returns carries one.
  const rows = clusterRows('pass-v', pages);
  const firstPage = rows.filter((row) => row.page === 1);

  const titled = firstPage.some((row) =>
    normaliseLabel(rowText(row)).includes(normaliseLabel(TITLE)),
  );
  if (!titled) {
    return { ok: false, reason: 'missing-title' };
  }

  const fields = new Map<string, LabelledField>();
  for (const row of firstPage) {
    const field = labelledField(row);
    if (field !== undefined && !fields.has(field.label)) {
      fields.set(field.label, field);
    }
  }

  if (!METADATA_LABELS.every((label) => fields.has(normaliseLabel(label)))) {
    return { ok: false, reason: 'missing-metadata' };
  }

  const header = rows.find((row) => isTableHeader(row));
  const columns = header === undefined ? undefined : bindColumns(header);
  if (header === undefined || columns === undefined) {
    return { ok: false, reason: 'missing-table' };
  }

  const collectionDate = parseDocumentDate(
    fields.get(normaliseLabel(COLLECTION_DATE_LABEL))?.value ?? '',
  );
  if (collectionDate === null) {
    return { ok: false, reason: 'missing-date' };
  }

  const identifierZones: TemplateZone[] = IDENTIFIER_LABELS.flatMap((label) => {
    const field = fields.get(normaliseLabel(label));
    return field === undefined ? [] : [{ rect: field.rect, resolution: 'redacted' as const }];
  });

  const afterHeader = rows.slice(rows.indexOf(header));
  const sectionTitles = afterHeader
    .filter(
      (row) =>
        !isTableHeader(row) &&
        labelledField(row)?.label !== normaliseLabel(PAGE_HEADER_LABEL) &&
        isSectionMarker(row, columns),
    )
    .map((row) => ({ page: row.page, y: row.y, title: rowText(row) }));

  return {
    ok: true,
    document: {
      columns,
      collectionDate,
      resultDate: parseDocumentDate(fields.get(normaliseLabel(RESULT_DATE_LABEL))?.value ?? ''),
      issuingLaboratory: fields.get(normaliseLabel(LABORATORY_LABEL))?.value ?? '',
      identifierZones,
      sectionTitles,
    },
  };
}
