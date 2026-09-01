# ADR-0012: Template recognition assists review; it never replaces it

- **Status:** Accepted
- **Date:** 2026-09-01
- **Decisions:** D14, D8 (amended)
- **Amends:** [ADR-0006](0006-plaintext-local-profile-storage.md)

## Context

Mandatory review (D6) and the identifier scrub (D7) are the app's worst user
experience. The vision-model appendix already concluded that the achievable prize is
demoting review from "correct every row" to "glance and confirm", and Task 4.2a targets
that as presentation work.

The proposal this record answers went further: keep a whitelist of labs, and skip
verification entirely for a lab whose results we have parsed before, on the premise
that a lab's layout is fixed and only the order of tests varies. The reference corpus
does not support either half of that premise.

**Layout is not fixed per lab.** Four labs produce at least six structurally distinct
layouts. Bioiatriki issues a sectioned list with per-marker method sublines and a
two-panel urine form. Galinos issues a haematology form with a left row-label gutter
and a flat biochemistry table; the two share a masthead, a generator and a lab, and are
not reorderings of one another. Iatrokosmos prints units inside the range column;
Galinos glues them to the value. The stable, matchable unit is the report **template**,
per page — which is also the granularity Task 3.4 already routes at.

**Near-perfect is not perfect, and the residue is silent.** Task 2.5c's release floor
is 99% value precision; across a 25-marker panel that leaves roughly one report in five
carrying at least one wrong value, and this product's stated worst outcome is a
wrong-but-plausible value that never surfaces. The corpus supplies the mechanisms: one
report prints a reference range as `4,50 - 5.85`, mixing decimal separators on one
line; another prints a range for a marker whose result cell is empty, positioned in the
result column's x-band. Task 2.2's acceptance criteria already name both as `missing`
cases. A template authorised to accept without review is precisely the thing that would
convert them into charted values.

**Two further gates are not accuracy questions at all.** The corpus contains reports
for two different people from the same lab, which is exactly what D8's same-person gate
exists to catch and exactly what a recognised template makes more likely rather than
less. And one report's footer carries an ΑΜΚΑ belonging to the signing physician, not
the patient — a D7 candidate that no accuracy improvement resolves.

That last case also shows where the real value is. Template knowledge does not make
review skippable; it makes review's questions already answered. It knows which of
Bioiatriki's three printed dates is the collection date, where the identifier zones
sit, which column carries the unit, and that the footer ΑΜΚΑ is the doctor's.

## Decision

Recognise report templates per page (Pass T), and spend the recognition on review's
cost rather than review's authority.

A `TemplateProfile` may pin `ColumnRole` assignments, set `DateCandidate.kind` for the
label it names, mark identifier zones for automatic **redaction**, record standing
false positives, and supply a `panelHint` to the grouping proposal. It may not create,
alter or suppress a value, a `ParseFlag` or a `Confidence`, and it never discharges D6
date or grouping confirmation, the D7 scrub, conflict resolution, unknown-marker
approval or D8 same-person confirmation. Redaction, never dismissal, is the automatic
default for a matched identifier zone.

Matching is per page and fails closed: band count, header tokens, the date label and
the expected identifier zones are verified before any role is applied, and any failure
discards the match whole. There is no partial application, so a lab that re-versions
its report degrades to current behaviour rather than to a confident misparse. Review
displays every match with its provenance and offers a "review this from scratch"
control; every pre-applied resolution is individually reversible.

Two provenances: a versioned shipped seed asset authored only from training labs, and
profiles learned locally, applied only after two clean confirmations and reset by any
user correction.

**Amendment to D8.** Learned template profiles are a second persisted object class
alongside the single `Profile`. They persist as hashed tokens and geometry only — no
document text, no values, no dates, no identifiers — in a separate bounded store that
`clearAll` removes, and they are excluded from `.medigraph` on both export and import.
Storing hashes rather than readable tokens is what keeps D7's raw-text rule intact;
excluding them from the envelope is because the set of labs a person attends is
health-adjacent metadata and the export is a plaintext file we encourage users to move
around.

## Consequences

Two new curated, versioned assets to keep honest: the shipped profile set, with the
same training-only and holdout-sealed discipline as registry aliases, and the local
store, which needs bounds and a staleness path. `columns.ts` and `dates.ts` gain an
optional prior input and must behave identically without it — the parser floors are
measured with Pass T absent, so Pass A's scores cannot be flattered by it. Review gains
a provenance surface and an escape hatch, and D13 constrains its copy: it may say
Medigraph recognised the form, never that it verified the results.

The claim this rests on is falsifiable and is gated as such. If a fingerprint cannot
separate Galinos haematology from Galinos biochemistry with zero cross-template
matches, the shipped asset and the review surface do not ship.

Auto-confirming a matched document, in any form including earned-after-N-confirmations,
is **not** authorised by this record. It would supersede ADR-0005 and requires its own.
