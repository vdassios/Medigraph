# Commit messages

Commits in this repo are made **by hand**. An agent's job is to **generate a commit
message** in the structure below and hand it over — not to run `git commit`.

Every message has three parts: a **header**, a **body** and a **footer**.

```
type(scope): subject

  - what changed, and where
  - one line per distinct change

Refs: #42
```

## When asked for a commit message

1. **Read the actual changes first.** Use `git diff --staged`; if nothing is staged,
   fall back to `git diff` and `git status --short` and say which you used. Never
   write a message from memory of the conversation — describe what the diff contains.
2. **One body entry per distinct change**, derived from the diff rather than from the
   task you were given. Two files changed for the same reason are one entry; one file
   changed for two unrelated reasons is two.
3. **Output exactly one fenced code block** containing the complete message and
   nothing else. No commentary inside the block, no leading `git commit -m`, no
   surrounding quotes. Anything you want to say about the message goes outside the
   block.
4. **Do not run `git add`, `git commit`, `git push`, or amend anything** unless the
   request explicitly asks you to perform the commit. Generating the message is the
   whole task.

If the request to commit is explicit, follow the structure below and then also append
the identity trailers described under *Identity trailers*.

## Header

Follows [`@commitlint/config-conventional`](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional):

- `type(scope): subject`, where `scope` is optional and `type` is required.
- **type** is one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`,
  `revert`, `style`, `test`. Lower-case.
- **scope** is lower-case and names the area touched. Prefer an existing one:
  `plan`, `adr`, `context`, `agents`, `domain`, `registry`, `extract`, `ocr`, `pdf`,
  `profile`, `series`, `ui`, `storage`, `fileformat`, `ci`, `deps`, `fixtures`.
  Omit the scope when a change genuinely spans many areas.
- **subject** is not empty, does not end in a period, and is not sentence-case,
  start-case, pascal-case or upper-case. Write it in the imperative: *add*, not
  *added* or *adds*.
- The whole header is **≤ 100 characters**.

## Body

- Separated from the header by **exactly one blank line**, and from the footer by
  **exactly one blank line**. Both blanks are required here even though stock
  commitlint only warns on them; this repo treats `body-leading-blank` and
  `footer-leading-blank` as errors.
- One entry per distinct change, each on its own line, each beginning with **two
  spaces then `- `**:

  ```
    - rewrite D1 as a data rule with a declared connect-src origin allowlist
    - add D13 and the display-only clause to the Trend chart spec
  ```

- Keep each entry concise and specific — say what changed and where, not why the
  work was undertaken. Reasoning belongs in an ADR, not a commit message.
- Each line is **≤ 100 characters**. Wrap a long entry onto a continuation line
  indented to align under the entry text, not under the `-`.
- Do not use blank lines *inside* the body, and do not use sub-bullets, prose
  paragraphs or nested lists.

## Footer

- Separated from the body by exactly one blank line. Each line **≤ 100 characters**.
- References the GitHub issue this commit targets, using a
  [git trailer](https://git-scm.com/docs/git-interpret-trailers):
  `Refs: #42`, or `Closes: #42` when the commit fully resolves the issue.
- **When no issue is open, omit the issue reference entirely.** Do not invent an
  issue number and do not write a placeholder. Do not guess an issue number from
  context — if you are not certain, leave it out and mention it outside the code
  block so the human can add it.
- Breaking changes use a `BREAKING CHANGE: <description>` trailer.

### Identity trailers

A **generated** message carries no `Co-Authored-By:` or `Claude-Session:` trailers.
The human running `git commit` is the author, and attribution is theirs to add.

Those trailers apply only when an agent is explicitly asked to perform the commit
itself. In that case they go in the footer block, after any issue reference, and a
commit with no open issue still carries them — so its footer is not literally empty,
only its issue reference is absent.

## Full examples

With an issue:

```
feat(extract): add Pass B column model

  - add columns.ts with x-clustering and header detection
  - wire ColumnModel through extract.ts reconciliation
  - cover single-column, sectioned and units-in-own-column fixtures

Closes: #17
```

Without an issue — the footer is absent entirely, and the message ends after the body:

```
docs(plan): revise D1 egress scope and add D13 display-only positioning

  - restate D1 as a data rule with a declared connect-src origin allowlist
  - add D13 barring any characterisation of a Measurement or Series
  - supersede ADR-0001 with ADR-0009 and record D13 as ADR-0010
```

## Enforcement

Task 0.1 installs husky and lint-staged. When `commitlint` is added to that setup, it
must run on `commit-msg` with `@commitlint/config-conventional` extended by
`body-leading-blank: [2, 'always']` and `footer-leading-blank: [2, 'always']` to make
this document's blank-line rule an error rather than a warning. Until then the
convention is enforced by review.
