# Handback · round 4 — live incidents, since the consolidated report

3 September 2026 · continuing directly from the round-3 consolidated handback (rebuild,
adaptation proof, TestFlight 252). Everything below happened while you were actively trying to
run today's session, in the order it happened. Everything is on `main`, deployed, unless marked
otherwise.

## 1 · A friend's run was rendered as your prescribed workout

You started an easy run with a friend from Apple Workouts — not the Faff app — and Today showed
it as `INTERVALS, done`, over a hill-repeat session you hadn't gone out to run yet. Your words:
"I like that it brought it in but the run I did was just some easy miles with a friend and not
meant to replace this workout."

**Root cause, read from the code, not guessed:** three separate "pick today's run" queries
(the Today poster, the watch face, the run-detail load — the third's own comment already cited
the first as sharing its pick) all ordered candidates by literally the biggest distance logged
that day. No check that the run corresponds to the day's prescription at all. Your friend's
4.48mi easy run was simply the only run on the date, so it won by default.

**Fix:** prefer the run actually recorded AS an execution of today's plan
(`plannedWorkoutType`, stamped by the one endpoint both the phone's live tracker and the watch
companion post completions to) over merely the day's largest run. Applied at all three sites.
Two things you asked for were already true and I verified rather than assumed: week/day totals
already sum every run on a date, not just the selected one; the full run log already lists every
run, not deduped per day. Neither needed a change.

**Falsified per Rule 18** against the exact shape that broke — a smaller tracked workout against
a larger untracked run, the case the old logic got backwards. Old query picks the untracked run;
new query correctly picks the tracked one. Deployed and confirmed before you went to run.

## 2 · Merging it surfaced three unrelated, real findings

`main` had moved (the week-strip session's own work landed while I worked). Merging against it
surfaced three genuine, unrelated defects, all closed the same pass:

- A comment in `week-loader.ts` contained the literal text `/**` inside a `//` line (talking
  about a glob path, `app/api/**`) — this fooled a test's naive comment-stripping regex into
  treating it as a block-comment open, silently eating 5.6KB of real code — including the exact
  SQL clause that test was supposed to be checking — as "comment." Reworded the comment.
- Two stale exemptions in the cross-surface contract registry, both describing defects specific
  to the plan authored 2026-08-31 — which predated fixes that had already landed in code by the
  time tonight's rebuild authored a fresh one. Confirmed each entry's own stated closing
  condition was met live (not assumed from the rebuild alone), then deleted both, per Rule 18.
- The rebuilt plan itself was missing an audit stamp (`pace_recompute.anchors`) that a separate,
  later-scheduled process normally adds — a real, expected timing gap, not a rebuild defect.
  Ran that process directly rather than waiting for its schedule (Rule 23): 72 workouts and 4
  race rows refreshed at your own unchanged anchor, one day correctly skipped because it was
  already sealed, all 8 historically-completed days re-verified byte-identical afterward.

## 3 · The treadmill session "didn't load" — the real reason, and a fast fix

You started the actual prescribed workout on the treadmill and it opened flat — no hill
structure, no incline. Not a fetch failure: `LiveRunTreadmillV5`'s belt-speed default only knows
how to read a pace target, and hill reps deliberately carry none (outdoor grade varies too much
for a flat pace number to mean anything — the same thing we discussed earlier tonight about the
HR-only hill card). On a treadmill the grade IS fixed, so a pace+incline pair is meaningful
again, but nothing was computing one — it silently fell back to a flat 8.0mph.

You asked me to build the real fix now rather than wait. Built and shipped:

- **Server** (`build-workout.ts`): for a work phase the phase's own label names as a hill rep
  and that carries no pace target, computes a **5% incline** (`Research/04` §8.3, the doctrine
  table's own 4-6% band for medium hill repeats, its midpoint) and the belt speed that
  reproduces your "5K-10K effort" band (the midpoint of your threshold and interval pace
  anchors) at that grade — using the same treadmill grade math the app already uses to judge
  completed runs, not a new formula. Verified against your real account before touching any
  Swift: your actual session computes **5% incline, 7.7mph (7:46/mi graded)** — a sane number for
  a hard hill effort.
- **Client**: the phone's watch-payload model gains the two new fields (additive — an older
  build ignores them and keeps working exactly as before); the treadmill screen's speed and
  incline defaults read them when present, falling back to the old flat defaults only when
  they're absent (a genuinely paced session, or an effort phase that isn't a hill rep).
- Verified both the phone and watch targets build clean, and the full watch gate (223/223 test
  cases) passes.

**Status: server change is deployed and live now.** The client half needs the new build your
currently-installed app doesn't have yet — **TestFlight build 255 is shipping as this document
is written**; check TestFlight in a few minutes.

## 4 · The friend's run — excluded, reversibly

Separately, while diagnosing the treadmill issue, you asked me to remove the extra run (not the
prescribed workout, which you asked me to keep). This codebase has no delete endpoint for a run
by design — nothing here ever destroys a runner's logged activity. Used the same mechanism the
app's own dedup system already uses: marked the run excluded (`mergedIntoId`, plus a written
reason) rather than deleting it. It no longer counts toward anything or seals the day; it still
exists in the database and is fully reversible by removing those two keys, if you ever want it
back.

## 5 · What's still open

- **A multi-run day's UI.** You asked how a day with two runs should read: prescribed workout
  still the hero, the extra run shown as a smaller entry below it. That's not built — Today's API
  currently returns only the one selected run. Real but small: backend needs to also return the
  day's other run(s), native needs a secondary-row treatment under the hero. Not started; your
  call on when.
- **TestFlight build 255** — confirm it lands and shows the real incline/speed once installed.
- Everything from the round-3 consolidated handback that was still open remains open: post-run
  experience integration (its own session says not ready), the canonical Adaptation Engine's
  production-data replay (blocked on making plan selection date-aware, not yet built), ranked
  Sunday reschedule options' UI half.

Nothing here was assumed. Every claim traces to a command actually run or a file actually read.
