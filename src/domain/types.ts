/**
 * Field-level contracts (docs/plan.md, "Field-level contracts") plus the two
 * validators Task 0.2 requires.
 *
 * These shapes are **provisional until Task 3.8** freezes them. A field change
 * before or after freeze updates the plan and every affected fixture in the same
 * change — never add a convenience field locally.
 *
 * Pure TypeScript: zero DOM, zero I/O, no browser or vendor types (D4).
 */

export type Confidence = 'high' | 'medium' | 'low';
export type Comparator = '<' | '<=' | '>' | '>=';
export type ParseStatus = 'value' | 'missing';
export type ParseSource = 'anchor' | 'layout' | 'adapter';
export type ParseFlag =
  | 'ambiguous-thousands'
  | 'ambiguous-role'
  | 'implausible-value'
  | 'unrecognised-unit'
  | 'unparsed-range'
  | 'competing-anchor'
  | 'low-ocr-confidence';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface SourceTextRange {
  itemId: string;
  start: number;
  end: number;
} // UTF-16 [start,end)
export interface SourceRef {
  sourceId: string;
  page: number; // 1-based
  box?: Rect;
  itemIds?: string[];
  textRange?: SourceTextRange; // exact span for a whole-line anchor
}
export interface TextItem extends Rect {
  id: string;
  text: string;
  confidence?: number; // [0,1], absent when the adapter has none
}

export interface LexicalToken {
  text: string;
  parentItemId: string;
  start: number; // UTF-16 code-unit offset, inclusive
  end: number; // UTF-16 code-unit offset, exclusive
}

export interface Row {
  id: string;
  sourceId: string;
  page: number;
  items: TextItem[]; // x-ascending, original observations preserved
  y: number;
  h: number;
}

export type MatchTier = 'T1' | 'T2' | 'T3' | 'T4';
export interface Anchor {
  id: string;
  markerKey: string;
  label: string;
  tier: MatchTier;
  confidence: Confidence;
  section: string | null;
  sourceRef: SourceRef;
}

export type ColumnRole = 'label' | 'value' | 'unit' | 'range' | 'unknown';
export interface Column {
  role: ColumnRole;
  xMin: number;
  xMax: number;
}
export interface ColumnModel {
  page: number;
  yMin: number;
  yMax: number;
  columns: Column[];
}

export interface ParsedNumber {
  value: number;
  comparator: Comparator | null;
  ambiguousThousands: boolean;
}

export type ReferenceRange =
  | { kind: 'closed'; min: number; max: number }
  | { kind: 'minOnly'; min: number; comparator: '>' | '>=' }
  | { kind: 'maxOnly'; max: number; comparator: '<' | '<=' };

export interface ParsedRow {
  id: string;
  label: string;
  markerKey: string;
  status: ParseStatus;
  value: number | null;
  comparator: Comparator | null;
  unit: string | null;
  referenceRange: ReferenceRange | null;
  confidence: Confidence;
  source: ParseSource;
  section: string | null;
  flags: ParseFlag[];
  sourceOrder: number;
  sourceRef?: SourceRef;
}

export interface DateCandidate {
  id: string;
  raw: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:mm, local civil time
  precision: 'day' | 'minute';
  ambiguous: boolean;
  kind: 'collection' | 'report' | 'print' | 'birth' | 'unknown';
  score: number;
  sourceRef?: SourceRef;
}

export interface IdentifierCandidate {
  id: string;
  kind: 'name' | 'national-id' | 'patient-id' | 'phone' | 'email' | 'address' | 'other'; // AMKA is national-id
  text: string; // transient; never copied into Profile
  sourceRef?: SourceRef;
}

export interface ExtractionResult {
  sourceId: string;
  adapterId: string;
  tier: 'E0' | 'E1' | 'E2';
  registryVersion: number;
  rows: ParsedRow[];
  dateCandidates: DateCandidate[];
  identifierCandidates: IdentifierCandidate[];
  unrecognised: string[];
  evidenceAvailable: boolean;
  evidencePages?: TextItem[][]; // transient review evidence only
}

export interface CollectedAt {
  date: string; // YYYY-MM-DD, local civil date
  time: string | null; // required to distinguish two same-day Reports
  precision: 'day' | 'minute';
}

export interface Measurement {
  markerKey: string;
  label?: string; // allowed only for an approved x:* marker
  status: ParseStatus;
  value: number | null; // native lab value
  comparator: Comparator | null;
  unit: string | null; // native lab unit
  referenceRange: ReferenceRange | null; // native lab range
  sourceOrder: number;
}

export interface Report {
  id: string; // UUID created only when review is confirmed
  collectedAt: CollectedAt;
  measurements: Measurement[]; // markerKey unique within this array
}

export interface Profile {
  schemaVersion: 1;
  id: string; // opaque UUID, never a patient identifier
  reports: Report[];
}

export interface Conflict {
  id: string;
  markerKey: string;
  candidateRowIds: string[];
  resolution:
    { kind: 'choose'; rowId: string } | { kind: 'edited'; measurement: Measurement } | null;
}

export type IdentifierResolution = 'redacted' | 'deleted-row' | 'false-positive';
export interface ReviewReportDraft {
  id: string; // ephemeral; never persisted as the Report id
  sourceIds: string[];
  groupingConfirmed: boolean;
  targetReportId: string | null; // explicit “add to existing report”, never inferred
  collectedAt: CollectedAt | null;
  dateConfirmed: boolean;
  rows: ParsedRow[];
  conflicts: Conflict[];
}

export interface ReviewSession {
  id: string;
  results: ExtractionResult[];
  reportDrafts: ReviewReportDraft[];
  identifierResolutions: Record<string, IdentifierResolution>;
  approvedUnknownRowIds: string[];
  existingReportDateUpdates: Record<string, CollectedAt>;
  samePersonConfirmed: boolean | null;
}

export interface ProfileChange {
  updates: Report[];
  additions: Report[];
}

export type ProfileMergeConflict =
  | { kind: 'report-id'; existing: Report; incoming: Report }
  | { kind: 'same-day-precision'; existing: Report; incoming: Report };

export interface ProfileMergePlan {
  duplicateReportIds: string[];
  updates: Report[];
  additions: Report[];
  conflicts: ProfileMergeConflict[];
}

export type ProfileMergeResult =
  | { ok: true; profile: Profile }
  | { ok: false; error: 'report-id-conflict' | 'same-day-precision-conflict' };

export interface SeriesPoint {
  reportId: string;
  collectedAt: CollectedAt;
  status: ParseStatus;
  value: number | null; // converted to Series.unit when possible
  comparator: Comparator | null;
  referenceRange: ReferenceRange | null; // converted by the same factor
  nativeValue: number | null;
  nativeUnit: string | null;
  nativeReferenceRange: ReferenceRange | null;
}

export interface Series {
  id: string; // `${markerKey}@${unit-or-none}`
  markerKey: string;
  label: string;
  unit: string | null;
  points: SeriesPoint[];
}

// ---------------------------------------------------------------------------
// Validation
//
// `validateProfile` is the structural + semantic gate: it accepts `unknown` and
// either returns a `Profile` or throws. `assertProfileSafe` is the separate D7
// safety validator over the one free-text path into a Profile — an approved
// unknown-marker label. Both are called on import (Task 3.5) and before persist.
// ---------------------------------------------------------------------------

/** Bounds from the `.medigraph` file format section. */
export const PROFILE_LIMITS = {
  maxReports: 10_000,
  maxMeasurementsPerReport: 1_000,
  maxUnknownLabelLength: 120,
} as const;

function fail(path: string, message: string): never {
  throw new Error(`invalid-profile: ${path} ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Non-empty opaque string. Ids are opaque here; UUID shape is a producer concern. */
function requireId(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'must be a non-empty string');
  return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number');
  return value;
}

/** Strict Gregorian YYYY-MM-DD — rejects 2025-02-30 and 2025-13-01. */
function requireCivilDate(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(path, 'must be a YYYY-MM-DD date');
  }
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12) fail(path, 'has a month outside 1-12');
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d < 1 || d > daysInMonth) fail(path, 'is not a real calendar day');
  return value;
}

/** Local civil HH:mm, 00:00-23:59. No timezone conversion (plan: grouping rules). */
function requireCivilTime(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    fail(path, 'must be an HH:mm time');
  }
  const [h, min] = value.split(':').map(Number) as [number, number];
  if (h > 23 || min > 59) fail(path, 'is not a valid time of day');
  return value;
}

const COMPARATORS: readonly Comparator[] = ['<', '<=', '>', '>='];

function validateComparator(value: unknown, path: string): Comparator | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !COMPARATORS.includes(value as Comparator)) {
    fail(path, `must be null or one of ${COMPARATORS.join(', ')}`);
  }
  return value as Comparator;
}

function validateReferenceRange(value: unknown, path: string): ReferenceRange | null {
  if (value === null) return null;
  if (!isRecord(value)) fail(path, 'must be null or an object');
  switch (value.kind) {
    case 'closed': {
      const min = requireFiniteNumber(value.min, `${path}.min`);
      const max = requireFiniteNumber(value.max, `${path}.max`);
      if (min > max) fail(path, 'has min greater than max');
      return { kind: 'closed', min, max };
    }
    case 'minOnly': {
      const min = requireFiniteNumber(value.min, `${path}.min`);
      const comparator = value.comparator;
      if (comparator !== '>' && comparator !== '>=') {
        fail(`${path}.comparator`, "must be '>' or '>=' for a minOnly range");
      }
      return { kind: 'minOnly', min, comparator };
    }
    case 'maxOnly': {
      const max = requireFiniteNumber(value.max, `${path}.max`);
      const comparator = value.comparator;
      if (comparator !== '<' && comparator !== '<=') {
        fail(`${path}.comparator`, "must be '<' or '<=' for a maxOnly range");
      }
      return { kind: 'maxOnly', max, comparator };
    }
    default:
      fail(`${path}.kind`, "must be 'closed', 'minOnly' or 'maxOnly'");
  }
}

function validateCollectedAt(value: unknown, path: string): CollectedAt {
  if (!isRecord(value)) fail(path, 'must be an object');
  const date = requireCivilDate(value.date, `${path}.date`);
  const precision = value.precision;
  if (precision !== 'day' && precision !== 'minute') {
    fail(`${path}.precision`, "must be 'day' or 'minute'");
  }
  const rawTime = value.time;
  if (precision === 'day') {
    if (rawTime !== null) fail(`${path}.time`, "must be null when precision is 'day'");
    return { date, time: null, precision: 'day' };
  }
  return { date, time: requireCivilTime(rawTime, `${path}.time`), precision: 'minute' };
}

function validateMeasurement(value: unknown, path: string): Measurement {
  if (!isRecord(value)) fail(path, 'must be an object');
  const markerKey = requireId(value.markerKey, `${path}.markerKey`);

  const status = value.status;
  if (status !== 'value' && status !== 'missing') {
    fail(`${path}.status`, "must be 'value' or 'missing'");
  }

  const referenceRange = validateReferenceRange(value.referenceRange, `${path}.referenceRange`);

  const rawUnit = value.unit;
  if (rawUnit !== null && typeof rawUnit !== 'string') {
    fail(`${path}.unit`, 'must be a string or null');
  }
  const unit = rawUnit;

  const sourceOrder = requireFiniteNumber(value.sourceOrder, `${path}.sourceOrder`);
  if (!Number.isInteger(sourceOrder) || sourceOrder < 0) {
    fail(`${path}.sourceOrder`, 'must be a non-negative integer');
  }

  // A `label` is permitted only for a derived (x:*) marker key. Carrying one on a
  // canonical key is how source text would leak into Profile under a real marker.
  let label: string | undefined;
  const rawLabel = value.label;
  if (rawLabel !== undefined) {
    if (typeof rawLabel !== 'string') fail(`${path}.label`, 'must be a string when present');
    if (!markerKey.startsWith('x:')) {
      fail(`${path}.label`, 'is allowed only for a derived x:* marker key');
    }
    label = rawLabel;
  }

  // status/value consistency, and one-sided comparator direction.
  if (status === 'missing') {
    if (value.value !== null) fail(`${path}.value`, "must be null when status is 'missing'");
    if (value.comparator !== null) {
      fail(`${path}.comparator`, "must be null when status is 'missing'");
    }
    const missing: Measurement = {
      markerKey,
      status: 'missing',
      value: null,
      comparator: null,
      unit,
      referenceRange,
      sourceOrder,
    };
    return label === undefined ? missing : { ...missing, label };
  }

  const numeric = requireFiniteNumber(value.value, `${path}.value`);
  const measured: Measurement = {
    markerKey,
    status: 'value',
    value: numeric,
    comparator: validateComparator(value.comparator, `${path}.comparator`),
    unit,
    referenceRange,
    sourceOrder,
  };
  return label === undefined ? measured : { ...measured, label };
}

function validateReport(value: unknown, path: string): Report {
  if (!isRecord(value)) fail(path, 'must be an object');
  const id = requireId(value.id, `${path}.id`);
  const collectedAt = validateCollectedAt(value.collectedAt, `${path}.collectedAt`);

  const rawMeasurements = value.measurements;
  if (!Array.isArray(rawMeasurements)) fail(`${path}.measurements`, 'must be an array');
  if (rawMeasurements.length > PROFILE_LIMITS.maxMeasurementsPerReport) {
    fail(
      `${path}.measurements`,
      `exceeds ${String(PROFILE_LIMITS.maxMeasurementsPerReport)} entries`,
    );
  }

  const measurements = rawMeasurements.map((entry, i) =>
    validateMeasurement(entry, `${path}.measurements[${String(i)}]`),
  );

  const seen = new Set<string>();
  for (const measurement of measurements) {
    if (seen.has(measurement.markerKey)) {
      fail(`${path}.measurements`, `repeats marker key ${measurement.markerKey}`);
    }
    seen.add(measurement.markerKey);
  }

  return { id, collectedAt, measurements };
}

/**
 * Structural and semantic validation of an untrusted `Profile`.
 *
 * Throws on the first violation. Enforces finite medical numbers, valid Gregorian
 * dates and civil times, `min <= max`, status/value consistency, one-sided
 * comparator direction, unique Report ids, unique marker keys per Report, and the
 * same-date minute-precision rule.
 */
export function validateProfile(value: unknown): Profile {
  if (!isRecord(value)) fail('profile', 'must be an object');
  if (value.schemaVersion !== 1) fail('profile.schemaVersion', 'must be 1');
  const id = requireId(value.id, 'profile.id');

  const rawReports = value.reports;
  if (!Array.isArray(rawReports)) fail('profile.reports', 'must be an array');
  if (rawReports.length > PROFILE_LIMITS.maxReports) {
    fail('profile.reports', `exceeds ${String(PROFILE_LIMITS.maxReports)} entries`);
  }

  const reports = rawReports.map((entry, i) =>
    validateReport(entry, `profile.reports[${String(i)}]`),
  );

  const seenIds = new Set<string>();
  for (const report of reports) {
    if (seenIds.has(report.id)) fail('profile.reports', `repeats report id ${report.id}`);
    seenIds.add(report.id);
  }

  // Equal dates never imply equal Reports. If a date carries more than one Report,
  // every Report on that date must be minute-precision with a distinct time.
  const byDate = new Map<string, Report[]>();
  for (const report of reports) {
    const bucket = byDate.get(report.collectedAt.date);
    if (bucket) bucket.push(report);
    else byDate.set(report.collectedAt.date, [report]);
  }
  for (const [date, sameDay] of byDate) {
    if (sameDay.length < 2) continue;
    const times = new Set<string>();
    for (const report of sameDay) {
      const { precision, time } = report.collectedAt;
      if (precision !== 'minute' || time === null) {
        fail(
          `profile.reports[${report.id}].collectedAt`,
          `must be minute-precision because ${date} carries more than one Report`,
        );
      }
      if (times.has(time)) {
        fail(`profile.reports[${report.id}].collectedAt.time`, `is not unique within ${date}`);
      }
      times.add(time);
    }
  }

  return { schemaVersion: 1, id, reports };
}

// D7 safety validator. The one path source text can take into a Profile is an
// approved unknown-marker label, so it gets a final check independent of review.
// Detecting control characters is the point of this rule, so the regex must
// contain them. D7: a newline in a label could smuggle a second line of text.
// eslint-disable-next-line no-control-regex -- intentional control-char class
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
/** Greek AMKA: 11 consecutive digits. */
const AMKA_PATTERN = /\b\d{11}\b/;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/;
/** Greek mobile/landline shapes, with or without +30, allowing spaces or dashes. */
const PHONE_PATTERN = /(?:\+30[\s-]?)?\b(?:2\d|69)\d(?:[\s-]?\d){7}\b/;

/**
 * Rejects a Profile whose free-text labels could carry identifying content.
 *
 * Separate from `validateProfile` because it is a D7 policy gate, not a shape
 * check: a structurally perfect Profile can still be unsafe to persist.
 */
export function assertProfileSafe(profile: Profile): void {
  for (const report of profile.reports) {
    for (const measurement of report.measurements) {
      const { label, markerKey } = measurement;
      if (label === undefined) continue;

      const path = `profile.reports[${report.id}].measurements[${markerKey}].label`;
      if (!markerKey.startsWith('x:')) {
        fail(path, 'is allowed only for a derived x:* marker key');
      }
      if (label.length > PROFILE_LIMITS.maxUnknownLabelLength) {
        fail(path, `exceeds ${String(PROFILE_LIMITS.maxUnknownLabelLength)} characters`);
      }
      if (CONTROL_CHARACTERS.test(label)) {
        fail(path, 'contains control characters or newlines');
      }
      if (AMKA_PATTERN.test(label)) fail(path, 'looks like an AMKA');
      if (EMAIL_PATTERN.test(label)) fail(path, 'looks like an email address');
      if (PHONE_PATTERN.test(label)) fail(path, 'looks like a phone number');
    }
  }
}
