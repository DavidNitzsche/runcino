# Handback · round 6 — EXECUTION-IDENTITY-1, the adaptation/evidence closure

3 September 2026 · continuing directly from round 5. Deployed commit `3d413f46`
(Railway confirmed `success` on the actual verified commit, `27632f55`, before
two more docs/AppCache commits from the week-strip session merged in cleanly on
top). TestFlight build 260, App Store Connect confirms distributed to Internal
Testers.

## The instruction, and how it's satisfied

You asked me to treat execution identity and adaptation integration as one
integrity closure, with the canonical distinction — prescribed workout,
execution explicitly linked to it, supplemental activity — preserved
everywhere. That distinction now holds in the four places a session's identity
actually gets read: Today, Watch Today, post-run analysis, and the evidence
path that feeds the Adaptation Engine.

## P0 · the adaptation/evidence path, hardened

**The gap.** WORKOUT-EXECUTION-ID-1 (round 5) fixed what the *runner* sees.
`lib/execution/load.ts` — the one function every capacity-belief and
Adaptation Engine reader consumes — still picked "the richest run of the day"
with zero prescription awareness. A threshold session graded off an unrelated
easy run would have silently poisoned VDOT belief, never just painted one
screen wrong.

**The fix.** `loadKeySessionExecutions` now resolves every owned quality day
through a new `resolveDateRangeExecutions` — one batched pass across the whole
range (not N+1 queries), sharing its classification logic with the single-day
resolver so a multi-day caller and Today can never disagree. No match → the
session reads `MISSED`, exactly as if nothing happened.

**Verified against your real account, both directions:**

```
2026-09-01  threshold   matched (legacy_type)   → read.state: AS_PLANNED
2026-09-03  intervals   UNMATCHED (this morning) → read.state: MISSED, actual: null
```

Then, after you actually ran the treadmill session while I was working:

```
2026-09-03  intervals   matched (EXACT via planWorkoutId)  → read.state: PARTIAL_PRODUCTIVE
            run: -240375143823562, source: treadmill, 4.71 mi
            supplemental: -166065474720154 (the friend run), 4.48 mi — still supplemental
```

That's not a synthetic test — that's the actual incident, live, resolved
correctly: your real hill session matched exactly, your friend's earlier run
stayed supplemental, and nothing conflated the two.

**A fourth surface had the same shape.** `lib/postrun/detail-load.ts` —
reached directly by run id, from the log or a supplemental run's own card —
graded whatever run was opened against "today's prescription" regardless of
whether it executed it. Fixed the same way: a run only inherits type/spec/
sub-label when the resolver confirms it's the matched execution. Verified: the
friend's run's analysis reads `sessionTypeDisplay: null` (ungraded); your real
threshold session still returns its full rep-by-rep comparison ("your previous
4×1mi threshold session, 11 weeks ago").

**The passive-sync heuristic, demoted.** Second live find while building the
legacy tier: the friend's run *already* carried `workoutType: 'intervals'`,
`workoutTypeSource: 'plan'` — stamped independently by
`/api/ingest/workout`'s own date+distance heuristic, nothing to do with
whether it was your workout. The legacy tier now requires a **live-tracked
source** (watch/treadmill/phone) before trusting that stamp at all — a passive
sync's type guess can no longer establish identity, completion, sealing, or
grading anywhere the resolver is consulted.

**Two real bugs found auditing `lib/execution/day-resolver.ts` itself:**
- Prescriptions now read through `ownedDaysSql`'s reign-aware plan ownership,
  not a bare `archived_iso IS NULL` join — the latter reads your entire
  executed history as unplanned the instant a block rolls over, which matters
  most for an evidence walk that routinely crosses one.
- Nothing else — the source-gating fix above was the only correctness bug in
  the resolver proper; everything else was extending its coverage.

## The full named matrix — proven, not asserted

22 resolver tests (up from 12 in round 5), covering everything you listed:
exact linked execution · one legacy app-tracked execution with unambiguous
type · passive synced run on a prescribed day · supplemental before the
prescribed workout · supplemental after it (array order proven irrelevant
both ways) · two runs of the same apparent type (refuses, never guesses) ·
a partial prescribed execution plus a supplemental run · treadmill, phone and
watch executions · a delayed HealthKit duplicate resolving to ONE execution
via canonical dedup (never re-admitted here) · a rescheduled workout matched
on its new date · a race day with warm-up/cooldown activities staying
supplemental · a day with no prescription at all · and
`resolveDateRangeExecutions` batching two independent days without
cross-contamination.

**Falsified per Rule 18** on the two highest-risk new tests — both catch the
exact regression they're named for when I broke them on purpose.

**Idempotency** is proven at the right layer: canonical dedup
(`getCanonicalRunIds`) is this app's one authority for "which physical run is
real," and the resolver's contract is to trust it completely — the test wires
a duplicate row but only the survivor's id in `canonicalIds`, and confirms the
loser never appears anywhere in the resolved day, matched or supplemental.
Re-deriving dedup logic inside the resolver would be a second, competing
answer to a question this app already has one owner for.

## Three of this repo's own gates caught real issues before they landed

Rule 18 in action, three times on one commit: two new blind
`.catch(() => null)` sites (coercion-scan) now observe their error before
defaulting; one `EMPTIED`-ratchet entry got deleted 2-for-1 when only one of
two sites actually closed (swallow-scan), corrected and the other restored;
one legitimate two-row tie-break needed an argued allowlist entry
(derived-consistency). All three: the gate found it, not a review.

## The four remaining items, closed

**1 · Treadmill.** Warm-up, recovery and cooldown now carry intentional,
doctrine-cited incline/speed (`TERRAIN.treadmill-air-resistance-grade`, 1% —
"a treadmill run at 1% is a FLAT run") instead of the client's unexplained
hardcoded fallback. Swift's `nominalMph`/`nominalInclinePct` read the
server's per-phase value first. Live HR is now suppressed specifically during
the 60-second work reps (`hrRoleForRepDuration`'s `.observational` case) —
scoped to work phases only, so a genuinely-readable warm-up/recovery/cooldown
HR is never hidden for the wrong reason. Manual speed/incline adjustment was
already recorded as a runner input, never overwriting the plan target —
verified existing, not rebuilt.

**2 · Multi-run-day UI.** Built, not just API-ready. Prescribed workout stays
the Today hero; supplemental runs render as compact secondary rows
underneath, on both the before-run and after-run screens (`ListGroup`/
`ListRow` — no new component invented, the existing house pattern). No
verdict, no workout-type label — visible, never masquerading as completion.
`V5Today.supplementalRuns`, always present, built from the same `runFacts`
basis the hero itself uses.

**3 · TestFlight.** Build 260 confirmed distributed to Internal Testers.
Physical-device confirmation is yours — I can't drive your phone directly,
only the simulator, where the build compiles and boots clean.

**4 · Pace-recompute audit.** Found a real gap auditing it: `recomputePacesForPlan`
rewrote 72 workouts' paces this morning but never bumped `last_adapted_at` —
exactly the "in-place pace re-anchor" trigger `PLANVERSION-1`'s own doc
comment names as a cache-bust condition. So no client cache keyed on
`${id}:${last_adapted_at}` (Today, week strip, watch) had any signal 72 rows
had changed underneath it. Fixed, gated on something having actually changed
(never a spurious bust on a no-op recompute). **Not re-run against the
currently active plan** — the existing stamp from this morning is one
recompute behind this fix, a single-column `UPDATE training_plans SET
last_adapted_at = now() WHERE id = 'pln_7636bcc0a201bf2d'` away. Held for your
explicit go, per this repo's data-write discipline — say the word and it's one
statement.

## What's still genuinely open

- The `generate.ts` mid-block detection signal (`detectMidBlock` signal 2)
  reads a run's `workoutType` — including a passively-stamped one — as part of
  a 3-signal, ≥2-of-N habit check for plan composition. Found, not fixed:
  lower stakes than completion/grading (a habit signal, redundant with two
  other signals, feeding a composition decision rather than a specific
  session's grade), and `lib/plan/generate.ts` is sensitive enough — its own
  dosing-cap and doctrine gates — that I didn't want to touch it inside this
  same pass without it being the explicit next target.
- Age/sex grading and hydration bands (`Research/24`, `Research/19`) — genuinely
  unrelated to this work, listed here only because CLAUDE.md's own registry
  checklist still carries them as open.

Nothing here was assumed. Every claim traces to a command actually run, a file
actually read, or a production query actually executed against your account.
