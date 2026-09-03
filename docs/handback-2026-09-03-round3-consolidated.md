# Handback · round 3 — the consolidated one

3 September 2026 · lead engineer report · this is the document you asked for at the end of your
production authorization: rebuild, persisted verification, adaptation evidence, integration and
TestFlight, in one place. Everything below is on `main`, deployed, and in TestFlight build 252
unless marked otherwise.

## Deployed commit and production plan version

`main` at `2b461db7`, confirmed deployed via GitHub commit status polled to resolution (not
merged-status alone) at every push tonight. Production's active plan is `pln_7636bcc0a201bf2d`
(`cim`, authored 2026-09-03 18:43 UTC), replacing `pln_9a57561debb776e5` (authored 2026-08-31,
now archived, not deleted).

## Rollback snapshot — captured, not needed

`docs/rebuild-2026-09-03/snapshot-{training_plans,plan_phases,plan_weeks,plan_workouts,
sealed-days-only}.json`, checksummed, taken before the write. Independent of the engine's own
archive-not-delete mechanism (verified by reading `clearActivePlansFor`'s source: it only sets
`archived_iso`, never deletes a row) and the existing, tested `/api/plan/undo` route. Not
invoked — the rebuild succeeded and passed every persisted check below on the first attempt.

## Classified before/after plan changes

103 persisted rows total (not the previewed 105 — two speculative `NEW DAY` predictions at
08-25/08-29 were correctly dropped at persist time by the composer's own never-author-into-the-
unsealed-past gate). 20 identical, 83 differ:

- **35 KEY** — every long run, every quality session, every workout-type change, individually
  accounted for in `docs/rebuild-2026-09-03/persisted-vs-old-classified.json`.
- **18 EASY_VOLUME** — grouped, routine aerobic-day redistribution, 49.4mi total absolute delta
  across them.
- **30 TRIVIAL** — label-only (e.g. strides added at an unchanged distance).

Marathon-pace mileage: 38.5mi → 22mi across the differing days. Not a new finding — this is
S1.1's own already-audited fix (documented earlier this session as "18 of 33 (55%) → 5 of
~22.6 (22%)" in the final three weeks). The two sessions losing MP content specifically
(11-17, 11-24) are taper onset — `race_week_tuneup`'s 5×400m sharpening reps correctly replacing
MP-heavy work inside CIM's taper window, confirmed against `generate.ts`'s TAPER-phase logic.

## Complete rebuilt plan by week

| Week | Starts | Total mi | Long run | Flags |
|---|---|---|---|---|
| 0 | 2026-08-24 | 38.0 | 13.0 | |
| 1 | 2026-08-31 | 46.5 | 15.0 | |
| 2 | 2026-09-07 | 24.4 | — | cutback |
| 3 | 2026-09-14 | 46.8 | 16.5 | |
| 4 | 2026-09-21 | 55.2 | 17.0 | |
| 5 | 2026-09-28 | 43.0 | 14.0 | cutback |
| 6 | 2026-10-05 | 59.5 | 18.5 | |
| 7 | 2026-10-12 | 59.6 | 20.0 | |
| 8 | 2026-10-19 | 46.0 | 15.0 | cutback |
| 9 | 2026-10-26 | 60.0 | 21.5 | **peak** |
| 10 | 2026-11-02 | 43.2 | — | cutback |
| 11 | 2026-11-09 | 40.5 | 16.0 | |
| 12 | 2026-11-16 | 49.0 | 16.0 | |
| 13 | 2026-11-23 | 36.0 | 10.0 | |
| 14 | 2026-11-30 | 43.7 | — | **race week** (CIM 12-06) |

Peak week 60.0mi, peak long 21.5mi — your own demonstrated ceiling, not a mile under it. Four
cutback weeks at roughly 2-3 week intervals, matching the rhythm S1.5's own independent audit
already verified as doctrine-coherent earlier this session.

## Persisted-versus-composed comparison

Full detail in `docs/rebuild-2026-09-03/`. The headline: **zero mismatches across all 8
completed/sealed days**, checked on every field (type, distance, pace, sub-label, HR cap,
quality flag, long flag, notes) — your training history through yesterday reads exactly as it
did before the rebuild. LTHR (168) and season VDOT anchor (47.7) unchanged since authoring,
confirming the visible differences are structural, not anchor drift.

## Cross-surface, rendered with real data

Screenshots sent directly to you during the session: **Today** (`INTERVALS · 6 mi · 10×1:00
hills · ~168 bpm`, matching the persisted row exactly), **Block** (`QUALITY · 14 weeks to CIM ·
Quality share 31% · Long run 15mi · This week's mileage 46.5mi`), **Races** (94 days to CIM,
Goal 3:00:00, Projected 3:19:43, all 5 races correct). **Watch payload**
(`/api/watch/today`) independently confirmed the same session.

One tooling gap found and worked around, not fixed: the walk-substrate verification tool's seed
script doesn't copy `plan_phases`/`plan_weeks` for a plan created very recently relative to when
it runs — reproduced twice. Production itself had the correct data throughout; this only affected
my local render, not your phone. Worked around by copying the rows from production directly;
filed as tooling debt.

## Adaptation replay distribution and actual decisions

The existing hand-authored, doctrine-grounded replay ledger (`lib/adaptation/canonical/
_replay_ledger.test.ts`, structurally no-lookahead — attacked by an ORACLE test, not merely
asserted) had a real gap: floors existed for PROGRESS/HOLD/REFUSE but nothing exercised REGRESS.
Closed with D14 — two corroborating threshold sessions both meaningfully slower than the held
anchor, the mirror of the existing PROGRESS case (D4). Falsified per Rule 18 (mutating the
sessions to be faster instead correctly fails three assertions), then confirmed clean.

**Current distribution, 14 cases: REFUSE 6 · PROGRESS 5 · HOLD 1 · REGRESS 1.** Bounded — D14's
magnitude is held to ≤5 s/mi despite a ~16-17 s/mi raw delta, the same step discipline PROGRESS
is held to. Travel/reschedule/missing-data non-penalization verified **structural**, not merely
tested: zero references to `plan_reschedules` anywhere in `lib/adaptation/`, and no travel-
specific code exists because none is needed — a day with no run reads through the same
absent-not-zero mechanism (Rule 11) that D6 already proves, never as evidence of decline.

## First production shadow records

Migration 164 (`canonical_adaptation_shadow_log`) applied and verified against production
directly — schema, all 3 CHECK constraints, both FKs, `faff_readonly` SELECT-only grant.
Triggered as a real (non-verification) process, exactly how the `run-adaptations` cron would:

```
WEEKLY_VOLUME   REGRESS   45 → 42.8   (last 3 non-cutback weeks averaged 28.8, below prescribed)
LONG_RUN        REFUSE    6.2, unchanged (1 comparable long run, contract needs 2)
THRESHOLD_PACE  REFUSE    394 s/mi, unchanged (no qualifying session in 28 days)
```

## Mutation authority — who can actually change your plan today

Only the legacy system (`lib/plan/adapt.ts`, via the `run-adaptations` cron). The intermediate
PACE-only shadow-compare and tonight's canonical engine are both structurally shadow-only —
proven from source (`_cannot_mutate.test.ts`, `_never_mutates_plan.test.ts`), not merely
configured that way. Cutover conditions not yet met: a genuine production-data no-lookahead
replay needs `readActivePlan` made date-aware first (it currently reads whichever plan is active
*now*, which would leak lookahead through plan selection even with evidence correctly
date-filtered) — identified, not built, since getting that boundary wrong would be worse than
the honest synthetic replay that exists today. Full reasoning in the master programme.

## CI, deployment, TestFlight

Every push tonight verified CLEAN through the full chain (`npm run prebuild`'s ~20 gates,
`check-web-build.sh`, CI unit tests, `check-watch.sh` where the diff touched watch-relevant
files) before landing on `main`, and deployment confirmed via GitHub commit status polled to
resolution after each one — never assumed from push success alone.

**TestFlight build 252**, distributed to Internal Testers, confirmed via App Store Connect's own
processing status (not assumed from a successful upload). Includes everything above: the
rebuilt plan, the canonical shadow evaluation, and the pre-run experience integration.

## Session integration

**`feat/pre-run-experience` — merged (`578616c7`).** `RunLobbyV5` replaces the two-button
picker with a real pre-run screen; `HR-ROLE-1` is the direct fix for the exact issue you raised
live tonight — a short rep's HR number rendering indistinguishable from a real target — reusing
the existing kinetics-floor constant rather than inventing a new one. Three real findings caught
by the gate chain on merge and fixed, not assumed clean because the branch's own build was
green: a bare padding value, a hand-drawn tilde on a number that was never actually modelled
data, five em dashes. `check-watch.sh` failed once on a known shared-host database-lock
contention (matching this project's own documented precedent), confirmed no concurrent builds
were running, retried clean.

**`feat/postrun-experience-lead` — not merged.** Its own handback states plainly it isn't ready.
Respected rather than grabbed anyway.

## Explicit remaining gaps

**Baseline quality:** done and verified above. The one open item is the walk-substrate seeding
gap (tooling, not production) and the still-open doctrine registry items unrelated to tonight
(age/sex grading, hydration bands) that predate this session.

**Adaptation promotion:** shadow evaluation is real and now has real production rows, and the
replay ledger proves all four verdicts are reachable and bounded — but the canonical engine is
not yet authoritative, and per the mutation-authority section above, the specific blocker
(date-aware plan selection for a genuine no-lookahead production replay) is identified but not
built. Legacy `adapt.ts` remains the sole system that can actually change your plan.

**UI delivery:** pre-run experience is merged and in TestFlight 252. Post-run experience is not
— its own session says it isn't ready. Ranked Sunday reschedule options need pre-run session's
UI half (RS-2/4/6/7/8) built against the contract this session owns (RS-1/3/5, already built).
Treadmill incline/speed prescription was investigated and explicitly not built tonight, per your
instruction — recorded as a scoped follow-up.

Nothing here was assumed. Every claim above traces to a command that was actually run, a file
that was actually read, or a screenshot that was actually taken.
