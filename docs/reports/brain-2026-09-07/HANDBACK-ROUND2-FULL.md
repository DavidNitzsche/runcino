# Handback — round 2, full detail, 2026-09-07 evening

Follows `HANDBACK-FINAL.md` (round 14) and `HANDBACK-ADDENDUM-2.md` in this
same directory. This one covers everything since: the week-strip date defect
and its full falsification, a live production incident (two real, separate
bugs found and fixed from your own device's evidence, not guesses), and a
rigorous re-examination of the organic PUSH proof. Every commit below is on
`origin/main`. Every Railway deployment is confirmed `SUCCESS` on the exact
commit named. TestFlight build 290 is confirmed distributed to Internal
Testing.

---

## Part 1 — the week-strip date defect: root cause, fix, full falsification

**Root cause, traced to the exact line.** `HostsV5.snapshotWeekStripDays`
computed the displayed day-of-month via `Calendar.current` — the device's
real timezone. Every `date_iso` this app carries is a bare `yyyy-MM-dd`
civil date with no time component; `Self.iso` already parses/formats every
one as a fixed UTC-midnight anchor purely for arithmetic. Reading a `.day`
component off that anchor through a negative-UTC-offset calendar (Pacific,
every device this ships to) lands on the PREVIOUS civil day. The ISO
string still round-tripped correctly — the day's own content opened
correctly — but the displayed number read one day early. Confirmed live via
a temporary debug log against the real walk-substrate before touching the
fix: `moved=2026-09-14 number=13`, byte-for-byte the defect you saw.

**Fix.** One canonical `Self.utcCalendar` (matching `Self.iso`'s own
timezone), used for every Calendar operation in the function — not a ±1
patch, the opposite: total elimination of any local-timezone dependence
from date-only string arithmetic.

**A second, related defect found while re-verifying.** Landing on a
calendar-jumped day (e.g. Mon 14 via the calendar sheet) and then tapping a
*different* day in that same week's own strip (e.g. Sun 20) did nothing.
`inSharedShell`'s header passed `day.id` alone to the picker; a
snapshot-reconstructed row's id (a plan_workout row id, not date-embedded)
cannot be found in `model.weekStrip`. Same fix as the calendar sheet's own
`day.dateISO ?? day.id`.

**Falsification — algorithmic (32 combinations).** A standalone harness
running the exact fixed formula was run under `TZ=America/Los_Angeles`,
`TZ=UTC`, `TZ=Pacific/Kiritimati` (UTC+14), `TZ=Asia/Kathmandu` (UTC+5:45),
across: current/future/previous week, a Sun–Mon boundary, a month boundary,
a year boundary, both 2026 US DST transitions. All 32 identical regardless
of device TZ. The unfixed formula was run through the same harness and
reproduces the exact on-device symptom under any negative-UTC-offset zone,
passing only under UTC — proving both that the harness can see the defect
and that the fix removes it.

**Falsification — physical, on the walk-substrate (real copied production
data, not a fixture):**
- Future week: landed on Mon 14 → strip reads M14–S20, hero shows Easy ·
  4.5mi, matching exactly.
- Previous week: landed on Thu 27 (Aug) via the calendar's past-week
  scroll → strip reads M24–S30, matching exactly, including a real
  supplemental-run day ("Also logged 3.14 mi").
- Calendar-jump-then-strip-tap: from Mon 14, tapped Sun 20 in the same
  strip → correctly opened "LONG · 16.5 mi" (previously did nothing).

Commits: `e6cae7a93` (fix), `b9ee5ac0c` (TestFlight 289 ship, source commit
`1517abe47`).

---

## Part 2 — the live incident: two real, separate bugs, found from evidence

You reported the "Can't reach faff" banner recurring, and a real run not
showing up, and told me — correctly — to stop guessing and check the
evidence. Here's what the evidence actually showed, in the order it broke.

### 2a. Your run genuinely was server-side, correctly resolved

Ran the exact production code (`resolveDayExecutions`, `loadGlanceState`)
live against your real data, twice, at different times, byte-identical
both times: your 5.01mi run resolves as a supplemental run on a rest day,
`doneMi=5`, `ranToday=true`. The backend was never wrong. Reproduced the
full scenario physically on the simulator with a copy of your real run row
in a scratch database and the real client code: it renders correctly —
"REST · 5.01 mi · 39:29 · 7:53/mi", "Also today: 5 easy — not part of
today's session", "Coach's read: Run recorded — no session structure to
grade it against", "Plan unchanged." So the rendering path is correct
end-to-end when the fetch actually completes. The problem was the fetch
not completing on your device — which is Part 2c.

### 2b. Deploy-gap: every fix I shipped was itself causing an outage

The service ran a single Railway replica with no `healthcheckPath` and no
`overlapSeconds`. Every deploy was a hard swap — Railway killed the old
container before or as the new one came up, with a real gap where nothing
was listening. Checked the exact timestamps: my deploys landed at ~1:46pm
and ~2:03pm — directly on top of your 1:49pm and 2:03pm/2:09pm reports.
Every attempted fix that afternoon was generating a fresh instance of the
exact symptom it shipped to resolve.

**Fix:** added `GET /api/up`, a deliberately trivial liveness probe (no DB,
no auth), and wired it as `healthcheckPath` in both `railway.json` files
with a 30s check timeout and 20s `overlapSeconds`. A new deploy must now
prove it's accepting connections before the old one is retired.

Commit `7ba221a0b`. Railway `SUCCESS`. `/api/up` confirmed live
(`http=200`, ~0.15s).

### 2c. The real, confirmed cause: duplicate concurrent requests

You opened the hidden request-log screen (Settings → 7 taps on the version
footer) and that's what actually broke this open. It showed, at one
generation tick, **two separate `/api/v5/plan-snapshot` requests in flight
at the same moment** (#64 and #67), each independently taking 5.3–6.8
seconds against production. `syncPlanSnapshot()` has five independent
callers — launch, foreground, explicit Retry, pull-to-refresh, a plan
mutation — and had **no coordination between them at all**. Every caller
unconditionally started a new fetch no matter how many were already
running. Two overlapping requests for the identical block don't answer any
question the first wasn't already going to answer; they only compete for
the same DB connections and CPU, making each other slower, on the single
heaviest read every launch and foreground depends on. This is "timeout
caused by request duplication," the exact category you asked me to check
for, now with direct log evidence instead of a guess.

**Fix:** single-flight coalescing. `syncPlanSnapshot()` now checks for an
already-running task and awaits *that one* instead of starting a sibling.
Safe without a lock — the host is `@MainActor` and the check-then-store has
no `await` between them, so no caller can ever observe the slot empty and
race another into filling it.

Commit `0dce24f23`. Build succeeded, physically re-verified on the
simulator with real data (the rest-day recap screenshot above came from
this exact build). TestFlight build 290 shipped: commit `b6bf7c314`
(the `.asc.build` counter), Railway `SUCCESS`, build 290 **VALID,
export-compliant, distributed to Internal Testers** — confirmed from the
ship script's own output, not assumed.

**Honest limits of this diagnosis.** The duplication is real, confirmed,
and fixed. It plausibly explains the pattern you described (clears on
navigation, recurs "after a bit") — a slow, contended fetch timing out
while a later uncontended one succeeds fits exactly. I do not have a log
entry showing the literal failing request's outcome (timeout / transport
error) — your screenshots showed successes and benign cancellations in the
visible window, not the failure itself. If the banner recurs on 290, the
request log is the next thing to read, specifically for a `timeout` or
`transport:` line rather than another `OK 200`.

**Also found, not yet acted on:** plan-snapshot's own baseline latency is
high even uncontended — 5–7 seconds for a single, non-duplicated request,
observed repeatedly. The single-flight fix stops it from being asked for
twice at once; it does not make the one real request faster. Worth a
follow-up in its own right (this file's Part 4 below revisits it).

---

## Part 3 — orchestration Step 3 / 16-of-16, re-confirmed against current main

`WIRED_STEP_PIN = 16` in `lib/brain/orchestration/steps.ts`, and
`_orchestration.test.ts` passes (9/9) against the real import graph on
current `main` — not carried over from an earlier session's claim.

**Falsified per Rule 18, live, this session:** bumped the pin to 17,
re-ran — the test correctly reports "16 steps are WIRED against a pin of
17" and fails. Restored the pin, re-ran — 9/9 pass again, git diff clean.
This proves the count is computed from the real graph, not a rubber stamp,
and that it is genuinely 16 right now.

---

## Part 4 — the organic PUSH proof: 1/12, and a precise reason why, not a vague one

Ran the real 12-proof harness (`_organic_push_proofs.script.ts`) against
the scratch database (`faff_push_walk`), unmodified except for one thing:
I extended its `runs` table with your **real** training data through
2026-09-04 (it was missing Sept 1–4, and had nothing past Sept 4 at all —
a straight copy from `DATABASE_URL_RO`, nothing fabricated). Result: still
1/12. Confidence moved from 35.8% to 36.6% — real, but nowhere near enough.

**This sent me to find out why, precisely, rather than try another patch.**
The candidate step `raiseOrganically()` evaluates is a 16.1% single-week
demand rise (dated 2026-08-31). `lib/plan/adjudication/rolling-boundary.ts`
computes confidence for a demand step as a doctrine-cited, Rule-9-continuous
logistic: ~0.85 confidence at 10% growth, ~0.5 at 12.5% (the band's own
midpoint), ~0.15 at 15%, asymptotic toward 0 beyond it. At 16.1% growth the
bare (context-free) confidence is **~7.6%**. Athlete context can recover
some of that — but the recovery is explicitly, deliberately capped at
`CONTEXT_MAX_RECOVERY = 0.45`, and the code's own comment states the reason
in so many words: *"capping that below the PUSH floor means even PERFECT
context can never wave an arbitrarily large step through on its own."*
Working the actual numbers: **even with a perfect context score of 1.0, the
maximum reachable confidence for this exact step is ≈49.2% — mathematically
short of the 50% floor, by design.**

**What this means, plainly:** for the specific candidate the walk currently
lands on, an organic PUSH is not "not yet earned" — it is *structurally
unreachable*, on purpose, because a 16%+ single-step demand jump is
doctrine-classified as too large to autonomously clear no matter how strong
the supporting evidence is. This is not the ORGANICPUSH-1 bug (that one
silently killed the whole mechanism; this one is the mechanism correctly
refusing a candidate it was built to refuse). Adding more real data cannot
close this gap — the ceiling is fixed by the step size alone.

**What would actually close this proof honestly:** a real point in your
training history — past or, more likely, future, once it exists — where
the trailing-three-week baseline step is smaller (the logistic only leaves
room to earn PROCEED below roughly 12–13% growth). I have not gone looking
for such a week in your full history; that's a real next step, but it is a
*scope decision* (which real week to anchor the proof to) rather than an
engineering one, and I did not want to make that call unilaterally by
picking whichever week made the number come out the way I wanted.

**Standing status, precise:** 1/12 closed end-to-end (PROOF 11, restart).
10/12 blocked on the confidence-ceiling fact above. 1/12 (PROOF 12, plan
rebuild) blocked on the separate, already-documented composer defect (a
generator bug producing a zero-quality cutback week), spun off earlier
this week. **I did not manufacture a pass by loosening the confidence
math, and I did not fabricate training data to force a smaller step.**

---

## Part 5 — migration checkpoint, re-verified live, zero drift

Re-ran the exact queries from `MIGRATION-PACKET-FINAL.md` against
production (`DATABASE_URL_RO`) at 2026-09-07T21:01Z:

- The four tables (`plan_decision_ledger`, `reassessment_schedule`,
  `plan_decision_outcome`, `runner_beliefs`) are still absent — confirmed
  live, zero rows returned.
- `plan_weeks`/`plan_phases` NULL-`user_uuid` backfill target: still
  **113 rows** (88 + 25), byte-identical to both the morning read and the
  original packet. New rows since then all landed with `user_uuid`
  populated — the code-side fix is still holding.
- `gen_random_uuid()` still works live, this exact moment, independent
  confirmation.

**No migration has been applied. No DDL or DML of any kind has touched
production.** Nothing here has changed since `MIGRATION-PACKET-FINAL.md`;
this is a live re-check, not a new decision. The packet is still waiting on
your explicit per-statement go — that has not changed and I have not acted
as though it has.

---

## Part 6 — everything else on the priority list: untouched, exactly as it stood

Per your own instruction to freeze adjacent fronts, and because the live
incident took priority once it started: belief-owner consolidation (9/12),
facet re-derivation, the Pa:HR proof matrix, native calorie-resync dry-run
preview, the remaining native/Watch acceptance/decline/mutation/
explanation/sync verification checklist, and the three rolling-boundary
re-proofs are **exactly where `HANDBACK-FINAL.md` left them.** None were
touched this round. Not rounding up, not implying progress that didn't
happen.

---

## Commits and deployment status, exact

| Commit | What | Verified |
|---|---|---|
| `e6cae7a93` | WKSTRIP-UTC-1 fix | Build succeeded, physically verified |
| `b9ee5ac0c` | TestFlight 289 ship | Build 289 VALID, distributed |
| `b3261d59e` | BANNER-LATENCY-1 (2.5s cap on race-outlook) | Railway SUCCESS |
| `1517abe47` | FINISHEST-1 point-value consistency fix | Railway SUCCESS |
| `7ba221a0b` | DEPLOY-GAP-1 (healthcheck + overlap) | Railway SUCCESS, `/api/up` live |
| `0dce24f23` | PLANSNAPSHOT-SINGLEFLIGHT-1 | Build succeeded, physically verified |
| `b6bf7c314` | TestFlight 290 ship | Build 290 VALID, distributed, Railway SUCCESS |

Current Railway production: commit `b6bf7c314`, status `SUCCESS`.
Current TestFlight: build 290, source commit `0dce24f23`, VALID and
distributed to Internal Testers.

## What's actually left, and what's blocking each

1. **Organic PUSH, 11 of 12** — blocked on a scope decision (which real
   week has an earnable-size demand step), not an engineering gap. Your
   call on how to proceed.
2. **Migration packet** — blocked on your explicit per-statement approval.
   Nothing else is blocking it; the packet is current as of tonight.
3. **Belief-owner consolidation, facets, Pa:HR matrix, native/Watch
   checklist, calorie-resync preview** — genuinely untouched, no new
   information this round.
4. **Plan-snapshot's own baseline latency** (5–7s uncontended) — a real,
   separate follow-up, not yet started.

If the banner or the missing-run symptom recurs on build 290, the request
log (Settings → 7 taps on the version footer) is the fastest way to tell
me exactly what failed, the way it did tonight.
