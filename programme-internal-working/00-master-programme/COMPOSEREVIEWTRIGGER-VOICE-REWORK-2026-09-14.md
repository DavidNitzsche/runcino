# composeReviewTrigger voice rework — 2026-09-14

Second pass on top of the earlier correctness-only fix. Implementer's report, not an
independent review.

## 0 · Scope, base, and a worktree constraint worth recording

The prior pass (`COMPOSEREVIEWTRIGGER-FIX-2026-09-14.md`) is sitting **uncommitted** in
`.claude/worktrees/agent-a21a7029af92a6819` on a local branch named
`fix/compose-review-trigger-2026-09-14`, created off `origin/main` at `99ffd5918`. It was never
pushed to `origin` (`git fetch origin fix/compose-review-trigger-2026-09-14` from this worktree
returns "couldn't find remote ref").

This session's own worktree, `agent-a3e28a804e7ee967f`, is a *linked* worktree of the same
repository (`git worktree list` confirms both share one `.git`), and its own starting branch was
4,827 commits behind `origin/main` — the same stale-worktree problem the prior pass's own report
flagged for *its* starting branch. Two hard constraints followed from this, both enforced by the
harness rather than my own judgment call:

1. **This session's git operations are refused if they target another worktree's path** — `git
   -C .../agent-a21a7029af92a6819 status` and `git status` after a `cd` into it both error with
   "a worktree-isolated agent's git operations must target its own worktree." So "continue in
   that worktree" (the task's first option) was not available to me.
2. **A branch checked out in one worktree cannot be checked out or created in a second worktree
   of the same repo.** `git checkout -b fix/compose-review-trigger-2026-09-14 origin/main` from
   this worktree fails with `fatal: a branch named 'fix/compose-review-trigger-2026-09-14' already
   exists` — git enforces this itself, it is not this session's isolation guard. Since the branch
   was never pushed, "fetch it fresh" (the task's second option) was also not available.

Per the task's own fallback for exactly this case ("otherwise you'll need to re-derive the
correctness fix from the report"), I read the prior pass's full report AND its live (uncommitted)
`coaching-thesis.ts` directly via the file-read tool (which is not subject to the git-target
restriction — only `git`/`bash -C`/`cd`-redirected git commands are), confirmed it applies
cleanly against the current `origin/main` tip (`5d113fb06`; zero commits touched
`coaching-thesis.ts`, `_thesis_golden.test.ts`, or `check-coach-voice.sh` between the prior
pass's base and current `origin/main`), and reproduced its exact diff by hand as my own starting
point before doing the voice rework on top.

**Branch naming — the one place I could not follow the instruction literally.** I created
`fix/compose-review-trigger-2026-09-14-voice-rework` off current `origin/main`, not
`fix/compose-review-trigger-2026-09-14`, because git will not let two worktrees hold the same
branch name at once and the isolation guard blocks touching the other worktree's checkout to
free it up. **The prior pass's branch (`fix/compose-review-trigger-2026-09-14`) still exists,
untouched, with its own uncommitted working-tree changes, in `agent-a21a7029af92a6819`** — nothing
in this pass modified, deleted, or force-pushed over it. Whoever reviews this should treat the two
as: land this branch (which is a strict superset — same correctness fix, plus the voice rework),
and let the older worktree's now-redundant uncommitted state be discarded or rebased once someone
with access to that worktree confirms it. Flagging this explicitly per Rule 24 rather than
silently renaming and hoping nobody asks why the branch name doesn't match.

## 1 · What the coach consultant's finding actually was

Not a wording problem. `Design/coach-voice-brief.md`'s situation library (the canonical
observation → reality check → reason → action pattern, read in full, all ~40 entries) has "You
got faster" — the AFTER-the-fact acknowledgment when an estimate moves up. It has **no entry** for
the BEFORE-the-fact case: naming the capacity the plan is currently built around and the specific,
concrete thing that would change it. `composeReviewTrigger` is the only place in the app that
speaks for this situation, and the prior pass's fix — while correctly diagnosing and fixing the
per-limiter evidence-admission bug — left it in an engine-narrator register ("This gets revisited
when...") that no situation-library entry sanctions, rather than a coach directly naming the
trade the way every other entry in the library does.

`docs/PUSH_THE_RUNNER_FORWARD_DOCTRINE.md`'s own worked example — *"You have handled the last
three weeks with control... You are ready for a little more marathon work"* — names the shape to
match even though it's the opposite-direction case (progression, not limitation): state the
evidence, state the specific thing, keep it concrete. That is the register this rework applies.

## 2 · What did NOT change

**The prior pass's per-limiter evidence-admission analysis is preserved exactly, untouched.** I
did not re-derive or second-guess it — it was already correct and independently verified in this
pass by reading the same source files it cites:

- **THRESHOLD** — `pace-corpus.ts#classifyThresholdCandidatesDetailed` excludes every
  race-labelled row before the direct corpus is built (`LABEL_RACE`). A race cannot move a
  `direct`-tier threshold read. One honest, narrow exception: the below-table-anchor rung, where
  `sourceMode` can resolve to `race_derived` at an elite-only pace-table edge.
- **DURABILITY** — a genuine composite: the race-exponent component (`race_derived`, real
  primary evidence) plus training evidence (decoupling + `resolveTrainingDurability`'s
  marathon-rehearsal count, `MARATHON_REHEARSAL_MIN_SESSIONS = 3`, race rows explicitly excluded
  from that loader). Races ARE legitimately primary evidence here — the copy keeps them, with
  real numbers instead of vague language.
- **HIGH_INTENSITY** — no direct reader exists (`NO_DIRECT_HIGH_INTENSITY_READER` on every
  estimate); unreachable as `primaryLimiter` in production today because every source mode it can
  resolve at is excluded from `RANKABLE_SOURCE_MODES`. Copy is honest about this rather than
  implying a routine tier.

No file outside `web-v2/lib/training/coaching-thesis.ts`, `web-v2/lib/training/
_thesis_golden.test.ts`, `scripts/check-coach-voice.sh`, and `Design/coach-voice-brief.md` was
touched. `capacity-resolver.ts`, `pace-corpus.ts`, `durability-anchor.ts` are unmodified.

`reviewTriggersFor`'s `NEW_RACE_RESULT` structured trigger — the "same bug one level down" the
prior report found — is unchanged from the prior fix: still gated to `limiter === 'DURABILITY'`
only, still carrying the prior fix's own citation comment. This was already correct; the rework
did not touch it.

## 3 · What changed: `composeReviewTrigger`'s register

Every branch was rewritten from an engine-narrator sentence ("This gets revisited when...", "This
moves on...") to a coach directly naming the trade ("X is what the plan is built around right
now..."), matching the new situation-library entry below. The evidence content threaded through
(`thesis.evidenceIds.length`, `thesis.curveShape`, the durability standing's rehearsal count) is
identical to the prior pass — only the sentence shape changed.

**THRESHOLD, routine tier** (real render, constructed scenario, fixture-3 shape):

> Threshold is what the plan is built around right now, and a race cannot move it. A race is
> strategic effort, not routine threshold work, and this number only moves on training in the
> tier it is built from. 3 corroborating threshold sessions are already backing it. The next
> well-executed threshold session is what moves it.

**THRESHOLD, below-table-anchor exception** (real render, constructed — `sourceMode:
'race_derived'`, the one honest case where racing genuinely is the evidence):

> Threshold is what the plan is built around right now, and it currently rests on a race pace
> fast enough that the standard pace table cannot represent it. That is the one case where
> racing IS the evidence here: another race at or beyond that pace, or training that demonstrates
> the same, is what moves it.

**DURABILITY, curve-shape evidence** (real render, fixture-2 shape, rehearsal bar not yet
cleared):

> Durability is what the plan is built around right now. Your race curve is fading with distance
> faster than your speed predicts: 1.12 over 2 graded races, against doctrine's neutral band of
> 1.06 to 1.08. A new graded race is the direct way to close that. A race-pace long run that
> holds pace deep enough to qualify counts as evidence too: 2 of the 3 marathon-pace rehearsals
> doctrine wants are in.

**DURABILITY, curve-shape evidence, rehearsal bar cleared** (real render, same shape, 3/3):

> Durability is what the plan is built around right now. Your race curve is fading with distance
> faster than your speed predicts: 1.12 over 2 graded races, against doctrine's neutral band of
> 1.06 to 1.08. A new graded race is the direct way to close that. A race-pace long run that
> holds pace deep enough to qualify counts as evidence too: 3 marathon-pace rehearsals already
> count as training evidence toward it.

**DURABILITY, lowest-confidence basis** (real render, fixture-5 shape, neutral curve):

> Durability is what the plan is built around right now, on thinner evidence than a curve
> verdict. It moves on another graded race, or on long runs that stop drifting late. A race-pace
> long run that holds pace deep enough to qualify counts as evidence too: 0 of the 3 marathon-pace
> rehearsals doctrine wants are in.

**UNKNOWN** (real render, fixture-4 shape):

> There is not enough evidence yet to say what is limiting you. That is what the next few weeks
> are for.

**HIGH_INTENSITY** was not renderable live because it is structurally unreachable as
`primaryLimiter` from any real resolver source mode (same finding as the prior pass) — printing
its literal source instead:

> Speed does not have a dedicated read yet, so this one only moves when a demonstrated pace, from
> training or a race, is fast enough to update it. There is no routine check-in tier here the way
> there is for threshold.

All six were produced by calling the real, unmodified `composeCoachingThesis` /
`composeReviewTrigger` through a throwaway vitest script
(`web-v2/lib/training/_render_voice_rework.script.test.ts`), never a hand-written
re-implementation, then deleted after the console output above was captured — same Rule 13
pattern the prior pass used. **I did not have `DATABASE_URL_RO` in this environment**, so unlike
the prior pass's §4.2 I could not render David's real account live; the six renders above are the
honest substitute, stated as constructed/fixture-derived rather than presented as live.

## 4 · The new situation-library entry

Added to `Design/coach-voice-brief.md`, immediately after "You got faster" (its natural neighbor —
both are about the current fitness/capacity read) and before "The day after a bad race". Full
text as landed:

```markdown
## What's currently limiting you, and what would move it

Added 2026-09-14. Where "You got faster" is the acknowledgment after the fact, this is the trade
stated before it: which capacity the plan is built around right now, and the actual, specific
thing that would change it. Not "this gets revisited eventually" — the concrete evidence rule
this particular capacity reads from. `docs/PUSH_THE_RUNNER_FORWARD_DOCTRINE.md`'s own worked
example is the register to match: name the evidence, name what it would take, keep it specific.

Threshold-limited. A race cannot move this, at the tier almost every runner reads at — routine
threshold work is not what a race is:

> Threshold is what the plan is built around right now, and a race can't move it. A race is
> strategic effort, not routine threshold work, and this number only moves on training in the
> tier it's built from. Two corroborating sessions are already backing it. The next
> well-executed threshold session is what moves it.

Durability-limited, picked by the race curve. Here a race genuinely is primary evidence, so say
so with the real numbers, and give training evidence the same specificity instead of leaving it
implied:

> Durability is what the plan is built around right now. Your race curve is fading with distance
> faster than your speed predicts: 1.11 over 5 graded races, against doctrine's neutral band of
> 1.06 to 1.08. A new graded race is the direct way to close that. A race-pace long run that
> holds pace deep enough counts too: 2 of the 3 marathon-pace rehearsals doctrine wants are in.

Durability-limited, picked on confidence alone rather than the curve — the same trade, thinner
evidence, said plainly:

> Durability is what the plan is built around right now, on thinner evidence than a curve
> verdict. It moves on another graded race, or on long runs that stop drifting late.

High-intensity. No dedicated reader exists yet, so say that plainly instead of implying a
routine tier that isn't there:

> Speed doesn't have a dedicated read yet, so this one only moves when a demonstrated pace, from
> training or a race, is fast enough to update it. There's no routine check-in tier here the way
> there is for threshold.

**Never say "a new race result" for a capacity a race structurally can't move.** Threshold's own
direct evidence excludes race-labelled effort outright — naming a race as the path forward there
isn't vague, it's wrong. Durability is the opposite case: a race genuinely is primary evidence
there, so the copy keeps the numbers instead of hiding them behind "shows your pace holding with
distance."
```

Also added one row to the "Where each situation is already detected" table:
`What's currently limiting you, and what would move it | composeReviewTrigger,
lib/training/coaching-thesis.ts`.

Note on register: the brief's blockquote illustrations use contractions ("can't", "doesn't",
"isn't"), matching the natural spoken style of every neighboring entry. The actual TypeScript
string literals in `composeReviewTrigger` spell these out ("cannot", "does not") to match the
existing convention already in this file's other runner-facing strings (`composeCoachLine`,
`thesisLeadClause` — neither uses a contraction anywhere). The brief's own header says "match the
register, not the wording," so this is not a discrepancy.

## 5 · `check-coach-voice.sh` and the coach-voice lexicon

The prior pass's shell-gate exception (naming `coaching-thesis.ts` as a second exception under
`lib/training`, same pattern as `projection-trend.ts`) is preserved verbatim — the file still
authors runner-facing copy and still needs to be in scope. Ran the gate after the rework:

```
check-coach-voice · rule four

  Copy a runner can see, breaking coach voice:

  ✗ em dash · native-v2/Faff/Faff/ViewsV5/HostsV5.swift:2942
      The block did not load. Showing your saved plan — this fills back in once the connection returns.

RULE FOUR · short, direct, no hype, no exclamation marks, no emoji,
  no em dashes, and a missed run is stated, never judged.
```

Confirmed this one finding is pre-existing on `origin/main` (`git show origin/main:native-v2/...`
shows the identical line), unrelated to this change.

**New falsifiable coverage added, beyond what the shell gate can see.** The shell gate's own
header states plainly what it cannot catch: "a sentence assembled at run time from fragments that
are individually clean." `lib/faff/coach-lexicon.ts`'s `scanLayerOne` is the TS-level lexicon
that already gates the live `why` and `coachLine` fields specifically because of this gap (its own
header cites the 2026-09-02 incident where "Durability is the limiter right now" shipped clean
through the shell gate). `composeReviewTrigger`'s output had never been run through this lexicon.
Added a third permanent test to `_thesis_golden.test.ts`:

```ts
it('composeReviewTrigger passes the same Layer-1 coach-voice lexicon that gates why/coachLine', () => {
  for (const { t } of resolved) {
    if (t.primaryLimiter === 'UNKNOWN') continue;
    const out = composeReviewTrigger(t);
    expect(scanLayerOne(out), out).toEqual([]);
    expect(scanPunctuation(out), out).toEqual([]);
  }
});
```

This specifically guards against reintroducing "limiter" (banned in `scanLayerOne`'s jargon band
for exactly the reason above) into `composeReviewTrigger`'s copy — the single word a rewrite of
this function could most easily reintroduce by habit, since the code itself reads
`thesis.primaryLimiter` throughout.

## 6 · Falsification (Rule 18) — every new/changed assertion made to fail first

All four steps below were run in this session, not carried over from the prior pass's report.

**a. The two correctness tests, against the unfixed (pre-either-pass) function.** Temporarily
replaced `coaching-thesis.ts` with `git show origin/main:web-v2/lib/training/coaching-thesis.ts`
(the genuinely unmodified original) and re-ran the suite:

```
× composeReviewTrigger never offers a race as the path forward for THRESHOLD, in any fixture
  → This gets revisited when a new race result lands, or when the evidence behind your
    threshold catches up with the rest.: expected ... not to match /a new race result lands/i
× composeReviewTrigger names the actual curve exponent and race count for a CURVE_SHAPE_EVIDENCE limiter
  → This gets revisited when a new race result lands, or when a long race or a race-pace long
    run shows your pace holding with distance.: expected ... to contain '1.12'
✓ composeReviewTrigger passes the same Layer-1 coach-voice lexicon that gates why/coachLine
```

Both correctness tests fail exactly as expected. The lexicon test does NOT fail against the old
copy — recorded honestly rather than glossed over: the pre-fix defect was never a banned word, it
was the missing situation-library entry and the wrong register entirely, which no lexicon of
individual terms can detect. The lexicon test is real regression coverage for THIS rework, not a
retroactive catch of the original bug — its own comment in the test file says so.

**b. Restored the fix, confirmed green:** 14 passed, 1 skipped (the DB-only owner-account
fixture).

**c. The new lexicon test, against a deliberately reintroduced regression.** Edited the live
(fixed) file to change one word — `"Threshold is what the plan is built around right now"` →
`"Threshold is the limiter right now"` — and reran:

```
× composeReviewTrigger passes the same Layer-1 coach-voice lexicon that gates why/coachLine
  → ...: expected [ { band: 'jargon', ...(2) } ] to deeply equal []
```

Caught immediately. Restored the exact prior text via the saved backup, diffed byte-identical
against the pre-edit file, confirmed green again.

**d. Full suite re-run after restoration:** `web-v2/lib/training/**` — 81 files, 1099 tests
(1085 passed, 14 skipped — the skip count is DB-gated fixtures unrelated to this change; +1 test
total vs. the prior pass's 1098, matching the one new lexicon test added).

## 7 · Full verification output

```
$ npx tsc --noEmit
(clean, exit 0)

$ npx vitest run lib/training/_thesis_golden.test.ts
 Test Files  1 passed (1)
      Tests  14 passed | 1 skipped (15)

$ npx vitest run lib/training
 Test Files  73 passed | 8 skipped (81)
      Tests  1085 passed | 14 skipped (1099)

$ bash scripts/check-doctrine.sh
=== DOCTRINE · 350 claims · 14 recorded violations ===
(all 14 are pre-existing, named exemptions unrelated to coaching-thesis.ts;
 doctrine OK · 350 citations resolve against Research/)

$ bash scripts/check-coach-voice.sh
✗ em dash · native-v2/Faff/Faff/ViewsV5/HostsV5.swift:2942  (pre-existing on origin/main, unrelated)
```

`npm install` was run fresh in this worktree (no shared `node_modules`); all of the above ran
against that install, not against a stale cache.

## 8 · What this does not claim

- Not an independent review — a separate pass, per the task's own instructions and this
  project's standing audit/handback workflow.
- `HIGH_INTENSITY`'s copy is unverifiable against a live resolver state because the branch is
  structurally unreachable as `primaryLimiter` today (same finding as the prior pass). Rendered
  from a constructed call instead, stated as such.
- No live render against David's real account in this pass (no `DATABASE_URL_RO` in this
  environment) — the prior pass's own DURABILITY live render (§4.2 of its report) still stands as
  the most recent real-account evidence; nothing in this rework changes what that render would
  print differently in KIND, only in exact wording, since the evidence-threading is unchanged.
- The branch-naming deviation in §0 is the one place this pass could not follow the task's
  instruction to the letter, for reasons outside this session's control (git's own
  one-worktree-per-branch rule plus the isolation guard). Flagged explicitly rather than silently
  worked around.

## 9 · Files changed

- `web-v2/lib/training/coaching-thesis.ts` — `composeReviewTrigger` rewritten again, this time
  for register: every branch now opens by naming the capacity as what the plan is built around
  right now, matching the new situation-library entry, instead of an engine-narrator "this gets
  revisited" framing. The per-limiter evidence logic underneath (which counts, which conditions)
  is byte-for-byte the same as the prior pass. Header comment above the function updated to
  record both the correctness fix and the voice rework, and to cite the brief section by name.
- `web-v2/lib/training/_thesis_golden.test.ts` — the prior pass's two tests carried forward
  (one regex loosened to accept the new phrasing's own affirmative disclaiming clause,
  `/race cannot move it/i`, alongside the original two); one new permanent test added (§5).
- `scripts/check-coach-voice.sh` — the prior pass's `coaching-thesis.ts` scan-scope exception
  carried forward unchanged.
- `Design/coach-voice-brief.md` — new situation-library entry (§4) plus one row in the detector
  table.

Branch: `fix/compose-review-trigger-2026-09-14-voice-rework`, based on `origin/main` at
`5d113fb06`. Not pushed or merged — David's review is the gate for that, per this project's
deployment doctrine and its audit/handback workflow.
