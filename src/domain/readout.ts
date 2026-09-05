import { parseNumber } from './numbers';
import { parseRange } from './ranges';
import { tokenise } from './text';
import { isKnownUnit, normaliseUnit } from './units';
import type {
  Anchor,
  Comparator,
  Confidence,
  LexicalToken,
  ParseFlag,
  ParsedNumber,
  ParsedRow,
  Rect,
  ReferenceRange,
  Row,
  SourceRef,
  TextItem,
} from './types';

/**
 * PASS A — reading outward from an anchor.
 *
 * `anchors.ts` answers which marker a row is about; this module answers what
 * the laboratory printed beside it. It owns no column model: D5 removed layout
 * discovery, and Pass V's column roles bind the *template*, not a row, so a
 * value is found by looking outward from the anchor's own box and letting the
 * numbers identify themselves.
 *
 * Two facts do the work. A printed number is unmistakable, so the read-out
 * assembles numeric groups first and assigns roles afterwards; and a stop
 * condition is cheaper than a wrong reading, so the search refuses to widen
 * rather than borrowing the next marker's cell.
 */

/** A printed unit may span whitespace: `x10^3`, `/`, `μL` is one unit. */
const MAX_UNIT_TOKENS = 3;

/** A horizontal gap this wide, with nothing found yet, ends the search. */
const HORIZONTAL_GAP = 0.25;

/** How far below the anchor a stacked cell may sit, in anchor heights. */
const BELOW_REACH = 2.5;

/** How much of the narrower box a stacked cell must sit under. */
const BELOW_OVERLAP = 0.5;

/** `rows.ts`'s sharing rule, reused so "same row" means one thing. */
const ROW_SHARE = 0.6;

const DASH = /^[-–—]$/u;
const COMPARATOR = /^[<>≤≥]$/u;

/**
 * A number glued to its unit: `12mg`, `5.4%`.
 *
 * The suffix must open with a letter or `%`, which is what keeps the pattern
 * away from everything else a digit can start: `188-300` and `4,0-11,0` are
 * ranges, `10^3/μL` is a unit in its own right, and the seed corpus prints
 * literal `3\nΕνδιάμεσο:` in a range cell. Splitting is lexical — it invents
 * no geometry, so the two halves keep the box their fragment was measured in.
 */
const GLUED_UNIT = /^([+-]?\d+(?:[.,]\d+)?)(\p{L}.*|%.*)$/u;

/** One printed token, with a glued unit separated from its number. */
function split(text: string): string[] {
  const glue = GLUED_UNIT.exec(text);
  const [, number, unit] = glue ?? [];

  return number === undefined || unit === undefined ? [text] : [number, unit];
}

const RANGE_OF: Record<Comparator, (bound: number) => ReferenceRange> = {
  '<': (max) => ({ kind: 'maxOnly', comparator: '<', max }),
  '<=': (max) => ({ kind: 'maxOnly', comparator: '<=', max }),
  '>': (min) => ({ kind: 'minOnly', comparator: '>', min }),
  '>=': (min) => ({ kind: 'minOnly', comparator: '>=', min }),
};

const RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

/**
 * One token of the neighbourhood.
 *
 * `region` is the search direction it was collected from. Two tokens are
 * adjacent in print only when they came from the same direction: a token found
 * below the anchor does not continue one found to its right, however the
 * concatenated list happens to read.
 */
interface Candidate {
  text: string;
  item: TextItem | null; // null in line mode: the anchor's own item continues
  region: number;
}

/**
 * A run of candidate tokens the numeric grammar recognised.
 *
 * `range` is present and null for a range that failed to parse — the
 * difference between "no interval here" and "an interval this code could not
 * read", which is what `unparsed-range` reports.
 */
type Group =
  | { kind: 'number'; start: number; end: number; number: ParsedNumber }
  | { kind: 'comparator'; start: number; end: number; number: ParsedNumber }
  | { kind: 'range'; start: number; end: number; range: ReferenceRange | null };

// ---------------------------------------------------------------------------
// The neighbourhood
// ---------------------------------------------------------------------------

function shareRow(a: Rect, b: Rect): boolean {
  return Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < ROW_SHARE * Math.min(a.h, b.h);
}

/**
 * Whether a stacked cell sits directly under the anchor.
 *
 * The overlap is measured against the narrower box, for `rows.ts`'s reason: a
 * wide banner overlapping a narrow cell says nothing about the cell.
 */
function sitsBelow(box: Rect, item: TextItem): boolean {
  const overlap = Math.min(box.x + box.w, item.x + item.w) - Math.max(box.x, item.x);
  const under = item.y - (box.y + box.h);

  return (
    overlap >= BELOW_OVERLAP * Math.min(box.w, item.w) && under >= 0 && under <= BELOW_REACH * box.h
  );
}

/**
 * The tokens the anchor's own item still holds after the matched span.
 *
 * This is § A2's lexical mode. A page collapsed into one whole-line item per
 * printed line carries its cells here rather than in neighbouring boxes, and
 * the same role and stop rules then apply in token order.
 */
function lexicalTail(anchor: Anchor, item: TextItem | undefined): LexicalToken[] {
  const { textRange } = anchor.sourceRef;
  if (item === undefined || textRange?.itemId !== item.id) {
    return [];
  }

  return tokenise(item).filter((token) => token.start >= textRange.end);
}

/**
 * Walk items in reading order, stopping where § A2 says to stop.
 *
 * `barrier` is the next anchor's edge: everything from there on belongs to
 * another marker. The gap rule ends the walk only while nothing numeric has
 * been collected — once a value is in hand, a wide gap is the table's own
 * column spacing and means nothing.
 */
function walk(
  items: readonly TextItem[],
  from: number,
  barrier: number,
  found: () => boolean,
): { items: TextItem[]; stopped: boolean } {
  const kept: TextItem[] = [];
  let edge = from;

  for (const item of items) {
    if (item.x >= barrier) {
      return { items: kept, stopped: true };
    }
    if (item.x - edge > HORIZONTAL_GAP && !found() && kept.length === 0) {
      return { items: kept, stopped: true };
    }
    kept.push(item);
    edge = Math.max(edge, item.x + item.w);
  }

  return { items: kept, stopped: false };
}

interface Neighbourhood {
  candidates: Candidate[];
  stopped: boolean;
}

/**
 * Everything the anchor may read, in § A2's order: the anchor's own remaining
 * tokens, then the same row to the right, then directly below, then the same
 * row to the left. Roles are filled from the front, so "the first candidate
 * satisfying each role" falls out of the ordering rather than needing a scan
 * per role.
 */
function neighbourhood(
  anchor: Anchor,
  row: Row,
  allRows: readonly Row[],
  anchors: readonly Anchor[],
): Neighbourhood {
  const owned = new Set(anchor.sourceRef.itemIds ?? []);
  const box = anchor.sourceRef.box;
  const parent = row.items.find((item) => owned.has(item.id));

  const tail = lexicalTail(anchor, parent).flatMap<Candidate>((token) =>
    split(token.text).map((text) => ({ text, item: null, region: 0 })),
  );

  // Lexical mode. An anchor whose own item carries on past the matched span is
  // sitting in a whole printed line, and § A2 forbids looking at another line
  // for its value — a narrow column, where each cell is its own item, is a
  // different shape and keeps the spatial search below.
  if (box === undefined || tail.length > 0) {
    return { candidates: tail, stopped: false };
  }

  const rightEdge = box.x + box.w;
  const numeric = tail.some((candidate) => looksNumeric(candidate.text));
  const found = (): boolean => numeric;

  const free = (item: TextItem): boolean => !owned.has(item.id);
  const beside = (item: TextItem): boolean => shareRow(box, item);

  const right = walk(
    row.items.filter((item) => free(item) && beside(item) && item.x >= rightEdge),
    rightEdge,
    nextAnchorX(row, anchor, anchors, box),
    found,
  );

  const belowBarrier = nextAnchorY(anchor, anchors, box);
  const below = allRows
    .filter((other) => other.page === row.page && other.id !== row.id)
    .flatMap((other) => other.items)
    .filter((item) => free(item) && sitsBelow(box, item) && item.y < belowBarrier)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const left = row.items
    .filter((item) => free(item) && beside(item) && item.x < box.x)
    .sort((a, b) => b.x - a.x);

  const regions: TextItem[][] = [right.items, below, left];

  return {
    candidates: [
      ...tail,
      ...regions.flatMap((region, index) =>
        region.flatMap((item) =>
          tokenise(item).flatMap<Candidate>((token) =>
            split(token.text).map((text) => ({ text, item, region: index + 1 })),
          ),
        ),
      ),
    ],
    stopped: right.stopped,
  };
}

/**
 * The next anchor's x on this row, or the page edge.
 *
 * "This row" is membership, not height: a band on another page sits at the
 * same y as this one perhaps a dozen times over, and a barrier drawn from one
 * of those would silently empty the neighbourhood of a row that reads fine.
 */
function nextAnchorX(row: Row, anchor: Anchor, anchors: readonly Anchor[], box: Rect): number {
  const here = new Set(row.items.map((item) => item.id));

  const xs = anchors
    .filter(
      (other) =>
        other.id !== anchor.id && (other.sourceRef.itemIds ?? []).some((id) => here.has(id)),
    )
    .map((other) => other.sourceRef.box)
    .filter((other): other is Rect => other !== undefined && other.x > box.x)
    .map((other) => other.x);

  return xs.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...xs);
}

/** The next anchor's y below this one, or the page bottom. */
function nextAnchorY(anchor: Anchor, anchors: readonly Anchor[], box: Rect): number {
  const ys = anchors
    .filter((other) => other.id !== anchor.id && other.sourceRef.page === anchor.sourceRef.page)
    .map((other) => other.sourceRef.box)
    .filter((other): other is Rect => other !== undefined && other.y > box.y + box.h)
    .map((other) => other.y);

  return ys.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...ys);
}

// ---------------------------------------------------------------------------
// Numeric groups
// ---------------------------------------------------------------------------

function plain(text: string): ParsedNumber | null {
  const parsed = parseNumber([text]);
  return parsed !== null && parsed.comparator === null ? parsed : null;
}

function glued(text: string): ParsedNumber | null {
  const parsed = parseNumber([text]);
  return parsed !== null && parsed.comparator !== null ? parsed : null;
}

function looksNumeric(text: string): boolean {
  return plain(text) !== null || glued(text) !== null || parseRange([text]) !== null;
}

/**
 * Assemble every numeric group the neighbourhood prints, left to right.
 *
 * A standalone comparator is joined to the number it precedes and a split
 * range (`70`, `-`, `110`) to its bounds, so the grammar sees the same thing
 * whether the laboratory glued its tokens or the adapter split them. Roles are
 * *not* decided here: a `<` group can be either the value or a one-sided
 * range, and only the units and the groups around it say which.
 *
 * A range cell may repeat its unit — the corpus prints `4,0 - 10,0 k/μl`. A
 * recognised trailing unit is dropped before `parseRange`, which owns the
 * allowlist through `isKnownUnit`. An *unrecognised* trailing token is handed
 * to `parseRange` instead, which rejects it: a remainder nobody can account
 * for fails loudly as `unparsed-range` rather than being silently skipped.
 */
function groupsOf(candidates: readonly Candidate[]): Group[] {
  const text = candidates.map((candidate) => candidate.text);
  const region = candidates.map((candidate) => candidate.region);
  const groups: Group[] = [];

  for (let at = 0; at < text.length;) {
    const group = groupAt(text, region, at);
    if (group === undefined) {
      at += 1;
      continue;
    }
    groups.push(group);
    at = group.end;
  }

  return groups;
}

function groupAt(
  text: readonly string[],
  region: readonly number[],
  at: number,
): Group | undefined {
  const here = text[at] ?? '';
  const next = text[at + 1];

  const gluedNumber = glued(here);
  if (gluedNumber !== null) {
    return { kind: 'comparator', start: at, end: at + 1, number: gluedNumber };
  }

  if (COMPARATOR.test(here) && next !== undefined) {
    const joined = parseNumber([here, next]);
    if (joined !== null) {
      return { kind: 'comparator', start: at, end: at + 2, number: joined };
    }
  }

  const first = plain(here);
  if (first !== null) {
    const third = text[at + 2];
    if (next !== undefined && DASH.test(next) && third !== undefined && plain(third) !== null) {
      return closed(text, region, at, at + 3);
    }
    return { kind: 'number', start: at, end: at + 1, number: first };
  }

  // `Έως 5` / `μέχρι 5`: the words belong to `ranges.ts`, so the pair is
  // offered to it rather than restated here.
  if (next !== undefined && plain(next) !== null && parseRange([here, next]) !== null) {
    return closed(text, region, at, at + 2);
  }

  return parseRange([here]) === null ? undefined : closed(text, region, at, at + 1);
}

/** A range group, with a repeated unit stripped and any other tail kept. */
function closed(
  text: readonly string[],
  region: readonly number[],
  start: number,
  bound: number,
): Group {
  const tail = region[bound] === region[bound - 1] ? text[bound] : undefined;
  if (tail !== undefined && plain(tail) === null && !DASH.test(tail)) {
    if (isKnownUnit(tail)) {
      return { kind: 'range', start, end: bound + 1, range: parseRange(text.slice(start, bound)) };
    }
    return {
      kind: 'range',
      start,
      end: bound + 1,
      range: parseRange(text.slice(start, bound + 1)),
    };
  }

  return { kind: 'range', start, end: bound, range: parseRange(text.slice(start, bound)) };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

interface Reading {
  value: ParsedNumber | null;
  range: ReferenceRange | null;
  unparsedRange: boolean;
  ambiguousRole: boolean;
  unitTokens: string[];
  unitAt: number;
  /** Candidate offsets the reading came from, for the review crop. */
  read: number[];
}

/**
 * Assign the value and the reference range.
 *
 * The order is § A2's. A two-sided or textual interval is always a range, so a
 * row printing one interval and nothing else is a range with no value — a
 * single measurement is never printed as an interval. A comparator group is
 * the value only when a recognised unit follows it, which is what tells
 * `< 1.03 mg/L` (a result below the assay's floor) from `< 5` (the reference).
 * A comparator group nobody can place is kept as the value and flagged
 * `ambiguous-role`, because discarding it would lose a printed measurement and
 * choosing silently would invent one.
 */
function assign(groups: readonly Group[], candidates: readonly Candidate[]): Reading {
  const text = candidates.map((candidate) => candidate.text);
  const region = candidates.map((candidate) => candidate.region);

  let value: ParsedNumber | null = null;
  let valueEnd = -1;
  let range: ReferenceRange | null = null;
  let unparsedRange = false;
  let ambiguousRole = false;
  let seenRange = false;
  const read: number[] = [];

  const take = (group: Group): void => {
    for (let at = group.start; at < group.end; at += 1) {
      read.push(at);
    }
  };

  for (const group of groups) {
    if (group.kind === 'range') {
      if (!seenRange) {
        seenRange = true;
        range = group.range;
        unparsedRange = group.range === null;
        take(group);
      }
      continue;
    }

    if (value !== null) {
      if (!seenRange && group.kind === 'comparator' && group.number.comparator !== null) {
        seenRange = true;
        range = RANGE_OF[group.number.comparator](group.number.value);
        take(group);
      }
      continue;
    }

    if (group.kind === 'number') {
      value = group.number;
      valueEnd = group.end;
      take(group);
      continue;
    }

    // A comparator group with a recognised unit behind it is a measurement.
    if (unitRun(text, region, group.end).length > 0) {
      value = group.number;
      valueEnd = group.end;
      take(group);
      continue;
    }

    // A comparator group printed after an interval is the interval's own
    // second thought, not a result.
    if (seenRange) {
      continue;
    }

    value = group.number;
    valueEnd = group.end;
    take(group);
    ambiguousRole = true;
  }

  const unitTokens = valueEnd < 0 ? [] : unitWindow(text, region, valueEnd);

  return { value, range, unparsedRange, ambiguousRole, unitTokens, unitAt: valueEnd, read };
}

/**
 * The tokens that may spell the unit: everything printed after the value, in
 * the direction the value was found, up to the next number.
 *
 * Both bounds matter. `1031` followed by `1010 - 1030` must not read the
 * range's lower bound as a unit, and a value found to the right of the anchor
 * is not continued by the label printed to its left.
 */
function unitWindow(text: readonly string[], region: readonly number[], from: number): string[] {
  const window: string[] = [];

  const direction = from === 0 ? undefined : region[from - 1];

  for (let at = from; at < text.length; at += 1) {
    const token = text[at] ?? '';
    if (direction !== undefined && region[at] !== direction) {
      break;
    }
    if (looksNumeric(token) || DASH.test(token) || COMPARATOR.test(token)) {
      break;
    }
    window.push(token);
  }

  return window;
}

/** The longest adjacent run of up to three tokens the allowlist accepts. */
function unitRun(text: readonly string[], region: readonly number[], from: number): string[] {
  const window = unitWindow(text, region, from);

  for (let length = Math.min(MAX_UNIT_TOKENS, window.length); length >= 1; length -= 1) {
    const run = window.slice(0, length);
    if (isKnownUnit(run.join(' '))) {
      return run;
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

interface Demotions {
  confidence: Confidence;
  flags: ParseFlag[];
}

function demote(from: Confidence, to: Confidence): Confidence {
  return RANK[to] < RANK[from] ? to : from;
}

/**
 * Read one anchor's row.
 *
 * `allRows` is the document's, because a stacked cell may sit in the row below
 * the anchor's; `anchors` is the document's for the same reason the stop
 * conditions exist — the next marker's x and y are where this one's reading
 * ends. Neither is searched for a value beyond those bounds.
 */
export function readAnchor(
  anchor: Anchor,
  row: Row,
  allRows: readonly Row[],
  anchors: readonly Anchor[],
): ParsedRow {
  const found = neighbourhood(anchor, row, allRows, anchors);
  const groups = groupsOf(found.candidates);
  const reading = assign(groups, found.candidates);

  const unit = unitOf(reading.unitTokens, reading.unitAt);
  const categorical = groups.length === 0 ? categoricalOf(found.candidates) : null;

  const { confidence, flags } = grade(anchor, reading, unit, found.stopped, categorical !== null);
  const cells = consumed(found.candidates, categorical?.read ?? reading.read, unit);

  const base = {
    id: anchor.id,
    label: anchor.label,
    markerKey: anchor.markerKey,
    confidence,
    source: 'anchor' as const,
    section: anchor.section,
    flags,
    sourceOrder: Math.max(0, anchors.indexOf(anchor)),
    sourceRef: sourceRefOf(anchor, row, cells),
  };

  if (categorical !== null) {
    return {
      ...base,
      status: 'categorical',
      value: null,
      comparator: null,
      textValue: categorical.textValue,
      unit: null,
      referenceRange: null,
      categoricalReference: categorical.reference,
    };
  }

  return {
    ...base,
    status: reading.value === null ? 'missing' : 'value',
    value: reading.value?.value ?? null,
    comparator: reading.value?.comparator ?? null,
    textValue: null,
    unit: unit?.text ?? null,
    referenceRange: reading.range,
    categoricalReference: null,
  };
}

interface Unit {
  text: string;
  recognised: boolean;
  read: number[];
}

/**
 * The printed unit, folded.
 *
 * Acceptance is not a precondition for storing it: an unrecognised unit is
 * kept as its normalised text so review sees what the laboratory printed, and
 * the row is flagged and demoted rather than emptied. Acceptance gates one
 * thing only — how many tokens the unit is allowed to span.
 */
function unitOf(tokens: readonly string[], from: number): Unit | undefined {
  const at = (length: number): number[] => Array.from({ length }, (_unused, index) => from + index);

  for (let length = Math.min(MAX_UNIT_TOKENS, tokens.length); length >= 1; length -= 1) {
    const run = tokens.slice(0, length).join(' ');
    if (isKnownUnit(run)) {
      return { text: normaliseUnit(run), recognised: true, read: at(length) };
    }
  }

  const [first] = tokens;
  return first === undefined
    ? undefined
    : { text: normaliseUnit(first), recognised: false, read: at(1) };
}

/**
 * A result the laboratory printed as words (D15).
 *
 * The urine panel is entirely non-numeric, and reading it as `missing` would
 * discard a whole panel the user attached. The first candidate cell is the
 * result and everything after it is the reference the laboratory printed
 * beside it, verbatim — including compound forms like `Αρνητικό(<=10 mg/dl)`.
 * A whole printed line has no cells to divide, so there the first token is the
 * result and the rest the reference.
 */
function categoricalOf(
  candidates: readonly Candidate[],
): { textValue: string; reference: string | null; read: number[] } | null {
  const [first] = candidates;
  if (first === undefined) {
    return null;
  }

  // A result and the reference printed beside it lie in one direction from the
  // anchor. Anything reached by another direction is a different row's text.
  const printed = candidates.filter((candidate) => candidate.region === first.region);
  const head =
    first.item === null
      ? printed.slice(0, 1)
      : printed.filter((candidate) => candidate.item === first.item);
  const rest = printed.slice(head.length);

  const reference = rest.map((candidate) => candidate.text).join(' ');

  return {
    textValue: head.map((candidate) => candidate.text).join(' '),
    reference: reference === '' ? null : reference,
    read: printed.map((candidate) => candidates.indexOf(candidate)),
  };
}

/**
 * The boxes the reading actually came from.
 *
 * The neighbourhood is wider than the reading — the search looks in three
 * directions and fills roles from the front — and a review crop drawn around
 * everything looked at would frame cells this row never used. Only what was
 * read is pointed at.
 */
function consumed(
  candidates: readonly Candidate[],
  read: readonly number[],
  unit: Unit | undefined,
): TextItem[] {
  const offsets = new Set(read);
  if (unit !== undefined) {
    for (const at of unit.read) {
      offsets.add(at);
    }
  }

  const items: TextItem[] = [];
  for (const at of [...offsets].sort((a, b) => a - b)) {
    const item = candidates[at]?.item;
    if (item != null && !items.includes(item)) {
      items.push(item);
    }
  }

  return items;
}

/**
 * Confidence and flags this pass can justify.
 *
 * Demotion always takes the worse of current and target, and nothing here
 * promotes: a tier is the best a row can be, and every rule below is a reason
 * to trust it less. The plausibility check and the anchor-overlap flag are
 * `extract.ts`'s, because they compare a row against the registry and against
 * other rows rather than against what was printed.
 */
function grade(
  anchor: Anchor,
  reading: Reading,
  unit: Unit | undefined,
  stopped: boolean,
  categorical: boolean,
): Demotions {
  const flags: ParseFlag[] = [];
  let confidence = anchor.confidence;

  if (reading.value?.ambiguousThousands === true) {
    flags.push('ambiguous-thousands');
    confidence = demote(confidence, 'low');
  }
  if (reading.ambiguousRole) {
    flags.push('ambiguous-role');
    confidence = demote(confidence, 'low');
  }
  if (reading.unparsedRange) {
    flags.push('unparsed-range');
    confidence = demote(confidence, 'medium');
  }
  if (unit !== undefined && !unit.recognised) {
    flags.push('unrecognised-unit');
    confidence = demote(confidence, 'medium');
  }
  if (reading.value?.comparator != null) {
    confidence = demote(confidence, 'medium');
  }
  if (!categorical && reading.value === null) {
    confidence = demote(confidence, 'low');
  }
  if (stopped && (unit === undefined || reading.range === null)) {
    confidence = demote(confidence, 'low');
  }

  return { confidence, flags };
}

/**
 * Where the row was read from: the anchor's own span plus every box it read.
 *
 * Only measured boxes take part — the union of what pdf.js reported, never an
 * interpolated coordinate (D13) — so the review crop shows the reader exactly
 * the cells this row came from.
 */
function sourceRefOf(anchor: Anchor, row: Row, cells: readonly TextItem[]): SourceRef {
  const owned = new Set(anchor.sourceRef.itemIds ?? []);
  const items = [...row.items.filter((item) => owned.has(item.id)), ...cells];

  const ref: SourceRef = {
    sourceId: anchor.sourceRef.sourceId,
    page: anchor.sourceRef.page,
    itemIds: items.map((item) => item.id),
  };

  const box = union(items);
  if (box !== undefined) {
    ref.box = box;
  }
  if (items.length === 1 && anchor.sourceRef.textRange !== undefined) {
    ref.textRange = anchor.sourceRef.textRange;
  }

  return ref;
}

function union(items: readonly TextItem[]): Rect | undefined {
  const [first] = items;
  if (first === undefined) {
    return undefined;
  }
  if (items.length === 1) {
    return { x: first.x, y: first.y, w: first.w, h: first.h };
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
