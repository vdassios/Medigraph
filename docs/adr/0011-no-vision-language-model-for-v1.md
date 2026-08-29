# ADR-0011: No vision-language model in v1; E2 splits into local and remote

- **Status:** Accepted
- **Date:** 2026-08-29
- **Decisions:** D1a (amended), D3, D6
- **Amends:** [ADR-0002](0002-local-extraction-tiers.md)

## Context

D6 makes review-and-correct mandatory between extraction and charting, and the plan
justified it on accuracy alone: "a local rules parser is weaker than a vision model,
so a mandatory review-and-correct step sits between extraction and charting." Stated
that way, the step reads as a workaround for a weak parser — which invites deleting it
as soon as a stronger extractor is available. Review is also the worst part of the
user experience, so the pressure to delete it is real and will recur.

The question put was therefore: what vision model could we run ourselves, and what
would the server cost? An earlier appendix had answered a narrower version ("which VLM
fits a €4.54/mo VPS-1") with "none, and we don't need one" — a correct conclusion
reached on cost grounds that do not actually hold.

Two terms were doing damage. "**Local**" was ambiguous between *on the user's device*
and *on hardware we own*, which are opposite privacy postures. And "**E2**" named a
single hypothetical future tier without distinguishing them, which invited two
symmetrical errors: treating any vision model as inherently privacy-breaking, and
treating "self-hosted" as inherently privacy-preserving.

## Decision

**No vision-language model ships in v1, in any deployment.** E0 (pdf.js text layer)
and E1 (the Task 0.7-selected in-browser Greek OCR engine) remain the extraction
tiers, and the D6 review step is retained on grounds independent of parser accuracy.

**`E2` splits into two tiers that are barred for entirely different reasons:**

- **E2-local** — on-device vision inference. Conforms to D1's data rule. Blocked today
  on Greek model coverage, on the absence of a browser runtime path, and on the Task
  5.5 device gate. Not blocked on privacy, and a legitimate future candidate.
- **E2-remote** — off-device inference of any kind, **including a server we operate
  ourselves**. Transmits document content off the device and therefore violates D1's
  data rule. Requires an ADR superseding D1/D1a, plus new threat and legal review,
  rewritten privacy copy, explicit per-use consent and a separate build.

The test is whether the bytes leave the device. Our own VPS is barred on exactly the
same rule as a third-party API; the origin allowlist is irrelevant to both.

**Review's justification is restated on three independent grounds** so that it
survives any future extractor upgrade: silent-failure containment, the D7 identifier
scrub, and the D6 date/grouping/same-person confirmations.

## Evidence

**No vision model removes review.** This is model-independent — it holds for a browser
VLM, our own hardware and a hosted API equally.

- On Greek specifically, VLMs exhibit visual-grounding failure, generating plausible
  Greek from language priors rather than reading pixels and producing confident output
  that does not match the image ([arXiv 2605.27750](https://arxiv.org/abs/2605.27750)).
- On medical reports specifically, character-level errors on fine-print numeric values
  and units are a recurring end-to-end VLM failure pattern
  ([MedRepBench, arXiv 2508.16674](https://arxiv.org/abs/2508.16674)).
- The failure *shape* matters more than the rate. Our parser emits `ParseFlag`s and a
  `Confidence` that review sorts on; a generative extractor resolves an ambiguous
  `1`/`7` silently. A model that raises average accuracy while removing the signal
  identifying *which rows to distrust* is a net loss at a better headline score.
- A VLM would also enter the D4 seam with `evidenceAvailable: false`, costing us crop
  inspection — the thing that makes review fast — and bypassing the D5a registry.

**E2-local is blocked on capability.** No Greek-capable vision model has a browser
runtime path: PaddleOCR-VL has real Greek (edit distance 0.135, against 0.013 for
Latin) but no ONNX export; SmolVLM, Granite-Docling and LFM-2.5VL have browser paths
and no Greek. A 0.9B model at Q4 is ~500–700 MB — about 40× PP-OCRv5's ~15 MB — with a
1–2 GB working set, against a Task 5.5 gate of ≤512 MiB peak and ≤15 s/page and a
Safari WebGPU buffer cap near 256 MB on iPhone.

**Weight delivery never requires a server.** Cloudflare Pages caps one asset at
25 MiB, but ONNX external-data sharding splits a 600 MB model across ~25 files against
a 20,000-file limit, and an R2 public bucket serves multi-GB files with no egress fee.
If it runs on the device, our existing hosting delivers it; if it needs a server, it is
not on-device. **No "run it locally" option forces us to provision a VPS.**

**E2-remote is cheap.** This must be recorded, because it is the strongest argument
*for* the option and an ADR that omitted it would not survive scrutiny. A dedicated
GPU box is €184–569/mo and is the wrong shape — the workload is a handful of pages per
user a few times a year, so the box idles over 99 % of the time and costs ~€0.12/page
against ~$0.0007 at scale providers. The right shape is serverless GPU with per-second
billing: ~1,500 pages/month at ~4 s each is ~100 GPU-minutes, **roughly €2–4/month.**
CPU-only is separately dead — PaddleOCR-VL 1.6 needs ~53 s/page on an Apple M5 Pro CPU,
so two shared vCores land in the several-minute range.

**PDF-only does not remove review either.** The distinction that matters is text-layer
versus raster, not PDF versus image; a scanned report inside a PDF still needs OCR.
Restricting to text-layer PDFs eliminates the recognition error class, which is the
strongest accuracy lever available and is already the E0 path — but parse-role
ambiguity survives (deciding that `245` is the value and `30 - 400` the range, not a
previous-visit column), subsetted fonts with broken `ToUnicode` CMaps yield Greek
mojibake and Latin lookalikes, and D6/D7 are untouched. Whether it shrinks review
*enough* is measurable against the Task 3.9 corpus floors rather than arguable.

## Alternatives considered

- **Provision a GPU server and run PaddleOCR-VL ourselves:** rejected — but on posture,
  not price. We would receive Article 9 special-category data and become a controller
  (Art. 9(2)(a) consent, Art. 13 transparency, an Art. 35 DPIA, Art. 30 records,
  72-hour Art. 33/34 breach notification, an Art. 37 DPO assessment, an Art. 28
  processor agreement, and Chapter V machinery if the hardware sits outside the EEA).
  It supersedes D1, D1a and D2, voids ADR-0009, rewrites the Task 0.4 CSP, deletes the
  Task 5.2 egress test, and ends D2's pure-static deployment. It also contradicts the
  project's binding constraint — *no sensitive user data on Medigraph's server* — more
  directly than a third-party API would, because it puts the data on the one machine
  the constraint names. And it still would not delete review.
- **A hosted third-party vision API:** rejected. Confirmed 2026-08-29 that outward flow
  of document content remains barred; only third-party *inbound* asset fetches are
  permitted, and those only via D1's declared allowlist.
- **An on-device VLM in v1 (E2-local now):** rejected on capability — no Greek model
  with a browser path, and the weight and memory budget fails Task 5.5. Revisit only
  if a Greek-capable model gains a real browser runtime *and* clears the device gate.
- **Accept PDFs only and drop review:** rejected. Worth considering as a *sequencing*
  choice (ship E0, hold E1 to its gates), which D1a already permits; not as grounds
  for removing review.
- **Keep review but justify it on accuracy alone:** rejected. That framing is what
  made deleting the step look reasonable, and it understates the D6 and D7 gates,
  which no extractor can discharge.

## Consequences

D1a is rewritten to carry the E2-local / E2-remote split; ADR-0002 is amended with the
same split; the plan's "Why this shape" paragraph restates review on three independent
grounds; and the OCR/vision-model appendix is replaced with the evidence above. Task
4.2a is added to Wave 4 to reduce review *friction* — confidence triage, batch confirm,
inline crop-adjacent correction — without reducing review *authority*.

Nothing about the extraction seam changes: D4 still admits a direct-row adapter, and
the `'E2'` tier literal in `ExtractionResult` and `ExtractionAdapter` is unchanged and
denotes E2-local, the only kind that could ship under D1.

The "just use a VLM" proposal will recur, and the cost figures here will keep getting
cheaper. This ADR is written so that it stays correct when they do: the rejection never
rested on price. It is engineering guidance recorded for design purposes, not legal
advice.
