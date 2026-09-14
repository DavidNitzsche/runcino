# composeReviewTrigger voice fixes — 2026-09-14

Third pass on top of the correctness fix and the voice rework. Implementer's report, closing the
two real findings from the coach consultant's review (`for coaching consult/consult-log/2026-09-
14-011-composereviewtrigger-voice-review.md`). Not an independent review.

## 0 · Base and branch — same worktree constraint as the prior pass, resolved differently

The voice-rework commit (`fix(coach): composeReviewTrigger speaks the situation library, not the
engine`, `d056f422b`) is checked out in `.claude/worktrees/agent-a3e28a804e7ee967f` on branch
`fix/compose-review-trigger-2026-09-14-voice-rework`, never pushed to `origin`
(`git ls-remote origin fix/compose-review-trigger-2026-09-14-voice-rework` returned nothing).

Unlike the prior pass, this session did **not** need to hand-reproduce the diff from a file read.
Git worktrees of one repository share one object database and one `refs/heads` namespace — only
`HEAD` and the index are per-worktree — so the commit object `d056f422b` was directly visible and
cherry-pickable from this worktree even though the *branch name* is checked out elsewhere:

```
$ git log origin/main..fix/compose-review-trigger-2026-09-14-voice-rework --oneline
d056f422b fix(coach): composeReviewTrigger speaks the situation library, not the engine

$ git checkout -B fix/compose-review-trigger-2026-09-14-voice-fixes origin/main
$ git cherry-pick d056f422b
[fix/compose-review-trigger-2026-09-14-voice-fixes e4c07782a] fix(coach): composeReviewTrigger speaks...
 5 files changed, 663 insertions(+), 14 deletions(-)
```

The resulting tree diffed byte-identical (same 5 files, same line counts) against what the report
and a direct file-read of the other worktree showed, confirming the reproduction is exact.

**Branch naming — same constraint the voice-rework pass hit, same resolution.** git will not let
two worktrees hold branch `fix/compose-review-trigger-2026-09-14-voice-rework` at once, and this
session's isolation guard blocks touching the other worktree's checkout to free it up. Followed the
prior pass's own naming convention (append what changed) rather than reusing the exact name:
**`fix/compose-review-trigger-2026-09-14-voice-fixes`**, based on `origin/main` at `09406ad1a`. The
two earlier branches (`fix/compose-review-trigger-2026-09-14`,
`fix/compose-review-trigger-2026-09-14-voice-rework`) are untouched in their own worktrees. This
branch is a strict superset of the voice-rework branch (the same cherry-picked commit, plus one
more commit with the two fixes below) — not pushed or merged.

## 1 · Fix 1 — "doctrine" removed from runner-facing copy

The consultant's finding: two of the six strings `composeReviewTrigger` can return — both
DURABILITY branches — said *"against doctrine's neutral band"* and *"doctrine wants"*, literally
naming this project's internal vocabulary in copy a runner reads. No entry in `Design/coach-voice-
brief.md`'s ~40-entry situation library, including its highest-stakes ones, cites its own source
that way; they all say what a number *means* in plain running language. Found and fixed both
occurrences, in both files that carried the wording (`coaching-thesis.ts`'s actual runner-facing
strings, and the design brief's own blockquote examples of them, which are supposed to be the exact
rendered text).

**`web-v2/lib/training/coaching-thesis.ts` — `composeReviewTrigger`, DURABILITY, curve-shape-evidence
branch:**

Before:
> Durability is what the plan is built around right now. Your race curve is fading with distance
> faster than your speed predicts: 1.11 over 5 graded races, against doctrine's neutral band of
> 1.06 to 1.08. A new graded race is the direct way to close that. A race-pace long run that holds
> pace deep enough to qualify counts as evidence too: 2 of the 3 marathon-pace rehearsals doctrine
> wants are in.

After (real render, `npx vitest run` against the live function, `2/3` rehearsals not yet cleared):
> Durability is what the plan is built around right now. Your race curve is fading with distance
> faster than your speed predicts: 1.11 over 5 graded races, against what is typical for a runner
> whose pace and endurance are in balance (1.06 to 1.08). A new graded race is the direct way to
> close that. A race-pace long run that holds pace deep enough to qualify counts as evidence too: 2
> of the 3 marathon-pace rehearsals it takes to count as confirmed are in.

Same branch, rehearsal bar cleared (real render, `3/3` met):
> Durability is what the plan is built around right now. Your race curve is fading with distance
> faster than your speed predicts: 1.11 over 5 graded races, against what is typical for a runner
> whose pace and endurance are in balance (1.06 to 1.08). A new graded race is the direct way to
> close that. A race-pace long run that holds pace deep enough to qualify counts as evidence too: 3
> marathon-pace rehearsals already count as training evidence toward it.

**DURABILITY, lowest-confidence basis (thinner evidence than a curve verdict — the other branch
that carries the shared `rehearsalDetail` phrase)** — before: *"...0 of the 3 marathon-pace
rehearsals doctrine wants are in."* After (real render, `0/3`):
> Durability is what the plan is built around right now, on thinner evidence than a curve verdict.
> It moves on another graded race, or on long runs that stop drifting late. A race-pace long run
> that holds pace deep enough to qualify counts as evidence too: 0 of the 3 marathon-pace rehearsals
> it takes to count as confirmed are in.

None of the three renders name doctrine, a rule, or any other internal source — each states what
the number itself means (a typical balanced-runner band; a rehearsal count that would count as
confirmed). No evidence-admission logic changed — same `rawFittedExponent`, `shape.band`,
`trainingDurabilityObservations`/`trainingDurabilityMinRequired`/`trainingDurabilityMet` fields,
threaded through exactly as both prior passes computed them; only the two phrases changed.

**`Design/coach-voice-brief.md`** — the situation library's own blockquote for this case carried
the identical wording (it is supposed to be the literal rendered text) and was updated to match,
in the brief's own contraction-using register (*"what's typical"*, matching its neighbors —
unlike the TS file, see §3 below on why those two registers differ deliberately).

**Scope note:** "doctrine's neutral band" also appears twice elsewhere in `coaching-thesis.ts` —
`heldConstantFor`'s `HeldConstant.note` field (line ~541) and `reviewTriggersFor`'s structured
`ReviewTrigger.detail` field (line ~983). Both are outside `composeReviewTrigger`, outside what the
consultant reviewed, and outside this task's stated scope, so neither was touched. Flagging this
explicitly rather than silently leaving it unmentioned: if `HeldConstant.note` or
`ReviewTrigger.detail` are ever rendered directly to a runner (today they read as structured/audit
fields, not confirmed UI copy), the same "doctrine" wording would need the same fix there.

## 2 · Fix 2 — the lexicon test's UNKNOWN skip removed

`_thesis_golden.test.ts`'s new permanent test (`composeReviewTrigger passes the same Layer-1
coach-voice lexicon that gates why/coachLine`) had `if (t.primaryLimiter === 'UNKNOWN') continue`,
so it never ran the UNKNOWN branch's own copy — *"There is not enough evidence yet to say what is
limiting you. That is what the next few weeks are for."* — through `scanLayerOne`/`scanPunctuation`
at all.

Removed the skip. Confirmed live, not assumed, per the consultant's own framing ("I don't think
there's a live bug here" — verify rather than trust):

- `lib/faff/coach-lexicon.ts`'s banned jargon term is `"limiter"` (a noun), matched by
  `matchesTerm`'s word-bounded regex `\blimiter(?:s|es|ed|ing|ly|er|est)?\b` — inflections are
  appended to the LITERAL term "limiter", not to its root "limit". `"limiting"` is `limit` + `ing`,
  not `limiter` + anything; the substring `"limiter"` does not occur inside `"limiting"` at all (6th
  character diverges: `e` vs `i`). So the UNKNOWN branch's "limiting" cannot and does not match.
- Ran the full suite with the skip removed: **14 passed, 1 skipped** (the DB-only owner-account
  fixture, unrelated) — no new failures, confirming the consultant's read.

This is coverage-completeness, not a copy change — the UNKNOWN branch's text is unmodified. A
permanent regression test whose entire purpose is "stop jargon creeping back in by habit" now
actually looks at every branch it composes, including the one branch whose wording sits closest to
the banned word.

## 3 · The two smaller, non-blocking notes

**"A race is strategic effort, not routine threshold work" — left unchanged.** The consultant
flagged this as a notch more clinical than the library's punchier neighbors (contrasting it with
*"Easy days build volume. Hard days build speed. Mixing the two just builds fatigue."*). Considered
alternatives (e.g., leaning harder into "not routine threshold work" alone, or a shorter clause) but
found nothing that was an *obviously* better fit without risking a different problem — either losing
the precision of "strategic effort" (which is doing real work distinguishing race intensity from
routine training) or reading glib about something that determines whether a runner's race panic is
warranted. Per the task's own instruction to fix only if trivial and clearly correct: left as-is.
This is a stylistic judgment call, not a defect, exactly as the consultant framed it — worth a pass
if there's time, not worth blocking on or forcing here.

**Contractions — left as an explicitly open question, not touched.** The prior pass's report
already recorded that `composeReviewTrigger`'s TypeScript strings spell out "cannot"/"does not" to
match this file's existing convention (`composeCoachLine`, `thesisLeadClause` do the same, no
contraction anywhere), while the design brief's own blockquote illustrations for this and other
high-stakes entries use contractions freely ("I'd recommend," "That's not a judgment," and this
same entry's own "can't"/"doesn't"/"there's"). The consultant's note reframes this as possibly a
pre-existing drift in this file's convention rather than a settled rule the new copy is right to
inherit — "matches the file" and "matches the brief" are not the same claim. **This report does not
resolve that question and does not change any contraction usage in either file** — per the explicit
instruction not to change this on my own judgment, since flipping it without a clear direction from
whoever owns final sign-off risks contradicting the prior pass's own deliberate, recorded choice.
Flagging plainly: **someone needs to decide whether `coaching-thesis.ts`'s no-contraction pattern is
the convention to keep matching, or whether it should move toward the brief's contraction-using
register** — this affects `composeCoachLine` and `thesisLeadClause` too, not just this function, so
it is a file-wide (arguably brief-wide) decision, not a one-string fix.

## 4 · Verification (Rule 13/18)

**a. Real renders, both DURABILITY branches, via the actual (unmodified-elsewhere) function** — a
throwaway vitest file (`web-v2/lib/training/_render_voice_fixes.script.test.ts`), built off the
same golden-fixture shapes as `_thesis_golden.test.ts`, called the live `composeCoachingThesis` /
`composeReviewTrigger`, printed the three renders quoted in §1 above, then was deleted — same Rule
13 pattern both prior passes used. None of the three contains "doctrine" or names any internal
source.

**b. Full suite, skip removed:**

```
$ npx vitest run lib/training/_thesis_golden.test.ts
 Test Files  1 passed (1)
      Tests  14 passed | 1 skipped (15)

$ npx vitest run lib/training
 Test Files  73 passed | 8 skipped (81)
      Tests  1085 passed | 14 skipped (1099)
```

Identical pass/skip counts to the voice-rework pass's own baseline (§7 of its report) — the skip
removal added coverage, it did not change what passes.

**c. Falsification — reintroduced "doctrine", confirmed nothing currently catches it.** Temporarily
restored the exact pre-fix phrase (`against doctrine's neutral band of ${...} to ${...}`) in the
curve-shape branch and re-ran:

```
$ npx vitest run lib/training/_thesis_golden.test.ts
 Test Files  1 passed (1)
      Tests  14 passed | 1 skipped (15)          ← unchanged, "doctrine" not caught

$ bash scripts/check-coach-voice.sh
check-coach-voice OK · 382 user-facing source file(s) clean   ← unchanged, not caught either
```

**Why manual review caught this and neither gate did:** `lib/faff/coach-lexicon.ts`'s `COACH_LEXICON`
bans specific terms (`limiter`, `readiness score`, `evidence count`, `confidence interval`,
`training stress`, `aerobic decoupling`, `taxonomy`, plus the `always`-band engine acronyms) — the
word "doctrine" is not in that list at all, in any band. `scripts/check-coach-voice.sh` (Rule Four)
checks punctuation (em dash, exclamation marks, interpuncts) and hype/emoji patterns, not vocabulary
content. Neither gate is a general jargon detector; both are lists/patterns of KNOWN prior defects.
**This is a real gap in the lexicon** — "doctrine," like "limiter," is project-internal vocabulary a
runner should never see, and today nothing but a human (or a coach-consultant review) would catch
it landing in a new string. Per the task's own scope instruction, not expanding scope to fix the
lexicon itself here (adding a `doctrine`/`rule`/similar band entry is a small, separable change that
whoever owns `coach-lexicon.ts` should make deliberately, with its own `why` and test coverage,
rather than as a side effect of this fix) — flagging it as the gap it is rather than silently
leaving it unmentioned.

Reverted the falsification immediately after confirming, restoring the exact fixed text; re-ran the
full suite (14 passed, 1 skipped) and `check-coach-voice.sh` (clean) to confirm nothing was left
in the falsified state.

**d. `tsc --noEmit`:** clean, exit 0.

**e. `check-coach-voice.sh`:** clean — `check-coach-voice OK · 382 user-facing source file(s) clean`
(the em-dash finding both prior reports noted in `native-v2/Faff/Faff/ViewsV5/HostsV5.swift:2942`
is gone because `origin/main` at this branch's base, `09406ad1a`, already carries the fix for it —
`fix(coach-voice): remove em dash from HostsV5 outage-fallback copy, unblocks deploy pipeline` —
unrelated to this change, confirmed pre-existing-and-since-fixed, not something this pass touched).

## 5 · Files changed

- `web-v2/lib/training/coaching-thesis.ts` — the two "doctrine" phrases in `composeReviewTrigger`'s
  DURABILITY branches reworded to state what the number means rather than naming its source; header
  comment above the function extended to record this pass. Nothing else in the file touched — same
  per-limiter evidence-admission logic both prior passes verified, byte-for-byte.
- `web-v2/lib/training/_thesis_golden.test.ts` — the `if (t.primaryLimiter === 'UNKNOWN') continue`
  skip removed from the Layer-1 lexicon test; comment above it extended to record why. (The
  *different* `continue` on the same condition in the earlier "a fallback-only capacity is NEVER the
  limiter" test, a few lines above, was left alone — that skip is structurally correct there, since
  UNKNOWN by definition has no rankable capacity to check, and removing it would break that test's
  own logic, not add coverage.)
- `Design/coach-voice-brief.md` — the DURABILITY curve-shape blockquote in "What's currently
  limiting you, and what would move it" reworded to match, in the brief's own contraction-using
  register.

Branch: `fix/compose-review-trigger-2026-09-14-voice-fixes`, based on `origin/main` at `09406ad1a`,
carrying the cherry-picked voice-rework commit (`d056f422b`) plus one new commit with the two fixes
above. Not pushed or merged — David's review is the gate, per this project's deployment doctrine.
