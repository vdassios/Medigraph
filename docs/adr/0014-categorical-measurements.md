# ADR-0014: Categorical measurements

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decisions:** D15, amends D9, D11, D13
- **Amends:** [ADR-0007](0007-plaintext-medigraph-files.md)

## Context

The domain model was numeric throughout: `value: number | null`, a `ReferenceRange` of
numeric bounds, and a `Series` plotted on a numeric y-scale. A `ParseStatus` was either
`value` or `missing`.

An ΑΗΦΥ document routinely contains results that are not numbers. The urine panel
reports `Χροιά: Ωχροκίτρινη` against a printed reference of `Κίτρινη`, and
`Λεύκωμα: Αρνητικό` against `Αρνητικό(<=10 mg/dl)`. Some cells hold both a number and a
word — `Αντίδραση PH: 6.0 Όξινη`.

Under the numeric model every one of those rows becomes `status: 'missing'`. A user
attaches a document containing a full urine panel and Medigraph silently returns nothing
from it, which is the failure mode the plan most wants to avoid: data the user can see
on the page, absent from the app, with no explanation.

## Decision

A `Measurement` is numeric or categorical.

`status: 'categorical'` carries a trimmed, non-empty `textValue` and a nullable
`categoricalReference` — the string the laboratory printed in `Φυσιολογικές Τιμές`,
verbatim, including forms like `Αρνητικό(<=10 mg/dl)`. Its `value`, `comparator`, `unit`
and `referenceRange` are all null. A categorical result has no unit, is never converted,
and never reaches `units.ts`, so a categorical Series never splits on unit
incompatibility.

A cell holding both a number and a word is `status: 'value'`; the number is the
measurement and the trailing word is the laboratory's gloss on it, and is discarded.

Categorical Series are ordered by collection date like numeric ones and rendered as a
step sequence of printed values. Equality is exact on the normalised string. **No
ordering is defined between two distinct strings and none may be invented** — `Αρνητικό`
is not ranked against `Θετικό`, no colour encodes direction, and no string is described
as better, worse, improving or abnormal.

## Consequences

The persisted schema gains two nullable fields, so `.medigraph` gains a schema version
and a migration that defaults both to null (ADR-0007's envelope is otherwise unchanged).
`validateProfile` enforces the per-status field invariants. `SeriesPoint` carries the
same two fields and `series.ts` passes categorical points through unconverted.

The chart specifications gain a categorical rendering: a step sequence of printed
strings against the printed expected value, with no y-scale, no interpolation between
points and no in-range shading. D13 is the binding constraint on that view and is
tighter here than for numeric markers, because a categorical value reads as a verdict in
a way a number does not. The panel and trend views must show the laboratory's string and
the laboratory's expected string side by side, and say nothing further.
