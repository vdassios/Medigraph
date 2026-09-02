# ADR-0016: Inline scripts are permitted, and cross-origin isolation is withdrawn

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decision:** Amends the Task 0.4 CSP and response headers under D1.
- **Amends:** [ADR-0008](0008-csp-style-attribute-amendment.md) (script directive only,
  style directives unchanged)
- **Does not supersede:** [ADR-0015](0015-ordinary-network-freedom-under-the-data-rule.md).
  D1's data rule is untouched.

## Context

Task 0.4 stated, as a fact about the build: _"Emit no inline `<script>`, so `script-src`
needs no hash, nonce, `'unsafe-inline'` or `'unsafe-hashes'`."_

That is false, and was false when it was written. Astro delivers a client island by
emitting two **inline** `<script>` blocks into the page: the `client:*` directive runtime
and the `<astro-island>` custom-element definition. Building the current app produces
both in `dist/app/index.html`. Under `script-src 'self'` with no hash and no nonce, a
browser blocks both and `MedigraphApp` never hydrates — so the task's own acceptance
criterion, "boots under the delivered headers with no CSP violation", could not pass
against the CSP the same task mandates.

Nothing could reconcile the two without paying somewhere. The available prices were a
generated hash list (which Task 0.4 forbids in the same paragraph, and which ADR-0008
already rejected for styles as a fragile build-output-to-header coupling), Astro's
`experimental.csp` (a second policy in a `<meta>` tag, which cannot carry
`frame-ancestors` and would break Task 5.3's byte-identity assertion), or abandoning
Astro's hydration directives for a hand-rolled client-only mount. Each is real work and
ongoing friction, bought to keep one directive token out of a header.

The token is not worth that. The plan asked what the strict policy was actually buying
once before, in ADR-0008, and the same question answers this one. `script-src` defends
against **executing injected script**. The injection routes it closes need a place for
untrusted markup to enter the document, and this application has none: it is a static
site with no server, no request reflection, no `dangerouslySetInnerHTML` and no raw HTML
rendering anywhere (ADR-0015 keeps all three as standing rules). The directive that
carries the actual weight against the plaintext `Profile` is `connect-src 'self'` — as
ADR-0015 says outright, that is "the reason an injected script cannot simply POST the
Profile to an attacker" — and it is unaffected by anything here.

Separately, Task 0.4's justification for cross-origin isolation has expired.
`Cross-Origin-Embedder-Policy: require-corp` was adopted to "give Task 3.3
`crossOriginIsolated` for WASM threads". [ADR-0013](0013-ahfy-documents-are-the-only-input.md)
deleted E1; Task 3.3 no longer exists, the plan ships "no OCR runtime, model or
dictionary", and nothing in the product uses `SharedArrayBuffer` or threaded WASM.
`require-corp` is not free: it makes every cross-origin subresource fail unless it opts
in with CORP or CORS, which is precisely the ordinary dependency freedom ADR-0015
restored. It is now a constraint with no beneficiary.

## Decision

**Inline scripts are permitted.** The script directive becomes:

```text
script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';
```

Astro's island bootstrap is a normal part of the framework. Use `client:*` directives
freely. `'wasm-unsafe-eval'` stays — not for OCR, which is gone, but because `pdfjs-dist`
compiles WebAssembly for embedded image codecs, and the token permits WASM compilation
only, never inline or `eval`'d JavaScript.

**Withdrawn from Task 0.4:**

- The claim that the build emits no inline `<script>`, and the prohibition behind it.
- `Cross-Origin-Embedder-Policy: require-corp`, and cross-origin isolation as a goal.
- Self-hosting stated as an obligation. It remains the v1 default, for the reasons
  ADR-0015 gives, and departing from it needs no decision record.

**Retained unchanged:**

- Every other directive: `default-src 'none'`, `connect-src 'self'`, `worker-src`,
  `img-src`, `font-src`, `manifest-src`, `object-src 'none'`, `base-uri 'none'`,
  `form-action 'none'`, `frame-src 'none'`, `frame-ancestors 'none'`. `connect-src` is
  the load-bearing one and is not relaxed.
- The style directives exactly as ADR-0008 set them, including
  `build.inlineStylesheets: 'never'`. Permitting an inline `<script>` that Astro itself
  writes is not an argument for permitting an injected `<style>` element, and no build
  constraint forces the question.
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`,
  `Referrer-Policy: no-referrer`, HSTS, `X-Content-Type-Options: nosniff` and the
  Permissions Policy. These cost nothing and none of them depended on Task 3.3.
- The CSP as a **committed static string**. With `'unsafe-inline'` there is no hash list
  to generate, so the property Task 0.4 wanted is now true by construction rather than by
  prohibition, and Task 5.3 still asserts byte-identity against a single header.

## Alternatives considered

- **Client-only mount** — replace `client:load` with a bundled `<script>` that renders
  `MedigraphApp` into a root element. Verified to work: the build emits one external
  module script and zero inline script, and the original CSP holds verbatim. Rejected
  because it trades every hydration directive Astro offers, permanently, for a token.
- **Committed static hashes** — paste the two Astro runtime hashes into `script-src` with
  a test that recomputes them from `dist/`. Rejected: it re-creates the build-output-to-header
  coupling ADR-0008 removed, and a routine Astro upgrade silently breaks production.
- **`experimental.csp`** — let Astro generate hashes into a `<meta>` policy. Rejected: an
  experimental flag in a pinned toolchain, a policy split across a header and a meta tag,
  a meta policy that cannot express `frame-ancestors`, and a direct conflict with Task
  5.3.
- **Keep `require-corp` for a future threaded workload** — rejected. No such workload is
  planned; D1a admits exactly one text-layer extraction mode. If one ever returns, adding
  two headers back is a one-line change, and it should be justified by the workload that
  needs it.

## Consequences

What is newly permitted is **execution of inline script by an adversary who can already
inject markup into the document**. In this architecture that adversary has no entry
point, and if one ever appears — a raw-HTML sink, a server, a third-party script — that
change is the security event, not this header. Reviewers should treat the introduction of
any HTML sink as the trigger to revisit this record, rather than trusting `script-src` to
contain it.

The plaintext `Profile` keeps the containment that actually applies to it: `connect-src
'self'` denies an exfiltration endpoint, `default-src 'none'` denies everything
unnamed, and D1's data rule and its Task 5.2 canary test are unchanged. As always, this
is regression evidence against accidental egress, not proof against deliberate egress by
compromised same-origin code.

Dropping `require-corp` removes `crossOriginIsolated` and therefore `SharedArrayBuffer`.
Nothing uses either. Cross-origin subresources are no longer required to opt in, which
matches ADR-0015's position that a third-party origin is an ordinary, reviewable
dependency choice.

If a future change needs `'unsafe-inline'` or `'unsafe-hashes'` on `style-src-elem`, or
any relaxation of `connect-src`, it supersedes this ADR explicitly rather than widening
those directives in place.
