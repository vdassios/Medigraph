# ADR-0018: A non-exhaustive corpus declares what it cannot judge

- **Status:** Accepted
- **Date:** 2026-09-07
- **Decision:** Amends the plan's "Metric semantics" for Task 0.6's `score`, and the
  parser fixture schema Task 0.5a commits.
- **Does not supersede:** the rule it looks like it weakens. Every emitted row still
  contributes to precision unless the corpus has positively declared that it derived
  that marker and could not judge it.

## Context

`score` counts every emitted row that answered no expectation as a precision
denominator. The rule exists for a good reason, stated in the plan: a parser cannot buy
recall by guessing, because every guess it emits is a precision denominator.

It assumes the expected table is exhaustive. The ΑΗΦΥ parser corpus is not.
`expected.json` commits only rows where poppler's column reconstruction and the
committed TextItems agree, precisely so the corpus never scores the parser against the
parser's own output — and `coverage.note` has said so from the start: _"a marker absent
here is not an expectation that the parser find nothing."_ ΒΙΟΙΑΤΡΙΚΗ withholds 23 of 99
derived rows on that ground, almost all of them markers whose reference "range" is
multi-line risk-tier prose the two engines read differently.

The two rules contradict each other. The fixture declines to assert a row; the metric
charges the parser for reading it. On the committed corpus that was ten emitted rows —
`(TC)` 226, `(TRIG)` 48, `(Vit-B12)` 347, `(anti-Tg)`, `(anti-TPO)`, `(ΗDL-C)`,
`(LDL-C)`, `ασπαρτικού οξέος (SGOT/AST)` 25, eGFR 94.4, `ΧΟΛΗΣΤΕΡΙΝΗ (CHOL)` 234 — every
one of them a row the laboratory really printed and the parser really read. Aggregate
value precision was reported as 81.8% when 88.0% is what the corpus can actually
support.

That is not a small reporting error. Task 2.5c commits CI floors of ≥99% value
precision from these numbers, and a floor set against a metric that charges the parser
for the corpus's own gaps freezes those gaps into the gate.

## Decision

`expected.json` gains two fields:

- `coverage.exhaustive` — whether the corpus asserts every row the document prints.
- `coverage.notScored` — the marker keys it derived, found printed, and could not
  establish the truth of.

`score` gains a third argument, that set. Rows carrying one of those keys are removed
from the emitted table before pairing, so they reach no denominator and no numerator,
and the count set aside is reported as `CorpusScore.unjudged`.

## Consequences

**What is preserved.** A marker in neither list is a false positive and costs precision
exactly as before. A duplicate of an expected marker still costs precision. `notScored`
is a positive declaration per laboratory, checked against the printed document, not a
blanket amnesty for anything the corpus happens not to mention.

**A marker cannot be both.** Expecting a marker and naming it `notScored` would leave it
in the recall denominator and out of the precision one — a marker that can only be
missed. `score` throws, and `parserFixtures.test.ts` checks the same invariant where the
fixture is written.

**The list is a floor.** `notScored` names what has been identified, not everything a
laboratory withheld; `rowsDerived` minus `rowsCorroborated` is that number. ΒΙΟΙΑΤΡΙΚΗ
withholds 23 rows and names 9. An unlisted withheld row still costs precision, so the
error runs against the parser and the reported score stays conservative. Making a
laboratory exhaustive, or extending its list, only ever raises the number.

**`unjudged` is reported, never swallowed.** A growing count is the corpus falling
behind its documents, and Task 2.5c should read it beside the floors rather than only
the ratios.
