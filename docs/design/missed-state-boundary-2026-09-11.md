# Missed/skipped/moved state — the date boundary, timezone, and grace period

**2026-09-11 · Finding 3 (`docs/audit-2026-09-11-session-handback.md` §5).
Written before any implementation, per David's explicit instruction: "Do not
turn a workout into 'missed' at an arbitrary server-midnight boundary."**

This note states the decision and the reasoning. The implementation
(`web-v2/lib/execution/day-resolution.ts`) is the enforcement of exactly this
text — if the two ever disagree, this note is stale and should be corrected,
not silently overridden by the code.

## The three questions, answered

### 1. What timezone governs "this day has passed"?

**The runner's own device-reported timezone, via the existing canonical
resolver `lib/runtime/runner-tz.ts`'s `runnerToday(userUuid)` — reused, not
re-derived.**

This is not a new decision. `runnerToday()` already exists and is already the
app's one answer to "what day is it for this runner" — used by
`/api/v5/today`, `/api/plan/reschedule`, `/api/today/skip`, and
`week-loader.ts`'s own `is_past` flag. Rule 16 ("one quantity, one name") and
`docs/BRAIN_CONSTITUTION.md`'s "no side doors, no feature-specific overrides"
both forbid Finding 3 growing a second definition of "today" next to the one
the rest of the app already trusts. `profile.timezone` is auto-populated from
every watch/HealthKit/iPhone sync payload (TZ-08), so a runner who travels has
their "today" follow their phone, not a value fossilized at signup.

**Inherited limitation, stated rather than silently accepted:** because
`runnerToday()` reads `profile.timezone` at call time, a runner crossing
timezones mid-trip can see "today" jump discontinuously (a calendar day
repeated or skipped, matching how every other surface in the app already
behaves under the same resolver). This is not a new defect Finding 3
introduces or is responsible for fixing — re-deriving a travel-aware "today"
would be exactly the second-identity-path this task is explicitly told not to
build. If David wants a different travel policy, it changes `runnerToday()`
once, for every caller, not a Finding-3-specific carve-out.

### 2. What exact boundary marks a day as "past"?

**Calendar-date comparison in the runner's own timezone: `dateISO <
runnerToday(userUuid)`.** This is the same comparison `week-loader.ts`
already makes (`is_past: dISO < today`) and `/api/v5/today`'s own
`isSteppedDay` logic. A day is "past" the instant the runner's local calendar
turns over past it — not at UTC midnight, not at a server cron tick.

The boundary crossing itself is **not** what triggers a missed verdict — see
the grace period below. Crossing the boundary only makes a day *eligible* to
resolve as missed; it does not resolve it.

### 3. Is a grace period warranted, and how long?

**Yes. A past day is not eligible to resolve as `missed` or `supplemental`
until 6 hours past the start of the FOLLOWING runner-local calendar day** —
i.e. a day that turned over at local midnight stays in a neutral,
still-live-looking state until roughly 6am local the next morning.

**Why 6 hours, and why this is an engineering default, not a doctrine
citation.** No `Research/` doctrine sizes a completion-sync grace window —
this is a data-latency question, not a physiological one, so `lib/doctrine/
registry.ts` is the wrong home for it and this note is the citation instead.
The number is sized against the two real latency sources this app has:

- A run finished late at night, synced from Apple Watch/HealthKit in the
  background. HealthKit background delivery is not instantaneous and can lag
  behind an app that is not foregrounded — the exact "hasn't synced yet"
  case David named. Six hours covers an overnight window generously without
  making "missed" meaningless (a full day's grace would mean a workout never
  reads as missed until the SECOND day after it, which contradicts "week to
  week is what matters").
- A run that crosses local midnight (an 11:45pm start). `runnerToday()`
  already buckets a run by wall-clock day at write time
  (`lib/runs/run-shape.ts`'s day derivation), so this is a sync-latency
  concern, not a day-bucketing one — the run lands on the correct calendar
  day already; the grace period exists purely so the LABEL doesn't flip to
  "missed" and then flip back to "completed" a few minutes later in front of
  the runner.

**The grace period changes nothing about identity or matching.** It only
delays when the ABSENCE of a match is treated as meaningful. The moment a
qualifying run syncs — at any point, grace window or not — `day-resolver.ts`
picks it up on the next read and the day resolves as `completed` immediately.
A day is never "locked into missed" by anything in this design: `missed`,
`supplemental`, `moved` and `completed` are all **computed live on every
read**, never written as a persisted, sticky verdict. There is no batch job
that "marks" a day missed at some hour — the fact self-heals the instant
better data exists, and un-heals just as fast if a duplicate/merge changes
the picture. This is deliberate: a persisted "missed" stamp is exactly the
kind of frozen derived value Rule 10 warns about, and computing it fresh from
`day-resolver.ts` + `plan_reschedules` + `day_actions` avoids ever needing
one.

**What is NOT grace-gated.** `completed`, `moved`, and `skipped` are
affirmative facts about something the runner (or the coach engine) actually
did — a real run matched, a real reschedule decision, a real explicit skip
declaration. None of those wait on the grace window; they resolve the moment
they are true, including for a day that has not even happened yet (a runner
can mark a future day "I'm skipping this" or move a future workout today,
and that should show immediately, not wait for the day to lapse). The grace
period governs exactly one transition: silence read as `missed`/
`supplemental` rather than as a live, still-open prescription.

## The constant

```ts
// web-v2/lib/execution/day-resolution.ts
export const MISSED_GRACE_HOURS = 6;
```

Named, single-owner, easy to find and easy to argue with — exactly the
posture Rule 18 asks of anything that isn't a hard doctrine citation: this is
disclosed as a judgment call, not dressed up as a derived research number.

## Worked example

Runner-local timezone `America/Los_Angeles`. Thursday's prescribed threshold
run has no matching run, no skip, no reschedule.

| Wall-clock moment (local) | `dateISO` (Thursday) vs `runnerToday()` | Grace elapsed? | Resolution shown |
|---|---|---|---|
| Thursday 6pm | not yet past (`dateISO == today`) | n/a | none — still live, normal upcoming prescription |
| Friday 2am | past (`dateISO < today`) | No (< 6h past Fri 00:00) | none — still live, no missed badge yet |
| Friday 5:59am | past | No | none |
| Friday 6:01am | past | Yes | `missed` (or `supplemental` if an unrelated run exists that day) |
| Friday 6:01am, but a watch-completion syncs at 6:02am | past | Yes at 6:01, but... | `completed` from 6:02am on — the next read sees the match and the missed label never persisted anywhere to contradict it |

## Where this is enforced

`web-v2/lib/execution/day-resolution.ts` is the only implementation of this
boundary. `resolveDayStatus()` is the sole call site that decides `missed` vs
`supplemental` vs "not yet due" — no other file re-derives the 6-hour number
or re-implements the past/future comparison for this purpose.
