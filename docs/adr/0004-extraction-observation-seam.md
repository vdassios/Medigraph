# ADR-0004: Extraction observations converge into one review draft

- **Status:** Accepted
- **Date:** 2026-08-29
- **Decision:** D4

## Context

pdf.js and OCR naturally emit positioned text, while a possible future local
document model may emit measurement rows directly. The review workflow still needs
date candidates, identifier candidates and source evidence regardless of adapter.
The original minimal ParsedRow contract could not carry those guarantees.

## Decision

An `ExtractionAdapter` returns either page-normalised TextItems or direct ParsedRows.
TextItems have stable ids, optional confidence and no browser/vendor objects. Direct
rows need no TextItem provenance, but their adapter must also provide date and
identifier candidates. Both paths converge into one `ExtractionResult` review draft.

ParsedRow source references are optional domain values (page, normalized box and/or
item ids). E0/E1 must supply them and evidence pages so every row is inspectable;
future direct-row adapters may declare evidence unavailable, which review displays
explicitly rather than fabricating a preview.
Everything downstream of ExtractionResult is adapter-agnostic; only `io/` imports
pdf.js or OCR runtime packages.

## Consequences

Parser behavior remains testable from plain JSON. Review safety evidence is not lost
at the seam. Browser objects, raw files and OCR engine types cannot leak into domain,
Profile, charts or export.
