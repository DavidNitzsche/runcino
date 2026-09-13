# Post-run audit failures · root-cause investigation

**Date** 2026-09-13 · **Branch** `fix/postrun-audit-parity` · **Base** `origin/main` `a79c5c86d`
**Final SHA** `38c5a3039b4b5d29507dd54674a351d6b92bbdeb`
**Access** read-only, `faff_readonly`, via `DATABASE_URL_RO`. No writes issued; the vitest write
barrier armed on every run and refused six `UPDATE plan_workout_proposals` attempts the routes made
of their own accord (ledger: *6 writes attempted, 0 issued*).

> **This report goes to David before any of it integrates with anything else.** It is not requested
> for Wave 1 and should not be assumed into it. The code on the branch is a **merge candidate only
> after a fresh independent reviewer reads it against the exact SHA above** — I wrote both the fix
> and its gates, and Rule 22 says a gate inherits the bias of whoever wrote it.

---

## 1 · Headline

The three failing files have **two** distinct root causes, and they are of completely different
kinds.

| | Cause | Class | Runner sees false analysis? |
|---|---|---|---|
| **A** | `/api/v5/today` asks a **date-blind** reader whether the runner ran on the **viewed** date | Incorrect canonical resolver/adapter | **YES — high priority.** 46 of his 48 completed days currently render as an *upcoming* workout |
| **B** | The audit files gate on `DATABASE_URL_RO` but connect on `DATABASE_URL`, which CI never sets | Test-harness defect (with a false-green tail) | No. But it was **hiding** A, and hiding seven other assertions |

Neither is bad production data. Neither is an obsolete expectation. **No expected value was changed
to make anything pass.**

---

## 2 · Root-cause table

### A · `_postrun_surface_parity.audit.test.ts` — all 7 assertions, one cause

| Field | Detail |
|---|---|
| **Assertions** | `state === 'after_run'` (l.62); `typeof postRun.decisionVersion === 'string'` (l.69); `recap.verdict === today.verdict` (l.77); postRun byte-identical across three routes (l.86); Rule 17 `postRun` truthy (l.93); Rule 20 `postRun.learned` is a string (l.118); LIVENESS `postRun` truthy (l.126) |
| **Observed** | All seven fail. The single upstream fact: `today.state === 'before_run'`, `today.runId === null`, `today.postRun === null` |
| **Classification** | **Incorrect canonical resolver/adapter** |
| **False analysis?** | **YES — high priority** |

#### The exact live evidence

Two calls, one run, opposite answers. Both captured on production 2026-09-13, runner today
`2026-09-13`, current training week `2026-09-07 .. 2026-09-13`:

```
GET /api/v5/today?date=2026-09-01
  → 200 · state "before_run" · runId null · postRun null · verdict null · win null

GET /api/runs/-258355938987883/recap
  → 200 · postRun POPULATED
    headline "Controlled work"
    summary  "All four reps landed, with one quicker than the window."
    cost     "Work heart rate averaged 162 against a 164 ceiling."
    learned  "You held that pace deeper into the session than your current threshold
              pace predicts. One session does not move it. The next one like it will."
    decisionVersion "run:-258355938987883|plan:pln_9a57561debb776e5|grade:threshold/executed|evidence:1.0.0"
```

The row itself is fine. `runs` id `-258355938987883`, `data.date = 2026-09-01`, 8.50 mi,
`source = watch`, `workoutType = threshold`, `planWorkoutId = wko_470a1327c80a75c3`,
`watchCompletionRef = 0645f40c-…-2026-09-01#0920`. The day resolver agrees: `resolution = completed`,
`completedRunId` present, `done_mi = 8.5`.

#### The trace

1. `web-v2/app/api/v5/today/route.ts:298-299` — `?date=` **is** honoured: `today = requestedDate || runnerTodayISO`.
2. `route.ts:422` — `loadPlanWeek(userId, runnerTodayISO, today)` is **date-aware** and windows on the viewed date.
3. `route.ts:435` — `todayWeekDay = resolveViewedPlanDay(planWeek.days, today)` therefore holds the right row.
4. `route.ts:445` — `glanceToday = glance.weekDays.find(d => d.date === today) ?? null`.
5. `web-v2/lib/coach/glance-state.ts:395` — `export async function loadGlanceState(userId)`. **No date parameter.** Its `weekDays` is always the *current* training week.
6. `route.ts:1008-1015` (pre-fix) — `const ranToday = glanceToday && glanceToday.doneMi >= 0.5 && !prescriptionUnmatched;`
7. `glanceToday` is `null` for every viewed date outside the current week → `ranToday` falsy → the whole after-run branch (`route.ts:1016`+) is skipped → `postRun`, `runId`, `verdict`, `win` are never composed.
8. `web-v2/lib/faff/v5-today.ts:2049` `viewedDayResolutionFor` — **excludes `completed`** on purpose ("the after-run hero owns it"), so no `viewedDayResolution` is emitted either.
9. `native-v2/Faff/Faff/ViewsV5/HostsV5.swift:1099-1214` — with no `viewedDayResolution` and `state == before_run`, the host renders `TodayBeforeLiveV5` → `TodayBeforeV5`.
10. `native-v2/Faff/Faff/ViewsV5/TodayBeforeV5.swift:454-520` — the **upcoming-workout hero**: kicker, type ("Threshold"), prescribed distance, a "Pace band 8:09-8:33/mi" stats plate, and Warm up / Work / Cool down steps with target paces. Plus "Before you go · Move or skip".

**Measured directly, and this is the probe output, not an inference:**

```
DATE 2026-09-01 → state=before_run  runId=null              postRun=null
DATE 2026-09-08 → state=after_run   runId=-75144899844434   postRun=POPULATED
DATE 2026-09-09 → state=after_run   runId=-218380344929823  postRun=POPULATED
DATE 2026-09-11 → state=before_run  runId=null              postRun=null   ← correct, see §4
```

`2026-09-08` and `2026-09-09` are inside the current week and answer correctly. `2026-09-01` is not.

#### Why this is high priority

The phone reaches those dates **routinely, not exceptionally**:

- `native-v2/Faff/Faff/DesignV5/ChartsV5.swift:1134-1146` — `WeekStripV5` is a real paging `TabView` with previous / next week pages, plus explicit VoiceOver "Previous week" / "Next week" actions (`:1180-1181`).
- `HostsV5.swift:1360-1364` — the only clamp is the **whole plan's** start/end, and it fails **open** when bounds are unknown. Nothing clamps to the current training week.
- `HostsV5.swift:1608-1634` — any non-today selection becomes `?date=YYYY-MM-DD`.
- `HostsV5.swift:1925-1951` — `prefetchAround` requests **the whole previous and next week** (21 dated reads) on every navigation.
- The training-calendar sheet (`HostsV5.swift:2214-2282`) lists **every week of the block**, each day tappable.
- `HostsV5.swift:1773-1776` — `shouldRenderFromSnapshot` *forces* the live `?date=` fetch precisely for days the local snapshot says have a `matched_run`, because it **expects** `after_run`. Nothing compares the two. There is **no client-side guard** anywhere that detects "this day has a completed run but the payload says before_run".

**Blast radius, measured over his trailing 120 days** (days with an exact prescription match, ≥0.5 mi):

```
IN the current training week   :  2  (2026-09-08, 2026-09-09)
OUTSIDE it                     : 46
```

Every one of those 46 — including `2026-07-25 (18.0 mi)`, `2026-06-27 (14.02 mi)`,
`2026-09-04 (15.51 mi)`, `2026-09-01 (8.50 mi)` — rendered as an upcoming prescription with a
prescribed distance and a pace band, over a run that was finished, graded and sealed. The one thing
distinguishing it from a genuinely upcoming day is the header word changing to "Earlier".

And note the interlock, which is why nothing else caught it: `completed` is excluded from
`viewedDayResolution` *because* the after-run hero was supposed to own it, and the after-run hero
was unreachable for exactly those dates. Two individually correct decisions, one hole, and the hole
is precisely the set of days that have real post-run analysis to show.

#### On whether the test expectation is obsolete — it is not

The parity file pins the literal date `2026-09-01`. On 2026-09-02, when it was written, that date
was **inside** the current training week (`2026-08-31 .. 2026-09-06`), so it exercised the in-week
path and passed honestly. It has since **aged into** the out-of-week path. This is Rule 15 in its
purest form: the assertion was always right, and for twelve days it could not reach the code that
breaks it. It is a stronger test today than the day it was written, by accident. Nothing about it
should be relaxed.

#### Recommended fix — implemented, `202a87efc`

`route.ts:1008-1062`. The repair is **the same one the file already applies twelve lines below**, and
which its own comment (`route.ts:741-761`) explicitly argued for and then deferred: *"`planWeek` IS
date-aware … the real repair is a `loadGlanceState(userId, date)`, which is a wider change than
this."* `todayPlan` (`route.ts:762-778`) already does glance-first / `todayWeekDay`-second for the
**prescription** half. The **"did he run"** half never got the same treatment.

```ts
const viewedDoneMi: number | null = glanceToday
  ? glanceToday.doneMi
  : (todayWeekDay?.done_mi ?? null);
const ranToday = viewedDoneMi != null && viewedDoneMi >= 0.5 && !prescriptionUnmatched;
```

- **No new source of truth.** `todayWeekDay.done_mi` is `loadPlanWeek`'s own reading for the viewed date and is *already* trusted by this same file for the week strip's `isDone` (`route.ts:454`).
- **Rule 11.** Both readers null means "this date was not resolvable", not "he did not run" — reached by an explicit `!= null`, not by a zero, and leaving `ranToday` false (never invent a post-run card).
- **Ownership untouched.** Whether the run *completed the prescription* remains `prescriptionUnmatched` alone. See §3.

---

### B · `_postrun_live.audit.test.ts` and `_detail_live.audit.test.ts`

| Field | Detail |
|---|---|
| **Assertions** | `_postrun_live` l.212 `expect(await haveDb()).toBe(true)`; `_detail_live` l.59 the same |
| **Observed** | Both fail in CI. **Both files pass completely when run with a database** — I ran them against production on unmodified `origin/main` before touching anything: 5/5 and 4/4 green. Every content assertion in them is correct |
| **Classification** | **Test-harness defect** — closest of the four categories to *ambiguous nullability semantics*, but it is not that: it is one credential named in the guard and a different one named in the connection. Nothing about the product |
| **False analysis?** | **No.** No runner-facing consequence. Its cost is that it **hid** cause A and seven other assertions |

#### The evidence

`.github/workflows/audit-suite.yml:145-152` exports `DATABASE_URL_RO` and nothing else.
`web-v2/lib/db/pool.ts:25` connects on `process.env.DATABASE_URL`. Every audit file gates on
`describe.skipIf(!process.env.DATABASE_URL_RO)`.

So in CI the guard **opens**, the file **runs**, and the pool falls back to its localhost default:
`Error: The server does not support SSL connections`.

Reproduced exactly (`DATABASE_URL_RO` exported, `DATABASE_URL` unset, no `.env.local`):

```
✓ composes the owner's 2026-09-01 threshold session from real rows        11ms
✓ composes the owner's 2026-09-02 easy-plus-strides session from real rows 3ms
✓ PARITY · the run-id read and the date read are the same object           7ms
✓ a run that is not this runner's is a null                                4ms
× LIVENESS · the audit reached a database and read real rows               7ms
```

**Those four green ticks asserted nothing.** Each test opens
`if (!await haveDb()) { console.warn('NO DATABASE — this assertion did not run'); return; }`. The
millisecond timings are the tell. Only the LIVENESS assertions (Rule 18 clause 2) went honestly red —
they are the reason this was visible at all, and they worked exactly as designed.

This is the false-green class that `audit-suite.yml`'s own header calls *"the most expensive false
green found in the core-closure programme"*, reproduced **inside** the job built to stop it.

#### And it was not deterministic

`lib/db/pool` reads `DATABASE_URL` **once**, at module evaluation. 22 of the 33 audit files work
around this with `process.env.DATABASE_URL = RO` **inside a test body** — which only works if
nothing else in that vitest **worker** imported `lib/db/pool` first. So which audits genuinely reach
production varied with file-to-worker assignment. Measured in the CI environment across all 33 files,
two more died on the localhost fallback three levels down in `lib/runs/volume.ts:84`:
`_postrun_corpus.audit.test.ts` and `_durability_anchor.audit.test.ts`. **This is very likely why the
reported failing set was three files rather than five.** The suite's greenness was a function of
scheduling.

#### Recommended fix — implemented, `38c5a3039`

`web-v2/vitest.setup.ts`, which runs in **every worker before any test module is evaluated**, so the
pool singleton is built from the right string the first time and there is no ordering left to lose:

```ts
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_RO) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_RO;
}
```

One place, not a 23rd copy of the per-file workaround (Rule 16). It never overrides an explicit
`DATABASE_URL`, so `.env.local` and the loopback harnesses still win. The value adopted is the
`faff_readonly` role — SELECT-only at the database — with the write barrier as the second,
independent layer, which is exactly the two-layer posture `audit-suite.yml` already documents.

**Measured in the exact CI environment, all 33 audit files:**

| | Files | Assertions | `NO DATABASE` warnings |
|---|---|---|---|
| before | 5 failed, 27 passed, 1 skipped | 8 failed, 89 passed | 8 |
| after | **32 passed, 1 skipped** | **97 passed, 0 failed** | **0** |

(The 1 skipped is `_render_fixture.audit.test.ts`, an opt-in fixture writer.)

*Alternative considered and rejected:* adding `DATABASE_URL: ${{ secrets.DATABASE_URL_RO }}` to the
workflow. It fixes CI and leaves the ordering nondeterminism in place for every other caller, and it
puts the invariant somewhere no test can see it (Rule 20).

---

## 3 · Canonical owner for the `before_run` / `after_run` fact

**Two questions were wearing one name, which is a Rule 16 problem as much as an ownership one.**

| Question | Canonical owner | Does the code route through it? |
|---|---|---|
| *Did a run satisfy this date's prescription?* | `web-v2/lib/execution/day-resolver.ts` — `resolveDayExecutions` / `primaryPrescription` | **Yes, correctly.** `route.ts:1008-1014` calls it and derives `prescriptionUnmatched` from it |
| *Was there any running on this date at all?* | `loadPlanWeek` / `resolveDayExecutions` — anything date-aware | **No, pre-fix.** It read `glance-state.ts`, which cannot take a date |

`day-resolver.ts:1-64` claims the first outright: *"Every surface that has to answer 'what did the
runner do today, and did it complete what was asked' calls THIS. No other surface re-derives the
question independently."* That claim holds. The route does not bypass it, and my fix does not touch
it.

The bypass was narrower and easier to miss: the route AND-ed the owner's verdict with a **second,
date-blind** reading of a *different* question. Because the two were conjoined, the date-blind half
could only ever **suppress** an `after_run` — never manufacture one — which is why it produced a
quiet, plausible wrong answer instead of an obviously broken one. Per Constitution §29 this is the
"second answer to a row" pattern in its subtle form: not a rival engine, a rival **window**.

**Recommendation for the reviewer to weigh.** My fix keeps the glance-first ladder (glance carries
adaptation provenance the plan row cannot, and it is the pattern `todayPlan` already established
eleven lines away). A stricter reading of the Constitution would derive "was there running" from
`resolvedToday` alone and delete the glance dependency from this gate entirely. I did **not** do
that, because it changes the in-week answer for every runner and needs its own evidence pass. It is
the right follow-up if the reviewer wants one owner rather than one ladder. The honest description of
what shipped is: **the date-blindness is fixed; the two-source ladder is not collapsed.**

---

## 4 · What is *not* a defect (checked, and deliberately left alone)

**`2026-09-11` returns `before_run` and that is correct.** The run
(`runs` id `-356470421449245`, 5.36 mi, `source = apple_watch`) carries **no** `planWorkoutId`, **no**
`watchCompletionRef` and **no** `workoutType`. The day resolver classifies it `supplemental`, which is
David's own explicit ruling in `day-resolver.ts:38-56`: *"A completed activity may satisfy a
prescribed workout only when there is an exact, durable association between them"* — same date,
only run of the day and type alone are named **explicitly insufficient**. Because `supplemental` is
**not** excluded from `viewedDayResolution`, the phone renders `PastDayResolutionHeroV5` for it, not
the prescription hero. Correct end to end. My fix leaves it untouched, and the new test excludes
supplemental days from its candidate set rather than asserting either way about them.

**No bad production data was found.** Every row behind every failing assertion is well-formed and
self-consistent.

---

## 5 · Falsifying tests added

### `web-v2/lib/postrun/_stepped_day_after_run.audit.test.ts` (new)

Built on the live data shapes above, and deliberately **cannot age out** the way the parity file did.
It resolves its own candidate days at run time from the day resolver over a trailing 60 days,
partitions them by whether `loadGlanceState`'s date-blind week contains them, and **requires both
kinds** — a corpus with no out-of-week case is reported as a **failure of the corpus** (Rule 18
clause 2), not a pass. Four tests: liveness, out-of-week, an in-week **control** (a repair that moved
the in-week answer would be a regression wearing a fix's clothes), and a source-shape guard that runs
with no database at all.

**Falsified both ways** against the unfixed route:

```
with the fix       4 passed
fix reverted       × OUT OF THE CURRENT TRAINING WEEK
                     expected { date: '2026-09-04', state: 'after_run' }
                     received { date: '2026-09-04', state: 'before_run' }
                   × SOURCE · the done-reader is date-aware
                   ✓ IN the current training week   ← control correctly unmoved
```

`2026-09-04` is his 15.51 mi long run.

### `web-v2/lib/verify/_audit_credential_binding.test.ts` (new)

Rule 20 for cause B: a runtime assertion in every worker (if `DATABASE_URL_RO` is set then
`DATABASE_URL` must be too) plus a source guard for the developer machine where `.env.local` masks
the runtime half.

**Falsifying this one earned it a fix, and the failure is worth recording.** Written first without
stripping comments, the SOURCE half **passed** against a `vitest.setup.ts` whose binding had been
commented out — the regex matched the prose in the doc comment. That is exactly the shape Rule 18
names in `check-automatic-mutations.sh` guard 2. It now strips comments first and asserts that it can
tell code from prose (`expect(raw).toContain('AUDITRO-1'); expect(code).not.toContain('AUDITRO-1')`).
Re-falsified: both halves red with the binding removed, all three green with it restored.

---

## 6 · Verification performed

| Check | Result |
|---|---|
| `_postrun_surface_parity.audit.test.ts` vs production | **7 failed → 7 passed** |
| `_postrun_live` / `_detail_live` vs production, with a DB | **passed before and after** (they were always correct) |
| All 33 audit files, exact CI env | **5 files / 8 assertions failed → 32 passed, 1 skipped, 0 failed** |
| `lib/postrun` + `lib/faff` + `lib/execution` regression | 2383 passed, 1 expected-fail, 3 skipped |
| `lib/verify` (write barrier + new gate) | 65 passed |
| `tsc --noEmit` | clean |
| `npm run prebuild` (all 31 gate scripts) | **PASS** |
| Both fixes falsified against the unfixed code | yes, both directions |

**Rule 13's rendering half is NOT satisfied and I am not claiming it.** Everything above is the
**payload**. I did not build the iPhone app, launch the simulator, or screenshot `TodayBeforeV5`
against a stepped-back date. The Swift trace in §2 is read from source (with file:line), which is
evidence about the code path, not about the pixels. **Before this merges, someone should page the
week strip back one week on a real build and confirm the after-run card now draws.** That is the
step that has cost the most trust historically and I have not done it.

---

## 7 · Open items for David

1. **Decision — one owner or one ladder?** §3. Collapsing the glance/`planWeek` ladder into a
   resolver-only read is the stricter Constitution reading and changes the in-week answer for every
   runner. I did not do it. Default if no answer: leave as shipped.
2. **`loadGlanceState(userId, date)`.** The route's own comment has wanted this since at least
   2026-08-30 and names it "a wider change than this". Readiness, the seven-night sleep average and
   week-to-date mileage are *still* present-tense numbers rendered under a past date's heading
   (`route.ts:308-320`). My fix does not address that; it only stops the **state** being wrong.
3. **A client-side cross-check.** `HostsV5.swift:1773-1776` already knows from the local snapshot
   which days have a `matched_run`. Nothing compares that to `model.state`. A one-line disagreement
   check there would have surfaced this from the phone rather than from a test aging out.
4. **The other 22 audit files' `process.env.DATABASE_URL = RO` lines are now redundant.** Harmless,
   but they are 22 copies of a workaround whose cause is gone. Worth a ratcheted cleanup, not urgent.
5. **Not requested for Wave 1.** Please schedule deliberately.

---

## 8 · Merge status

**Not a merge candidate yet.** Two commits on `fix/postrun-audit-parity`:

- `202a87efc` — STEPPEDDAY-DONE-1, the product fix
- `38c5a3039` — AUDITRO-1, the harness fix and its gate

They are **independent** and can be split if the reviewer wants AUDITRO-1 to land first — it is the
one that makes the audit job trustworthy, and landing it alone would turn the CI red on
STEPPEDDAY-DONE-1 for real, which is arguably the honest sequence.

**This needs its own fresh independent reviewer against `38c5a3039b4b5d29507dd54674a351d6b92bbdeb`
before it merges.** I wrote the fix, the tests and the gates, so per Rule 22 the review cannot come
from the same reasoning that produced them. Rule 19 also applies once it does merge: confirm the
Railway deployment reports `success`, not that the push was accepted.
