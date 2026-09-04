# Handback · round 2

3 September 2026 · lead engineer report · continuing directly off your "send back" reply to
the morning handback. Everything below is on `main` and deployed unless marked otherwise.

You gave three decisions and a twelve-item programme, then opened two more focused sessions
(pre-run, post-run) alongside the existing week-strip one and asked me to record the ownership
split and keep going on the critical path. This is where that stands.

## 1 · The two remaining decisions from your reply are both merged

**Decision 3 · easy days after intervals (SEP-1).** Your ruling: ordinary quality → at least
one complete easy or rest day, always. A long run 16–18mi → normally one to two depending on the
run's own intensity. 18mi-plus, or any long run carrying real marathon-pace effort → normally
two. `validate.ts` §9 previously required intervals to carry *two* and everything else
*one* — backwards from `RESCHEDULING_CONTRACT.md` Q32's own table, which had always said "≥1"
for intervals too.

`requiredSeparationDays()` now types the requirement off the same fields the composer already
resolves — distance, quality, race-goal pace, long-run kind — instead of a flat number.
**The "at least one" floor is fatal.** The "normally two" band for an elevated long run is
**advisory**, reported through `onStress` as `SEPARATION_BAND_SHORTFALL` rather than enforced —
I tried making it fatal first and it broke real composed blocks, because `scheduleQuality`
places quality sessions against *each other*, not against the long run's own classification, so
an 18mi-plus Sunday followed by Tuesday tempo is normal composer output today. Promoting the band
to fatal needs `scheduleQuality` made long-run-aware, which is composer work I have not done —
named as a follow-up, not silently absorbed. Merged `8a242994`. `_sep1_boundary_walk.test.ts`
walks the 16mi/18mi edges in 0.1mi steps and confirms the only discontinuities are the ones your
ruling actually names.

**The canonical Adaptation Engine, wired into live shadow evaluation.** This was item 9 on your
programme. It now runs inside the existing 03:00 UTC `run-adaptations` cron — no new schedule —
right after the pace-only shadow-compare, reading the plan's pre-mutation state itself rather
than assuming an earlier job already re-anchored it (Rule 23). It writes to a **new** table,
`canonical_adaptation_shadow_log` (migration 164), rather than the existing intermediate one:
that table's columns are typed against the PACE-only mechanism's own vocabulary (a 3-way
`engine_decision` CHECK, enums that only make sense for `pace-hr-compatibility.ts` and
`authoring-convergence.ts`), and the canonical engine's 4-way PROGRESS/HOLD/REGRESS/REFUSE
decision across 3 levers does not fit it without half the columns permanently null — the same
shape Rule 16 forbids. **Migration 164 is written, not applied — it needs your per-statement go,
same as 163.**

You can now inspect what the canonical engine would have decided, in parallel with legacy
`adapt.ts` and the intermediate shadow-compare, none of them touching each other, at
`GET/POST /api/admin/canonical-adaptation-shadow`. The mutation guard
(`_cannot_mutate.test.ts` guard 4) was rewritten from a blanket "no outside importer" rule to a
narrow three-entry `(file, module, symbols)` allowlist and falsified nine ways — a different
file importing the same symbol, the allowed file importing something unlisted, a type-only
import correctly ignored versus a value import of the same module correctly still gated.
`_never_mutates_plan.test.ts` proves every write in the new code path targets only the new
table. Merged `cb8bf8ee`.

## 2 · Everything else in the programme was already landed before this round started

Race-week typed distinctions (Decision 1) and the QA-token path (VW-3) were both merged earlier
today and are unchanged by this round — recorded here only so this document does not repeat the
"one current truth" correction the morning handback already made. Nothing in this round found a
reason to revisit either.

## 3 · The coordination update

Your message set up pre-run and post-run as focused sessions with their own ownership, alongside
the existing week-strip session, and asked me to record it and check for overlap.

Recorded in `docs/MASTER_CORE_PRODUCT_PROGRAM.md`: what each of the three UI sessions owns and
does not own, what stays mine (canonical contracts, plan generation, the rebuild, the Adaptation
Engine, production writes, integration, CI/TestFlight), the integration and shared-file
protocols, and the two P1 inventories (`PR-*` post-run, `RS-*` rescheduling) annotated with
which half of each is UI versus canonical contract.

**Overlap check, done by reading the actual diffs, not by assuming:** everything I landed this
round touched `web-v2/lib/plan/**` and `web-v2/lib/adaptation/**` only — no Swift, no
`native-v2/**`, nothing in either new session's territory. Nothing needs to be handed back.

One correction I nearly shipped and caught: your message asked whether to bring the three UI
sessions' work back under this one, given a disk problem I had just found (next section). I
recommended against it — the disk problem was worktree accumulation across many sessions over
time, not a function of how many sessions are running right now, and collapsing back would undo
the file-collision protection you had just set up for no actual fix. You agreed.

## 4 · A real shared-infrastructure failure, found and triaged

The canonical-engine agent hit `ENOSPC` mid-verification. Not a fluke: the repo's worktree
volume was at **100% capacity, 30GB free**, across roughly 105 accumulated `git worktree`
entries — completed agent worktrees from this and other sessions that nothing had cleaned up.
One of them alone (`agent-a60881948acd72d20`, a fully-merged branch) was **113GB**. A second,
a leftover `verify-commit.sh` sub-worktree, was another 52GB.

Removed both — carefully, only after confirming the branch was already merged to `main` and the
worktree's holding process was this session's own stale lock, nothing belonging to another live
session. That, plus clearing a stray AppleDouble sidecar pack index that was throwing (harmless
but noisy) errors on every push, took free space from 30GB to about 195GB, which is what let the
canonical-engine agent's verification actually complete.

**This is a triage, not a fix.** The volume is back down to 98GB free / 99% capacity as of this
writing, with the same ~105 worktree entries still registered — other sessions are still
accumulating them at roughly the rate I was clearing them. If nothing changes, this recurs. I did
not do a broader cleanup pass because most of those 105 belong to sessions I cannot see the state
of, and deleting another session's live worktree is exactly the kind of thing this project's
rules say to check before doing, not assume. Worth a decision from you: either a scheduled prune,
or a convention that agents remove their own worktree once merged (which none currently do).

## 5 · The P0 preflight, run against everything above

`scripts/p0-proof/falsify.sh` — the mutate-a-real-invariant-and-restore-it check, no DB writes.
11 of 12 named invariants falsified correctly: threshold admission, the one-session move cap,
staleness-vs-support, goal isolation, HR informational-without-evidence, race-row
staleness/HR-cap, sealed-history refresh, projection self-computation, the effective-target
second rule, the limiter's self-fitting guard.

The 12th had gone stale — it targeted a line in `race-outlook.ts` that EXECTARGET-1's rewrite
had already deleted, so the mutation silently failed to apply and the check was proving nothing
(Rule 18). Retargeted at the current `conditionalUpside` refusal guard and traced the actual
math rather than guessing: the "fast edge" is `min(fastSec, expectedSec) − ciHalf`, and `ciHalf`
is strictly positive whenever a confidence interval is computed at all, which is almost always.
So under every composition I tried — including a race with zero build weeks remaining, the
closest thing to a degenerate case the fixtures can express — the edge came out strictly faster
than the execution target by construction. It looks like a genuinely defensive branch rather
than a live gap; documented in the code rather than forced into an artificial fixture that would
just be testing whether `computeConfidenceInterval` can return a zero-width interval, which
nothing establishes either way.

`scripts/p0-proof/rebuild-preview.ts` against current `main`: the composed plan is **105 rows
across 15 weeks**, versus the live plan's **103 rows**, **+7.2mi total** (about 1% over the
block), **64 of 105 days differ** from what is currently live.

**I did not trace all 64 to individual decisions, and I don't think that's the right bar.** The
diff spans workout-*type* changes — intervals swapping for threshold, a tempo session
restructured from warm-up/tempo/cooldown into continuous mile cutdowns — not just distance
nudges. That is the expected shape of composing fresh against current doctrine and evidence,
compared with a live plan that has drifted through ad-hoc authoring and cron adaptations since it
was last written. It is what the rebuild is *for*. What I checked instead: the direction is
right (long-run ceiling moving toward your demonstrated 21.5, marathon-pace mileage
redistributed per S1.1), and nothing spikes unexplained. The real gate on this is your explicit
go on the actual production write — the preflight being green doesn't change that, per this
repo's own rule that data writes need a separate go from code changes.

## 6 · Your treadmill question, investigated

You asked me to make sure incline and speed read properly for hill sessions you run on a
treadmill. I looked at the data side, which is mine; the rendering side is pre-run session's,
and I haven't touched it.

Hills are deliberately prescribed **by effort**, no pace target at all — `Research/04` §8.1
says "Strong, controlled (~95% effort)," never a pace, because a flat-ground pace is unreachable
on an outdoor grade that varies underfoot. That's correct for outdoor hills. **It doesn't hold
on a treadmill**, where the grade is fixed and you set it yourself — a pace-plus-incline pair is
both meaningful and something you could actually hit.

The conversion math to do this already exists: `lib/terrain/grade-adjust.ts` has
`gradeFactor`, `flatToGraded`, `gradedToFlat`, `treadmillEffectiveGradePct`, and two
doctrine-cited constants for how much a percent of belt grade actually costs versus how much is
just overcoming the belt's own air resistance. But it's only ever called on the post-run side,
grading a run you already did — never at prescription time. `spec-builder.ts`, which builds the
workout you see before you run, has zero references to incline or treadmill anywhere in it.

I didn't build this — it's three separate decisions stacked, not one fix: what incline to
prescribe (a coaching call, needs a citation or an argued default, not a number I invent),
new prescription logic in `spec-builder.ts` to convert the effort band through the existing
grade math at that incline (mechanical, given the functions above already exist), and knowing
you intend a *specific session* on a treadmill at all, which the engine can't infer and which is
a workout-selection question inside pre-run session's territory. Recorded as a scoped follow-up
rather than shipped half-built — a treadmill field with no way to say "I'm on a treadmill today"
would just sit there unused.

## 7 · What I am holding for you

1. **Migration 164** (`canonical_adaptation_shadow_log`) — written, not applied. Same
   per-statement go as 163.
2. **The live plan rebuild itself (P0-3).** The preflight is as green as I can make it without
   your goal being to spend more engineering time proving what composing fresh against current
   doctrine looks like, versus actually doing it. This is a production data write to your active
   14-week block regardless — I will not run it without you saying go.
3. **The treadmill incline convention**, if you want that built — what percent to prescribe,
   since I have nothing to cite it against.
4. **Worktree hygiene** (§4) — a scheduled prune, or a convention that sessions clean up their
   own merged worktrees, or leave it as a recurring manual triage.

Nothing was written to your production database this round beyond what's already disclosed above
(migration 164 is not applied). No completed activity or sealed prescription was touched. No
adaptation was applied to your live plan — the canonical engine is shadow-only and structurally
cannot mutate it. The live rebuild has not been performed. **Do not read this document as the app
being finished** — that was true of the morning handback and stays true here: the rebuilt plan
is not live, it has not been verified on every surface, and this build has not gone to
TestFlight since the rebuild-relevant work landed.
