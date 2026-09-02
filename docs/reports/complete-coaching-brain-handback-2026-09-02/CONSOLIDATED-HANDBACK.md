# faff.run · overnight handback · 2026-09-02

Everything from one night's work, in one document. The chronological work log
this was assembled from is `work-log-chronological.md` beside it, and the
per-stage reports are the other siblings. Nothing here is a projection: every
claim either carries its evidence or is marked as not established.

---

## 1 · The verdict, first

**The half of the coaching brain that PRICES your training is sound and
verified end to end. The halves that decide whether training is SAFE and whether
it should CHANGE are still not owned by anyone.**

Stages 1 to 3 of the directive are complete, verified and deployed. Stages 4 and
5 are covered in section 12. The brain was independently scored against your own
completion criterion and came back INCOMPLETE — eight of eighteen canonical
coaching questions had two live owners. Four of those are now closed, two are
gated, one was retired as not real, one is half done, and two are waiting on a
decision from you.

Along the way, three numbers that were wrong on your phone or in your database
were corrected, and one sentence the engine has been able to write for weeks
finally reached the screen it was written for.

---

## 2 · The seven decisions waiting on you

None is urgent. They are collected here so they are in one place rather than
scattered through the evidence.

| # | Decision | Default taken | Where |
|---|---|---|---|
| 1 | Re-author your plan so structural fixes reach your phone | Not done — it is a live data write | §4 |
| 2 | Downhill giveback: `Research/01` says 65%, `Research/11` says 50% | Neither picked | §9 |
| 3 | What Today should DO when the injury check cannot run | Failure made loud; behaviour unchanged | §8 |
| 4 | Should a stated goal move training VOLUME, not just pace? | Left alone | §6 |
| 5 | Should the one-primary-stressor rule bind, or stay advisory? | Advisory | §6 |
| 6 | Which watch builds are still in the field? | Nothing changed | §8 |
| 7 | Should the habit reader answer a mean or a sustained figure? | Left alone | §9 |

**Decision 1 is the one that changes what you see.** Every structural plan fix
from this programme is invisible on your phone until your plan is re-authored:

```bash
gh workflow run silent-rebuild.yml -f userUuid=0645f40c-951d-4ccc-b86e-9979cd26c795
```

It archives your active plan and writes a new one, which is reversible and shows
a 24-hour undo card, but it is still yours to decide. My recommendation is to run
it once, now that the programme has finished, so everything lands together.

---

## 3 · What each stage did

### Stage 1 · the coaching brain

Five defects corrected in the evidence model. The two that moved your numbers
were **representativeness computed but never spent**, and **a single long race
fixing the durability exponent invisibly**. Your exponent moved 1.087 → 1.0825
(raw fit 1.110), evidence confidence 0.66 → 0.45, and your marathon anchor
7:55 → 7:52 with a 7:40–8:08 band and an explicit `restsOnOneLongRace` flag.

**That contradicted the audit's own prediction and is reported as such.** The
marathon-anchor audit expected representativeness to make the anchor faster.
Endpoint coverage dominated it instead.

**Threshold belief replay**, 2026-06-01 to 09-01: 15 changes with a 26 s/mi
maximum single-day step became 13 changes with a 9 s/mi maximum, and the final
belief is unchanged at 430 s/mi. The engine got steadier without moving where it
ended up.

**Production verification.** The first canonical recompute moved only four race
rows, which exposed a real defect — the re-anchor trigger read the VDOT delta
alone and was blind to anchor drift. After the fix, the second recompute
repriced 76 workouts. The sealed history checksum
`1f9bc33de7f4cbb10c6807304305e1af` was identical before and after, and stated
goals were untouched.

### Stage 2 · plan generation

All nine brief phases, plus the golden-runner corpus and the invariant tests.

- **Warm-up and cool-down ratio 2.10 → 1.35.** Your tempo was `2.1 WU · 2 @ T ·
  2.1 CD` — bookends longer than the session. Week totals preserved to within
  half a mile across all fifteen weeks.
- **A race and the next day's long run are one transaction now.** It reads
  `Research/00b`'s "Return to long runs" column, which nothing in this engine
  had ever read. An A or B effort consumes the following long-run slot,
  continuously across the window; a C effort is graded a hard workout and the
  long stands.
- **Cutdowns ship their rungs.** Flat ladder sessions fell from 2,581 to 497
  across the archetype matrix, with the remainder DECLINING rather than guessing
  where the cited rows state no descent.
- **Block strategy, phase strategy and week intent** are stamped on every block,
  and a proposed progression names its lever, its from and to, the prerequisites
  with the module that owns each, and a concrete alternative if it holds.
- **The golden corpus names seven of its eighteen runners as UNREACHABLE**, with
  the suite that owns each, rather than counting them as coverage.

**One phase is an honest first cut and stays labelled as one.** The week-layout
decomposition names the input at 139 members and extracts one function; seven of
eight splits are not done and `generate.ts` is still a monolith.

### Stage 3 · the coaching explanation contract

**A sentence that was on your screen for at least three consecutive days:**

> "Durability is the limiter right now, and this is the session that moves it."

"Limiter" is engine taxonomy in a coach's sentence, which the UX doctrine
forbids outright. It now reads:

> "Holding your pace late in a race is the thing to move right now, and this is
> the session that does it."

**Two things let it ship, and the second is the one worth reading.** The voice
gate scans string literals and that sentence is assembled at runtime from clean
fragments — its own declared blind spot. And the thesis audit test **asserted**
`toContain('limiter')`: a gate that REQUIRED the defect, written by the same
reasoning that wrote the code. That is Rule 22 exactly — a test suite cannot
correct a bias it shares.

**One prohibited-word list where there were four**, none of which contained
"bail", "cook the back half", "don't get fancy", "bury yourself" or "junk mile",
all of which were live in shipped copy that morning. The voice gate now parses
the lexicon at build time instead of hardcoding both sides.

**The typed `CoachingExplanation` contract is wired, not prepared.** The first
draft was test-only and the generated-content gate failed the build with its
orphan message. The gate was right; the fix was to wire it.

---

## 4 · What actually reaches your phone, and what does not

**Pace and anchor work reaches you automatically.** Stage 1's re-anchor repriced
76 of your workouts.

**Structural work does not.** Your 2026-09-08 tempo still reads `2.1 mi WU · 2 mi
@ T · 2.1 mi CD` — current paces on a shape authored 2026-08-31. Pace recompute
reprices an authored plan; it never restructures one. The only paths that
re-lay-out a block are the drift job's automatic rebuilds (`race_graduate`,
`plan_elapsed`, `recovery_complete`, `goal_gap_widening`) and the manual silent
rebuild. **"The engine improved" is not a trigger.**

This imposes a discipline on every claim in this document, and it is kept: a
measurement taken by re-running the generator proves the CODE is fixed, not that
your plan is. Only decision 1 makes the second sentence true.

---

## 5 · The loop, traced on your live account

**Evidence → beliefs.** Threshold 430 s/mi from a DIRECT read at confidence
0.835, VDOT 47.8. Durability exponent 1.0825 (raw 1.110), marathon anchor 472
s/mi with a 460–488 band, carrying `restsOnOneLongRace: true`. High intensity is
honest about being weaker: `vdot_fallback` at 0.49.

**Beliefs → plan.** Your plan's stamped anchors are byte-for-byte the live
resolver's:

| Anchor | Plan stamp | Live resolver |
|---|---|---|
| Threshold | 430 | 430 |
| Interval | 401 | 401 |
| Repetition | 365 | 365 |
| Marathon | 472 | 472 |
| Easy ceiling | 502 | 502 |
| Shakeout ceiling | 532 | 532 |

**Beliefs → heart rate.** Your anchor moved 162 → 168 and the plan followed it in
the one way that is easy to get wrong. All thirteen quality sessions carry
`lthr_bpm` 168; sixty future rows carry the 151 bpm ceiling that anchor implies;
four rows still carry 145, and **all four are in the past**. That is not
staleness — a completed session should record the ceiling you actually trained
under, and Rule 10 names retroactively rewriting it as the bug.

**Plan → prescription.** Your week reads:

| Date | Session | Distance | Pace | HR cap |
|---|---|---|---|---|
| 09-02 | easy, 6 × 20s strides | 5.0 | — | 151 |
| 09-03 | 10 × 60s hills | 6.5 | — | — |
| 09-04 | easy | 5.5 | — | 151 |
| 09-05 | rest | — | — | — |
| 09-06 | long | 15.0 | 8:40 | 151 |
| 09-07 | easy, 6 × 20s strides | 4.5 | — | 151 |
| 09-08 | tempo | 6.2 | 7:10 | — |

**Rendered on the phone, live data** (`renders/today-2026-09-02-verified.png`):

Today, week 2 of 15, about 52 min, EASY, 5 mi. Pace band **8:22–9:02/mi**, HR
ceiling **151 bpm**. The 8:22 is 502 s/mi — the canonical easy ceiling,
unrounded. The segment row reads:

    5 mi                    no faster than 8:22 /mi
    6 × 20s strides                        6:41 /mi
    1:00 walk back between                 8:42 /mi

**The first line is the one that matters.** Doctrine gives easy running ONE
number and it is a ceiling. The goal-derived ladder that was deleted used to
invent a two-sided band around a number it had no right to. "No faster than" is
the refusal that replaced it, working on your screen.

And the Block screen now reads, under "Where this goes":

> Your races fade with distance faster than your speed predicts, so durability
> is where the work goes. Your threshold holds.

That is your coaching thesis, in the place it was written for. Two earlier
reports claimed it was already there by reading the wiring. Both were wrong.

**And Races, the third surface** (`renders/races-2026-09-02-verified.png`): CIM,
95 days out, **Goal 3:00:00 · Projected 3:19:42 · Gap +19:42**. That projection
is the same number the independent ownership audit read from a different path
entirely, which is Rule 16 holding across three surfaces on live data rather
than in a test. And your goal sits at 3:00:00, untouched, which is what four
months of production data already said and what the screen now confirms.

---

## 6 · The brain's own completion criterion, scored independently

Your standard, verbatim: do not call the brain complete while any canonical
coaching question still has competing live owners. Audited against the
Constitution's ownership table, eighteen rows, evidence per row.

**Result on first audit: 5 PASS · 5 PARTIAL · 8 FAIL.** Full scorecard in
`ownership-scorecard.md`.

**What was already finished, and it is the part that prices your block:** the
six-anchor pace spine agreeing across engine, plan, watch and stamp, with legacy
cascades deleted rather than deprecated. Durability, with every former competitor
converted to a delegating adapter and the deletion recorded in the file. Heat, as
one model with no Swift copy. The workout catalogue and its reachability gate.
The plan-mutation boundary, where fourteen ad-hoc writers were consolidated into
one and it holds. And goal immutability, proven in source AND in four months of
production data: CIM has sat at 3:00:00 against a 3:19:42 projection and never
moved.

### The ten blockers, where they stand now

| Blocker | State |
|---|---|
| B1 · goal-derived pace ladder live on iPhone and watch | **Closed** — plus two worse, persisting cases found by widening its gate |
| B2 · two records of the prescribed race target, 180s apart | **Closed** — plus a third reader neither audit had seen |
| B3 · safety has no owner | Open — needs decision 6 |
| B4 · nothing asserts legacy writers stop when the engine is promoted | **Gated** |
| B5 · a second, unbounded fitness read | **Closed** |
| B6 · two descent coefficients | Open — needs decision 2 |
| B7 · the HR half of intensity has no owner | **Closed** |
| B8 · a failed injury read reads as "not injured" | **Half** — failure made loud; behaviour needs decision 3 |
| B9 · two rows pass by inspection with no gate | **Gated** |
| B10 · parity gate reads the wrong copy | **Retired — not real** |

---

## 7 · The numbers that were wrong

Each of these was live, each has a magnitude, and each is fixed.

**Sixty seconds per mile.** `derivePaces` built your entire training pace ladder
as offsets from your TYPED GOAL. Threshold 394 against a canonical 430, interval
376 against 401, repetition 333 against 365, **marathon 412 against 472**. A
minute per mile too fast at the marathon, in the dangerous direction, live on
iPhone and watch. Deleted — the function, its goal inputs, and the stale
exemption that had been asking for exactly this fix.

**And widening its gate found two that persist.** The leak check covered three
trees; extended to seven it went from 246 files to 438 real ones and caught
`app/api/plan/restore` writing 394 s/mi into restored `workout_spec` rows, and
the spec backfill route ready to write the same number into every spec-less row
in the database. A wrong number on a screen is gone next render. A wrong number
in a workout spec is training.

**A hundred and eighty seconds, and then twenty-nine seconds per mile.** Your
plan held two records of your prescribed CIM target — 436 s/mi in
`authored_state`, 443 on the race row — and which you got depended on which job
ran last. A THIRD reader survived both: the refresh rewrote race paces but never
the pace-adrift abort rule authored off the old seed. **Three of your four race
rows carry a stale abort.** Santa Monica's sits at 466 s/mi against a canonical
437, twenty-nine seconds loose, which means the rule essentially cannot fire on
the day it exists for.

**Four bpm, on your wrist.** Every threshold row was shipping a work target of
168 bpm beside its own pass line of 164, because the target and the LTHR were
being merged as one quantity. Your 09-08 row prescribed Daniels T at 430 s/mi,
targeted 155 bpm and judged at 164 — three intensity statements, two anchors, no
owner — while you demonstrably hold 162 at that pace.

---

## 8 · Safety, and what it still needs from you

**Safety has no owning module.** Four surfaces author the NORMAL / CAUTION /
MODIFY / STOP verdict independently. There have been **184 injury-adjustment
proposals and zero accepted, over nine days** — the safety-to-training arm has
never once executed.

**A correction to the audit on this, from reading the code myself.** It reported
the watch shipping a runnable workout beside its own "Not today" injury board as
breaking the Constitution outright. The behaviour is real, but it is deliberate
and the code says so: an open injury is resolved before the plan row is read, and
"when a workout DOES exist it still ships beside this, so a deployed watch runs
the session unchanged and a 0821 build draws No session instead." That is a
backwards-compatibility posture for watches already in the field. Closing it
means deciding which builds are still out there — **decision 6**.

**And a Rule 11 collapse on the safety path, half fixed.** The open-injury read
ended in a catch returning no rows, so a database failure and "no open injury"
were the same answer. It now logs loudly and carries a flag saying the check
could not run. **What Today should DO with that is decision 3**: it must not
fabricate a flare, because an injury owns the whole screen and a transient error
would blank your day, and it should not silently prescribe as if you are clear.

---

## 9 · Two questions the evidence cannot settle

**The downhill coefficient.** `Research/01` says downhills give back 60–70% and
`Research/11` implies 50%. Both are implemented faithfully in separate modules,
both separately gated against their own citation, and they disagree. On your CIM
course — 691 ft of gain against 1002 ft of loss — the course reads 50 seconds
slower than flat under one and 10 seconds under the other. Forty seconds on your
goal race, decided today by which module a caller happens to import.

**The habit reader answers a mean where the question is sustained.** Rule 8's
filter works: over your fixed 28-day window, 26 of 29 days were taper, race or
prescribed recovery, and the reader REFUSED rather than calling your post-race
block your normal. The widening path then reaches 56 days and answers **34.0
mi/wk**, while CLAUDE.md's own Rule 8 table records your sustained volume as
**43.5** and labels it truth.

Queried raw over twenty weeks, your build was 37.6 / 40.5 / 39.7 / 44.9 / 40.1 /
47.3 / 43.2 / 39.8 / 47.5 mi/wk, containing one zero week (2026-06-29) and one
4.2-mile week (2026-07-27), neither taper, neither prescribed, neither explained
by any illness or injury row. So the filter is right and the STATISTIC is the
question: a mean over representative DAYS answers what you averaged; your plan
generator is asking what you can sustain. One zero week moves a mean six miles
and barely moves a median.

Not changed, because it is a doctrine change to the reader that sizes every
block. **Decision 7.**

---

## 10 · Operational state, checked rather than assumed

**Rule 23's precondition fix is real and earned its keep.** The plan-drift job
ensures the LTHR anchor itself rather than assuming the adaptations job ran
first. Last night the adaptations job fired 4 h 44 m late; the order still held
and the lateness was harmless, which is exactly the property the rule asked for.

**Alerts are recorded and delivered to nobody.** Production carries forty
environment variables and none configures the ops webhook, so dispatch returns
early every time. Fourteen alerts sit unacknowledged. Read them carefully: nine
say a scheduled job "has no recorded successful completion at all", naming
plan-drift and run-adaptations, and **those jobs are not dead** — all nine were
written at one instant on the day the cron ledger was introduced, before any job
had written to it. Sixty-one heartbeats have accumulated since.

That is the real finding, and it is worse than a dead job: **an alert table
nobody watches fills with resolved noise, so real signal lands where it cannot be
told apart.** Recording an alert is not noticing it.

Five alerts are real and open: a dedup-flag census error from 2026-08-22, and
four Strava webhook rejections naming an unknown subscription and owner.

**Data integrity is clean.** 136 rows over 90 days, 81 merged, **zero merged rows
pointing at a survivor that does not exist**, one canonical run per day across
the last seventeen. The 2026-08-22 dedup alert is stale.

**Push credentials are configured** — all five APNs variables are set, which
contradicts older notes.

---

## 11 · Incidents, and three corrections I made to my own work

**Main went red for sixteen minutes.** Widening the leak gate raised its liveness
floor to 500 files from a local count of 876. The local count was double the
truth: this volume is exFAT and carries an AppleDouble `._foo.ts` sidecar beside
every source file, roughly four hundred thousand of them, and `find -name '*.ts'`
matches them. A clean CI checkout counted the real 438 and failed a floor it
could never reach. Every local gate was green and `verify-commit` was CLEAN
including a full build, and production still did not deploy. That is Rule 19 in
one incident.

**I claimed a render that proved nothing.** The app installed on the simulator is
a DEV build pointed at `http://localhost:3111`, not production. With nothing on
that port every fetch failed silently and it painted a twelve-hour cache written
2026-09-01 17:14 — which is why its Today showed the previous day's run. My
earlier "Today renders correctly after the pace-ladder deletion" was measured
against that cache. I corrected it in the work log rather than leaving it
standing, then started the dev server the app expects, with the read-only role,
and rendered properly. Section 5 is that render.

**I ruled a decision and its implementation came back better.** I ruled that
per-step ladder paces should be additive wire keys, reasoning an older watch
ignores unknown keys. The implementation needs no new key at all: the offset
resolves into a field the spec already carries, so an old build grades the
session identically. Recorded as a correction rather than quietly accepted.

**And I overstated an audit finding before checking it.** The scorecard called
the watch injury behaviour an outright Constitution breach; the code documents it
as a compatibility decision. Stated at its real strength in section 8.

---

## 12 · Stages 4 and 5

PENDING — filled in when both land.

---

## 13 · What is NOT true

- **Upward pace adaptation remains shadow-only, deliberately.** Six shadow
  cycles over three days, engine PROGRESS on all six, agrees-with-live **0 of
  6**, zero-mutation verified on all six. Both halves matter: the shadow wants to
  push you up every cycle and the live engine fires nothing, which is Rule 21's
  asymmetry with a number on it — and a candidate that has never once matched
  production across a three-day record spanning two model versions is an untested
  divergence, not a validated one. Promotion requires agreement to be observed,
  and there is none to observe yet.
- **`generate.ts` is still a monolith.** Seven of eight layout splits are not
  done.
- **Three of your race rows still carry the stale abort rule.** The code is
  fixed; the rows correct themselves on the next authoring or refresh.
- **Nothing structural from this programme is on your phone** until decision 1.
- **The watch's own compiled grading is covered by a TypeScript port**, not by
  the Swift that runs on your wrist. The wire is right; the wrist is unverified.
- **A fetch-failure path on the phone** renders the previous day's content under
  the new day's label with no signal (`SurfaceStoreV5.swift:200`). Found because
  of the dead dev server, but it is a code fact. Not fixed: the clean fix
  contradicts your recorded preference about uncached days.

---

## 14 · Where the evidence lives

| Document | What it holds |
|---|---|
| `work-log-chronological.md` | This night as it happened, with the reasoning at each step |
| `ownership-scorecard.md` | The eighteen rows, per-row evidence, cross-surface numbers |
| `stage1-brain-locked.md` | The brain corrections and the replay |
| `stage2-decisions.md` | The three plan rulings, each with what would overturn it |
| `stage2-plan-generation.md` | Stage 2's own handback |
| `stage3-coaching-voice.md` | Stage 3's own handback |
| `second-owners-closed.md` | B1, B5, B10 |
| `blockers-b2-b7.md` | B2 and B7 |
| `renders/` | Screenshots, including the verified 2026-09-02 Today |
