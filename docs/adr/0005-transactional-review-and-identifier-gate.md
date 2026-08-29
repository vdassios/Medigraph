# ADR-0005: Transactional review and a hard identifier gate

- **Status:** Accepted
- **Date:** 2026-08-29
- **Decisions:** D6, D7

## Context

Displaying low-confidence rows or possible identifiers is insufficient if a partial
or unresolved draft can still reach charts, IndexedDB or export. Multi-file imports
also need dates, source grouping and duplicate marker conflicts resolved together.

## Decision

One attach batch creates one memory-only review session. The user confirms every
Report date and source grouping, resolves each duplicate-marker Conflict to exactly
one Measurement, and resolves every identifier candidate by redacting it, deleting
the affected row or explicitly dismissing a false positive. Grouping and dates have
separate explicit confirmation state. Every surviving unknown-marker label requires
an approval; reassignment/deletion invalidates stale approvals and rebuilds conflicts.
Rows from E0/E1 support source page/crop inspection through transient resources owned
by the application island.

Confirm remains disabled until all gates pass and then writes all resulting Reports
in one IndexedDB transaction. Cancel, error, Confirm and unmount release every source
File reference, revoke object URLs, close bitmaps and drop raw-text/crop references.
No draft is charted or persisted.

## Consequences

The app needs one owner for the attach-to-confirm state machine rather than isolated
island stores. Review is a core domain boundary, not optional UI polish. E2/direct-row
adapters must provide enough date and identifier evidence to satisfy the same gate.
