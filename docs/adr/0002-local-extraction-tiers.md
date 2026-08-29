# ADR-0002: Local extraction tiers and remote E2 boundary

- **Status:** Accepted
- **Date:** 2026-08-29
- **Decision:** D1a

## Context

Text-layer PDFs and photographed/scanned reports need different local extraction
paths. A future document VLM could fit the domain seam, but a remotely hosted VLM
would transmit source content and conflict with D1.

## Decision

v1 has two local extraction modes:

- **E0:** pdf.js positioned text from usable PDF text layers.
- **E1:** the Greek-capable in-browser OCR engine selected by ADR-0003's spike.

E1 is called a shipping default only after real image-to-OCR quality and supported
phone performance gates pass. Otherwise it remains available as assisted/beta with
honest copy. **E2** is reserved vocabulary for a possible future document-VLM
adapter; no E2 code, endpoint, key flow or dormant upload feature ships in v1.

A future E2-remote proposal requires a separate build and an ADR explicitly
superseding D1 and this ADR, plus new threat/legal review, privacy copy and per-use
consent. Merely supplying one's own API key does not make data egress D1-conforming.

**Amended 2026-08-29 ([ADR-0011](0011-no-vision-language-model-for-v1.md)):** E2 now
splits into **E2-local** (on-device inference, D1-conforming, blocked on Greek model
coverage and device limits rather than on privacy) and **E2-remote** (off-device
inference of any kind, _including a server we operate ourselves_, barred by the data
rule). The undifferentiated term invited two errors: treating a vision model as
inherently privacy-breaking, and treating "self-hosted" as inherently
privacy-preserving. The test is whether the bytes leave the device.

**Amended 2026-08-29 ([ADR-0009](0009-egress-data-rule-and-origin-allowlist.md)):** D1
now permits declared third-party _inbound_ asset fetches via a `connect-src` allowlist.
This does not soften the E2-remote boundary. E2-remote is barred because it transmits
document content off the device, which the data rule forbids outright — not because it
contacts a foreign origin. Declaring an origin can never authorise E2-remote, and the
non-`self` request-shape rule (GET/HEAD, no query, no body, no app-set header) makes an
inference API structurally unreachable through it.

## Consequences

The extraction seam remains capable of direct ParsedRow observations without making
remote processing part of the current architecture. Product fallback on weak OCR is
mandatory review/manual correction, not an undisclosed server call.
