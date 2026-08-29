# Medigraph

## Master plan — read this first

**`docs/plan.md` is the master plan and the source of truth for this repository.**
Read it before doing any work here. It defines the architecture, the binding
decisions (`D1`–`D13`, including `D1a` and `D5a`), the extraction pipeline, the chart specifications, the
`.medigraph` file format, and the task breakdown that GitHub issues derive from.

- Conform to it. Do not re-litigate a decision in its "Decisions already made"
  table — if one is genuinely wrong, change `docs/plan.md` first, record an ADR
  under `docs/adr/`, then change code.
- If it is ambiguous, that is a bug in the plan. Stop and ask rather than
  choosing; the resolution belongs in the plan, not in a commit message.
- If implementation diverges from it, update it in the same change.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `vdassios/Medigraph`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Commit messages

Commits are made by hand. When asked for a commit message, **generate** one in the
repo's header/body/footer structure and hand it over; do not run `git commit`.
See `docs/agents/commit-messages.md`.
