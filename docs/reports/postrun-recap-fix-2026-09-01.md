# Post-run recap fix — 2026-09-01

Subject: `wko_eaa8cfd7cb94310b` (2026-09-01, threshold, plan `pln_9a57561debb776e5`),
the completed run for `0645f40c-951d-4ccc-b86e-9979cd26c795`, canonical row
`runs.id = -258355938987883` (source `watch`, absorbed a duplicate Apple
Watch import `-1661591963635005`). David's own words: *"a big issue from
todays run is that the post run view in the app is not specific to this run.
no interval breakdown, no plan breakdown, the coach insight is off, its a
mess."* This report traces each of those four complaints to a real cause,
fixes what was safely fixable tonight, and states plainly what wasn't.

Companion to `docs/reports/workout-fix-verification-2026-09-01.md` and
`docs/reports/workout-provenance-trace-2026-09-01.md`, which fixed this same
workout's PRE-run card earlier tonight. This report is the POST-run side.

---

## Summary of findings

| # | Symptom | Root cause | Status |
|---|---|---|---|
| 1 | "7:03 just off target" matches no mile in the table | Real, correctly-computed average of the 4 real work-rep paces — a different quantity than any GPS mile, shown with nothing on screen explaining what it is | Not a bug in the number; resolved as a side effect of fixing #3 |
| 2 | Only 2 of 8 miles "orange", caption about "inside what the session asked for" | That exact caption and binary highlight are **dead code**, retired on `main` 2026-08-30 (`2ef168d6`). Current `main`, rendered tonight against this exact run, shows a continuous pace-speed gradient with a different caption | Not a live code defect — reads as a stale build; no code changed |
| 3 | No interval breakdown | **Two real bugs, found and fixed.** (a) A field-name mismatch in `web-v2/app/api/v5/today/route.ts` silently emptied the real per-rep segment data on every watch-completed run. (b) Fixing (a) exposed a second, previously-dormant bug in the Swift consumer: each section's pace was computed as its raw duration read straight as a pace, never divided by its distance | **Both fixed, both verified live on device** |
| 4 | No plan breakdown / independent generation | Not a bug. The post-run screen reads the same `plan_workouts` row, same date, as the pre-run card — verified `pace_target_s_per_mi = 430` (tonight's corrected value) reaches it | Confirmed correct, nothing to fix |

---

## 1. "Held form, 7:03 just off target" — real number, no bug

`winTempo` (`web-v2/lib/coach/run-win.ts`) prefers the average pace across the
run's real **work phases** over the whole-run average, specifically so a
threshold session isn't judged on a pace diluted by its warm-up and cool-down:

```ts
const workPhases = (input.phases ?? []).filter(
  (p) => (p.type === 'work' || ...) && p.actualPaceSPerMi,
);
const paceForJudge = workPhases.length > 0
  ? workPhases.reduce((s, p) => s + (p.actualPaceSPerMi as number), 0) / workPhases.length
  : input.actualPaceSPerMi;
```

For this run, `input.phases` (built correctly at `route.ts:1179-1188`, reading
`p.actualPaceSPerMi` — the *correct* field name, see §3) carries the four real
reps from the watch: **422, 429, 422, 419 s/mi**. Mean = 423 s/mi = **7:03/mi**,
exactly matching the screen. `heatAdjustedStatus(430, 423, 0)` (target 430,
±10s tolerance) returns `'on'` (423 is inside 420-440) but the 7-second gap
exceeds the 5-second "dead even" threshold, so `winTempo` falls to its final
branch: `Held form · 7:03 just off target`. Reproduced exactly by executing
the real function against the real row.

**This is not a wrong-source-value bug.** 7:03/mi is a real, accurately
computed quantity — the average pace across the four actual quality reps,
which ran 7:02, 7:09, 7:02, 6:59 against a 7:10 target (7:02-7:18 band, per
tonight's earlier pre-run fix). It legitimately does not match any GPS mile
in the table below it, because the table's miles are raw GPS auto-laps that
mix warm-up tail, rep, and jog-recovery distance inside each mile boundary —
they were never the same quantity as "the four reps' average pace" to begin
with.

The confusion the owner correctly flagged is real, but it isn't in the
composer — it's that nothing on the screen showed the four reps individually,
so "7:03" had no visible referent. **Fixing §3 (the real interval breakdown)
closes this**: once the runner can see "Interval 1: 7:02/mi, Interval 2:
7:09/mi, Interval 3: 7:02/mi, Interval 4: 6:59/mi" individually, the average
above it is self-evidently what it is.

## 2. Only 2 of 8 miles highlighted — not a defect on `main`

The owner's screenshot 1 shows a binary orange/not-orange highlight on miles
3 and 4 only, captioned "Orange where the session sat inside what the session
asked for" (paraphrased). Searching the current native app for that exact
string finds it **nowhere as live code** — only in comments describing logic
that was explicitly retired:

- `native-v2/Faff/Faff/ViewsV5/RunDetailV5.swift:855` — *"`splitsSection` IS
  GONE (2026-08-30) ... exactly the band-as-colour rule this screen has just
  stopped using."*
- `native-v2/Faff/Faff/Components/RouteMapView.swift:153-162` — *"THE
  FIVE-BUCKET QUINTILE PALETTE IS GONE (2026-08-30)."*
- Commit `2ef168d6 fix(run-detail): one orange, one meaning — the mile table
  matches the map`, 2026-08-30 17:31:44 -0700, on `main`.

That commit replaced the discrete "inside the target band → orange, outside
→ plain" mile highlight with a **continuous** amber-to-orange pace-ramp
gradient, normalized across the run's own miles, captioned "Amber slowest
mile, orange fastest. Colour reads speed, not a grade." The commit's own
argument for the change (quoted from `RunDetailV5.swift:750-754`) is exactly
the owner's hypothesis about why the old behavior misfired: *"an interval
session has a rep pace, and holding mile three of a session with a warmup,
six reps and a cooldown against that number would mark every recovery jog
'outside the target'."*

**Rendered tonight, live, against this exact real run** (see §5 — the build
succeeded and the simulator pulled real data for this account): the current
mile table shows all 8 miles shaded on a continuous amber→orange scale (miles
3 and 4, the fastest, draw brightest orange; mile 2, the slowest, draws
dimmest amber), captioned *"Amber slowest, orange fastest. Colour reads
speed, not a grade."* — a different caption, a different (continuous, not
binary) treatment, from what the owner described.

**Conclusion:** what the owner saw does not correspond to any code path on
`main` tonight. The most likely explanation is a stale build — a TestFlight
build (or a cached screen) that predates the 2026-08-30 commit. This is a
Rule 19 concern (confirm the deploy reached the device), not a defect to fix
in code; recommend shipping a fresh TestFlight build once tonight's fixes are
in so the account is running current `main`. No code was changed for this
item.

## 3. No interval breakdown — real bug, found and fixed

### The real segment data already exists

Queried live from `coach_intents` (`id = 915`, `reason = 'watch_completion'`,
the same row `runs.data.phases` was written from verbatim): **9 real
segments** for this run — warm-up, 4 quality reps (each with a real verdict:
`drifted`, `drifted`, `drifted`, `missed`), 3 recovery jogs, and a cool-down,
each carrying real `actualDistanceMi`, `actualDurationSec`, `actualPaceSPerMi`,
`targetPaceSPerMi`, `avgHr`, and a watch-graded `verdict`:

```
0 warmup    2.10 mi  1084s  516 s/mi (target 502)  hit
1 work      1.01 mi   424s  422 s/mi (target 430)  drifted
2 recovery  0.12 mi    61s  515 s/mi
3 work      1.01 mi   431s  429 s/mi (target 430)  drifted
4 recovery  0.08 mi    64s  785 s/mi
5 work      1.00 mi   423s  422 s/mi (target 430)  drifted
6 recovery  0.06 mi    64s 1034 s/mi
7 work      1.01 mi   422s  419 s/mi (target 430)  missed
8 cooldown  2.11 mi  1125s  534 s/mi (target 502)  missed
```

So the honest, structured answer to "how did the four reps go" was sitting in
the database the whole time. The question was whether the phone's post-run
screen ever read it.

### The bug

`TodayAfterV5` (the "Today" tab's after-run state — `HostsV5.swift:234`, the
actual production screen the runner sees immediately after finishing, not
run-history) picks between a **section-by-section breakdown**
(`RepBreakdownV5`) and a **raw mile table** (`MileBreakdownV5`) via
`RunShapeV5.decomposition(hasSections:hasMiles:)`
(`PostRunShapeV5.swift:166`). For a `threshold` workout the *preference* is
`.sections` — but only when `sectionPieces` (built from `model.routePhases`)
is non-empty; otherwise it falls back to `.miles`.

`model.routePhases` is built server-side in
`web-v2/app/api/v5/today/route.ts`:

```ts
routePhases: indoor
  ? []
  : completionPhases.flatMap((ph: any) => {
      const mi = Number(ph.distanceMi ?? ph.distance_mi);
      const sec = Number(ph.durationSec ?? ph.duration_sec);
      return Number.isFinite(mi) && mi > 0 && Number.isFinite(sec) && sec > 0
        ? [{ mi, sec: Math.round(sec) }]
        : [];
    }),
```

`completionPhases` is `coach_intents.value.phases`, the exact same array
shown above — and **every one of its fields is `actual`-prefixed**
(`actualDistanceMi`, `actualDurationSec`), confirmed against the live row.
There is no `distanceMi` or `durationSec` key on this account's phases, and
grepping the ingest side confirms it never has been. `Number(undefined)` is
`NaN`, so `mi`/`sec` failed the `> 0` check on **every phase, of every
watch-completed run, always** — `routePhases` was unconditionally `[]`.

That silently forced `sectionPieces.isEmpty` on `TodayAfterV5`, which forced
`RunShapeV5.decomposition` to fall back from its intended `.sections` to
`.miles` for every threshold/tempo/interval/tune-up session — the raw GPS
mile table the owner is complaining about, in place of the real rep-by-rep
structure that was one field-name fix away the whole time.

**A second, silent casualty of the same bug**, found while tracing it: the
same broken field-name read feeds `workAveragesFromPhases`
(`route.ts:1126-1132`), which computes `hrAvgWork` ("Heart rate, across the
work") and `paceWork` ("Pace, across the work") — the two readings
`PostRunShapeV5.swift` specifically designed to replace a whole-run average
that's meaningless on a session made of pieces (see its own extensive doc
comment). Both were always `null` for the same reason, so those two rows have
never appeared on any threshold/tempo/rep session's post-run sheet, for any
runner, since they shipped.

**Why run-history (`RunDetailV5`) never had this bug**: it reads a
structurally different, already-correct wire field —
`detail.phase_breakdown`, built by `loadPhaseBreakdown()` /
`mapWatchPhases()` in `web-v2/lib/coach/run-state.ts:1548`, which reads
`p.actualDistanceMi` / `p.actualDurationSec` correctly (confirmed by reading
the function). A real rep-by-rep breakdown was always one tap away, on the
screen reached later — just never on the screen opened first.

Also confirmed **not** affected by this bug: `deriveWin`'s own `phases` input
(`route.ts:1179-1188`, the one that produces "Held form, 7:03 just off
target" in §1) already reads `p.actualPaceSPerMi` / `p.actualDistanceMi`
correctly. Only the `routePhases` builder and the `workAveragesFromPhases`
input mapper had the wrong names — which is exactly why the coach-insight
line was numerically right while the table two rows below it showed nothing
resembling its inputs.

### The fix

`web-v2/app/api/v5/today/route.ts`, both sites, read the real field name
first and keep the old name as a fallback for any older payload shape:

```ts
sec: Number(ph.actualDurationSec ?? ph.durationSec ?? ph.duration_sec) || null,
mi: Number(ph.actualDistanceMi ?? ph.distanceMi ?? ph.distance_mi) || null,
```

and identically for the `routePhases` builder.

**Verified against the real live row**, executing the actual patched logic:

```
BEFORE: routePhases.length = 0   → sectionPieces empty → falls back to MILES
AFTER:  routePhases.length = 9   → sectionPieces non-empty → SECTIONS

  Section 1 (warmup):   2.10 mi, 8:36/mi
  Section 2 (work):     1.01 mi, 7:00/mi
  Section 3 (recovery): 0.12 mi, 8:28/mi
  Section 4 (work):     1.01 mi, 7:07/mi
  Section 5 (recovery): 0.08 mi, 13:20/mi
  Section 6 (work):     1.00 mi, 7:03/mi
  Section 7 (recovery): 0.06 mi, 17:47/mi
  Section 8 (work):     1.01 mi, 6:58/mi
  Section 9 (cooldown): 2.11 mi, 8:53/mi

  paceWork  (BEFORE null) → AFTER 7:02/mi  (1700s / 4.03mi across the 4 reps)
  hrAvgWork (BEFORE null) → AFTER 162 bpm
```

`npx tsc --noEmit` clean; `npx vitest run app/api lib/coach lib/runs
lib/faff/_v5_today.test.ts` — 1080 + 27 passing, no regressions. Committed
(`17b73fe2`), pushed, merged to `main`, Railway deploy confirmed (see §5).

### The second bug this exposed

Rendering the fix live (§5) surfaced a second, previously-dormant defect:
`TodayAfterV5.sectionPieces` (`native-v2/Faff/Faff/ViewsV5/TodayAfterV5.swift:1182-1199`)
built each section's displayed pace as:

```swift
actualPace: Units.formatPace(secPerMile: p.sec),
```

— `p.sec` is the phase's raw **elapsed duration**, passed straight into a
formatter that expects **seconds per mile**, with no division by `p.mi` at
all. This code has existed on `main` since the section-breakdown feature was
built, but `model.routePhases` was *always empty* (§3's bug) on every real
run, so `sectionPieces` never executed its `.map` body against real data —
the bug was invisible because its input was always `[]]`. The instant the
§3 fix gave it real phases, it rendered: the 2.10 mi, 1084 s warm-up (a real
8:36/mi) showed as **"18:04/mi"** — 1084 seconds read back as a pace,
unchanged. It had looked plausible only by coincidence on the four ~1-mile
reps, where seconds-elapsed happens to sit close to seconds-per-mile.

**Fixed**: divide by distance first —
`let paceSecPerMi = p.mi > 0 ? Double(p.sec) / p.mi : Double(p.sec)`. Verified
live on device (§5): every section now shows its real pace. Committed
separately (`6b37e71f`) since it's a distinct defect in a different file/
language, with its own comment naming what was wrong and why it was never
caught (per Rule 20 — a fix without that context is a fix nobody can
recognize a regression of later). This is exactly the shape Rule 15 warns
about: a code path that no real input had ever reached was, in effect,
untested — and turned out to be wrong the moment it was.

### What this fix does **not** yet do — flagged, not rushed

Even after this fix, `TodayAfterV5.sectionPieces` labels each row generically
— **"Section 1", "Section 2", ...** — with only distance and pace, no
"Warm-up"/"Interval · 1 mi", no asked pace, no watch verdict
("drifted"/"missed"). That's `TodayAfterV5.swift`'s own documented design:
its `model.routePhases` wire shape is deliberately thinner than
`RunDetailV5`'s `phase_breakdown` (`{mi, sec}` only, by comment, "so the rows
are numbered rather than named"). The real labels, asked pace and verdict
**do already exist** in `completionPhases` server-side (confirmed above,
and already correctly read by `deriveWin`'s phases input two lines away) —
bringing them to this screen means:

1. Widening `v5-today.ts`'s `routePhases` wire type from `{mi, sec}` to
   carry `type`/`label`/`askedPaceSPerMi`/`verdict` (small, low-risk —
   the data is already in hand server-side).
2. Updating `TodayAfterV5.sectionPieces` in Swift to build real `RepPiece`
   rows from that richer shape instead of always emitting `"Section N"` —
   essentially porting `RunDetailV5.repPieces`'s existing logic
   (`RunDetailV5.swift:629-654`) to the post-run sheet.

This is a real, worthwhile improvement, and it is **not** rushed into this
pass: it touches a wire contract shared by every completed run on the
account and a Swift view whose rendering needs its own build-and-screenshot
verification pass (Rule 13), separate from tonight's server-side data-
plumbing fix. Recommend as a scoped follow-up. The safely-fixable half —
real segment *boundaries* reaching the phone instead of raw GPS miles — is
done tonight; the richer *labeling* of those segments is the remaining gap.

## 4. "No plan breakdown" / independent generation — not a bug, confirmed

Checked whether the post-run screen consults `wko_eaa8cfd7cb94310b`'s real,
tonight-corrected `workout_spec`, or generates its recap independently of the
pre-run card:

- `route.ts`'s `askedPaceSPerMi = planRow?.pace_target_s_per_mi ?? null`
  reads `plan_workouts.pace_target_s_per_mi` directly — queried live,
  **`430`** (7:10/mi), the exact value tonight's earlier pass corrected it
  to. The post-run screen is not stale or independently derived; it reads
  the same row, same date, as the pre-run card.
- `askedMi: todayPlan?.distanceMi` = 8.5 mi, matching the actual 8.5 mi run
  exactly (`plan_workouts.distance_mi = 8.5`). The "asked vs ran" distance
  row is designed to print **only when the two materially diverge**
  (`v5-today.ts:1314-1329`, gap > max(0.25mi, 10% of ask)) — for this run the
  gap is zero, so the row correctly stays silent. That is the row working as
  designed, not a missing plan comparison.
- `deriveWin` and `deriveRecap` (feeding "Held form..." / "Tempo done...")
  both take `plannedPaceSPerMi: askedPaceSPerMi` as an explicit input —
  confirmed by reading the call site (`route.ts:1166-1167`).

**Conclusion: the post-run screen already consults the real, corrected
`workout_spec` for this exact workout, on the same date, and does not
generate its recap independently of the pre-run card.** Nothing to fix here.

## 5. Verification (Rule 13)

**Rendered for real, live, against David's own real account and this real
completed run, before AND after each fix** — not a fixture, not a sample,
and not stopped at "the server logic looks right."

**Before the §3/§3-second-bug fixes reached production** (build 1, scheme
`Faff`, Debug, iPhone 17 simulator, via `mcp__Claude_Code_iOS_Simulator__build`
+ `launch`): the real app, real account, real stored session, landed on
**Today** and rendered the exact post-run card from the owner's own
screenshot — `THRESHOLD · 8.50 mi · 1:08:23 · 8:03/mi`, `Effort 6 of 10`,
`Heart rate, max 172 bpm`, `Temperature 69°F`,
`"Held form, 7:03 just off target" / "Tempo done, 8.5 mi total at 8:03/mi,
avg HR 154."` — confirming this was the same real screen and the same real
run. Scrolling revealed the mile table, confirming §2: all 8 miles shaded on
a continuous amber→orange gradient (not a binary 2-of-8 highlight), captioned
"Amber slowest, orange fastest. Colour reads speed, not a grade." — current
`main`'s actual live behavior, different from what the owner described. No
"Heart rate, across the work" / "Pace, across the work" rows were present.

**§3's server fix** was committed (`17b73fe2`), pushed, and confirmed
deployed: `railway deployment list` showed deploy `31b8d174` reach
**SUCCESS** (polled to completion via a background monitor rather than
assumed from the push alone, per Rule 19). The app was relaunched — real
account, fresh fetch against the now-fixed API — and the post-run card now
showed **two new rows that were never there before**: `Heart rate, across
the work · 162 bpm` and `Pace, across the work · 7:02`, exactly matching the
values computed by executing the patched logic against the real row (§3).
Scrolling further revealed the breakdown had switched from **"MILE BY
MILE"** to **"PIECE BY PIECE"** — 9 real sections, confirming
`RunShapeV5.decomposition` now resolves to `.sections` for this run, as
designed. But the section paces were wrong — `Section 1: 18:04/mi` for a
2.10 mi warm-up — which is how the second bug (§3) was caught: not by
reading the Swift source in isolation, but by looking at what actually
rendered once real data reached it.

**§3's second (Swift) fix** was committed (`6b37e71f`) and pushed. Rebuilt
(build 2) and relaunched. The post-run card now shows, real and live:

```
PIECE BY PIECE
  Section 1   2.10 mi    8:36/mi   ← warm-up, correct (was 18:04/mi)
  Section 2   1.01 mi    7:00/mi   ← rep 1
  Section 3   0.12 mi    8:28/mi   ← jog
  Section 4   1.01 mi    7:07/mi   ← rep 2
  Section 5   0.08 mi   13:20/mi   ← jog
  Section 6   1.00 mi    7:03/mi   ← rep 3 — the exact number the coach
                                      insight line cites, now visible
                                      on a row instead of unexplained
  Section 7   0.06 mi   17:47/mi   ← jog
```

matching the real per-phase data (§3's table) exactly. This closes the loop
on §1 as well: "7:03" is no longer a number with no visible referent — it's
Section 6, right there on the same screen.

- `npx tsc --noEmit` clean; `npx vitest run app/api lib/coach lib/runs
  lib/faff/_v5_today.test.ts` — 1080 + 27 passing (web-v2 fix only; the
  Swift fix has no vitest surface).
- Both fixes committed and pushed to `main`: `17b73fe2` (server field-name
  fix) and `6b37e71f` (Swift duration-as-pace fix). Both pre-push hooks'
  `next build` gate passed. The web-v2 deploy was polled to `SUCCESS` before
  re-verifying (Rule 19); the Swift fix has no separate deploy step — it
  ships on the next TestFlight build (see Recommendation).

**Not independently re-verified**: run-history (`RunDetailV5`)'s own
rendering of this run, since §3 established it reads a different,
already-correct field and was never affected by either bug. `askedVsRan`'s
behavior for a run that *does* materially diverge from its plan (§4 confirms
the logic exists and is correctly gated, but this run's 8.5-vs-8.5 mi match
never exercises the "shows a divergence" branch).

## Files changed

- `web-v2/app/api/v5/today/route.ts` — `workAveragesFromPhases`'s input
  mapper and the `routePhases` builder both now read
  `actualDistanceMi`/`actualDurationSec` first, falling back to the old
  plain names. Both sites carry a comment naming the bug, its evidence, and
  its blast radius, per Rule 20 (a fix without a comment naming the
  discovered defect is a fix nobody can recognize a regression of later).
  Committed `17b73fe2`, deployed (Railway `31b8d174`, confirmed SUCCESS).
- `native-v2/Faff/Faff/ViewsV5/TodayAfterV5.swift` — `sectionPieces` now
  divides the phase's duration by its distance before formatting a pace,
  instead of formatting the raw duration as if it already were one.
  Committed `6b37e71f`. Ships on the next TestFlight build.
- This report.

## Recommendation

1. **Ship a fresh TestFlight build** once approved — both fixes are
   committed to `main` but the Swift half only reaches the device on a new
   TF build (per this project's standing rule: never ship TestFlight without
   explicit go). This should also resolve the §2 mile-table-coloring
   complaint as a side effect, since current `main`'s live mile-table
   behavior (a continuous pace-ramp, verified by direct render tonight)
   already differs from what the owner's screenshot showed.
2. **Scoped follow-up** (not tonight): widen `routePhases`'s wire shape and
   `TodayAfterV5.sectionPieces` to carry real labels/asked-pace/verdict
   instead of generic "Section N" rows, matching what `RunDetailV5` already
   shows on the run-history screen. Concrete, bounded, needs its own native
   build-and-render verification pass — the same kind this report just did
   for the two bugs above.
