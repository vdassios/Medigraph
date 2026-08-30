import { z } from 'zod';

/**
 * Field-level contracts (docs/plan.md, "Field-level contracts") plus the two
 * validators Task 0.2 requires.
 *
 * These shapes are **provisional until Task 3.8** freezes them. A field change
 * before or after freeze updates the plan and every affected fixture in the same
 * change — never add a convenience field locally.
 *
 * Pure domain code: zero DOM, zero I/O, and no browser or vendor runtime objects (D4).
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

export type ReferenceRange = z.infer<typeof referenceRangeSchema>;

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

export type CollectedAt = z.infer<typeof collectedAtSchema>;
export type Measurement = z.infer<typeof measurementSchema>;
export type Report = z.infer<typeof reportSchema>;
export type Profile = z.infer<typeof profileSchema>;

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
// `validateProfile` is the Zod structural + semantic gate: it accepts `unknown`
// and either returns a `Profile` or throws. `assertProfileSafe` is the separate D7
// safety validator over the one free-text path into a Profile — an approved
// unknown-marker label. Both are called on import (Task 3.5) and before persist.
// ---------------------------------------------------------------------------

const PROFILE_LIMITS = {
  maxReports: 10_000,
  maxMeasurementsPerReport: 1_000,
  maxUnknownLabelLength: 120,
} as const;

function fail(path: string, message: string): never {
  throw new Error(`invalid-profile: ${path} ${message}`);
}

const idSchema = z.string().min(1, 'must be a non-empty string');
const finiteNumberSchema = z.number({ error: 'must be a finite number' });
const comparatorSchema = z.enum(['<', '<=', '>', '>=']);

const civilDateSchema = z.string().superRefine((date, context) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    context.addIssue({ code: 'custom', message: 'must be a YYYY-MM-DD date' });
    return;
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12) {
    context.addIssue({ code: 'custom', message: 'has a month outside 1-12' });
    return;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    context.addIssue({ code: 'custom', message: 'is not a real calendar day' });
  }
});

const civilTimeSchema = z.string().superRefine((time, context) => {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    context.addIssue({ code: 'custom', message: 'must be an HH:mm time' });
    return;
  }
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  if (hour > 23 || minute > 59) {
    context.addIssue({ code: 'custom', message: 'is not a valid time of day' });
  }
});

const referenceRangeSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('closed'), min: finiteNumberSchema, max: finiteNumberSchema }),
    z.object({
      kind: z.literal('minOnly'),
      min: finiteNumberSchema,
      comparator: z.enum(['>', '>=']),
    }),
    z.object({
      kind: z.literal('maxOnly'),
      max: finiteNumberSchema,
      comparator: z.enum(['<', '<=']),
    }),
  ])
  .superRefine((range, context) => {
    if (range.kind === 'closed' && range.min > range.max) {
      context.addIssue({ code: 'custom', message: 'has min greater than max' });
    }
  });

const collectedAtSchema = z.discriminatedUnion('precision', [
  z.object({ date: civilDateSchema, time: z.null(), precision: z.literal('day') }),
  z.object({ date: civilDateSchema, time: civilTimeSchema, precision: z.literal('minute') }),
]);

const measurementSchema = z
  .object({
    markerKey: idSchema,
    label: z.string().optional(),
    status: z.enum(['value', 'missing']),
    value: finiteNumberSchema.nullable(),
    comparator: comparatorSchema.nullable(),
    unit: z.string().nullable(),
    referenceRange: referenceRangeSchema.nullable(),
    sourceOrder: z.number().int().nonnegative(),
  })
  .superRefine((measurement, context) => {
    if (measurement.label !== undefined && !measurement.markerKey.startsWith('x:')) {
      context.addIssue({
        code: 'custom',
        message: 'is allowed only for a derived x:* marker key',
        path: ['label'],
      });
    }
    if (measurement.status === 'missing' && measurement.value !== null) {
      context.addIssue({
        code: 'custom',
        message: "must be null when status is 'missing'",
        path: ['value'],
      });
    }
    if (measurement.status === 'missing' && measurement.comparator !== null) {
      context.addIssue({
        code: 'custom',
        message: "must be null when status is 'missing'",
        path: ['comparator'],
      });
    }
    if (measurement.status === 'value' && measurement.value === null) {
      context.addIssue({
        code: 'custom',
        message: "must be a finite number when status is 'value'",
        path: ['value'],
      });
    }
  });

const reportSchema = z
  .object({
    id: idSchema,
    collectedAt: collectedAtSchema,
    measurements: z
      .array(measurementSchema)
      .max(
        PROFILE_LIMITS.maxMeasurementsPerReport,
        `exceeds ${String(PROFILE_LIMITS.maxMeasurementsPerReport)} entries`,
      ),
  })
  .superRefine((report, context) => {
    const markerKeys = new Set<string>();
    for (const measurement of report.measurements) {
      if (markerKeys.has(measurement.markerKey)) {
        context.addIssue({
          code: 'custom',
          message: `repeats marker key ${measurement.markerKey}`,
          path: ['measurements'],
        });
      }
      markerKeys.add(measurement.markerKey);
    }
  });

const profileSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    reports: z
      .array(reportSchema)
      .max(PROFILE_LIMITS.maxReports, `exceeds ${String(PROFILE_LIMITS.maxReports)} entries`),
  })
  .superRefine((profile, context) => {
    const reportIds = new Set<string>();
    const reportsByDate = new Map<string, { report: Report; index: number }[]>();

    for (const [index, report] of profile.reports.entries()) {
      if (reportIds.has(report.id)) {
        context.addIssue({
          code: 'custom',
          message: `repeats report id ${report.id}`,
          path: ['reports', index, 'id'],
        });
      }
      reportIds.add(report.id);

      const reports = reportsByDate.get(report.collectedAt.date);
      if (reports) reports.push({ report, index });
      else reportsByDate.set(report.collectedAt.date, [{ report, index }]);
    }

    for (const [date, sameDay] of reportsByDate) {
      if (sameDay.length < 2) continue;
      const times = new Set<string>();
      for (const { report, index } of sameDay) {
        const { precision, time } = report.collectedAt;
        if (precision !== 'minute') {
          context.addIssue({
            code: 'custom',
            message: `must be minute-precision because ${date} carries more than one Report`,
            path: ['reports', index, 'collectedAt'],
          });
          continue;
        }
        if (times.has(time)) {
          context.addIssue({
            code: 'custom',
            message: `is not unique within ${date}`,
            path: ['reports', index, 'collectedAt', 'time'],
          });
        }
        times.add(time);
      }
    }
  });

function formatProfilePath(path: PropertyKey[]): string {
  return path.reduce<string>(
    (result, segment) =>
      typeof segment === 'number'
        ? `${result}[${String(segment)}]`
        : `${result}.${String(segment)}`,
    'profile',
  );
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
  const result = profileSchema.safeParse(value);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  if (!issue) fail('profile', 'is invalid');
  fail(formatProfilePath(issue.path), issue.message);
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
