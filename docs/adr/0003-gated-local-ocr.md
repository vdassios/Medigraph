# ADR-0003: Gate the local Greek OCR engine on evidence

- **Status:** Accepted; concrete engine selection pending Task 0.7 evidence
- **Date:** 2026-08-29
- **Decision:** D3

## Context

PP-OCRv5 has a dedicated Greek recognition model and attractive size/accuracy, but
there is no official Greek ONNX browser export and custom dictionary wiring is
unproven. Tesseract's `ell+eng` browser integration is more mature. Vendor clean-text
accuracy does not establish report-level value precision on phone photos.

## Decision

Task 0.7 compares PP-OCRv5 Greek ONNX with `tesseract.js` `ell+eng` in Chromium and
Safari, recording conversion/integration failures, recognition confidence, exact
asset hashes and latency. It selects one `OcrEngine` before Wave 3; this ADR and D3
are amended with that result.

Whichever engine wins runs entirely in-browser. Its models, dictionary and runtime
are self-hosted under `public/` and lazy-loaded (amended by
[ADR-0009](0009-egress-data-rule-and-origin-allowlist.md): plain paths, no content-hash
manifest). Real image-to-OCR corpus
scores and supported-phone limits are separate release gates. PP-OCRv6 is not a
drop-in upgrade because its published language set does not include Greek.

## Consequences

The implementation depends on the stable `OcrEngine`/TextItem contract, not a vendor
API. Failure of PP-OCR integration selects Tesseract; failure of E1 quality or device
performance changes its product label to assisted/beta and never enables a server
fallback.
