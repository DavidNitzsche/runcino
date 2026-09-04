# Runner-loop verdict · David's account, 2026-09-04

Eight questions about the loop that matters: **plan → run → interpret → adapt**.
Answers are `YES — proven`, `PARTIAL — exact missing proof`, or `NO — exact
defect`. Nothing here is graded on intent.

Baseline: `origin/main` @ `5bd8a320`, TestFlight **278**, Railway SUCCESS.

---

## 1 · Can the app build a strong plan?

**PARTIAL.**

Proven: the live 15-week CIM block is progressive, marathon-specific and
internally coherent — 38 → 46.5 → 55.2 → 59.5 → 59.6 → **60.0** peak with three
correctly-placed cutbacks; a threshold session in 10 of 15 weeks growing
3.4 → 6 mi at T; embedded marathon-pace work at 09-14, 10-12, 11-09, 11-16; no
week places two quality days adjacent; taper shape 49 → 36 → 17.5 non-race
against `Research/08` §9.2's 80-90 / 60-70 / 40-50 bands. Read week by week in
`BASELINE-PLAN-AUDIT.md`, from production, not from generation tests.

**Missing proof:** marathon-specific DENSITY thins out near the race. The −3
taper week carries **5 mi at M where §9.2 asks for 10–12**, and `Research/22`'s
four-week race-prep phase contains **four** marathon-pace miles in total. The
21.5 mi dress-rehearsal slot is run as a plain easy long run.

Two things I originally called defects are not: the peak long is **2026-11-01,
35 days out** (I misread a Monday week-start as a run date), and two 20-milers
is inside `Research/22`'s "20-22 mi, 2-3 times" band. The sharper measured
tension is that his peak actual 2026 week is **48.5 mi** against a plan peaking
at **60**, his longest run in 90 days is **18.0**, and `Research/00a`'s 25-30%
long-run share cap is breached in **9 of 9** build weeks — the long runs are
oversized for the weeks carrying them.

The recommendation is in `PLAN-PREVIEW.md`. **The live plan has NOT been
written.**

## 2 · Can iPhone and Watch present the same workout?

**PARTIAL.**

Proven at code level: one expansion (`lib/training/expand-spec.ts`) feeds both
the phone card and `lib/watch/build-workout.ts`; `check-wire-keys` verifies
**131 phone decoder keys and 97 watch decoder keys** against the server's own
source on every build; `_spec_card.test.ts`'s SPECFIRST-1 suite asserts "the
phone and the watch read the same phases" case by case.

**Missing proof:** nobody has held both devices at once. Smoke test #5 and the
Watch section of `PHYSICAL-TESTS.md`.

## 3 · Can I execute it reliably?

**PARTIAL.**

Proven: 42 treadmill tests covering the canonical phase walk — auto-advance,
skip, per-type override propagation, pause-at-boundary, background-gap catch-up
in one tick, resume-from-checkpoint. iPhone **346 tests / 0 failures**, Watch
**223 Swift Testing cases / 0 failures**, `check-watch.sh` **OK with all guards
executed**.

**Missing proof: zero physical verification, on either product.**
`TreadmillStateMachineTests` names its own three uncoverable behaviours —
stable-width digits, End/Skip dialogs actually blocking a tap, cues actually
firing on a speaker. Those need the device.

## 4 · Can the app identify what I actually did?

**YES — proven, with one qualifier.**

One canonical owner, `lib/execution/day-resolver.ts`, with EXACT / LEGACY /
SUPPLEMENTAL tiers. Verified live against production, not a fixture:

```
resolveDayExecutions(2026-08-31)
  prescription easy 4.5mi · matchedRun=-41598809443969 match=legacy_type 6.18mi
  supplemental: []
```

A 6.18 mi run matched its 4.5 mi easy prescription — a genuine 37% overrun
recognised as its own session rather than filed as a stranger. Four separate
date-coincidence bypasses have been closed (display, evidence, sealing, and the
undo gate), and `EXECID-SCAN-1` now fails the build if a fifth appears.

**Qualifier, and it is a real one (EXECIDENT-1).** That match is `legacy_type`,
not `exact`, and the door it came through is weaker than its own comment claims.
Measured: **2 of 159 canonical rows carry `planWorkoutId`**, so 98.7% of every
completion rides the LEGACY tier. Worse, the "independent self-classification"
LEGACY trusts can be Strava's — `data.type` is not in `canonical.ts`'s
`NEVER_COPY` so absorption copies it off a merged Strava sibling, and
`stravaTypeToFaff` returns the literal `'easy'` for `workout_type === 0`, which
is Strava's **unlabelled default**. An absence rendered as an assertion (Rule
11). Across the whole account only two `data.type` values exist: `'Run'` (141)
and `'easy'` (57).

**Fixed structurally, not by tightening LEGACY** — tightening it would unmatch
the 2026-08-31 overrun, which is correctly matched today. `/api/ingest/workout`
already held the prescription row and never selected its id; it now stamps
`planWorkoutId`, so future ingests reach the EXACT tier and the weak door stops
mattering. The same change refuses to stamp when two prescriptions fit the
distance, instead of the previous arbitrary `LIMIT 1`.

## 5 · Can it learn from valid evidence?

**YES — proven, and this is what changed today.**

Three defects fixed, all of which made valid evidence invisible:

| | |
|---|---|
| HRCEILING-1 | every threshold session graded against a **149 bpm easy-day cap** while LTHR is **168** |
| HRCHANNEL-1 | an **absent** HR ceiling read as a **breached** one — the state of every quality session authored since ZONEBAND-1 |
| HRFLATLINE-1 | a **held** HR value graded as a measurement (8 distinct bpm across 21 phases) |

Measured effect: threshold-direction evidence blocked at **34 of 40** decision
points → **14 of 40**. And the converse is proven too: missing runs, supplemental
activity, telemetry-compromised sessions and flat-lined traces can none of them
count as negative evidence or satisfy an upgrade — the table of proofs is in
`ADAPTATION-VERDICT.md`. **625 tests / 25 files in `lib/adaptation/`.**

## 6 · Can it propose appropriate progress, hold, regression or refusal?

**PARTIAL — it proposes correctly and then almost never applies.**

All four outcomes now occur on real history: PROGRESS 14, HOLD 64, REGRESS 4,
REFUSE 38. Before today PROGRESS was 0.

**Missing proof — and the exact defect:** of 14 PROGRESS proposals, **one
applied**. Thirteen were suppressed by arbitration, ten of them by
`WEEKLY_VOLUME` saying "this week already contains enough change". Over three
months the belief moved **3 s/mi**; his real anchor today is nine seconds faster.

Located to two lines. `arbitration.ts`'s rule 2 promises "a small pace
correction … may proceed", but materiality is half the lever's own ordinary
step (1.5 s/mi) while the ordinary step is 3 — so the exception's live window is
**[1, 1.5) s/mi**, narrower than one step, and it fired **zero** times.
`ARBREACH-1` now pins this. The repair is a genuine doctrine choice between two
contract sentences that cannot both be satisfiable, set out with a
recommendation in `ADAPTATION-VERDICT.md`.

## 7 · Can it explain the decision briefly?

**YES — proven.**

Every decision record carries a one-sentence runner-facing reason, and they read
as a coach speaking:

> "Threshold pace moves from 7:22/mi to 7:19/mi. 2 sessions on separate days in
> the last 28 days ran faster than the anchor and held together to the finish."

> "The threshold evidence supports this change, but this week already contains
> enough total demand, so the change is deferred until the next appropriate
> boundary."

Refusals name their cause rather than going silent, and the voice gates
(`check-coach-voice`, `check-sentence-repetition`, the coach lexicon) run on
every build.

## 8 · Can it do all of this without backend intervention?

**NO — and this is the sharpest answer in the list.**

Two hand interventions in the last 48 hours, both by a human at the database:

1. **You moved your own training week by hand**, around travel, on 2026-09-03 —
   because the in-app move-a-run feature does not exist. That single edit then
   broke two live audit tests that had pinned calendar dates (LIVEDATES-1).
2. **A run was backfilled by hand** (`-41598809443969`) to carry the
   `workoutType`/`workoutTypeSource` stamp the widened ingest band would now
   apply, because the ingest fix only affects future ingests.

Neither was avoidable with what is built. **MOVE-A-RUN is the missing surface**,
and it is the difference between a coaching app and a coaching app with a DBA.

---

## The one-line answer

**The app can now build a good plan, resolve what you actually ran, and see the
evidence it was previously blind to. It still cannot act on that evidence
(arbitration), and it still cannot let you move a run without me opening a SQL
client.** Those two are the loop's remaining breaks, and neither is a mystery
any more — both are located to specific lines with named owners.
