# Pace-shape truth table (DIRECTION-1, 2026-09-04)

The engine's real shape set — `PrescriptionShape` in `web-v2/lib/training/prescription-resolver.ts` — has exactly **four** values. There is no distinct `floor`, `target`, or `observational` shape; the request to audit those maps onto the real four as noted below rather than inventing types that don't exist.

| Shape | What it asserts | Fails when | Never fails when | Real owner |
|---|---|---|---|---|
| **ceiling** | "Do not go FASTER than this." A one-sided bound. | `avg < ceiling - slack` (running faster than the allowed slack) | Running **slower**, at any distance from the ceiling | `gradeCeilingPhase` |
| **window** | "Hold this, both sides." | `avg < target - tolerance` (fast) OR `avg > target + tolerance` (slow) | Only inside the band | `gradeWorkPhase` |
| **effort** | A target exists but not as a pace (hills, strides, by-feel). | Never — not pace-graded | Always | `gradePhase` routes to `not_graded` |
| **none** | No prescribed pace. This *is* the engine's "observational, report only" case — recorded, never judged. | Never — not pace-graded | Always | `gradePhase` routes to `not_graded` |

**"Floor"** does not exist as a shape in this engine — nothing prescribes a minimum pace with no ceiling. A test asserting its direction would be asserting behavior of code that isn't there.

**Direction convention**: seconds per mile. Smaller number = faster. Larger number = slower. Every shape's fail condition above is written in that convention, not in generic `actual > prescribed` arithmetic — that arithmetic is exactly what the deleted `paceShortfalls` clause got backwards for a ceiling.

## The defect this table exists to prevent

`experience.ts`'s now-deleted `paceShortfalls` clause computed `avgSecPerMi - targetSecPerMi > toleranceSec` on a **ceiling**-shaped phase and reported it as a missed target. For a ceiling, that arithmetic is true precisely when the runner is *slower* — which a ceiling can never fail for. The result: "10.0 mi easy averaged 8:48/mi against 8:00/mi prescribed" was reported as a shortfall when 8:48 against an 8:00 ceiling is fully compliant by construction.

## MP-EMBEDDED-1: the engine gap this exposed

`paceShapeFor` resolves a shape from a phase **type** ('work') and a session **class** ('long') — it has no way to see per-phase *intent*. Every work phase in a `long` session therefore read `ceiling` uniformly, including an embedded marathon-pace-specific segment, whose whole point (`Research/04-workout-vocabulary.md` §4.1, "marathon-specific economy") is to rehearse a real target pace.

Fixed in `lib/execution/verdict.ts`'s `gradeStoredPhases`: a work phase with no explicit wire shape, in a `long`-classified session, whose own **label** matches `/marathon[\s-]*pace/i` now grades as a **window** at `MP_PHASE_TOLERANCE_S_PER_MI` (±5 s/mi — `Research/01-pace-zones-vdot.md`'s M row: "window for general MP segments"), not a ceiling. A phase carrying an explicit wire `paceShape` (Rule 10 — a stamped anchor is read, not guessed) always wins over this detection.

Doctrine-registered: `PACE.marathon-embedded-window-tolerance` in `lib/doctrine/registry.ts`, reading the ±5 figure out of the doc table at run time.

## Boundary matrix — where it's tested

`web-v2/lib/training/_pace_shape_direction.test.ts` (new, 38 cases): comfortably compliant / exactly at boundary / just inside tolerance / just outside tolerance / much faster / much slower / missing pace / missing shape / legacy payload, for both ceiling and window, plus the effort/none refusal cases, plus `paceShapeFor`'s own type+class resolution, plus MP-EMBEDDED-1's detection and wire-precedence, plus the five real-shaped examples below.

## The five real-shaped examples

| # | Case | Shape | Real numbers | Verdict | Plain language |
|---|---|---|---|---|---|
| 1 | Easy ceiling | ceiling | asked 8:42, actual 8:35 | `hit` | 7s faster than the ceiling, inside the 30s slack — compliant. |
| 2 | Easy ceiling | ceiling | asked 8:00, actual 8:48 | `hit` | 48s slower than the ceiling — a ceiling has no slow-side edge, never a miss. |
| 3 | Marathon-effort | window (MP-EMBEDDED-1) | asked 7:14, actual 7:42 | `slow` | 28s slower than a ±5s window — a real, genuine miss. |
| 4 | Sept 1 interval reps | window | 422/429/422/419 vs 430±8 | hit/hit/hit/**fast** | Three landed; the last, 11s under target, is a controlled fast finish, not a miss. |
| 5 | AFC race segments (self-authored) | window | 5 segments, ±12 tolerance | **hit**/slow/slow/slow/slow | One segment (+8s) cleared the band; four (+15 to +105s) did not. |

All five verified against real production data pulled from `faff_readonly` via the walk-substrate copy, 2026-09-04.
