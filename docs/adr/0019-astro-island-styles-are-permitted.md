# ADR-0019: Astro's island stylesheet is permitted, and `style-src-elem` is relaxed

- **Status:** Accepted
- **Date:** 2026-09-08
- **Decision:** Amends the Task 0.4 CSP under D1, style directives only.
- **Supersedes:** the style clause
  [ADR-0016](0016-inline-scripts-and-the-withdrawn-isolation-headers.md) retained, and
  amends [ADR-0008](0008-csp-style-attribute-amendment.md)'s `style-src-elem` value.
- **Does not supersede:** D1, [ADR-0001](0001-no-user-data-egress.md) or
  [ADR-0015](0015-ordinary-network-freedom-under-the-data-rule.md). The data rule and
  `connect-src` are untouched.

## Context

ADR-0016 kept the style directives exactly as ADR-0008 set them, on this reasoning:

> Permitting an inline `<script>` that Astro itself writes is not an argument for
> permitting an injected `<style>` element, and no build constraint forces the question.

The second clause is the load-bearing one, and it is false. Astro emits its island shim
as an inline `<style>` **element** into every page that carries an island:

```html
<style>
  astro-island,
  astro-slot,
  astro-static-slot {
    display: contents;
  }
</style>
```

It is in `dist/app/index.html` on every build. `build.inlineStylesheets: 'never'`
does not reach it: that setting governs component `<style>` blocks, and this is the
framework's own custom-element shim, written by the renderer regardless. Under
`style-src-elem 'self'` the browser blocks it, and `display: contents` never applies to
`<astro-island>`, `<astro-slot>` or `<astro-static-slot>`.

This is the same shape of finding as ADR-0016 — a Task 0.4 statement about the build
that the build does not honour — and it went unseen for the same reason it was cheap to
miss. The walking slice does assert "no CSP violation", but it attaches its console
listener inside the test body, after `beforeEach` has already navigated and reloaded.
No page load was ever observed by the listener that existed to watch page loads. The
violation surfaced only when a reload was added mid-test for an unrelated reason.

Nothing visibly breaks today, because the E0 shell has almost no layout. That is the
argument for fixing it now rather than later: from Task 4.1 an unexpected inline box
sitting between the app root and its children is a layout bug that appears a long way
from its cause, on a page whose CSS is otherwise correct.

## Decision

Relax one directive:

```text
style-src-elem 'self' 'unsafe-inline';
```

`style-src` and `style-src-attr` are unchanged, as is every other directive.

The element/attribute split ADR-0008 introduced was meant to keep "stylesheet elements
as strict as before" while permitting the attribute case. It no longer separates two
different adversaries. An adversary who can inject a `<style>` element into the document
can, by construction, put a `style` attribute on the same markup, and that has been
permitted since ADR-0008. The capability being defended against is the HTML sink, not
the directive; what the split actually separates now is Astro's output from the app's.

The channel ADR-0008 weighed is still closed by the rest of the policy. CSS-based
exfiltration needs a remote fetch target, and `default-src 'none'` with `connect-src
'self'`, `img-src 'self' blob: data:` and `font-src 'self'` deny every one.

## Alternatives considered

- **A committed hash for the shim.** The browser names it
  (`sha256-vv9IoKo7BSLbWcUHr3tNmfNVmm5L/9Cfn2H6LMk7/ow=`), and it is one constant string
  rather than a generated list. Rejected on the grounds ADR-0008 and ADR-0016 both
  reached: it is a build-output-to-header coupling, and this hash belongs to Astro
  rather than to us. A routine patch upgrade that touches the shim by one character
  silently breaks production layout, which is the exact failure ADR-0016 named when it
  rejected committed script hashes.
- **`style-src 'self' 'unsafe-inline'` as well.** It would also cover the engines that
  do not implement the Level 3 split. Rejected: it re-permits inline stylesheets on
  every engine, which is a strictly larger surface than the one the framework forces,
  and ADR-0008's reason for splitting the directives in the first place was to avoid
  exactly that.
- **A hand-rolled client-only mount.** Verified to work in ADR-0016 and rejected there
  for the same reason it is rejected here: it trades every hydration directive Astro
  offers, permanently, for a token.
- **Delete `_headers` entirely.** Considered explicitly. Three rounds of this — ADR-0008,
  ADR-0016, and this record — have all been Astro's own output colliding with the
  directives governing what may render or execute, and the frustration is earned. But
  the cost and the value sit in different halves of the file. `connect-src 'self'`,
  `default-src 'none'`, `form-action 'none'`, `frame-ancestors 'none'` and the six
  non-CSP headers have caused no incident in any of the three, and `connect-src` is the
  directive ADR-0015 and ADR-0016 both call load-bearing: it is what denies an injected
  script an endpoint to POST the plaintext Profile to, and the browser-level backing for
  the promise the app footer makes. Deleting the file to stop the expensive half would
  discard the half that has been free. Rejected.

## Consequences

`style-src-elem` is a CSP Level 3 directive with the same support floor as
`style-src-attr`: Chrome/Edge 75+, Firefox 108+, Safari 15.4+. Two gaps follow, and
both leave the shim blocked rather than allowed:

- An engine that does not implement `style-src-elem` falls back to `style-src`, which
  stays `'self'`.
- Safari 15.4–26.1 parses `style-src-elem` without effect. Task 0.4 recorded this as
  harmless because `style-src` and `style-src-elem` carried an identical value. They no
  longer do, so on those versions `style-src 'self'` governs and the shim is blocked.

Therefore **`display: contents` on island wrappers must never be load-bearing.** This is
the same standing rule ADR-0008 set for style attributes, and it is a design constraint
on Tasks 4.1–4.5: every layout must remain correct and readable with `<astro-island>`
rendering as an ordinary inline box. A layout that only works when the shim applies is a
layout that breaks on Safari.

What is newly permitted is an injected `<style>` element on engines that honour the
split — restyling, not exfiltration, and by the argument above not a capability an
adversary with an HTML sink lacked already. The residual risk ADR-0008 recorded is
unchanged in kind: UI redressing against the D8/D9 warnings, which no client-side
control can prevent once arbitrary markup executes.

`connect-src 'self'`, `default-src 'none'`, D1's data rule and the Task 5.2 canary test
are untouched. Task 5.3's byte-identity assertion still holds against a single committed
header with no generated hashes.

Task 0.4's acceptance criterion — "boots under the delivered headers with no CSP
violation, checked in the browser once the Playwright harness lands in Wave 5" — is now
asserted on a page load rather than only on interaction, so the next directive the
framework outgrows fails a test instead of degrading a layout quietly.

If a future change needs `'unsafe-inline'` on `style-src`, or any relaxation of
`script-src` beyond ADR-0016 or of `connect-src`, it supersedes this ADR explicitly
rather than widening those directives in place.
