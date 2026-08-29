# ADR-0010: Display-only positioning; Medigraph never interprets

- **Status:** Accepted
- **Date:** 2026-08-29
- **Decision:** D13

## Context

Medigraph reads lab reports and plots each marker over time. Under
[MDCG 2019-11](https://health.ec.europa.eu/system/files/2020-09/md_mdcg_2019_11_guidance_en_0.pdf),
software that stores, archives and _displays_ data is not a medical device, while
software that **interprets** data for a diagnostic purpose is — and MDR Rule 11 puts
diagnostic software at Class IIa or above, meaning a notified body, CE marking and a
QMS. The primary qualification trigger is the **intended purpose the manufacturer
states**, so product copy weighs at least as heavily as UI behaviour.

The plan sat on both sides of that line without noticing. The chart specifications
were already disciplined — Panel view mandates neutral factual language, forbids
`good`/`warning`/`critical` and severity inference, and frames every status as
_reported_ — but the Trend view carried no equivalent clause despite being the view
that produces information no lab ever gave the user. Meanwhile the product pitch
promised to reveal "whether their ferritin has been sliding for four years", which is
a claim to deliver clinical insight.

## Decision

Medigraph displays values and the reference ranges the labs printed. It never
characterises them.

- No severity language, clinical inference or percentage-outside heuristic. Every
  status string is traceable to the range that lab printed for that report.
- No trend direction, slope, regression line, rate of change, delta-since-last badge
  or projection, in any view.
- Product and marketing copy states a capability — see your own data over time — and
  never a clinical insight or a promise of interpretation.
- Panel and Trend each carry persistent, always-visible copy stating that Medigraph
  displays the user's own reported values and ranges, does not interpret them, and is
  not medical advice. Persistent copy, not a dismissible modal or a one-time consent
  gate: a gate is clicked through blind and records consent for a purpose consent
  does not cover.

The rule binds every user-facing string in both `el` and `en`, including titles,
summaries, axis labels, tooltips and table copy.

## Alternatives considered

- **Allow interpretive language and address the regulatory question properly:**
  rejected for v1. The process cost is disproportionate for the product, and the
  specs already comply.
- **Park it and deal with it later:** rejected. Retrofitting after Wave 4 means
  auditing interpretive copy scattered through components and marketing, whereas
  holding the line now costs a Trend-spec clause and one rewritten paragraph.
- **A one-time "I understand" acceptance gate:** rejected as friction that buys
  little; standing copy on the views that show health data is what actually informs.

## Consequences

The Trend chart spec gains an explicit display-only clause mirroring Panel view's.
The plan's `## Context` pitch is reframed from inference to capability, which also
changes `index.astro` under Task 4.6. Task 4.6 gains the persistent disclaimer
requirement for Panel and Trend.

The erosion risk is gradual and needs standing review: one "trending low" badge or
one marketing sentence promising insight can change the stated intended purpose. This
ADR is engineering guidance recorded for design purposes; it is not legal advice, and
an EU launch warrants a real regulatory opinion on the Trend view specifically.
